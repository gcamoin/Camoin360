import os
import re
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row


DATABASE_URL = os.getenv("DATABASE_URL")

_initialized = False

_NAMED_PLACEHOLDER_PATTERN = re.compile(r":([a-zA-Z_][a-zA-Z0-9_]*)")


def _require_database_url() -> str:
    if not DATABASE_URL:
        raise RuntimeError(
            "DATABASE_URL environment variable is not set. Set it to a PostgreSQL "
            "connection string (Render provides this automatically in production; "
            "for local development, point it at a local PostgreSQL instance)."
        )
    return DATABASE_URL


def _connect():
    return psycopg.connect(_require_database_url(), row_factory=dict_row)


def _translate_placeholders(sql: str, parameters):
    """Translate sqlite-style '?' / ':name' placeholders to psycopg's '%s' / '%(name)s'."""
    if parameters is None:
        return sql
    if isinstance(parameters, dict):
        return _NAMED_PLACEHOLDER_PATTERN.sub(r"%(\1)s", sql)
    return sql.replace("?", "%s")


class _CompatConnection:
    """Wraps a psycopg connection so existing sqlite3-style call sites keep working:
    connection.execute(sql, params).fetchone()/.fetchall() with '?' / ':name' placeholders.
    """

    def __init__(self, connection):
        self._connection = connection

    def execute(self, sql, parameters=None):
        translated = _translate_placeholders(sql, parameters)
        if parameters is None:
            return self._connection.execute(translated)
        return self._connection.execute(translated, parameters)

    def executemany(self, sql, seq_of_parameters):
        seq_of_parameters = list(seq_of_parameters)
        if not seq_of_parameters:
            return
        translated = _translate_placeholders(sql, seq_of_parameters[0])
        cursor = self._connection.cursor()
        cursor.executemany(translated, seq_of_parameters)
        return cursor

    def commit(self):
        self._connection.commit()

    def __getattr__(self, name):
        return getattr(self._connection, name)


