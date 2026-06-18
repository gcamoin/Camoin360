import os
import asyncio
import time
import httpx
from dotenv import load_dotenv
from pathlib import Path
from .auth import get_access_token
from .metrics import increment_processed, log_update
from .seamless import enrich_with_seamless
from .usage import can_make_request, increment_usage, load_usage, WEEKLY_LIMIT

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = Path(__file__).resolve().parents[2]

load_dotenv(REPO_ROOT / ".env")
load_dotenv(BACKEND_ROOT / ".env")

API_URL = os.getenv("DYNAMICS_API_URL")
DATA_QUALITY_CACHE_TTL_SECONDS = 120
DATA_QUALITY_ACCOUNT_LIMIT = 20000
SUMMARY_CACHE_TTL_SECONDS = 600
DATA_QUALITY_REQUEST_TIMEOUT_SECONDS = 60
DUPLICATE_ACCOUNT_DEFAULT_LIMIT = 1000
DUPLICATE_ACCOUNT_MAX_LIMIT = 1000
MARKETING_LIST_DEFAULT_LIMIT = 5000
MARKETING_LIST_REQUEST_TIMEOUT_SECONDS = 60
_DATA_QUALITY_CACHE = {"expires_at": 0, "data": None}
_SUMMARY_CACHE = {"expires_at": 0, "data": None}

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


async def get_accounts_data_quality():
    now = time.time()
    if _DATA_QUALITY_CACHE["data"] is not None and _DATA_QUALITY_CACHE["expires_at"] > now:
        return _DATA_QUALITY_CACHE["data"]

    token = await get_access_token()

    url = (
        f"{API_URL}/accounts?"
        # TODO: Add NAICS text and subsector once the exact Dynamics field names are confirmed.
        "$select=accountid,name,address1_stateorprovince,address1_country,address1_city,new_sector,description,websiteurl,telephone1,new_datasource,new_employees&"
        "$orderby=name asc&"
        f"$top={DATA_QUALITY_ACCOUNT_LIMIT}"
    )

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0",
        "Prefer": "odata.maxpagesize=5000",
    }

    accounts = []
    next_url = url

    timeout = httpx.Timeout(DATA_QUALITY_REQUEST_TIMEOUT_SECONDS)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            while next_url and len(accounts) < DATA_QUALITY_ACCOUNT_LIMIT:
                response = await client.get(next_url, headers=headers)

                if response.status_code != 200:
                    raise Exception(f"Dynamics GET error: {response.text}")

                response_data = response.json()
                accounts.extend(response_data.get("value", []))
                next_url = response_data.get("@odata.nextLink")
    except httpx.TimeoutException as exc:
        raise Exception(
            f"Dynamics request timed out after {DATA_QUALITY_REQUEST_TIMEOUT_SECONDS} seconds while loading data quality accounts"
        ) from exc

    accounts = accounts[:DATA_QUALITY_ACCOUNT_LIMIT]
    _DATA_QUALITY_CACHE["data"] = accounts
    _DATA_QUALITY_CACHE["expires_at"] = now + DATA_QUALITY_CACHE_TTL_SECONDS

    return accounts


async def get_duplicate_account_records(limit: int = DUPLICATE_ACCOUNT_DEFAULT_LIMIT):
    account_limit = max(1, min(limit, DUPLICATE_ACCOUNT_MAX_LIMIT))
    token = await get_access_token()

    url = (
        f"{API_URL}/accounts?"
        "$select=accountid,name,websiteurl,address1_country,address1_stateorprovince,address1_city,telephone1,new_sector,createdon&"
        "$orderby=name asc&"
        f"$top={account_limit}"
    )

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0",
        "Prefer": f"odata.maxpagesize={account_limit}",
    }

    accounts = []
    next_url = url
    timeout = httpx.Timeout(DATA_QUALITY_REQUEST_TIMEOUT_SECONDS)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            while next_url and len(accounts) < account_limit:
                response = await client.get(next_url, headers=headers)

                if response.status_code != 200:
                    raise Exception(f"Dynamics GET error: {response.text}")

                payload = response.json()
                accounts.extend(payload.get("value", []))
                next_url = payload.get("@odata.nextLink")
    except httpx.TimeoutException as exc:
        raise Exception(
            f"Dynamics request timed out after {DATA_QUALITY_REQUEST_TIMEOUT_SECONDS} seconds while loading duplicate account records"
        ) from exc

    return accounts[:account_limit]


def get_formatted_value(record: dict, field_name: str):
    return record.get(f"{field_name}@OData.Community.Display.V1.FormattedValue", record.get(field_name))


def normalize_marketing_list_record(record: dict):
    created_by = record.get("createdby", {}) if isinstance(record.get("createdby"), dict) else {}

    return {
        "listid": record.get("listid"),
        "name": record.get("listname"),
        "marketing_list_name": record.get("listname"),
        "createdon": record.get("createdon"),
        "created_by": created_by.get("fullname") or get_formatted_value(record, "_createdby_value") or "",
        "member_count": record.get("membercount"),
        "list_member_type": get_formatted_value(record, "createdfromcode") or "",
        "list_type": get_formatted_value(record, "type") or "",
        "client_name": record.get("client_name", ""),
        "campaign": record.get("campaign", ""),
    }


