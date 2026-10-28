"""Real PostgreSQL checks. Require an explicitly selected local test database.

No fallback to DATABASE_URL; never import the FastAPI app or legacy user file.
"""

from concurrent.futures import ThreadPoolExecutor
import copy
import hashlib
import json
import os
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit
from uuid import uuid4

import psycopg
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from psycopg.rows import dict_row
import pytest

from backend.app import database
from backend.app.application_users_schema import initialize_application_users_schema
from backend.app.services import application_users as users
from backend.app.services.application_auth_configuration import require_auth_configuration
from backend.app.services.application_user_migration import decode_legacy_snapshot, reconcile_legacy_accounts


@pytest.fixture
def pg():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.fail("Set TEST_DATABASE_URL to a disposable local PostgreSQL database")
    if urlsplit(url).hostname not in {"localhost", "127.0.0.1", "::1"}:
        pytest.fail("Application-user tests require loopback PostgreSQL")
    schema = "auth_test_" + uuid4().hex
    with psycopg.connect(url, autocommit=True) as connection:
        connection.execute(f'CREATE SCHEMA "{schema}"')
    connection_info = conninfo_to_dict(url)
    connection_info["options"] = f"-csearch_path={schema}"
    isolated_url = make_conninfo(**connection_info)
    try:
        with patch.object(database, "DATABASE_URL", isolated_url), patch.object(database, "_initialized", False):
            database.initialize_database()
            yield isolated_url
    finally:
        with psycopg.connect(url, autocommit=True) as connection:
            connection.execute(f'DROP SCHEMA "{schema}" CASCADE')


def create(email="jane@example.com", **overrides):
    details = dict(name="Jane", email=email, password="long-test-password", organization_id=27,
                   modules=["main", "prospecting"])
    return users.create_user(**{**details, **overrides})


def legacy(email="jane@example.com", **overrides):
    salt = "legacy-fixed-test-salt"
    digest = hashlib.pbkdf2_hmac("sha256", b"existing-password", salt.encode(), 120000).hex()
    return {email: {"id": "stable-legacy-id", "email": email, "name": "Existing User",
                    "password": f"{salt}:{digest}", "role": "admin", "organization_id": 413,
                    "modules": ["main", "admin", "future-module"], **overrides}}


def test_create_login_resolution_and_public_permissions(pg):
    created = create(" Jane@Example.COM ")
    assert created.email == "jane@example.com"
    assert users.authenticate("JANE@example.com", "long-test-password") == created
    assert users.authenticate(created.email, "incorrect") is None
    assert users.authenticate("absent@example.com", "incorrect") is None
    assert users.get_user(created.email) == created
    assert created.has_module("main")
    assert not created.has_module("management")
    assert "password" not in json.dumps(created.public_dict())
    assert created.password_hash not in repr(created)
    assert created.password_hash not in json.dumps(created.public_dict())


def test_persistence_from_fresh_connections_and_process(pg):
    created = create()
    # A fresh interpreter has no shared Python globals or local account file.
    import subprocess
    import sys
    result = subprocess.run(
        [sys.executable, "-B", "-c", """
import os
from backend.app import database
database.DATABASE_URL = os.environ['TEST_DATABASE_URL']
from backend.app.services.application_users import authenticate
user = authenticate('jane@example.com', 'long-test-password')
assert user is not None
print(user.id)
"""], env={**os.environ, "TEST_DATABASE_URL": pg}, capture_output=True, text=True, check=True,
    )
    assert result.stdout.strip() == created.id


def test_duplicate_normalized_email_is_database_enforced(pg):
    create()
    with pytest.raises(users.AccountConflict, match="identity already exists"):
        create(" JANE@EXAMPLE.COM ")
    with psycopg.connect(pg) as connection:
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute("UPDATE application_users SET email = ' Jane@example.com '")
    assert len(users.list_users()) == 1


def test_concurrent_duplicate_and_distinct_creates(pg):
    def attempt(email):
        try:
            create(email)
            return True
        except users.AccountConflict:
            return False
    with ThreadPoolExecutor(max_workers=6) as executor:
        results = list(executor.map(attempt, ["shared@example.com"] * 6))
    assert sum(results) == 1
    with ThreadPoolExecutor(max_workers=6) as executor:
        assert all(executor.map(attempt, [f"distinct{i}@example.com" for i in range(6)]))
    assert len(users.list_users()) == 7


