"""Persistent application authentication accounts.

No JSON reads or implicit provisioning. Only explicit callers create accounts.
Historical import helpers remain operator-only. Do not log credential records.
"""

from contextlib import contextmanager
from dataclasses import dataclass, field
import hashlib
import hmac
import re
import secrets
from uuid import uuid4

import psycopg
from psycopg.types.json import Jsonb

from ..database import get_auth_database_connection as get_database_connection


class AccountConflict(ValueError):
    """An identity already exists, or an import requires manual reconciliation."""


class AccountStorageError(RuntimeError):
    """Sanitized database error; never includes SQL parameters or connection URLs."""


def _validate_postgres_text(value):
    if not isinstance(value, str) or "\x00" in value:
        raise ValueError("PostgreSQL-compatible text required")
    try:
        value.encode("utf-8")
    except UnicodeError:
        raise ValueError("PostgreSQL-compatible text required") from None


def normalize_email(email):
    if not isinstance(email, str):
        raise ValueError("Valid email required")
    _validate_postgres_text(email)
    email = email.strip().lower()
    if "@" not in email or any(character.isspace() for character in email):
        raise ValueError("Valid email required")
    return email


def validate_password_hash(value):
    # The deployed legacy format is salt:PBKDF2-HMAC-SHA256, 120000 iterations.
    if not isinstance(value, str) or not re.fullmatch(r"[^:]{1,256}:[0-9a-f]{64}", value):
        raise ValueError("Unsupported password hash format")
    _validate_postgres_text(value)
    return value


def hash_password(password):
    if not isinstance(password, str) or len(password) < 8:
        raise ValueError("Password must contain at least 8 characters")
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120000).hex()
    return f"{salt}:{digest}"


def verify_password(password, stored_hash):
    try:
        validate_password_hash(stored_hash)
        salt, expected = stored_hash.split(":", 1)
        candidate = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120000).hex()
        return hmac.compare_digest(candidate, expected)
    except (ValueError, TypeError, AttributeError, UnicodeError):
        return False


def _metadata(name, role, organization_id, modules):
    if not isinstance(name, str) or not name.strip():
        raise ValueError("Valid name required")
    if not isinstance(role, str) or not role.strip():
        raise ValueError("Valid role required")
    if type(organization_id) is not int or not 0 < organization_id <= 9223372036854775807:
        raise ValueError("Valid organization ID required")
    if not isinstance(modules, (list, tuple)) or any(not isinstance(m, str) or not m for m in modules):
        raise ValueError("Valid module permissions required")
    for value in (name, role, *modules):
        _validate_postgres_text(value)
    return name, role, organization_id, tuple(modules)


@dataclass(frozen=True)
class ApplicationUser:
    id: str
    email: str
    name: str
    password_hash: str = field(repr=False)
    role: str
    organization_id: int
    modules: tuple[str, ...]
    # Keep the exact original JSON ID (including its type) as well as a stable key.
    legacy_id: str | int | None = None

    def public_dict(self):
        """Existing /auth/users response shape, with no credential material."""
        return {"name": self.name, "email": self.email, "role": self.role,
                "organization_id": self.organization_id, "modules": list(self.modules)}

    def has_module(self, module):
        return self.role == "admin" or module in self.modules

    @classmethod
    def from_row(cls, row):
        return cls(**{**row, "modules": tuple(row["modules"])})


_COLUMNS = "id, legacy_id, email, name, password_hash, role, organization_id, modules"


@contextmanager
def _connection():
    try:
        with get_database_connection() as connection:
            yield connection
    except psycopg.errors.UniqueViolation:
        raise AccountConflict("Account identity already exists") from None
    except psycopg.Error:
        # PostgreSQL constraint errors can include the entire failing row.
        raise AccountStorageError("Account persistence failed") from None


def _find(connection, email, *, lock=False):
    row = connection.execute(
        f"SELECT {_COLUMNS} FROM application_users WHERE email = ?" + (" FOR UPDATE" if lock else ""),
        (email,),
    ).fetchone()
    return ApplicationUser.from_row(row) if row else None


def _insert(connection, user, *, importing=False):
    connection.execute(
        "INSERT INTO application_users (" + _COLUMNS + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        + (" ON CONFLICT DO NOTHING" if importing else ""),
        (user.id, Jsonb(user.legacy_id) if user.legacy_id is not None else None,
         user.email, user.name, user.password_hash, user.role, user.organization_id, list(user.modules)),
    )


