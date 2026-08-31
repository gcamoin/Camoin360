import hashlib
import hmac
import secrets

import psycopg

from ..database import get_database_connection
from ..models.client_user import ClientUser


HASH_ITERATIONS = 120000


def hash_password(password: str, salt: str | None = None):
    salt = salt or secrets.token_hex(16)
    password_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        HASH_ITERATIONS,
    ).hex()
    return f"pbkdf2_sha256${HASH_ITERATIONS}${salt}${password_hash}"


def verify_password(password: str, stored_password_hash: str):
    try:
        algorithm, iterations, salt, expected_hash = stored_password_hash.split("$", 3)
    except ValueError:
        return False

    if algorithm != "pbkdf2_sha256":
        return False

    candidate_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        int(iterations),
    ).hex()
    return hmac.compare_digest(candidate_hash, expected_hash)


def _select_user_by_id(connection, user_id: int):
    return connection.execute(
        """
        SELECT client_users.id, client_users.organization_id, organizations.organization_name,
               client_users.name, client_users.username, client_users.password_hash,
               client_users.role, client_users.created_at, client_users.updated_at
        FROM client_users
        JOIN organizations ON organizations.id = client_users.organization_id
        WHERE client_users.id = ?
        """,
        (user_id,),
    ).fetchone()


def _ensure_organization_exists(connection, organization_id: int):
    organization = connection.execute(
        "SELECT id FROM organizations WHERE id = ?",
        (organization_id,),
    ).fetchone()
    if organization is None:
        raise LookupError("Organization not found")


def list_client_users(organization_id: int | None = None):
    parameters = ()
    organization_filter = ""

    if organization_id is not None:
        organization_filter = "WHERE client_users.organization_id = ?"
        parameters = (organization_id,)

    with get_database_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT client_users.id, client_users.organization_id, organizations.organization_name,
                   client_users.name, client_users.username, client_users.password_hash,
                   client_users.role, client_users.created_at, client_users.updated_at
            FROM client_users
            JOIN organizations ON organizations.id = client_users.organization_id
            {organization_filter}
            ORDER BY LOWER(organizations.organization_name) ASC,
                     LOWER(client_users.name) ASC
            """,
            parameters,
        ).fetchall()

    return [ClientUser.from_row(row) for row in rows]


def get_client_user(user_id: int):
    with get_database_connection() as connection:
        row = _select_user_by_id(connection, user_id)

    if row is None:
        raise LookupError("User not found")

    return ClientUser.from_row(row)


def create_client_user(user_details: dict):
    with get_database_connection() as connection:
        _ensure_organization_exists(connection, int(user_details["organization_id"]))

        try:
            cursor = connection.execute(
                """
                INSERT INTO client_users (
                    organization_id, name, username, password_hash, role
                )
                VALUES (?, ?, ?, ?, ?)
                RETURNING id
                """,
                (
                    int(user_details["organization_id"]),
                    user_details["name"],
                    user_details["username"].lower(),
                    hash_password(user_details["password"]),
                    user_details.get("role") or "user",
                ),
            )
        except psycopg.IntegrityError as exc:
            raise ValueError("Username already exists") from exc

        new_user_id = cursor.fetchone()["id"]

        connection.execute(
            """
            UPDATE organizations
            SET user_count = (
                SELECT COUNT(*) FROM client_users WHERE organization_id = ?
            ),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (int(user_details["organization_id"]), int(user_details["organization_id"])),
        )
        row = _select_user_by_id(connection, new_user_id)

    return ClientUser.from_row(row)


def update_client_user(user_id: int, user_details: dict):
    with get_database_connection() as connection:
        existing_row = _select_user_by_id(connection, user_id)
        if existing_row is None:
            raise LookupError("User not found")

        existing_user = ClientUser.from_row(existing_row)
        next_organization_id = int(user_details.get("organization_id") or existing_user.organization_id)
        _ensure_organization_exists(connection, next_organization_id)

        try:
            connection.execute(
                """
                UPDATE client_users
                SET organization_id = ?,
                    name = ?,
                    username = ?,
                    role = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (
                    next_organization_id,
                    user_details.get("name") or existing_user.name,
                    (user_details.get("username") or existing_user.username).lower(),
                    user_details.get("role") or existing_user.role,
                    user_id,
                ),
            )
        except psycopg.IntegrityError as exc:
            raise ValueError("Username already exists") from exc

        for organization_id in {existing_user.organization_id, next_organization_id}:
            connection.execute(
                """
                UPDATE organizations
                SET user_count = (
                    SELECT COUNT(*) FROM client_users WHERE organization_id = ?
                ),
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (organization_id, organization_id),
            )

        row = _select_user_by_id(connection, user_id)

    return ClientUser.from_row(row)


def delete_client_user(user_id: int):
    with get_database_connection() as connection:
        existing_row = _select_user_by_id(connection, user_id)
        if existing_row is None:
            raise LookupError("User not found")

        organization_id = int(existing_row["organization_id"])
        connection.execute("DELETE FROM client_users WHERE id = ?", (user_id,))
        connection.execute(
            """
            UPDATE organizations
            SET user_count = (
                SELECT COUNT(*) FROM client_users WHERE organization_id = ?
            ),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (organization_id, organization_id),
        )


def reset_client_user_password(user_id: int, password: str):
    with get_database_connection() as connection:
        existing_row = _select_user_by_id(connection, user_id)
        if existing_row is None:
            raise LookupError("User not found")

        connection.execute(
            """
            UPDATE client_users
            SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (hash_password(password), user_id),
        )
        row = _select_user_by_id(connection, user_id)

    return ClientUser.from_row(row)
