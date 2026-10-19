from uuid import uuid4

from ..database import get_database_connection
from ..models.organization import Organization


def list_organizations():
    with get_database_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, dynamics_account_id, organization_name, city, state, user_count,
                   contract_expiration, created_at, updated_at
            FROM organizations
            ORDER BY LOWER(organization_name) ASC
            """
        ).fetchall()

    return [Organization.from_row(row) for row in rows]


def list_manual_organizations():
    with get_database_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, dynamics_account_id, organization_name, city, state, user_count,
                   contract_expiration, created_at, updated_at
            FROM organizations
            WHERE dynamics_account_id LIKE 'manual-%'
            ORDER BY LOWER(organization_name) ASC
            """
        ).fetchall()

    return [Organization.from_row(row) for row in rows]


def _select_organization_by_id(connection, organization_id: int):
    return connection.execute(
        """
        SELECT id, dynamics_account_id, organization_name, city, state, user_count,
               contract_expiration, created_at, updated_at
        FROM organizations
        WHERE id = ?
        """,
        (organization_id,),
    ).fetchone()


def get_organization(organization_id: int):
    with get_database_connection() as connection:
        row = _select_organization_by_id(connection, organization_id)

    if row is None:
        raise LookupError("Organization not found")

    return Organization.from_row(row)


def create_organization(organization_details: dict):
    with get_database_connection() as connection:
        dynamics_account_id = f"manual-{uuid4()}"
        connection.execute(
            """
            INSERT INTO organizations (
                dynamics_account_id, organization_name, city, state, user_count,
                contract_expiration
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                dynamics_account_id,
                organization_details["organization_name"],
                organization_details.get("city") or "",
                organization_details.get("state") or "",
                0,
                organization_details.get("contract_expiration"),
            ),
        )
        row = connection.execute(
            """
            SELECT id, dynamics_account_id, organization_name, city, state, user_count,
                   contract_expiration, created_at, updated_at
            FROM organizations
            WHERE dynamics_account_id = ?
            """,
            (dynamics_account_id,),
        ).fetchone()

    return Organization.from_row(row)


def upsert_organization(organization: dict):
    with get_database_connection() as connection:
        connection.execute(
            """
            INSERT INTO organizations (
                dynamics_account_id, organization_name, city, state, user_count,
                contract_expiration
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(dynamics_account_id) DO UPDATE SET
                organization_name = excluded.organization_name,
                city = excluded.city,
                state = excluded.state,
                contract_expiration = excluded.contract_expiration,
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                organization["account_id"],
                organization["client_name"],
                organization.get("city") or "",
                organization.get("state") or "",
                0,
                organization.get("contract_expiration"),
            ),
        )
        connection.execute(
            """
            UPDATE organizations
            SET user_count = (
                SELECT COUNT(*)
                FROM client_users
                WHERE client_users.organization_id = organizations.id
            )
            WHERE dynamics_account_id = ?
            """,
            (organization["account_id"],),
        )
        row = connection.execute(
            """
            SELECT id, dynamics_account_id, organization_name, city, state, user_count,
                   contract_expiration, created_at, updated_at
            FROM organizations
            WHERE dynamics_account_id = ?
            """,
            (organization["account_id"],),
        ).fetchone()

    return Organization.from_row(row)


def sync_organizations(organizations: list[dict]):
    return [upsert_organization(organization) for organization in organizations]


def update_organization(organization_id: int, organization_details: dict):
    with get_database_connection() as connection:
        existing_row = _select_organization_by_id(connection, organization_id)
        if existing_row is None:
            raise LookupError("Organization not found")

        existing_organization = Organization.from_row(existing_row)
        connection.execute(
            """
            UPDATE organizations
            SET organization_name = ?,
                city = ?,
                state = ?,
                contract_expiration = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                organization_details.get("organization_name") or existing_organization.organization_name,
                organization_details.get("city")
                if organization_details.get("city") is not None
                else existing_organization.city,
                organization_details.get("state")
                if organization_details.get("state") is not None
                else existing_organization.state,
                organization_details["contract_expiration"]
                if "contract_expiration" in organization_details
                else existing_organization.contract_expiration,
                organization_id,
            ),
        )
        row = _select_organization_by_id(connection, organization_id)

    return Organization.from_row(row)


def delete_organization(organization_id: int):
    with get_database_connection() as connection:
        existing_row = _select_organization_by_id(connection, organization_id)
        if existing_row is None:
            raise LookupError("Organization not found")

        connection.execute("DELETE FROM client_users WHERE organization_id = ?", (organization_id,))
        connection.execute("DELETE FROM organizations WHERE id = ?", (organization_id,))


def increment_organization_user_count(dynamics_account_id: str):
    with get_database_connection() as connection:
        connection.execute(
            """
            UPDATE organizations
            SET user_count = user_count + 1, updated_at = CURRENT_TIMESTAMP
            WHERE dynamics_account_id = ?
            """,
            (dynamics_account_id,),
        )
