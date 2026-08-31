import os
import uuid
from unittest.mock import patch

import psycopg

from . import database


def temporary_database():
    """Isolate a test against a fresh, throwaway PostgreSQL schema.

    Requires TEST_DATABASE_URL (or DATABASE_URL) to point at a reachable
    PostgreSQL instance. Returns an object with start()/stop(), mirroring
    unittest.mock.patch, so tests can call it from setUp()/tearDown().
    """
    base_url = os.getenv("TEST_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not base_url:
        raise RuntimeError(
            "TEST_DATABASE_URL or DATABASE_URL must be set to a PostgreSQL connection "
            "string to run database-backed tests."
        )

    return _TemporaryDatabase(base_url)


class _TemporaryDatabase:
    def __init__(self, base_url: str):
        self._base_url = base_url
        self._schema = f"test_{uuid.uuid4().hex}"
        separator = "&" if "?" in base_url else "?"
        schema_url = f"{base_url}{separator}options=-csearch_path%3D{self._schema}"
        self._url_patch = patch.object(database, "DATABASE_URL", schema_url)

    def start(self):
        with psycopg.connect(self._base_url, autocommit=True) as connection:
            connection.execute(f'CREATE SCHEMA "{self._schema}"')

        self._url_patch.start()
        database._initialized = False
        database.initialize_database()

    def stop(self):
        self._url_patch.stop()
        database._initialized = False

        with psycopg.connect(self._base_url, autocommit=True) as connection:
            connection.execute(f'DROP SCHEMA IF EXISTS "{self._schema}" CASCADE')
