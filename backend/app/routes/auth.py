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
ADMIN_EMAIL = "garrett@camoinassociates.com"
ADMIN_NAME = "Garrett Camoin"
ADMIN_PASSWORD = os.getenv("CAMOIN360_ADMIN_PASSWORD", "Roccky#5")
MODULES = {
    "main": "Sophie Maintenance",
    "prospecting": "Prospecting",
    "consulting": "Consulting",
    "management": "Management",
    "admin": "Admin",
}
ADMIN_MODULES = list(MODULES.keys())


class SignupRequest(BaseModel):
    name: str = Field(min_length=1)
    email: str = Field(min_length=3)
    password: str = Field(min_length=8)
    modules: list[str] = Field(default_factory=list)


class UpdateUserRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    password: str | None = Field(default=None, min_length=8)
    modules: list[str] | None = None


class LoginRequest(BaseModel):
    email: str = Field(min_length=3)
    password: str = Field(min_length=1)


class AuthResponse(BaseModel):
    token: str
    name: str
    email: str
    role: str = "user"
    modules: list[str] = Field(default_factory=list)


class UserResponse(BaseModel):
    name: str
    email: str
    role: str = "user"
    modules: list[str] = Field(default_factory=list)


class UserListResponse(BaseModel):
    users: list[UserResponse]


def _load_users():
    if not USERS_FILE.exists():
        return _with_admin_user({})

    with USERS_FILE.open("r", encoding="utf-8") as file:
        return _with_admin_user(json.load(file))


def _save_users(users):
    BASE_DIR.mkdir(parents=True, exist_ok=True)
    with USERS_FILE.open("w", encoding="utf-8") as file:
        json.dump(users, file, indent=2)


def _with_admin_user(users):
    existing_admin = users.get(ADMIN_EMAIL)
    password_matches = False

    if existing_admin:
        try:
            password_matches = _verify_password(ADMIN_PASSWORD, existing_admin.get("password", ""))
        except ValueError:
            password_matches = False

    if (
        not existing_admin
        or existing_admin.get("name") != ADMIN_NAME
        or existing_admin.get("email") != ADMIN_EMAIL
        or existing_admin.get("role") != "admin"
        or _normalize_modules(existing_admin.get("modules", [])) != ADMIN_MODULES
        or not password_matches
    ):
        users[ADMIN_EMAIL] = {
            "name": ADMIN_NAME,
            "email": ADMIN_EMAIL,
            "password": _hash_password(ADMIN_PASSWORD),
            "role": "admin",
            "modules": ADMIN_MODULES,
        }
        _save_users(users)

    return users


def _normalize_modules(modules):
    return [module for module in MODULES if module in set(modules or [])]


def _sanitize_user(user):
    return UserResponse(
        name=user["name"],
        email=user["email"],
        role=user.get("role", "user"),
        modules=_normalize_modules(user.get("modules", [])),
    )


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
    sanitized_user = _sanitize_user(user)
    token = _sign_token(
        {
            "sub": sanitized_user.email,
            "name": sanitized_user.name,
            "role": sanitized_user.role,
            "modules": sanitized_user.modules,
            "exp": int(time.time()) + TOKEN_TTL_SECONDS,
        }
    )
    return AuthResponse(
        token=token,
        name=sanitized_user.name,
        email=sanitized_user.email,
        role=sanitized_user.role,
        modules=sanitized_user.modules,
    )


def require_user(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token")

    return get_user_from_token(credentials.credentials)


def get_user_from_token(token: str):
    payload = _decode_token(token)
    users = _load_users()
    user = users.get(payload["sub"].lower())
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return user


def user_has_module(user, module):
    modules = _normalize_modules(user.get("modules", []))
    return user.get("role") == "admin" or module in modules


def require_admin_user(user=Depends(require_user)):
    if user.get("email", "").lower() != ADMIN_EMAIL:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    return user


def require_module(module):
    def dependency(user=Depends(require_user)):
        if user_has_module(user, module):
            return user

        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Module access required")

    return dependency


@router.post("/signup", response_model=AuthResponse)
async def signup(request: SignupRequest):
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account creation is restricted to the admin")


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(request: SignupRequest, _admin=Depends(require_admin_user)):
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
        "role": "user",
        "modules": _normalize_modules(request.modules),
    }
    users[email] = user
    _save_users(users)

    return _sanitize_user(user)


@router.get("/users", response_model=UserListResponse)
async def list_users(_admin=Depends(require_admin_user)):
    users = _load_users()
    return UserListResponse(users=[_sanitize_user(user) for user in users.values()])


@router.patch("/users/{email}", response_model=UserResponse)
async def update_user(email: str, request: UpdateUserRequest, _admin=Depends(require_admin_user)):
    users = _load_users()
    normalized_email = email.strip().lower()
    user = users.get(normalized_email)

    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if normalized_email == ADMIN_EMAIL:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="The admin account cannot be edited")

    if request.name is not None:
        name = request.name.strip()
        if not name:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Valid name required")
        user["name"] = name

    if request.password is not None:
        user["password"] = _hash_password(request.password)

    if request.modules is not None:
        user["modules"] = _normalize_modules(request.modules)

    users[normalized_email] = user
    _save_users(users)

    return _sanitize_user(user)


@router.delete("/users/{email}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(email: str, _admin=Depends(require_admin_user)):
    users = _load_users()
    normalized_email = email.strip().lower()

    if normalized_email == ADMIN_EMAIL:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="The admin account cannot be deleted")

    if normalized_email not in users:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    del users[normalized_email]
    _save_users(users)


@router.post("/login", response_model=AuthResponse)
async def login(request: LoginRequest):
    users = _load_users()
    user = users.get(request.email.strip().lower())

    if user is None or not _verify_password(request.password, user["password"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    return _create_auth_response(user)
