"""One-time bootstrap and auth-only schema commands on disposable PostgreSQL."""

from concurrent.futures import ThreadPoolExecutor
import hashlib
import os
from urllib.parse import urlencode
from uuid import uuid4
from unittest.mock import patch

import psycopg
import pytest

from backend.app import database
from backend.app.application_users_schema import AuthSchemaError, initialize_application_users_schema, verify_application_users_schema
from backend.app.services import application_users as users
from backend.app.services.application_administrator import bootstrap_administrator
from backend.app.services.test_application_users import pg
from backend.app.workers import application_auth_admin as operator
from psycopg.conninfo import conninfo_to_dict

SECRET = "synthetic-shared-signing-key-0123456789-abcdefghijklmno"


def bootstrap(**overrides):
    data = dict(name="Synthetic administrator", email="operator@synthetic.invalid",
                password="synthetic-administrator-password", organization_id=17, signing_key=SECRET)
    with database.get_auth_database_connection() as connection:
        return bootstrap_administrator(connection, **{**data, **overrides})


def test_explicit_bootstrap_and_reruns_never_overwrite(pg):
    admin = bootstrap()
    assert admin.modules == ("main", "prospecting", "consulting", "management", "admin")
    assert users.authenticate(admin.email, "synthetic-administrator-password") == admin
    for change in [{}, {"password": "another-synthetic-password"}, {"email": "another@synthetic.invalid"}]:
        with pytest.raises(users.AccountConflict):
            bootstrap(**change)
    assert users.list_users() == [admin]
    with database.get_auth_database_connection() as connection:
        marker = connection.execute("SELECT * FROM application_auth_bootstrap").fetchone()
        assert marker["administrator_id"] == admin.id
        assert marker["signing_key_digest"] == hashlib.sha256(SECRET.encode()).hexdigest()


@pytest.mark.parametrize("length", range(8))
def test_bootstrap_rejects_short_passwords_without_creating_accounts(pg, length):
    with pytest.raises(ValueError, match="Administrator password must contain 8 to 1024 characters"):
        bootstrap(password="x" * length)
    assert users.list_users() == []
    with database.get_auth_database_connection() as connection:
        assert connection.execute("SELECT COUNT(*) AS count FROM application_auth_bootstrap").fetchone()["count"] == 0


@pytest.mark.parametrize("length", [8, 15, 16, 1024])
def test_bootstrap_password_boundaries_allow_login_and_preserve_one_time_guard(pg, length):
    password = "x" * length
    admin = bootstrap(password=password)
    assert users.authenticate(admin.email, password) == admin
    with pytest.raises(users.AccountConflict):
        bootstrap(password=password)
    assert users.list_users() == [admin]


def test_bootstrap_still_rejects_oversized_passwords_and_short_signing_keys(pg):
    with pytest.raises(ValueError, match="8 to 1024 characters"):
        bootstrap(password="x" * 1025)
    with pytest.raises(ValueError, match="Secure shared signing key required"):
        bootstrap(password="x" * 8, signing_key="x" * 31)
    assert users.list_users() == []


def test_bootstrap_is_one_time_even_if_administrator_is_demoted(pg):
    bootstrap()
    with database.get_auth_database_connection() as connection:
        connection.execute("UPDATE application_users SET role='user'")
    with pytest.raises(users.AccountConflict):
        bootstrap(email="new@synthetic.invalid")
    assert len(users.list_users()) == 1


def test_existing_admin_or_email_cannot_be_overwritten(pg):
    existing = users.create_user(name="Existing", email="operator@synthetic.invalid", password="original-password", organization_id=1)
    with pytest.raises(users.AccountConflict):
        bootstrap()
    assert users.list_users() == [existing]
    users.create_user(name="Other", email="other@synthetic.invalid", password="original-password", organization_id=1, role="admin")
    with pytest.raises(users.AccountConflict):
        bootstrap(email="new@synthetic.invalid")


def test_concurrent_bootstrap_creates_exactly_one_administrator(pg):
    def attempt(index):
        try:
            bootstrap(email=f"operator{index}@synthetic.invalid")
            return True
        except users.AccountConflict:
            return False
    with ThreadPoolExecutor(max_workers=4) as executor:
        assert sum(executor.map(attempt, range(4))) == 1
    assert len(users.list_users()) == 1


def test_failed_marker_write_rolls_back_administrator(pg):
    original = database._CompatConnection.execute
    def interrupted(connection, sql, parameters=None):
        if "INSERT INTO application_auth_bootstrap" in sql:
            raise KeyboardInterrupt
        return original(connection, sql, parameters)
    with patch.object(database._CompatConnection, "execute", interrupted):
        with pytest.raises(KeyboardInterrupt):
            bootstrap()
    assert users.list_users() == []
    assert bootstrap().role == "admin"


