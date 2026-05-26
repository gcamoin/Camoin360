import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

router = APIRouter(prefix="/auth", tags=["auth"])
bearer_scheme = HTTPBearer(auto_error=False)

BASE_DIR = Path(__file__).resolve().parent.parent / "services"
USERS_FILE = BASE_DIR / "users.json"
AUTH_SECRET = os.getenv("AUTH_SECRET_KEY", "dev-only-change-me")
TOKEN_TTL_SECONDS = 60 * 60 * 12


class SignupRequest(BaseModel):
    name: str = Field(min_length=1)
    email: str = Field(min_length=3)
    password: str = Field(min_length=8)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3)
    password: str = Field(min_length=1)


class AuthResponse(BaseModel):
    token: str
    name: str
    email: str


def _load_users():
    if not USERS_FILE.exists():
        return {}

    with USERS_FILE.open("r", encoding="utf-8") as file:
        return json.load(file)


def _save_users(users):
    BASE_DIR.mkdir(parents=True, exist_ok=True)
    with USERS_FILE.open("w", encoding="utf-8") as file:
        json.dump(users, file, indent=2)


def _hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    password_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        120000,
    ).hex()
    return f"{salt}:{password_hash}"


def _verify_password(password, stored_password):
    salt, expected_hash = stored_password.split(":", 1)
    candidate = _hash_password(password, salt).split(":", 1)[1]
    return hmac.compare_digest(candidate, expected_hash)


def _sign_token(payload):
    body = base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8")).decode("utf-8")
    signature = hmac.new(
        AUTH_SECRET.encode("utf-8"),
        body.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{body}.{signature}"


def _decode_token(token):
    try:
        body, signature = token.rsplit(".", 1)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc

    expected_signature = hmac.new(
        AUTH_SECRET.encode("utf-8"),
        body.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(signature, expected_signature):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    try:
        payload = json.loads(base64.urlsafe_b64decode(body.encode("utf-8")))
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc

    if payload.get("exp", 0) < int(time.time()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")

    return payload


def _create_auth_response(user):
    token = _sign_token(
        {
            "sub": user["email"],
            "name": user["name"],
            "exp": int(time.time()) + TOKEN_TTL_SECONDS,
        }
    )
    return AuthResponse(token=token, name=user["name"], email=user["email"])


def require_user(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")

    payload = _decode_token(credentials.credentials)
    users = _load_users()
    user = users.get(payload["sub"].lower())
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return user


@router.post("/signup", response_model=AuthResponse)
async def signup(request: SignupRequest):
    users = _load_users()
    email = request.email.strip().lower()
    name = request.name.strip()

    if not name or "@" not in email:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Valid name and email required")

    if email in users:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")

    user = {
        "name": name,
        "email": email,
        "password": _hash_password(request.password),
    }
    users[email] = user
    _save_users(users)

    return _create_auth_response(user)


@router.post("/login", response_model=AuthResponse)
async def login(request: LoginRequest):
    users = _load_users()
    user = users.get(request.email.strip().lower())

    if user is None or not _verify_password(request.password, user["password"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    return _create_auth_response(user)
