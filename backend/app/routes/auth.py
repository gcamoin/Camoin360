"""PostgreSQL-only application authentication. No JSON fallback or provisioning."""
import base64
import binascii
import hashlib
import hmac
import json
import os
import re
import time

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from ..services import application_users as accounts
from ..services.application_auth_configuration import require_auth_configuration
from ..services.application_auth_policy import MODULES, normalize_modules as _normalize_modules
from ..database import get_auth_database_connection

router = APIRouter(prefix="/auth", tags=["auth"])
bearer_scheme = HTTPBearer(auto_error=False)
TOKEN_TTL_SECONDS = 60 * 60 * 12
DEFAULT_ORGANIZATION_ID = int(os.getenv("CAMOIN360_ORGANIZATION_ID", "1"))
TOKEN_ISSUER = "camoin360"
TOKEN_AUDIENCE = "camoin360-web"


class SignupRequest(BaseModel):
    name: str = Field(min_length=1)
    email: str = Field(min_length=3)
    password: str = Field(min_length=8)
    modules: list[str] = Field(default_factory=list)
    organization_id: int = Field(default=DEFAULT_ORGANIZATION_ID, ge=1)


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
    organization_id: int


class UserResponse(BaseModel):
    name: str
    email: str
    role: str = "user"
    modules: list[str] = Field(default_factory=list)
    organization_id: int = DEFAULT_ORGANIZATION_ID


class UserListResponse(BaseModel):
    users: list[UserResponse]


def _sanitize_user(user):
    public = user.public_dict()
    public["modules"] = _normalize_modules(public["modules"])
    return UserResponse(**public)


def _operation(function, *args, **kwargs):
    try:
        return function(*args, **kwargs)
    except accounts.AccountStorageError:
        raise HTTPException(503, "Authentication storage unavailable") from None
    except accounts.AccountConflict:
        raise HTTPException(409, "Email already exists") from None
    except LookupError:
        raise HTTPException(404, "User not found") from None
    except PermissionError:
        raise HTTPException(403, "The admin account cannot be edited or deleted") from None
    except ValueError:
        raise HTTPException(422, "Valid account details required") from None


def _secret():
    try:
        secret = require_auth_configuration(os.environ).secret_key.encode("utf-8")
        with get_auth_database_connection() as connection:
            marker = connection.execute("SELECT signing_key_digest FROM application_auth_bootstrap WHERE singleton=1").fetchone()
        if marker is None or not hmac.compare_digest(marker["signing_key_digest"], hashlib.sha256(secret).hexdigest()):
            raise HTTPException(503, "Authentication signing configuration unavailable")
        return secret
    except ValueError:
        raise HTTPException(503, "Authentication configuration unavailable") from None
    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(503, "Authentication configuration unavailable") from None


def _b64encode(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64decode(value):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise ValueError("Invalid encoding")
    return base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)


def _sign_token(payload):
    # Fixed HS256 only; no caller-controlled algorithm or key lookup.
    header = _b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    body = _b64encode(json.dumps(payload, separators=(",", ":")).encode())
    message = f"{header}.{body}"
    signature = hmac.new(_secret(), message.encode("ascii"), hashlib.sha256).digest()
    return f"{message}.{_b64encode(signature)}"


