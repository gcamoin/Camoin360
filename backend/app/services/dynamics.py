import os
import asyncio
import time
import httpx
from dotenv import load_dotenv
from pathlib import Path
from datetime import datetime, timezone
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
SUMMARY_CACHE_TTL_SECONDS = 600
MARKETING_METRICS_CACHE_TTL_SECONDS = 600
INTERNAL_COMPANY_ACCOUNT_ID = "08c283ff-6186-eb11-a812-0022481d279b"
_DATA_QUALITY_CACHE = {"expires_at": 0, "data": None}
_SUMMARY_CACHE = {"expires_at": 0, "data": None}
_MARKETING_METRICS_CACHE = {"expires_at": 0, "data": None}
_PROJECT_METRICS_CACHE = {"expires_at": 0, "data": None}

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
        "$select=accountid,name,address1_stateorprovince,address1_country,address1_city,new_sector,description,websiteurl,telephone1,new_datasource,new_employees&"
        "$orderby=name asc&"
        "$top=2000"
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

    accounts = response.json().get("value", [])
    _DATA_QUALITY_CACHE["data"] = accounts
    _DATA_QUALITY_CACHE["expires_at"] = now + DATA_QUALITY_CACHE_TTL_SECONDS

    return accounts


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


def _shift_month(year: int, month: int, offset: int) -> tuple[int, int]:
    month_index = (year * 12) + (month - 1) + offset
    return month_index // 12, (month_index % 12) + 1


def _last_twelve_months(now: datetime) -> list[dict[str, int | str]]:
    start_year, start_month = _shift_month(now.year, now.month, -11)

    return [
        {
            "year": year,
            "month": month,
            "month_key": f"{year}-{month:02d}",
            "month_label": datetime(year, month, 1).strftime("%b '%y"),
        }
        for year, month in (_shift_month(start_year, start_month, offset) for offset in range(12))
    ]


async def get_website_visit_metrics():
    now = time.time()
    if _MARKETING_METRICS_CACHE["data"] is not None and _MARKETING_METRICS_CACHE["expires_at"] > now:
        return _MARKETING_METRICS_CACHE["data"]

    token = await get_access_token()
    current_time = datetime.now(timezone.utc)
    months = _last_twelve_months(current_time)
    start_date = _month_window_start(months)
    headers = _dynamics_read_headers(token)

    website_visits_url = (
        f"{API_URL}/lfapp_websitevisits?"
        "$select=lfapp_websitevisitid,lfapp_time&"
        f"$filter=_new_client_value eq {INTERNAL_COMPANY_ACCOUNT_ID} and lfapp_time ge {start_date}&"
        "$orderby=lfapp_time asc"
    )

    async with httpx.AsyncClient() as client:
        website_visit_counts = await _count_records_by_month(
            client,
            website_visits_url,
            headers,
            months,
            "lfapp_time",
        )

    visit_months = [
        {
            "month": month["month_label"],
            "month_key": month["month_key"],
            "visitors": website_visit_counts["counts_by_month"][month["month_key"]],
        }
        for month in months
    ]

    result = {
        "company_id": INTERNAL_COMPANY_ACCOUNT_ID,
        "updated_at": current_time.isoformat(),
        "total_visitors": website_visit_counts["total"],
        "months": visit_months,
    }
    _MARKETING_METRICS_CACHE["data"] = result
    _MARKETING_METRICS_CACHE["expires_at"] = now + MARKETING_METRICS_CACHE_TTL_SECONDS

    return result


async def get_project_creation_metrics():
    now = time.time()
    if _PROJECT_METRICS_CACHE["data"] is not None and _PROJECT_METRICS_CACHE["expires_at"] > now:
        return _PROJECT_METRICS_CACHE["data"]

    token = await get_access_token()
    current_time = datetime.now(timezone.utc)
    months = _last_twelve_months(current_time)
    start_date = _month_window_start(months)
    headers = _dynamics_read_headers(token)

    projects_url = (
        f"{API_URL}/new_projects?"
        "$select=new_projectid,createdon,new_serviceline&"
        f"$filter=createdon ge {start_date}&"
        "$orderby=createdon asc"
    )

    async with httpx.AsyncClient() as client:
        project_counts = await _count_projects_by_month_and_service_line(
            client,
            projects_url,
            headers,
            months,
        )

    project_months = [
        {
            "month": month["month_label"],
            "month_key": month["month_key"],
            "projects": project_counts["counts_by_month"][month["month_key"]],
            "service_lines": project_counts["service_lines_by_month"][month["month_key"]],
        }
        for month in months
    ]

    result = {
        "updated_at": current_time.isoformat(),
        "total_projects": project_counts["total"],
        "months": project_months,
        "service_lines": project_counts["service_line_totals"],
    }
    _PROJECT_METRICS_CACHE["data"] = result
    _PROJECT_METRICS_CACHE["expires_at"] = now + MARKETING_METRICS_CACHE_TTL_SECONDS

    return result