def initialize_database(force: bool = False):
    global _initialized
    if _initialized and not force:
        return

    connection = _connect()
    wrapped = _CompatConnection(connection)
    try:
        wrapped.execute(
            """
            CREATE TABLE IF NOT EXISTS organizations (
                id SERIAL PRIMARY KEY,
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
        wrapped.execute(
            "CREATE INDEX IF NOT EXISTS idx_organizations_name ON organizations (organization_name)"
        )
        wrapped.execute(
            """
            CREATE TABLE IF NOT EXISTS client_users (
                id SERIAL PRIMARY KEY,
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
        wrapped.execute(
            "CREATE INDEX IF NOT EXISTS idx_client_users_organization_id ON client_users (organization_id)"
        )
        wrapped.execute(
            "CREATE INDEX IF NOT EXISTS idx_client_users_username ON client_users (username)"
        )
        wrapped.execute(
            """
            CREATE TABLE IF NOT EXISTS software_subscriptions (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT '',
                department TEXT NOT NULL DEFAULT '',
                point_of_contact TEXT NOT NULL,
                assigned_users TEXT NOT NULL DEFAULT '',
                cost_2024_2025 DOUBLE PRECISION,
                cost_2025_2026 DOUBLE PRECISION,
                cost_2026_2027 DOUBLE PRECISION,
                billing_frequency TEXT NOT NULL DEFAULT '',
                renewal_date TEXT NOT NULL DEFAULT '',
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
        # Backfills columns for any pre-existing table created before these were added.
        # No-ops on a freshly created table since CREATE TABLE above already includes them.
        wrapped.execute(
            "ALTER TABLE software_subscriptions ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT ''"
        )
        wrapped.execute(
            "ALTER TABLE software_subscriptions ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT ''"
        )
        wrapped.execute(
            "ALTER TABLE software_subscriptions ADD COLUMN IF NOT EXISTS billing_frequency TEXT NOT NULL DEFAULT ''"
        )
        wrapped.execute(
            "ALTER TABLE software_subscriptions ADD COLUMN IF NOT EXISTS renewal_date TEXT NOT NULL DEFAULT ''"
        )
        wrapped.executemany(
            """
            UPDATE software_subscriptions
            SET category = ?,
                department = CASE WHEN department = '' THEN ? ELSE department END,
                billing_frequency = CASE WHEN billing_frequency = '' THEN ? ELSE billing_frequency END,
                renewal_date = CASE WHEN renewal_date = '' THEN ? ELSE renewal_date END
            WHERE name = ?
            """,
            [
                ("GIS / Mapping", "Operations", "Annual", "2026-07-01", "ArcGIS Online"),
                ("Labor Market Data", "Research", "Annual", "2026-09-01", "Lightcast Analyst"),
                ("Sales Intelligence", "Marketing", "Annual", "2027-03-01", "ZoomInfo"),
                ("Design Tools", "Marketing", "Annual", "2026-12-01", "Canva Teams"),
            ],
        )
        wrapped.execute(
            "CREATE INDEX IF NOT EXISTS idx_software_subscriptions_status ON software_subscriptions (status)"
        )
        wrapped.execute(
            "CREATE INDEX IF NOT EXISTS idx_software_subscriptions_contact ON software_subscriptions (point_of_contact)"
        )
        wrapped.execute(
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
        wrapped.execute(
            "CREATE INDEX IF NOT EXISTS idx_account_quality_name ON account_data_quality_cache (LOWER(name))"
        )
        wrapped.execute(
            "CREATE INDEX IF NOT EXISTS idx_account_quality_sector ON account_data_quality_cache (new_sector)"
        )
        wrapped.execute(
            "CREATE INDEX IF NOT EXISTS idx_account_quality_country ON account_data_quality_cache (address1_country)"
        )
        wrapped.execute(
            "CREATE INDEX IF NOT EXISTS idx_account_quality_state ON account_data_quality_cache (address1_stateorprovince)"
        )
        wrapped.execute(
            "CREATE INDEX IF NOT EXISTS idx_account_quality_city ON account_data_quality_cache (address1_city)"
        )
        wrapped.execute(
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
        wrapped.execute(
            """
            INSERT INTO account_data_quality_sync (id, status, row_count)
            VALUES (1, 'idle', 0)
            ON CONFLICT (id) DO NOTHING
            """
        )
        wrapped.execute(
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
        wrapped.execute(
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
        wrapped.execute(
            """
            CREATE TABLE IF NOT EXISTS service_line_marketing_cache (
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
        wrapped.execute(
            """
            CREATE TABLE IF NOT EXISTS quickbooks_connections (
                organization_key TEXT PRIMARY KEY,
                realm_id TEXT NOT NULL,
                company_name TEXT NOT NULL DEFAULT '',
                environment TEXT NOT NULL DEFAULT 'sandbox',
                access_token TEXT NOT NULL,
                refresh_token TEXT NOT NULL,
                access_token_expires_at TIMESTAMPTZ,
                refresh_token_expires_at TIMESTAMPTZ,
                status TEXT NOT NULL DEFAULT 'connected',
                connected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                connected_by_email TEXT NOT NULL DEFAULT '',
                disconnected_at TIMESTAMPTZ,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        wrapped.execute(
            """
            CREATE TABLE IF NOT EXISTS quickbooks_oauth_states (
                state TEXT PRIMARY KEY,
                organization_key TEXT NOT NULL,
                user_email TEXT NOT NULL,
                environment TEXT NOT NULL DEFAULT 'sandbox',
                created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMPTZ NOT NULL,
                consumed_at TIMESTAMPTZ
            )
            """
        )
        wrapped.execute(
            "CREATE INDEX IF NOT EXISTS idx_quickbooks_oauth_states_expires_at ON quickbooks_oauth_states (expires_at)"
        )
        subscription_count = wrapped.execute(
            "SELECT COUNT(*) AS count FROM software_subscriptions"
        ).fetchone()["count"]
        if subscription_count == 0:
            wrapped.executemany(
                """
                INSERT INTO software_subscriptions (
                    name, description, category, department, point_of_contact, assigned_users,
                    cost_2024_2025, cost_2025_2026, cost_2026_2027,
                    billing_frequency, renewal_date, renewal_time_frame,
                    vendor_rep, subscribed_since, status, notes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        "ArcGIS Online",
                        "Cloud mapping and spatial analysis platform used for project maps and data visualization.",
                        "GIS / Mapping",
                        "Operations",
                        "Operations",
                        "Planning and analyst team",
                        2800,
                        3100,
                        3300,
                        "Annual",
                        "2026-07-01",
                        "Annual - July",
                        "Esri Customer Success",
                        "2018",
                        "Active",
                        "Confirm named-user allocation before the next renewal.",
                    ),
                    (
                        "Lightcast Analyst",
                        "Labor market and economic data subscription for workforce and industry analysis.",
                        "Labor Market Data",
                        "Research",
                        "Research",
                        "Research team",
                        14500,
                        15250,
                        None,
                        "Annual",
                        "2026-09-01",
                        "Annual - September",
                        "Account Manager TBD",
                        "2020",
                        "Pending Renewal",
                        "2026-2027 pricing pending vendor quote.",
                    ),
                    (
                        "ZoomInfo",
                        "Business contact and company intelligence used for prospecting and market research.",
                        "Sales Intelligence",
                        "Marketing",
                        "Marketing",
                        "Marketing and business development",
                        12000,
                        12600,
                        13200,
                        "Annual",
                        "2027-03-01",
                        "Annual - March",
                        "",
                        "2022",
                        "Needs Review",
                        "Vendor contact needs to be confirmed.",
                    ),
                    (
                        "Canva Teams",
                        "Design collaboration workspace for branded reports, presentations, and marketing assets.",
                        "Design Tools",
                        "Marketing",
                        "Marketing",
                        "Marketing and project managers",
                        1500,
                        1800,
                        2100,
                        "Annual",
                        "2026-12-01",
                        "Annual - December",
                        "Canva Support",
                        "2021",
                        "Active",
                        "Review seat count quarterly.",
                    ),
                ],
            )

        connection.commit()
    finally:
        connection.close()

    _initialized = True


@contextmanager
def get_database_connection():
    initialize_database()
    connection = _connect()
    wrapped = _CompatConnection(connection)

    try:
        yield wrapped
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
