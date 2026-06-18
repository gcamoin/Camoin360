import os
import asyncio
import time
import httpx
import re
from dotenv import load_dotenv
from pathlib import Path
from datetime import datetime, timedelta, timezone
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
TARGET_INDUSTRIES_TABLE = "new_targetindustries"
TARGET_INDUSTRY_CLIENT_LOOKUP_FIELD = "_new_clientid_value"
TARGET_INDUSTRY_NAME_FIELD = "new_targetindustrydisplayname"
TARGET_INDUSTRY_NAICS_FIELD = "new_naicsprefixcode"
TARGET_INDUSTRY_CODE_FIELDS = (
    "new_naicsprefixcode",
    "naicscode",
    "new_naicscode",
)
TARGET_INDUSTRY_ENTITY_SET_CANDIDATES = (
    "new_targetindustries",
    "new_targetindustrieses",
    "new_targetindustry",
)
ACCOUNT_NAICS_FIELDS = (
    "new_naicsprefixcode",
    "naicscode",
    "new_naicscode",
)
VISITOR_ACCOUNT_LOOKUP_FIELDS = (
    "_new_account_value",
    "_lfapp_account_value",
    "_new_visitoraccount_value",
    "_lfapp_visitoraccount_value",
    "_new_visitor_value",
    "_lfapp_visitor_value",
)
_DATA_QUALITY_CACHE = {"expires_at": 0, "data": None}
_SUMMARY_CACHE = {"expires_at": 0, "data": None}
_MARKETING_METRICS_CACHE = {"expires_at": 0, "data": None}
_PROJECT_METRICS_CACHE = {"expires_at": 0, "data": None}
MARKETING_RANGE_OPTIONS = {
    "last_week": {"label": "Last Week", "days": 7},
    "last_month": {"label": "Last Month", "days": 30},
    "last_6_months": {"label": "Last 6 Months", "months": 6},
    "last_year": {"label": "Last Year", "months": 12},
}

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


def _month_buckets(now: datetime, month_count: int) -> list[dict[str, int | str]]:
    start_year, start_month = _shift_month(now.year, now.month, -(month_count - 1))

    return [
        {
            "year": year,
            "month": month,
            "month_key": f"{year}-{month:02d}",
            "month_label": datetime(year, month, 1).strftime("%b '%y"),
        }
        for year, month in (_shift_month(start_year, start_month, offset) for offset in range(month_count))
    ]


def _last_twelve_months(now: datetime) -> list[dict[str, int | str]]:
    return _month_buckets(now, 12)


def _day_buckets(start_date: datetime, day_count: int) -> list[dict[str, str]]:
    return [
        {
            "day_key": (start_date + timedelta(days=offset)).strftime("%Y-%m-%d"),
            "day_label": (start_date + timedelta(days=offset)).strftime("%b %-d"),
        }
        for offset in range(day_count)
    ]


