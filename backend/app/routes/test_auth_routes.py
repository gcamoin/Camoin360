"""PostgreSQL HTTP authentication contracts; no JSON account file access."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app import database, main
from backend.app.routes import auth
from backend.app.services import application_users as users
from backend.app.services.application_administrator import bootstrap_administrator
from backend.app.services.test_application_users import pg
from backend.app.schemas.client_user import ClientUserCreate, OrganizationClientUserCreate, ClientUserPasswordReset
from psycopg.conninfo import conninfo_to_dict

SECRET = "synthetic-shared-signing-key-0123456789-abcdefghijklmno"
ADMIN_EMAIL = "operator@synthetic.invalid"
ADMIN_PASSWORD = "synthetic-administrator-password"


async def idle_scheduler():
    await asyncio.Event().wait()


@pytest.fixture
def configured(pg, monkeypatch):
    monkeypatch.setenv("AUTH_SECRET_KEY", SECRET)
    monkeypatch.setenv("AUTH_DATABASE_SCHEMA", conninfo_to_dict(pg)["options"].split("=", 1)[1])
    monkeypatch.setattr(main, "run_snapshot_scheduler", idle_scheduler)
    return pg


@pytest.fixture
def client(configured):
    with database.get_auth_database_connection() as connection:
        bootstrap_administrator(connection, name="Synthetic operator", email=ADMIN_EMAIL,
                                password=ADMIN_PASSWORD, organization_id=7, signing_key=SECRET)
    with TestClient(main.app) as result:
        yield result


def login(client, email=ADMIN_EMAIL, password=ADMIN_PASSWORD):
    response = client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return response.json()


def headers(client):
    return {"Authorization": "Bearer " + login(client)["token"]}


def create(client, authorization, email="member@synthetic.invalid", **overrides):
    data = {"name": "Member", "email": email, "password": "synthetic-member-password",
            "organization_id": 19, "modules": ["main", "unknown"]}
    return client.post("/auth/users", json={**data, **overrides}, headers=authorization)


def test_empty_startup_and_login_do_not_provision_accounts_or_touch_json(configured):
    with TestClient(main.app) as client, patch.object(Path, "open", side_effect=AssertionError("No file access")):
        assert client.post("/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}).status_code == 401
        assert client.post("/auth/signup", json={"name": "User", "email": "nobody@example.invalid", "password": "password123"}).status_code == 403
        assert client.get("/auth/users").status_code == 401
        assert users.list_users() == []


def test_login_contract_standard_jwt_and_organization(client):
    response = login(client)
    assert response["organization_id"] == 7
    assert response["role"] == "admin"
    assert response["modules"] == list(auth.MODULES)
    assert len(response["token"].split(".")) == 3
    claims = auth._decode_token(response["token"])
    assert claims["sub"] == ADMIN_EMAIL
    assert claims["uid"] == users.get_user(ADMIN_EMAIL).id
    assert claims["iss"] == "camoin360" and claims["aud"] == "camoin360-web"
    assert "password" not in response and "password_hash" not in response
    for email, password in [(ADMIN_EMAIL, "incorrect"), ("absent@example.invalid", "incorrect")]:
        assert client.post("/auth/login", json={"email": email, "password": password}).status_code == 401


def test_admin_crud_normalized_emails_and_safe_api_contract(client):
    authorization = headers(client)
    assert create(client, authorization, " MEMBER@SYNTHETIC.INVALID ").status_code == 201
    assert create(client, authorization).status_code == 409
    records = client.get("/auth/users", headers=authorization).json()["users"]
    assert len(records) == 2
    assert records[0].keys() == {"name", "email", "role", "modules", "organization_id"}
    assert records[0]["modules"] == ["main"]
    changed = client.patch("/auth/users/member@synthetic.invalid", headers=authorization,
                           json={"name": "Changed", "password": "replacement-password", "modules": ["management"]})
    assert changed.status_code == 200
    assert changed.json()["modules"] == ["management"]
    assert client.post("/auth/login", json={"email": "member@synthetic.invalid", "password": "synthetic-member-password"}).status_code == 401
    assert login(client, "member@synthetic.invalid", "replacement-password")["name"] == "Changed"
    assert client.delete("/auth/users/member@synthetic.invalid", headers=authorization).status_code == 204
    assert client.patch("/auth/users/missing@synthetic.invalid", headers=authorization, json={"name": "Missing"}).status_code == 404


def test_password_creation_and_updates_enforce_eight_character_minimum(client):
    authorization = headers(client)
    for length in range(8):
        assert create(client, authorization, password="x" * length).status_code == 422
    assert users.get_user("member@synthetic.invalid") is None
    assert create(client, authorization, password="x" * 8).status_code == 201
    original = users.get_user("member@synthetic.invalid")
    assert login(client, original.email, "x" * 8)["role"] == "user"
    for length in range(8):
        response = client.patch(f"/auth/users/{original.email}", headers=authorization,
                                json={"password": "y" * length})
        assert response.status_code == 422
        assert users.get_user(original.email) == original
    assert client.patch(f"/auth/users/{original.email}", headers=authorization,
                        json={"password": "y" * 8}).status_code == 200
    assert client.post("/auth/login", json={"email": original.email, "password": "x" * 8}).status_code == 401
    assert login(client, original.email, "y" * 8)["role"] == "user"


@pytest.mark.parametrize("model", [ClientUserCreate, OrganizationClientUserCreate, ClientUserPasswordReset])
def test_client_creation_and_password_reset_models_share_eight_character_minimum(model):
    details = {"name": "Synthetic", "username": "synthetic@example.invalid", "organization_id": 1}
    for length in range(8):
        with pytest.raises(ValidationError):
            model(**details, password="x" * length)
    assert len(model(**details, password="x" * 8).password) == 8


def test_non_admin_cannot_manage_accounts_even_with_admin_module(client):
    admin = headers(client)
    assert create(client, admin, modules=["admin", "main"], role="admin").status_code == 201
    member = login(client, "member@synthetic.invalid", "synthetic-member-password")
    assert member["role"] == "user"
    authorization = {"Authorization": "Bearer " + member["token"]}
    for method, path, body in [("GET", "/auth/users", None), ("POST", "/auth/users", {"name": "X", "email": "x@y.z", "password": "password123"}),
                               ("PATCH", "/auth/users/other@example.invalid", {"name": "Changed"}),
                               ("DELETE", "/auth/users/other@example.invalid", None)]:
        assert client.request(method, path, headers=authorization, json=body).status_code == 403
    assert client.get("/software-subscriptions", headers=authorization).status_code == 403
    assert client.get("/software-subscriptions", headers=admin).status_code == 200


def test_bootstrapped_admin_cannot_be_edited_or_deleted(client):
    authorization = headers(client)
    assert client.patch(f"/auth/users/{ADMIN_EMAIL}", headers=authorization, json={"password": "different-password"}).status_code == 403
    assert client.delete(f"/auth/users/{ADMIN_EMAIL}", headers=authorization).status_code == 403
    assert login(client)["role"] == "admin"


def test_permissions_reload_from_database_and_deleted_identity_never_resurrects(client):
    admin = headers(client)
    create(client, admin, modules=["management"])
    original = login(client, "member@synthetic.invalid", "synthetic-member-password")["token"]
    authorization = {"Authorization": "Bearer " + original}
    assert client.get("/software-subscriptions", headers=authorization).status_code == 200
    client.patch("/auth/users/member@synthetic.invalid", headers=admin, json={"modules": ["main"]})
    assert client.get("/software-subscriptions", headers=authorization).status_code == 403
    client.delete("/auth/users/member@synthetic.invalid", headers=admin)
    assert client.get("/software-subscriptions", headers=authorization).status_code == 401
    create(client, admin, modules=["management"])
    assert client.get("/software-subscriptions", headers=authorization).status_code == 401


def test_expiration_and_invalid_jwt_inputs(client):
    token = login(client)["token"]
    expiration = auth._decode_token(token)["exp"]
    with patch.object(auth.time, "time", return_value=expiration):
        response = client.get("/auth/users", headers={"Authorization": "Bearer " + token})
        assert response.status_code == 401 and response.json()["detail"] == "Token expired"
    claims = auth._decode_token(token)
    for mutation in [{"aud": "wrong"}, {"iss": "wrong"}, {"exp": "wrong"}, {"iat": True}, {"uid": ""}]:
        malformed = auth._sign_token({**claims, **mutation})
        assert client.get("/auth/users", headers={"Authorization": "Bearer " + malformed}).status_code == 401
    for malformed in ["legacy.signature", "a.b.c", token + ".extra", token[:-1], "x" * 17000]:
        assert client.get("/auth/users", headers={"Authorization": "Bearer " + malformed}).status_code == 401
    wrong_header = auth._b64encode(b'{"alg":"none","typ":"JWT"}') + "." + ".".join(token.split(".")[1:])
    assert client.get("/auth/users", headers={"Authorization": "Bearer " + wrong_header}).status_code == 401


def test_wrong_instance_signing_key_fails_closed(client, monkeypatch):
    token = login(client)["token"]
    monkeypatch.setenv("AUTH_SECRET_KEY", "different-instance-key-0123456789-abcdefghi")
    assert client.get("/auth/users", headers={"Authorization": "Bearer " + token}).status_code == 503
    assert client.post("/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}).status_code == 503
    with pytest.raises(RuntimeError, match="does not match"):
        with TestClient(main.app):
            pass


def test_storage_errors_are_server_errors_with_cors_and_no_json_fallback(client):
    authorization = headers(client)
    with patch.object(users, "get_user", side_effect=users.AccountStorageError("synthetic-sensitive-detail")):
        response = client.get("/software-subscriptions", headers={**authorization, "Origin": "https://camoin360.com"})
        assert response.status_code == 503
        assert response.headers["access-control-allow-origin"] == "https://camoin360.com"
        assert "synthetic-sensitive-detail" not in response.text
    with patch.object(users, "authenticate", side_effect=users.AccountStorageError("synthetic-sensitive-detail")):
        assert client.post("/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}).status_code == 503


def test_startup_requires_configuration_and_verified_schema(configured, monkeypatch):
    monkeypatch.delenv("AUTH_SECRET_KEY")
    with pytest.raises(ValueError, match="AUTH_SECRET_KEY"):
        with TestClient(main.app):
            pass
    monkeypatch.setenv("AUTH_SECRET_KEY", SECRET)
    with database.get_auth_database_connection() as connection:
        connection.execute("ALTER TABLE application_users DROP CONSTRAINT application_users_normalized_email")
        connection.execute("ALTER TABLE application_users ADD CONSTRAINT application_users_normalized_email CHECK (TRUE)")
    with pytest.raises(RuntimeError, match="CHECK definitions"):
        with TestClient(main.app):
            pass


def test_tokens_and_accounts_survive_fresh_process_and_second_backend(client, configured):
    token = login(client)["token"]
    # Pass synthetic token through environment rather than argv or console.
    result = subprocess.run([sys.executable, "-B", "-c", """
import os
from backend.app import database
# This is a disposable test-schema DSN, not production configuration.
database.DATABASE_URL = os.environ['TEST_AUTH_SCHEMA_URL']
from backend.app.routes.auth import get_user_from_token
user = get_user_from_token(os.environ['TEST_AUTH_TOKEN'])
assert user['role'] == 'admin' and user['organization_id'] == 7
print('fresh_process_verified')
"""], env={**os.environ, "TEST_AUTH_SCHEMA_URL": configured, "TEST_AUTH_TOKEN": token}, capture_output=True, text=True)
    assert result.returncode == 0
    assert result.stdout.strip() == "fresh_process_verified"
    with TestClient(main.app) as second:
        assert second.get("/auth/users", headers={"Authorization": "Bearer " + token}).status_code == 200