@pytest.mark.parametrize("sql", [
    "ALTER TABLE application_users ALTER COLUMN email DROP NOT NULL",
    "ALTER TABLE application_users DROP CONSTRAINT application_users_email_key",
    "ALTER TABLE application_users ALTER COLUMN modules SET DEFAULT '{admin}'",
    "ALTER TABLE application_users ENABLE ROW LEVEL SECURITY",
    "DROP INDEX application_users_single_admin",
    "ALTER TABLE application_auth_bootstrap DROP CONSTRAINT application_auth_bootstrap_administrator_id_fkey",
])
def test_schema_verifier_rejects_real_column_index_default_and_policy_drift(pg, sql):
    with database.get_auth_database_connection() as connection:
        connection.execute(sql)
    with database.get_auth_database_connection() as connection:
        with pytest.raises(AuthSchemaError):
            verify_application_users_schema(connection)


def test_auth_operations_do_not_initialize_or_change_business_tables(pg):
    with database.get_database_connection() as connection:
        before = connection.execute("SELECT * FROM organizations").fetchall()
        subscriptions = connection.execute("SELECT * FROM software_subscriptions ORDER BY id").fetchall()
    with patch.object(database, "initialize_database", side_effect=AssertionError("Business initialization forbidden")):
        bootstrap()
        users.create_user(name="User", email="user@synthetic.invalid", password="synthetic-password", organization_id=1)
        with database.get_auth_database_connection() as connection:
            initialize_application_users_schema(connection)
    with database.get_database_connection() as connection:
        assert connection.execute("SELECT * FROM organizations").fetchall() == before
        assert connection.execute("SELECT * FROM software_subscriptions ORDER BY id").fetchall() == subscriptions


def test_operator_requires_confirmation_target_and_explicit_credentials(pg, monkeypatch, capsys):
    info = conninfo_to_dict(pg)
    schema = info["options"].split("=", 1)[1]
    url = f"postgresql://{info['user']}@{info['host']}:{info['port']}/{info['dbname']}?" + urlencode({"options": info["options"]})
    monkeypatch.setenv("SYNTHETIC_OPERATOR_DB", url)
    common = ["--database-url-env", "SYNTHETIC_OPERATOR_DB", "--expected-database", conninfo_to_dict(pg)["dbname"], "--expected-schema", schema]
    assert operator.main(["verify-schema", *common]) == 0
    assert operator.main(["bootstrap-admin", *common]) == 2
    assert operator.main(["bootstrap-admin", *common, "--confirm-bootstrap"]) == 2
    monkeypatch.setenv("AUTH_SECRET_KEY", SECRET)
    password = "x" * 8
    for name, value in {"NAME": "Synthetic", "EMAIL": "operator@synthetic.invalid", "PASSWORD": password, "ORGANIZATION_ID": "5"}.items():
        monkeypatch.setenv("CAMOIN360_BOOTSTRAP_" + name, value)
    assert operator.main(["bootstrap-admin", *common, "--confirm-bootstrap"]) == 0
    assert operator.main(["bootstrap-admin", *common, "--confirm-bootstrap"]) == 2
    output = capsys.readouterr()
    assert "operator@synthetic.invalid" not in output.out + output.err
    assert password not in output.out + output.err
    assert SECRET not in output.out + output.err


def test_prepare_schema_is_additive_auth_only_and_preserves_business_records(pg, monkeypatch):
    info = conninfo_to_dict(pg)
    schema = "auth_prepare_" + uuid4().hex
    with database.get_auth_database_connection() as connection:
        connection.execute(f'CREATE SCHEMA "{schema}"')
        connection.execute(f'CREATE TABLE "{schema}".business_guard (value TEXT)')
        connection.execute(f'INSERT INTO "{schema}".business_guard VALUES (%s)', ("unchanged",))
    url = f"postgresql://{info['user']}@{info['host']}:{info['port']}/{info['dbname']}?" + urlencode({"options": "-csearch_path=" + schema})
    monkeypatch.setenv("SYNTHETIC_PREPARE_DB", url)
    common = ["--database-url-env", "SYNTHETIC_PREPARE_DB", "--expected-database", info["dbname"], "--expected-schema", schema]
    try:
        assert operator.main(["prepare-schema", *common]) == 0
        assert operator.main(["prepare-schema", *common]) == 0
        assert operator.main(["verify-schema", *common]) == 0
        with psycopg.connect(url) as connection:
            assert connection.execute("SELECT * FROM business_guard").fetchall() == [("unchanged",)]
            tables = {r[0] for r in connection.execute("SELECT tablename FROM pg_tables WHERE schemaname=%s", (schema,))}
            assert tables == {"business_guard", "application_users", "application_auth_bootstrap"}
            assert connection.execute("SELECT COUNT(*) FROM application_users").fetchone()[0] == 0
    finally:
        with database.get_auth_database_connection() as connection:
            connection.execute(f'DROP SCHEMA "{schema}" CASCADE')
