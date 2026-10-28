"""Explicit one-time provisioning. Never called by startup, login or reads."""

import hashlib
from uuid import uuid4

from .application_auth_policy import MODULES
from .application_users import ApplicationUser, AccountConflict, _insert, _metadata, hash_password, normalize_email
from ..application_users_schema import verify_application_users_schema


def bootstrap_administrator(connection, *, name, email, password, organization_id, signing_key):
    """Caller owns the transaction. Failure rolls back both account and marker."""
    if not isinstance(password, str) or not 16 <= len(password) <= 1024:
        raise ValueError("Administrator password must contain 16 to 1024 characters")
    if not isinstance(signing_key, str) or len(signing_key.encode()) < 32:
        raise ValueError("Secure shared signing key required")
    name, role, organization_id, modules = _metadata(name.strip(), "admin", organization_id, list(MODULES))
    email = normalize_email(email)
    verify_application_users_schema(connection)
    connection.execute("SELECT pg_advisory_xact_lock(360028102028)")
    connection.execute("LOCK TABLE application_users IN SHARE ROW EXCLUSIVE MODE")
    if connection.execute("SELECT 1 FROM application_auth_bootstrap WHERE singleton=1").fetchone():
        raise AccountConflict("Administrator bootstrap has already completed")
    if connection.execute("SELECT 1 FROM application_users WHERE role='admin' OR email=%s", (email,)).fetchone():
        raise AccountConflict("Administrator or account already exists; bootstrap refused")
    user = ApplicationUser(str(uuid4()), email, name, hash_password(password), role, organization_id, modules)
    _insert(connection, user)
    connection.execute("""INSERT INTO application_auth_bootstrap
        (singleton,administrator_id,signing_key_digest) VALUES (1,%s,%s)""",
                       (user.id, hashlib.sha256(signing_key.encode()).hexdigest()))
    return user