async def get_marketing_lists(limit: int = MARKETING_LIST_DEFAULT_LIMIT):
    token = await get_access_token()

    url = (
        f"{API_URL}/lists?"
        "$select=listid,listname,createdon,membercount,createdfromcode,type,_createdby_value&"
        "$expand=createdby($select=fullname)&"
        "$orderby=createdon desc&"
        f"$top={limit}"
    )

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0",
        "Prefer": 'odata.include-annotations="OData.Community.Display.V1.FormattedValue",odata.maxpagesize=5000',
    }

    marketing_lists = []
    next_url = url
    timeout = httpx.Timeout(MARKETING_LIST_REQUEST_TIMEOUT_SECONDS)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            while next_url and len(marketing_lists) < limit:
                response = await client.get(next_url, headers=headers)

                if response.status_code != 200:
                    raise Exception(f"Dynamics GET error: {response.text}")

                payload = response.json()
                marketing_lists.extend(
                    normalize_marketing_list_record(record)
                    for record in payload.get("value", [])
                )
                next_url = payload.get("@odata.nextLink")
    except httpx.TimeoutException as exc:
        raise Exception(
            f"Dynamics request timed out after {MARKETING_LIST_REQUEST_TIMEOUT_SECONDS} seconds while loading marketing lists"
        ) from exc

    return marketing_lists[:limit]


async def get_account_sector_counts():
    now = time.time()
    if _SUMMARY_CACHE["data"] is not None and _SUMMARY_CACHE["expires_at"] > now:
        return _SUMMARY_CACHE["data"]

    token = await get_access_token()

    url = (
        f"{API_URL}/accounts?"
        "$select=new_sector"
    )

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0",
        "Prefer": 'odata.include-annotations="OData.Community.Display.V1.FormattedValue",odata.maxpagesize=5000',
    }

    sector_counts = {}

    async with httpx.AsyncClient() as client:
        while url:
            response = await client.get(url, headers=headers)

            if response.status_code != 200:
                raise Exception(f"Dynamics GET error: {response.text}")

            payload = response.json()

            for account in payload.get("value", []):
                raw_sector = account.get("new_sector@OData.Community.Display.V1.FormattedValue", account.get("new_sector"))
                sector = str(raw_sector).strip() if raw_sector is not None else ""
                sector = sector or "Unspecified"
                sector_counts[sector] = sector_counts.get(sector, 0) + 1

            url = payload.get("@odata.nextLink")

    sectors = [
        {"sector": sector, "account_count": account_count}
        for sector, account_count in sector_counts.items()
    ]
    sectors.sort(key=lambda item: (-item["account_count"], item["sector"].casefold()))

    total_accounts = sum(item["account_count"] for item in sectors)

    summary = {
        "total_accounts": total_accounts,
        "sector_count": len(sectors),
        "sectors": sectors
    }
    _SUMMARY_CACHE["data"] = summary
    _SUMMARY_CACHE["expires_at"] = now + SUMMARY_CACHE_TTL_SECONDS

    return summary


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


def should_update_field(field_key: str, fields_to_update: set[str] | None):
    return fields_to_update is None or field_key in fields_to_update


async def enrich_account(account_id: str, fields_to_update: list[str] | None = None):
    increment_processed()
    requested_fields = set(fields_to_update) if fields_to_update else None

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
    if should_update_field("websiteurl", requested_fields) and not account.get("websiteurl") and website:
        if not website.startswith("http"):
            website = f"https://{website}"
        updates["websiteurl"] = website

    # PHONE
    phone = seamless_data.get("phone")
    if should_update_field("telephone1", requested_fields) and not account.get("telephone1") and phone:
        updates["telephone1"] = phone

    # STATE
    state = seamless_data.get("state")
    print(f"📍 Raw state: {state}")
    if should_update_field("address1_stateorprovince", requested_fields) and state:
        state_clean = state.strip()
        state_abbr = STATE_ABBREVIATIONS.get(state_clean.title(), state_clean)
        print(f"📍 Converted state: {state_abbr}")
        if not account.get("address1_stateorprovince"):
            updates["address1_stateorprovince"] = state_abbr

    # COUNTRY
    country = seamless_data.get("country")
    if should_update_field("address1_country", requested_fields) and not account.get("address1_country") and country:
        updates["address1_country"] = country

    # EMPLOYEES
    employees = seamless_data.get("employees")
    if should_update_field("new_employees", requested_fields) and not account.get("numberofemployees") and employees:
        try:
            updates["numberofemployees"] = int(employees)
        except Exception:
            pass

    # DESCRIPTION
    description = seamless_data.get("description")
    if should_update_field("description", requested_fields) and description:
        print(f"📝 Description found: {description[:100]}")
        if not account.get("description") or account.get("description").strip() == "":
            updates["description"] = description
            print("📝 Description updated")

    if updates:
        print(f"🚀 Updating: {updates}")
        await update_account(account_id, updates)
        log_update(company_name, updates)

    return {
        "account_id": account_id,
        "updated": bool(updates),
        "updates": updates or None
    }


async def enrich_selected_accounts(account_ids: list[str], fields_to_update: list[str]):
    results = []

    for account_id in account_ids:
        if not account_id:
            continue

        try:
            result = await enrich_account(account_id, fields_to_update)
        except Exception as exc:
            result = {
                "account_id": account_id,
                "updated": False,
                "error": str(exc),
            }

        results.append(result)
        await asyncio.sleep(1)

    updated_count = sum(1 for result in results if result.get("updated"))

    return {
        "processed": len(results),
        "updated": updated_count,
        "results": results
    }


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

        # Rate limit safety
        await asyncio.sleep(1)

    updated_count = sum(1 for result in results if result["updated"])

    return {
        "processed": len(results),
        "updated": updated_count,
        "results": results
    }
