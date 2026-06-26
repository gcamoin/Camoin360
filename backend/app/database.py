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
