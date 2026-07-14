import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path


DEFAULT_DATABASE_PATH = Path(__file__).resolve().parent / "data" / "client_management.db"
DATABASE_PATH = Path(os.getenv("CLIENT_MANAGEMENT_DATABASE_PATH", DEFAULT_DATABASE_PATH))


def initialize_database():
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS organizations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dynamics_account_id TEXT NOT NULL UNIQUE,
                organization_name TEXT NOT NULL,
                city TEXT NOT NULL DEFAULT '',
                state TEXT NOT NULL DEFAULT '',
                user_count INTEGER NOT NULL DEFAULT 0,
                contract_expiration TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_organizations_name ON organizations (organization_name)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS client_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_client_users_organization_id ON client_users (organization_id)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_client_users_username ON client_users (username)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS software_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                point_of_contact TEXT NOT NULL,
                assigned_users TEXT NOT NULL DEFAULT '',
                cost_2024_2025 REAL,
                cost_2025_2026 REAL,
                cost_2026_2027 REAL,
                renewal_time_frame TEXT NOT NULL,
                vendor_rep TEXT NOT NULL DEFAULT '',
                subscribed_since TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_software_subscriptions_status ON software_subscriptions (status)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_software_subscriptions_contact ON software_subscriptions (point_of_contact)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS account_data_quality_cache (
                accountid TEXT PRIMARY KEY,
                name TEXT NOT NULL DEFAULT '',
                address1_stateorprovince TEXT NOT NULL DEFAULT '',
                address1_country TEXT NOT NULL DEFAULT '',
                address1_city TEXT NOT NULL DEFAULT '',
                new_sector TEXT NOT NULL DEFAULT '',
                new_subsector TEXT NOT NULL DEFAULT '',
                new_naicstext TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                websiteurl TEXT NOT NULL DEFAULT '',
                telephone1 TEXT NOT NULL DEFAULT '',
                new_datasource TEXT NOT NULL DEFAULT '',
                new_employees TEXT NOT NULL DEFAULT '',
                missing_field_keys TEXT NOT NULL DEFAULT '',
                missing_fields_summary TEXT NOT NULL DEFAULT '',
                data_quality_score INTEGER NOT NULL DEFAULT 0,
                has_missing_quality_field INTEGER NOT NULL DEFAULT 0,
                search_text TEXT NOT NULL DEFAULT '',
                synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_account_quality_name ON account_data_quality_cache (name COLLATE NOCASE)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_account_quality_sector ON account_data_quality_cache (new_sector)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_account_quality_country ON account_data_quality_cache (address1_country)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_account_quality_state ON account_data_quality_cache (address1_stateorprovince)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_account_quality_city ON account_data_quality_cache (address1_city)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS account_data_quality_sync (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                status TEXT NOT NULL DEFAULT 'idle',
                last_started_at TEXT,
                last_completed_at TEXT,
                last_error TEXT NOT NULL DEFAULT '',
                row_count INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        connection.execute(
            """
            INSERT OR IGNORE INTO account_data_quality_sync (id, status, row_count)
            VALUES (1, 'idle', 0)
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS marketing_metrics_cache (
                range_key TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'idle',
                last_started_at TEXT,
                last_completed_at TEXT,
                last_error TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS employee_productivity_cache (
                cache_key TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'idle',
                last_started_at TEXT,
                last_completed_at TEXT,
                last_error TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        subscription_count = connection.execute(
            "SELECT COUNT(*) FROM software_subscriptions"
        ).fetchone()[0]
        if subscription_count == 0:
            connection.executemany(
                """
                INSERT INTO software_subscriptions (
                    name, description, point_of_contact, assigned_users,
                    cost_2024_2025, cost_2025_2026, cost_2026_2027,
                    renewal_time_frame, vendor_rep, subscribed_since, status, notes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        "ArcGIS Online",
                        "Cloud mapping and spatial analysis platform used for project maps and data visualization.",
                        "Operations",
                        "Planning and analyst team",
                        2800,
                        3100,
                        3300,
                        "Annual - July",
                        "Esri Customer Success",
                        "2018",
                        "Active",
                        "Confirm named-user allocation before the next renewal.",
                    ),
                    (
                        "Lightcast Analyst",
                        "Labor market and economic data subscription for workforce and industry analysis.",
                        "Research",
                        "Research team",
                        14500,
                        15250,
                        None,
                        "Annual - September",
                        "Account Manager TBD",
                        "2020",
                        "Pending Renewal",
                        "2026-2027 pricing pending vendor quote.",
                    ),
                    (
                        "ZoomInfo",
                        "Business contact and company intelligence used for prospecting and market research.",
                        "Marketing",
                        "Marketing and business development",
                        12000,
                        12600,
                        13200,
                        "Annual - March",
                        "",
                        "2022",
                        "Needs Review",
                        "Vendor contact needs to be confirmed.",
                    ),
                    (
                        "Canva Teams",
                        "Design collaboration workspace for branded reports, presentations, and marketing assets.",
                        "Marketing",
                        "Marketing and project managers",
                        1500,
                        1800,
                        2100,
                        "Annual - December",
                        "Canva Support",
                        "2021",
                        "Active",
                        "Review seat count quarterly.",
                    ),
                ],
            )


@contextmanager
def get_database_connection():
    initialize_database()
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row

    try:
        yield connection
        connection.commit()
    finally:
        connection.close()