def _decode_token(token):
    secret = _secret()
    try:
        if not isinstance(token, str) or len(token) > 16384:
            raise ValueError("Invalid token")
        header, body, signature = token.split(".")
        if json.loads(_b64decode(header)) != {"alg": "HS256", "typ": "JWT"}:
            raise ValueError("Invalid header")
        expected = hmac.new(secret, f"{header}.{body}".encode("ascii"), hashlib.sha256).digest()
        if not hmac.compare_digest(_b64decode(signature), expected):
            raise ValueError("Invalid signature")
        payload = json.loads(_b64decode(body))
        if not isinstance(payload, dict):
            raise ValueError("Invalid payload")
        if (payload.get("iss") != TOKEN_ISSUER or payload.get("aud") != TOKEN_AUDIENCE
                or not isinstance(payload.get("sub"), str) or not isinstance(payload.get("uid"), str)
                or not payload["uid"] or accounts.normalize_email(payload["sub"]) != payload["sub"]
                or type(payload.get("exp")) is not int or type(payload.get("iat")) is not int
                or payload["iat"] > int(time.time()) or not 0 < payload["exp"] - payload["iat"] <= TOKEN_TTL_SECONDS):
            raise ValueError("Invalid claims")
    except (ValueError, TypeError, UnicodeError, binascii.Error, RecursionError):
        raise HTTPException(401, "Invalid token") from None
    if payload["exp"] <= int(time.time()):
        raise HTTPException(401, "Token expired")
    return payload


def _create_auth_response(user):
    public = _sanitize_user(user)
    now = int(time.time())
    payload = {"sub": public.email, "uid": user.id, "name": public.name, "role": public.role,
               "modules": public.modules, "organization_id": public.organization_id,
               "iat": now, "exp": now + TOKEN_TTL_SECONDS, "iss": TOKEN_ISSUER, "aud": TOKEN_AUDIENCE}
    return AuthResponse(token=_sign_token(payload), **public.model_dump())


def require_user(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    if credentials is None:
        raise HTTPException(401, "Missing token")
    return get_user_from_token(credentials.credentials)


def get_user_from_token(token: str):
    payload = _decode_token(token)
    user = _operation(accounts.get_user, payload["sub"])
    if user is None or user.id != payload["uid"]:
        raise HTTPException(401, "User not found")
    return _sanitize_user(user).model_dump()


def user_has_module(user, module):
    return user.get("role") == "admin" or module in _normalize_modules(user.get("modules", []))


def require_admin_user(user=Depends(require_user)):
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin access required")
    return user


def require_module(module):
    def dependency(user=Depends(require_user)):
        if not user_has_module(user, module):
            raise HTTPException(403, "Module access required")
        return user
    return dependency


@router.post("/signup", response_model=AuthResponse)
def signup(request: SignupRequest):
    raise HTTPException(403, "Account creation is restricted to the admin")


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(request: SignupRequest, _admin=Depends(require_admin_user)):
    user = _operation(accounts.create_user, name=request.name.strip(), email=request.email,
                      password=request.password, organization_id=request.organization_id,
                      modules=_normalize_modules(request.modules), role="user")
    return _sanitize_user(user)


@router.get("/users", response_model=UserListResponse)
def list_users(_admin=Depends(require_admin_user)):
    return UserListResponse(users=[_sanitize_user(user) for user in _operation(accounts.list_users)])


def _editable_user(email):
    user = _operation(accounts.get_user, email)
    if user is None:
        raise HTTPException(404, "User not found")
    if user.role == "admin":
        raise HTTPException(403, "The admin account cannot be edited or deleted")
    return user


@router.patch("/users/{email}", response_model=UserResponse)
def update_user(email: str, request: UpdateUserRequest, _admin=Depends(require_admin_user)):
    _editable_user(email)
    modules = None if request.modules is None else _normalize_modules(request.modules)
    user = _operation(accounts.update_user, email, name=None if request.name is None else request.name.strip(),
                      password=request.password, modules=modules, protect_admin=True)
    return _sanitize_user(user)


@router.delete("/users/{email}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(email: str, _admin=Depends(require_admin_user)):
    _editable_user(email)
    _operation(accounts.delete_user, email, protect_admin=True)


@router.post("/login", response_model=AuthResponse)
def login(request: LoginRequest):
    try:
        user = accounts.authenticate(request.email, request.password)
    except ValueError:
        user = None
    except accounts.AccountStorageError:
        raise HTTPException(503, "Authentication storage unavailable") from None
    if user is None:
        raise HTTPException(401, "Invalid email or password")
    return _create_auth_response(user)
