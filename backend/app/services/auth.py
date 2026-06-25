import os
import asyncio
import time
import httpx
from dotenv import load_dotenv
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = Path(__file__).resolve().parents[2]

load_dotenv(REPO_ROOT / ".env")
load_dotenv(BACKEND_ROOT / ".env")

TENANT_ID = os.getenv("TENANT_ID") or os.getenv("Tenant_ID")
CLIENT_ID = os.getenv("CLIENT_ID") or os.getenv("Application_ID")
CLIENT_SECRET = os.getenv("CLIENT_SECRET") or os.getenv("Client_Secret")
SCOPE = os.getenv("DYNAMICS_SCOPE")
TOKEN_REFRESH_SKEW_SECONDS = 60
TOKEN_REQUEST_TIMEOUT_SECONDS = 15
_TOKEN_CACHE = {
    "access_token": None,
    "expires_at": 0.0,
}
_TOKEN_LOCK = asyncio.Lock()


def _validate_oauth_config():
    required_values = {
        "TENANT_ID": TENANT_ID,
        "CLIENT_ID": CLIENT_ID,
        "CLIENT_SECRET": CLIENT_SECRET,
        "DYNAMICS_SCOPE": SCOPE,
    }
    missing_values = [
        name for name, value in required_values.items() if not value
    ]

    if missing_values:
        raise RuntimeError(
            "Missing Dynamics OAuth configuration: "
            f"{', '.join(missing_values)}. "
            "Set these values in the project .env file or process environment."
        )


def _get_cached_access_token():
    access_token = _TOKEN_CACHE["access_token"]
    if access_token and _TOKEN_CACHE["expires_at"] > time.monotonic() + TOKEN_REFRESH_SKEW_SECONDS:
        return access_token
    return None


def reset_access_token_cache():
    _TOKEN_CACHE["access_token"] = None
    _TOKEN_CACHE["expires_at"] = 0.0


async def get_access_token(force_refresh=False):
    _validate_oauth_config()
    if not force_refresh:
        cached_token = _get_cached_access_token()
        if cached_token:
            return cached_token

    async with _TOKEN_LOCK:
        if not force_refresh:
            cached_token = _get_cached_access_token()
            if cached_token:
                return cached_token

        return await _request_access_token()


async def _request_access_token():
    token_url = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token"

    data = {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "grant_type": "client_credentials",
        "scope": SCOPE,
    }

    async with httpx.AsyncClient(timeout=TOKEN_REQUEST_TIMEOUT_SECONDS) as client:
        response = await client.post(token_url, data=data)

    if response.status_code != 200:
        raise Exception(f"Token error: {response.text}")

    payload = response.json()
    access_token = payload["access_token"]
    expires_in = max(int(payload.get("expires_in", 3600)), TOKEN_REFRESH_SKEW_SECONDS + 1)
    _TOKEN_CACHE["access_token"] = access_token
    _TOKEN_CACHE["expires_at"] = time.monotonic() + expires_in
    return access_token
