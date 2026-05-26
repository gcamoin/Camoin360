import os
import time
import httpx
from dotenv import load_dotenv

load_dotenv()

TENANT_ID = os.getenv("TENANT_ID")
CLIENT_ID = os.getenv("CLIENT_ID")
CLIENT_SECRET = os.getenv("CLIENT_SECRET")
SCOPE = os.getenv("DYNAMICS_SCOPE")

# -----------------------------------
# TOKEN CACHE
# -----------------------------------
_cached_token = None
_token_expiry = 0


# -----------------------------------
# GET ACCESS TOKEN
# -----------------------------------
async def get_access_token():

    global _cached_token
    global _token_expiry

    current_time = time.time()

    # -----------------------------------
    # RETURN CACHED TOKEN
    # -----------------------------------
    if (
        _cached_token is not None
        and current_time < _token_expiry
    ):

        print("✅ Using cached Dynamics token")

        return _cached_token

    print("🔐 Requesting NEW Dynamics token")

    token_url = (
        f"https://login.microsoftonline.com/"
        f"{TENANT_ID}/oauth2/v2.0/token"
    )

    data = {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "grant_type": "client_credentials",
        "scope": SCOPE,
    }

    # -----------------------------------
    # REQUEST TOKEN
    # -----------------------------------
    async with httpx.AsyncClient(
        timeout=60.0
    ) as client:

        response = await client.post(
            token_url,
            data=data
        )

    print(f"📊 Token response: {response.status_code}")

    if response.status_code != 200:

        raise Exception(
            f"Token error: {response.text}"
        )

    token_data = response.json()

    access_token = token_data["access_token"]

    expires_in = token_data.get(
        "expires_in",
        3600
    )

    # -----------------------------------
    # CACHE TOKEN
    # -----------------------------------
    _cached_token = access_token

    # refresh 5 minutes early
    _token_expiry = (
        current_time + expires_in - 300
    )

    print(
        f"✅ Token cached for "
        f"{expires_in} seconds"
    )

    return access_token