def accounts_match(expected, actual):
    """Credential-safe comparison shared by import and operator verification.

    ID-less snapshots cannot predict their generated database ID. Explicit legacy
    IDs must match both the stable key and their original JSON type.
    """
    return actual is not None and (
        expected.public_dict() == actual.public_dict()
        and hmac.compare_digest(expected.password_hash.encode(), actual.password_hash.encode())
        and type(expected.legacy_id) is type(actual.legacy_id)
        and expected.legacy_id == actual.legacy_id
        and (expected.legacy_id is None or expected.id == actual.id)
    )


def create_user(*, name, email, password, organization_id, modules=(), role="user"):
    name, role, organization_id, modules = _metadata(name, role, organization_id, modules)
    user = ApplicationUser(str(uuid4()), normalize_email(email), name, hash_password(password),
                           role, organization_id, modules)
    with _connection() as connection:
        _insert(connection, user)
    return user


def get_user(email):
    with _connection() as connection:
        return _find(connection, normalize_email(email))


def list_users():
    with _connection() as connection:
        rows = connection.execute(f"SELECT {_COLUMNS} FROM application_users ORDER BY email").fetchall()
    return [ApplicationUser.from_row(row) for row in rows]


def authenticate(email, password):
    user = get_user(email)
    return user if user and verify_password(password, user.password_hash) else None


def update_user(email, *, name=None, password=None, modules=None, protect_admin=False):
    """Lock the row so independent concurrent edits do not overwrite one another."""
    with _connection() as connection:
        user = _find(connection, normalize_email(email), lock=True)
        if user is None:
            raise LookupError("User not found")
        if protect_admin and user.role == "admin":
            raise PermissionError("Administrator account is protected")
        next_name, _, _, next_modules = _metadata(
            user.name if name is None else name, user.role, user.organization_id,
            user.modules if modules is None else modules,
        )
        next_hash = user.password_hash if password is None else hash_password(password)
        connection.execute(
            """UPDATE application_users SET name = ?, password_hash = ?, modules = ?,
               updated_at = CURRENT_TIMESTAMP WHERE email = ?""",
            (next_name, next_hash, list(next_modules), user.email),
        )
        updated = _find(connection, user.email)
    return updated


def delete_user(email, *, protect_admin=False):
    with _connection() as connection:
        if protect_admin:
            user = _find(connection, normalize_email(email), lock=True)
            if user is not None and user.role == "admin":
                raise PermissionError("Administrator account is protected")
        row = connection.execute("DELETE FROM application_users WHERE email = ? RETURNING id",
                                 (normalize_email(email),)).fetchone()
        if row is None:
            raise LookupError("User not found")


def import_accounts(accounts):
    """Explicit, atomic, insert-only import of reconciled records; no file access.

    Identical reruns are harmless. Any differing account aborts the whole batch.
    No credentials or account identifiers appear in conflict messages.
    """
    imported = 0
    with _connection() as connection:
        # Serialize operators importing overlapping snapshots. Normal writes still
        # enforce uniqueness; a conflicting concurrent create aborts this import.
        connection.execute("SELECT pg_advisory_xact_lock(360028102026)")
        for account in accounts:
            if not isinstance(account, ApplicationUser):
                raise ValueError("Reconciled application accounts required")
            if not isinstance(account.id, str) or not account.id.strip():
                raise ValueError("Valid account ID required")
            _validate_postgres_text(account.id)
            if account.legacy_id is not None and (
                type(account.legacy_id) not in (str, int) or str(account.legacy_id) != account.id
            ):
                raise ValueError("Original account ID must be preserved")
            if normalize_email(account.email) != account.email:
                raise ValueError("Normalized email required")
            validate_password_hash(account.password_hash)
            _metadata(account.name, account.role, account.organization_id, account.modules)
            before = _find(connection, account.email)
            _insert(connection, account, importing=True)
            stored = _find(connection, account.email)
            # Generated IDs are deliberately ignored on reruns of ID-less JSON.
            if not accounts_match(account, stored):
                raise AccountConflict("Import requires manual account reconciliation")
            imported += before is None
    return imported
