from ..database import get_database_connection
from ..models.software_subscription import SoftwareSubscription


SOFTWARE_SUBSCRIPTION_COLUMNS = """
    id, name, description, point_of_contact, assigned_users,
    cost_2024_2025, cost_2025_2026, cost_2026_2027,
    renewal_time_frame, vendor_rep, subscribed_since, status, notes,
    created_at, updated_at
"""


def _select_subscription_by_id(connection, subscription_id: int):
    return connection.execute(
        f"""
        SELECT {SOFTWARE_SUBSCRIPTION_COLUMNS}
        FROM software_subscriptions
        WHERE id = ?
        """,
        (subscription_id,),
    ).fetchone()


def list_software_subscriptions():
    with get_database_connection() as connection:
        rows = connection.execute(
            f"""
            SELECT {SOFTWARE_SUBSCRIPTION_COLUMNS}
            FROM software_subscriptions
            ORDER BY name COLLATE NOCASE ASC
            """
        ).fetchall()

    return [SoftwareSubscription.from_row(row) for row in rows]


def get_software_subscription(subscription_id: int):
    with get_database_connection() as connection:
        row = _select_subscription_by_id(connection, subscription_id)

    if row is None:
        raise LookupError("Software subscription not found")

    return SoftwareSubscription.from_row(row)


def create_software_subscription(subscription_details: dict):
    with get_database_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO software_subscriptions (
                name, description, point_of_contact, assigned_users,
                cost_2024_2025, cost_2025_2026, cost_2026_2027,
                renewal_time_frame, vendor_rep, subscribed_since, status, notes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                subscription_details["name"],
                subscription_details.get("description") or "",
                subscription_details["point_of_contact"],
                subscription_details.get("assigned_users") or "",
                subscription_details.get("cost_2024_2025"),
                subscription_details.get("cost_2025_2026"),
                subscription_details.get("cost_2026_2027"),
                subscription_details["renewal_time_frame"],
                subscription_details.get("vendor_rep") or "",
                subscription_details.get("subscribed_since") or "",
                subscription_details["status"],
                subscription_details.get("notes") or "",
            ),
        )
        row = _select_subscription_by_id(connection, cursor.lastrowid)

    return SoftwareSubscription.from_row(row)


def update_software_subscription(subscription_id: int, subscription_details: dict):
    with get_database_connection() as connection:
        existing_row = _select_subscription_by_id(connection, subscription_id)
        if existing_row is None:
            raise LookupError("Software subscription not found")

        existing = SoftwareSubscription.from_row(existing_row)
        connection.execute(
            """
            UPDATE software_subscriptions
            SET name = ?,
                description = ?,
                point_of_contact = ?,
                assigned_users = ?,
                cost_2024_2025 = ?,
                cost_2025_2026 = ?,
                cost_2026_2027 = ?,
                renewal_time_frame = ?,
                vendor_rep = ?,
                subscribed_since = ?,
                status = ?,
                notes = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                subscription_details.get("name") or existing.name,
                subscription_details["description"]
                if "description" in subscription_details
                else existing.description,
                subscription_details.get("point_of_contact") or existing.point_of_contact,
                subscription_details["assigned_users"]
                if "assigned_users" in subscription_details
                else existing.assigned_users,
                subscription_details["cost_2024_2025"]
                if "cost_2024_2025" in subscription_details
                else existing.cost_2024_2025,
                subscription_details["cost_2025_2026"]
                if "cost_2025_2026" in subscription_details
                else existing.cost_2025_2026,
                subscription_details["cost_2026_2027"]
                if "cost_2026_2027" in subscription_details
                else existing.cost_2026_2027,
                subscription_details.get("renewal_time_frame") or existing.renewal_time_frame,
                subscription_details["vendor_rep"]
                if "vendor_rep" in subscription_details
                else existing.vendor_rep,
                subscription_details["subscribed_since"]
                if "subscribed_since" in subscription_details
                else existing.subscribed_since,
                subscription_details.get("status") or existing.status,
                subscription_details["notes"]
                if "notes" in subscription_details
                else existing.notes,
                subscription_id,
            ),
        )
        row = _select_subscription_by_id(connection, subscription_id)

    return SoftwareSubscription.from_row(row)


def delete_software_subscription(subscription_id: int):
    with get_database_connection() as connection:
        existing_row = _select_subscription_by_id(connection, subscription_id)
        if existing_row is None:
            raise LookupError("Software subscription not found")

        connection.execute("DELETE FROM software_subscriptions WHERE id = ?", (subscription_id,))