def _marketing_window(range_key: str, now: datetime) -> dict[str, object]:
    option = MARKETING_RANGE_OPTIONS.get(range_key, MARKETING_RANGE_OPTIONS["last_year"])

    if "days" in option:
        day_count = int(option["days"])
        start_date = (now - timedelta(days=day_count - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
        return {
            "range": range_key if range_key in MARKETING_RANGE_OPTIONS else "last_year",
            "label": option["label"],
            "start_date": start_date,
            "buckets": _day_buckets(start_date, day_count),
            "bucket_key": "day_key",
            "bucket_label": "day_label",
            "bucket_grain": "day",
        }

    month_count = int(option["months"])
    buckets = _month_buckets(now, month_count)
    return {
        "range": range_key if range_key in MARKETING_RANGE_OPTIONS else "last_year",
        "label": option["label"],
        "start_date": datetime(
            int(buckets[0]["year"]),
            int(buckets[0]["month"]),
            1,
            tzinfo=timezone.utc,
        ),
        "buckets": buckets,
        "bucket_key": "month_key",
        "bucket_label": "month_label",
        "bucket_grain": "month",
    }


async def get_website_visit_metrics(range_key: str = "last_year"):
    now = time.time()
    cache_key = range_key if range_key in MARKETING_RANGE_OPTIONS else "last_year"
    cached_data = _MARKETING_METRICS_CACHE["data"] or {}
    if cache_key in cached_data and _MARKETING_METRICS_CACHE["expires_at"] > now:
        return cached_data[cache_key]

    token = await get_access_token()
    current_time = datetime.now(timezone.utc)
    window = _marketing_window(range_key, current_time)
    buckets = window["buckets"]
    start_date = window["start_date"].strftime("%Y-%m-%dT%H:%M:%SZ")
    headers = _dynamics_read_headers(token)

    website_visits_url = (
        f"{API_URL}/lfapp_websitevisits?"
        f"$filter=_new_client_value eq {INTERNAL_COMPANY_ACCOUNT_ID} and lfapp_time ge {start_date}&"
        "$orderby=lfapp_time asc"
    )

    async with httpx.AsyncClient() as client:
        target_naics_codes = await _fetch_target_industry_naics_codes(client, headers)
        website_visit_counts = await _count_website_visits(
            client,
            website_visits_url,
            headers,
            buckets,
            window["bucket_key"],
            window["bucket_grain"],
            target_naics_codes,
        )

    visit_buckets = [
        {
            "period": bucket[window["bucket_label"]],
            "period_key": bucket[window["bucket_key"]],
            "visitors": website_visit_counts["counts_by_bucket"][bucket[window["bucket_key"]]],
            "target_visitors": website_visit_counts["target_counts_by_bucket"][bucket[window["bucket_key"]]],
        }
        for bucket in buckets
    ]

    result = {
        "company_id": INTERNAL_COMPANY_ACCOUNT_ID,
        "range": window["range"],
        "range_label": window["label"],
        "bucket_grain": window["bucket_grain"],
        "updated_at": current_time.isoformat(),
        "total_visitors": website_visit_counts["total"],
        "target_total_visitors": website_visit_counts["target_total"],
        "months": visit_buckets,
        "landing_pages": website_visit_counts["landing_pages"],
    }
    cached_data[cache_key] = result
    _MARKETING_METRICS_CACHE["data"] = cached_data
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


async def _count_website_visits(
    client: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
    buckets: list[dict[str, int | str]],
    bucket_key: str,
    bucket_grain: str,
    target_naics_codes: set[str] | None = None,
) -> dict[str, object]:
    counts_by_bucket = {bucket[bucket_key]: 0 for bucket in buckets}
    target_counts_by_bucket = {bucket[bucket_key]: 0 for bucket in buckets}
    landing_page_counts = {}
    visits_for_targeting = []
    total = 0
    target_total = 0

    while url:
        response = await client.get(url, headers=headers)

        if response.status_code != 200:
            raise Exception(f"Dynamics GET error: {response.text}")

        payload = response.json()

        for visit in payload.get("value", []):
            visit_time = visit.get("lfapp_time")
            if not visit_time:
                continue

            parsed_time = datetime.fromisoformat(visit_time.replace("Z", "+00:00"))
            current_key = parsed_time.strftime("%Y-%m-%d" if bucket_grain == "day" else "%Y-%m")

            if current_key not in counts_by_bucket:
                continue

            landing_page = (visit.get("lfapp_landingpage") or "").strip() or "Unspecified"
            counts_by_bucket[current_key] += 1
            landing_page_counts[landing_page] = landing_page_counts.get(landing_page, 0) + 1
            total += 1

            visitor_account_id = _get_visitor_account_id(visit)
            if visitor_account_id:
                visits_for_targeting.append(
                    {
                        "bucket_key": current_key,
                        "visitor_account_id": visitor_account_id,
                    }
                )

        url = payload.get("@odata.nextLink")

    if target_naics_codes and visits_for_targeting:
        visitor_account_ids = {
            visit["visitor_account_id"]
            for visit in visits_for_targeting
        }
        account_naics_codes = await _fetch_account_naics_codes(client, headers, visitor_account_ids)

        for visit in visits_for_targeting:
            account_naics = account_naics_codes.get(visit["visitor_account_id"], set())
            if _has_target_naics_match(account_naics, target_naics_codes):
                target_counts_by_bucket[visit["bucket_key"]] += 1
                target_total += 1

    return {
        "counts_by_bucket": counts_by_bucket,
        "target_counts_by_bucket": target_counts_by_bucket,
        "landing_pages": [
            {"landing_page": landing_page, "visitors": visitor_count}
            for landing_page, visitor_count in sorted(
                landing_page_counts.items(),
                key=lambda item: (-item[1], item[0].casefold()),
            )
        ],
        "total": total,
        "target_total": target_total,
    }


async def _fetch_target_industry_naics_codes(
    client: httpx.AsyncClient,
    headers: dict[str, str],
) -> set[str]:
    entity_set_name = await _resolve_entity_set_name(
        client,
        headers,
        TARGET_INDUSTRIES_TABLE,
        TARGET_INDUSTRY_ENTITY_SET_CANDIDATES,
    )
    target_naics_codes = set()
    code_field = await _resolve_existing_field(
        client,
        headers,
        entity_set_name,
        TARGET_INDUSTRY_CODE_FIELDS,
        "target industries NAICS",
    )
    url = _target_industries_url(entity_set_name, code_field)

    while url:
        response = await client.get(url, headers=headers)

        if response.status_code == 404:
            entity_set_name = await _find_working_entity_set_name(
                client,
                headers,
                TARGET_INDUSTRY_ENTITY_SET_CANDIDATES,
            )
            code_field = await _resolve_existing_field(
                client,
                headers,
                entity_set_name,
                TARGET_INDUSTRY_CODE_FIELDS,
                "target industries NAICS",
            )
            url = _target_industries_url(entity_set_name, code_field)
            response = await client.get(url, headers=headers)

        if response.status_code != 200:
            raise Exception(f"Dynamics GET error: {response.text}")

        payload = response.json()

        for target_industry in payload.get("value", []):
            target_naics_codes.update(
                _normalize_naics_codes(target_industry.get(code_field))
            )

        url = payload.get("@odata.nextLink")

    return target_naics_codes


async def _resolve_entity_set_name(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    logical_name: str,
    fallback_candidates: tuple[str, ...],
) -> str:
    metadata_url = (
        f"{API_URL}/EntityDefinitions(LogicalName='{logical_name}')?"
        "$select=EntitySetName"
    )
    response = await client.get(metadata_url, headers=headers)

    if response.status_code == 200:
        entity_set_name = response.json().get("EntitySetName")
        if entity_set_name:
            return entity_set_name

    return await _find_working_entity_set_name(client, headers, fallback_candidates)


async def _find_working_entity_set_name(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    candidates: tuple[str, ...],
) -> str:
    last_error = ""

    for candidate in candidates:
        response = await client.get(
            f"{API_URL}/{candidate}?$select={TARGET_INDUSTRY_NAICS_FIELD}&$top=1",
            headers=headers,
        )
        if response.status_code == 200:
            return candidate

        last_error = response.text

    raise Exception(f"Unable to find target industries entity set: {last_error}")


async def _resolve_existing_field(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    entity_set_name: str,
    field_candidates: tuple[str, ...],
    field_label: str,
) -> str:
    last_error = ""

    for field_name in field_candidates:
        response = await client.get(
            f"{API_URL}/{entity_set_name}?$select={field_name}&$top=1",
            headers=headers,
        )
        if response.status_code == 200:
            return field_name

        last_error = response.text

    raise Exception(f"Unable to find {field_label} field: {last_error}")


def _target_industries_url(entity_set_name: str, code_field: str) -> str:
    return (
        f"{API_URL}/{entity_set_name}?"
        f"$select={code_field}&"
        f"$filter={TARGET_INDUSTRY_CLIENT_LOOKUP_FIELD} eq {INTERNAL_COMPANY_ACCOUNT_ID}"
    )


async def _fetch_account_naics_codes(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    account_ids: set[str],
) -> dict[str, set[str]]:
    account_naics_codes = {}
    account_id_list = sorted(account_ids)
    chunk_size = 20
    try:
        account_naics_field = await _resolve_existing_field(
            client,
            headers,
            "accounts",
            ACCOUNT_NAICS_FIELDS,
            "account NAICS",
        )
    except Exception:
        return account_naics_codes

    for index in range(0, len(account_id_list), chunk_size):
        chunk = account_id_list[index:index + chunk_size]
        account_filter = " or ".join(
            f"accountid eq {account_id}"
            for account_id in chunk
        )
        url = (
            f"{API_URL}/accounts?"
            f"$select=accountid,{account_naics_field}&"
            f"$filter={account_filter}"
        )

        while url:
            response = await client.get(url, headers=headers)

            if response.status_code != 200:
                raise Exception(f"Dynamics GET error: {response.text}")

            payload = response.json()

            for account in payload.get("value", []):
                account_id = _clean_guid(account.get("accountid"))
                if not account_id:
                    continue

                account_naics_codes[account_id] = _normalize_naics_codes(
                    account.get(account_naics_field)
                )

            url = payload.get("@odata.nextLink")

    return account_naics_codes


def _get_visitor_account_id(visit: dict) -> str | None:
    for field_name in VISITOR_ACCOUNT_LOOKUP_FIELDS:
        account_id = _clean_guid(visit.get(field_name))
        if account_id:
            return account_id

    for field_name, field_value in visit.items():
        normalized_name = field_name.casefold()
        if (
            field_name.startswith("_")
            and field_name.endswith("_value")
            and "account" in normalized_name
            and "client" not in normalized_name
            and "owner" not in normalized_name
        ):
            account_id = _clean_guid(field_value)
            if account_id:
                return account_id

    return None


def _clean_guid(value: object) -> str | None:
    if not value:
        return None

    return str(value).strip("{}").casefold()


def _normalize_naics_codes(value: object) -> set[str]:
    if not value:
        return set()

    codes = set()
    for part in re.split(r"[,;|/\\\s]+", str(value)):
        digits = re.sub(r"\D", "", part)
        if digits:
            codes.add(digits)

    return codes


def _has_target_naics_match(account_naics_codes: set[str], target_naics_codes: set[str]) -> bool:
    for account_code in account_naics_codes:
        for target_code in target_naics_codes:
            if account_code == target_code or account_code.startswith(target_code):
                return True

    return False


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