def test_updates_preserve_identity_and_independent_concurrent_edits(pg):
    original = create()
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(users.update_user, original.email, name="Changed"),
                   executor.submit(users.update_user, original.email, modules=["management"])]
        for future in futures:
            future.result()
    changed = users.get_user(original.email)
    assert changed.name == "Changed"
    assert changed.modules == ("management",)
    assert changed.id == original.id
    assert changed.organization_id == original.organization_id
    assert changed.password_hash == original.password_hash
    users.update_user(original.email, password="replacement-password")
    assert users.authenticate(original.email, "long-test-password") is None
    assert users.authenticate(original.email, "replacement-password") is not None


def test_service_password_creation_and_updates_enforce_eight_character_minimum(pg):
    for length in range(8):
        with pytest.raises(ValueError, match="Password must contain at least 8 characters"):
            create(password="x" * length)
    assert users.list_users() == []
    original = create(password="x" * 8)
    assert users.authenticate(original.email, "x" * 8) == original
    for length in range(8):
        with pytest.raises(ValueError, match="Password must contain at least 8 characters"):
            users.update_user(original.email, password="y" * length)
        assert users.get_user(original.email) == original
    updated = users.update_user(original.email, password="y" * 8)
    assert users.authenticate(original.email, "x" * 8) is None
    assert users.authenticate(original.email, "y" * 8) == updated


def test_delete_and_missing_account_operations(pg):
    created = create()
    users.delete_user(created.email)
    assert users.get_user(created.email) is None
    assert users.list_users() == []  # No implicit administrator resurrection.
    with pytest.raises(LookupError):
        users.update_user(created.email, name="Missing")
    with pytest.raises(LookupError):
        users.delete_user(created.email)


def test_additive_schema_rerun_preserves_existing_users(pg):
    created = create()
    with database.get_database_connection() as connection:
        initialize_application_users_schema(connection)
        initialize_application_users_schema(connection)
    database.initialize_database(force=True)
    assert users.list_users() == [created]
    with psycopg.connect(pg, row_factory=dict_row) as connection:
        assert connection.execute("SELECT COUNT(*) AS n FROM client_users").fetchone()["n"] == 0


def test_empty_reads_never_seed_or_access_json(pg):
    with patch.object(Path, "open", side_effect=AssertionError("Unexpected file access")):
        assert users.list_users() == []
        assert users.get_user("absent@example.com") is None
        assert users.authenticate("absent@example.com", "incorrect") is None


def test_import_preserves_hash_id_privileges_and_association(pg):
    source = legacy()
    original = copy.deepcopy(source)
    accounts = reconcile_legacy_accounts([source, copy.deepcopy(source)], default_organization_id=1)
    assert len(accounts) == 1
    assert users.import_accounts(accounts) == 1
    stored = users.authenticate("jane@example.com", "existing-password")
    assert stored == accounts[0]
    assert stored.password_hash == source["jane@example.com"]["password"]
    assert stored.id == "stable-legacy-id"
    assert stored.role == "admin"
    assert stored.has_module("management")
    assert stored.modules == ("main", "admin", "future-module")
    assert stored.organization_id == 413  # Not dependent on client directory rows.
    assert source == original
    assert users.import_accounts(accounts) == 0


@pytest.mark.parametrize("identity", [42, "42"])
def test_import_preserves_original_id_type(pg, identity):
    accounts = reconcile_legacy_accounts([legacy(id=identity)], default_organization_id=1)
    users.import_accounts(accounts)
    stored = users.get_user("jane@example.com")
    assert stored.id == str(identity)
    assert stored.legacy_id == identity
    assert type(stored.legacy_id) is type(identity)


def test_idless_import_reruns_do_not_renumber_users(pg):
    source = legacy()
    del source["jane@example.com"]["id"]
    users.import_accounts(reconcile_legacy_accounts([source], default_organization_id=1))
    identity = users.get_user("jane@example.com").id
    assert users.import_accounts(reconcile_legacy_accounts([source], default_organization_id=1)) == 0
    assert users.get_user("jane@example.com").id == identity


@pytest.mark.parametrize("change", [
    {"name": "Different"}, {"password": "a:" + "0" * 64}, {"role": "user"},
    {"modules": ["main"]}, {"organization_id": 2}, {"id": "different"},
])
def test_multi_instance_conflicts_never_choose_a_winner(change):
    with pytest.raises(users.AccountConflict):
        reconcile_legacy_accounts([legacy(), legacy(**change)], default_organization_id=1)