async def _count_projects_by_month_and_service_line(
    client: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
    months: list[dict[str, int | str]],
) -> dict[str, dict[str, int] | int]:
    counts_by_month = {month["month_key"]: 0 for month in months}
    service_counts_by_month = {month["month_key"]: {} for month in months}
    service_line_totals = {}
    total = 0

    while url:
        response = await client.get(url, headers=headers)

        if response.status_code != 200:
            raise Exception(f"Dynamics GET error: {response.text}")

        payload = response.json()

        for project in payload.get("value", []):
            created_on = project.get("createdon")
            if not created_on:
                continue

            parsed_time = datetime.fromisoformat(created_on.replace("Z", "+00:00"))
            month_key = parsed_time.strftime("%Y-%m")

            if month_key not in counts_by_month:
                continue

            counts_by_month[month_key] += 1
            total += 1

            formatted_service_lines = project.get(
                "new_serviceline@OData.Community.Display.V1.FormattedValue",
                "",
            )
            service_lines = [
                service_line.strip()
                for service_line in formatted_service_lines.split(";")
                if service_line.strip()
            ] or ["Unspecified"]

            for service_line in service_lines:
                service_counts = service_counts_by_month[month_key]
                service_counts[service_line] = service_counts.get(service_line, 0) + 1
                service_line_totals[service_line] = service_line_totals.get(service_line, 0) + 1

        url = payload.get("@odata.nextLink")

    service_lines_by_month = {
        month_key: [
            {"service_line": service_line, "projects": project_count}
            for service_line, project_count in sorted(
                service_counts.items(),
                key=lambda item: (-item[1], item[0].casefold()),
            )
        ]
        for month_key, service_counts in service_counts_by_month.items()
    }

    return {
        "counts_by_month": counts_by_month,
        "service_lines_by_month": service_lines_by_month,
        "service_line_totals": [
            {"service_line": service_line, "projects": project_count}
            for service_line, project_count in sorted(
                service_line_totals.items(),
                key=lambda item: (-item[1], item[0].casefold()),
            )
        ],
        "total": total,
    }


def _month_window_start(months: list[dict[str, int | str]]) -> str:
    first_month = months[0]
    return datetime(
        int(first_month["year"]),
        int(first_month["month"]),
        1,
        tzinfo=timezone.utc,
    ).strftime("%Y-%m-%dT%H:%M:%SZ")


def _dynamics_read_headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0",
        "Prefer": 'odata.include-annotations="OData.Community.Display.V1.FormattedValue",odata.maxpagesize=5000',
    }


async def _count_records_by_month(
    client: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
    months: list[dict[str, int | str]],
    date_field: str,
) -> dict[str, dict[str, int] | int]:
    counts_by_month = {month["month_key"]: 0 for month in months}
    total = 0

    while url:
        response = await client.get(url, headers=headers)

        if response.status_code != 200:
            raise Exception(f"Dynamics GET error: {response.text}")

        payload = response.json()

        for record in payload.get("value", []):
            date_value = record.get(date_field)
            if not date_value:
                continue

            parsed_time = datetime.fromisoformat(date_value.replace("Z", "+00:00"))
            month_key = parsed_time.strftime("%Y-%m")

            if month_key in counts_by_month:
                counts_by_month[month_key] += 1
                total += 1

        url = payload.get("@odata.nextLink")

    return {"counts_by_month": counts_by_month, "total": total}


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
        log_update(company_name, updates)

    return {
        "account_id": account_id,
        "updated": bool(updates),
        "updates": updates or None
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
