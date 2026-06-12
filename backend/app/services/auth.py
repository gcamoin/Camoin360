import os
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


async def get_access_token():
    _validate_oauth_config()
    token_url = f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token"

    data = {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "grant_type": "client_credentials",
        "scope": SCOPE,
    }

    async with httpx.AsyncClient() as client:
        response = await client.post(token_url, data=data)

    if response.status_code != 200:
        raise Exception(f"Token error: {response.text}")

    return response.json()["access_token"]