def test_import_conflict_rolls_back_entire_batch_without_overwriting(pg):
    existing = create()
    accounts = reconcile_legacy_accounts(
        [legacy("new@example.com", id="new-id"), legacy()], default_organization_id=1,
    )
    with pytest.raises(users.AccountConflict):
        users.import_accounts(accounts)
    assert users.get_user("new@example.com") is None
    assert users.list_users() == [existing]


def test_import_validation_failure_rolls_back_prior_inserts(pg):
    account = reconcile_legacy_accounts([legacy()], default_organization_id=1)[0]
    with pytest.raises(ValueError):
        users.import_accounts([account, object()])
    assert users.list_users() == []


def test_storage_errors_never_include_row_credentials(pg):
    # Simulate a server constraint failure whose detail contains sensitive data.
    with patch.object(users, "get_database_connection", side_effect=psycopg.errors.CheckViolation("secret-row-material")):
        with pytest.raises(users.AccountStorageError) as caught:
            create()
    import traceback
    assert "secret-row-material" not in "".join(traceback.format_exception(caught.value))


@pytest.mark.parametrize("stored_hash", [None, "", "bad", "salt:not-hex", "salt:" + "z" * 64])
def test_invalid_hash_fails_closed(stored_hash):
    assert not users.verify_password("some-password", stored_hash)


@pytest.mark.parametrize("change", [{"id": True}, {"organization_id": 0}, {"modules": "main"},
                                     {"password": "invalid"}, {"unrecognized": "metadata"}])
def test_migration_rejects_invalid_or_unrecognized_records(change):
    with pytest.raises(ValueError):
        reconcile_legacy_accounts([legacy(**change)], default_organization_id=1)


def test_migration_email_and_id_collisions_require_review():
    mismatched = legacy()
    mismatched["jane@example.com"]["email"] = "mismatch@example.com"
    with pytest.raises(users.AccountConflict):
        reconcile_legacy_accounts([mismatched], default_organization_id=1)
    with pytest.raises(users.AccountConflict):
        reconcile_legacy_accounts([legacy(), legacy("other@example.com")], default_organization_id=1)


@pytest.mark.parametrize("payload", [b'{"user": {}, "user": {}}',
                                     b'{"user": {"role": "user", "role": "admin"}}'])
def test_snapshot_decoder_rejects_duplicate_keys(payload):
    with pytest.raises(users.AccountConflict, match="Duplicate legacy JSON keys"):
        decode_legacy_snapshot(payload)


def test_snapshot_decoder_and_missing_sources_fail_safely():
    source = legacy()
    assert decode_legacy_snapshot(json.dumps(source).encode()) == source
    for invalid in [b"invalid-json", b"[]", None]:
        with pytest.raises(ValueError):
            decode_legacy_snapshot(invalid)
    with pytest.raises(ValueError, match="At least one"):
        reconcile_legacy_accounts([], default_organization_id=1)


def test_commit_failure_rolls_back_and_never_returns_success(pg):
    original_connect = database._connect

    class FailedCommit:
        def __init__(self, connection):
            self.connection = connection

        def __getattr__(self, name):
            return getattr(self.connection, name)

        def commit(self):
            raise psycopg.OperationalError("simulated commit failure")

    with patch.object(database, "_connect", side_effect=lambda **kw: FailedCommit(original_connect(**kw))):
        with pytest.raises(users.AccountStorageError):
            create()
    assert users.list_users() == []


def test_directory_organization_deletion_cannot_delete_auth_accounts(pg):
    with database.get_database_connection() as connection:
        organization_id = connection.execute(
            """INSERT INTO organizations (dynamics_account_id, organization_name)
               VALUES ('auth-directory-test', 'Test directory entry') RETURNING id"""
        ).fetchone()["id"]
    account = create(organization_id=organization_id)
    with database.get_database_connection() as connection:
        connection.execute("DELETE FROM organizations WHERE id = ?", (organization_id,))
    assert users.get_user(account.email) == account


def test_production_configuration_requires_explicit_secure_values():
    for config in [{}, {"AUTH_SECRET_KEY": "dev-only-change-me"},
                   *[{"AUTH_SECRET_KEY": "test-only-secret-" * 3, "DATABASE_URL": url}
                     for url in ["sqlite:///local.db", "postgresql:", "postgresql://host", "postgresql:///implicit-host"]]]:
        with pytest.raises(ValueError):
            require_auth_configuration(config)
    config = require_auth_configuration({"AUTH_SECRET_KEY": "test-only-secret-" * 3,
                                         "DATABASE_URL": "postgresql://example.invalid/test"})
    assert config.secret_key not in repr(config)
    assert config.database_url not in repr(config)
