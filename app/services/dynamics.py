import os
import asyncio
import httpx
from dotenv import load_dotenv
from app.services.auth import get_access_token
from app.services.metrics import increment_processed, increment_updated
from app.services.seamless import enrich_with_seamless
from app.services.usage import can_make_request, increment_usage, load_usage, WEEKLY_LIMIT

load_dotenv()

API_URL = os.getenv("DYNAMICS_API_URL")

STATE_ABBREVIATIONS = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR",
    "California": "CA", "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE",
    "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID",
    "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS",
    "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
    "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS",
    "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
    "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK",
    "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI",
    "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX",
    "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA",
    "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY"
}


# -------------------------------
# GET SINGLE ACCOUNT
# -------------------------------
async def get_account(account_id: str, select_fields: str = "name,websiteurl"):
    token = await get_access_token()

    url = f"{API_URL}/accounts({account_id})?$select={select_fields}"

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0"
    }

    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers)

    if response.status_code != 200:
        raise Exception(f"Failed to fetch account: {response.text}")

    return response.json()


# -------------------------------
# GET ACCOUNTS (LIMIT 100)
# -------------------------------
async def get_accounts_missing_data():
    token = await get_access_token()

    url = (
        f"{API_URL}/accounts?"
        "$select=name,accountid,emailaddress1,telephone1,address1_city,address1_stateorprovince&"
        "$filter=(emailaddress1 eq null or telephone1 eq null)&"
        "$top=100"
    )

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0"
    }

    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers)

    if response.status_code != 200:
        raise Exception(f"Dynamics GET error: {response.text}")

    return response.json().get("value", [])


# -------------------------------
# GET ACCOUNTS NEEDING ENRICHMENT
# -------------------------------
async def get_accounts_needing_enrichment():
    token = await get_access_token()

    url = (
        f"{API_URL}/accounts?"
        "$select=accountid,name,websiteurl,telephone1&"
        "$filter=(websiteurl eq null or telephone1 eq null) and address1_country eq 'United States' and new_sector ne null and contains(new_sector,'Manufacturing')&"
        "$top=10"
    )

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0"
    }

    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers)

    if response.status_code != 200:
        raise Exception(f"Dynamics GET error: {response.text}")

    return response.json().get("value", [])


# -------------------------------
# UPDATE ACCOUNT (PATCH)
# -------------------------------
async def update_account(account_id: str, updates: dict):
    token = await get_access_token()

    url = f"{API_URL}/accounts({account_id})"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "OData-Version": "4.0"
    }

    async with httpx.AsyncClient() as client:
        response = await client.patch(url, headers=headers, json=updates)

    if response.status_code not in [200, 204]:
        raise Exception(f"Dynamics UPDATE error: {response.text}")

    return True


# -------------------------------
# ENRICH ONE ACCOUNT (SAFE TEST)
# -------------------------------
async def enrich_single_account_test(account_id: str):
    account = await get_account(account_id, "name,emailaddress1,telephone1")

    updates = {}

    if not account.get("telephone1"):
        updates["telephone1"] = "555-123-4567"

    if not account.get("emailaddress1"):
        updates["emailaddress1"] = "test@example.com"

    if not updates:
        return {
            "message": "No missing fields to update",
            "account_id": account_id
        }

    await update_account(account_id, updates)

    return {
        "account_id": account_id,
        "updates_applied": updates
    }


# -------------------------------
# REVERT ACCOUNT FIELD(S)
# -------------------------------
async def revert_account_fields(account_id: str, fields: dict = None):
    token = await get_access_token()

    url = f"{API_URL}/accounts({account_id})"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "OData-Version": "4.0"
    }

    if not fields:
        fields = {
            "emailaddress1": None,
            "telephone1": None
        }

    async with httpx.AsyncClient() as client:
        response = await client.patch(url, headers=headers, json=fields)

    if response.status_code not in [200, 204]:
        raise Exception(f"Revert failed: {response.text}")

    return {
        "account_id": account_id,
        "reverted_fields": fields
    }


# -------------------------------
# ENRICH ACCOUNT (🔥 FIXED)
# -------------------------------
async def enrich_account(account_id: str):
    increment_processed()

    account = await get_account(
        account_id,
        "name,websiteurl,telephone1,address1_city,address1_stateorprovince,address1_country,numberofemployees,new_sector"
    )

    company_name = account.get("name")
    sector = account.get("new_sector") or ""

    print(f"🔍 Enriching: {company_name}")
    print(f"🏭 Sector: {sector}")

    if "manufacturing" not in sector.lower():
        print("❌ Skipping non-manufacturing company")
        return {
            "account_id": account_id,
            "updated": False,
            "reason": "Not manufacturing sector"
        }

    print("✅ Manufacturing company — proceeding")

    usage = load_usage()
    credits_used = usage.get("credits_used", 0)
    print(f"📊 Credits used: {credits_used}/{WEEKLY_LIMIT}")

    if not can_make_request():
        print("🚫 Weekly credit cap reached (2000)")
        print("🚫 Cap reached — stopping enrichment")
        return {
            "account_id": account_id,
            "updated": False,
            "reason": "Weekly credit cap reached"
        }

    seamless_data = await enrich_with_seamless(account)
    usage = increment_usage()
    print("✅ Credit consumed")
    print(f"📊 Credits used: {usage.get('credits_used', 0)}/{WEEKLY_LIMIT}")

    print(f"🌐 Seamless result: {seamless_data}")

    updates = {}

    # WEBSITE
    website = seamless_data.get("website")
    if not account.get("websiteurl") and website:
        if not website.startswith("http"):
            website = f"https://{website}"
        updates["websiteurl"] = website

    # PHONE
    phone = seamless_data.get("phone")
    if not account.get("telephone1") and phone:
        updates["telephone1"] = phone

    # STATE
    state = seamless_data.get("state")
    print(f"📍 Raw state: {state}")
    if state:
        state_clean = state.strip()
        state_abbr = STATE_ABBREVIATIONS.get(state_clean.title(), state_clean)
        print(f"📍 Converted state: {state_abbr}")
        if not account.get("address1_stateorprovince"):
            updates["address1_stateorprovince"] = state_abbr

    # COUNTRY
    country = seamless_data.get("country")
    if not account.get("address1_country") and country:
        updates["address1_country"] = country

    # EMPLOYEES
    employees = seamless_data.get("employees")
    if not account.get("numberofemployees") and employees:
        try:
            updates["numberofemployees"] = int(employees)
        except Exception:
            pass

    # DESCRIPTION
    description = seamless_data.get("description")
    if description:
        print(f"📝 Description found: {description[:100]}")
        if not account.get("description") or account.get("description").strip() == "":
            updates["description"] = description
            print("📝 Description updated")

    if updates:
        print(f"🚀 Updating: {updates}")
        await update_account(account_id, updates)
        increment_updated()

    return {
        "account_id": account_id,
        "updated": bool(updates),
        "updates": updates or None
    }


# -------------------------------
# BULK ENRICHMENT
# -------------------------------
async def enrich_accounts():
    accounts = await get_accounts_needing_enrichment()
    results = []

    print(f"🚀 Starting bulk enrichment for {len(accounts)} accounts")

    for account in accounts:
        account_id = account.get("accountid")

        if not account_id:
            continue

        result = await enrich_account(account_id)
        results.append(result)

        # 🔥 Rate limit safety
        await asyncio.sleep(1)

    updated_count = sum(1 for result in results if result["updated"])

    return {
        "processed": len(results),
        "updated": updated_count,
        "results": results
    }
