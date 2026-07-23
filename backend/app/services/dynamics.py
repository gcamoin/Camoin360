import os
import asyncio
import time
import httpx
import re
import logging
import json
from urllib.parse import quote
from dotenv import load_dotenv
from pathlib import Path
from datetime import datetime, timedelta, timezone
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import DateRange, Dimension, Metric, RunReportRequest
from ..database import get_database_connection
from .auth import get_access_token
from .metrics import increment_processed, log_update
from .seamless import enrich_with_seamless
from .usage import can_make_request, increment_usage, load_usage, WEEKLY_LIMIT
from .locations import normalize_country_group, normalize_state_province

logger = logging.getLogger(__name__)


class DynamicsApiError(RuntimeError):
    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.status_code = status_code

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = Path(__file__).resolve().parents[2]

load_dotenv(REPO_ROOT / ".env")
load_dotenv(BACKEND_ROOT / ".env")

API_URL = os.getenv("DYNAMICS_API_URL")
DATA_QUALITY_CACHE_TTL_SECONDS = 300
DATA_QUALITY_ACCOUNT_LIMIT = int(os.getenv("DATA_QUALITY_ACCOUNT_LIMIT", "100000"))
SUMMARY_CACHE_TTL_SECONDS = 600
DATA_QUALITY_REQUEST_TIMEOUT_SECONDS = 300
DATA_QUALITY_SYNC_STALE_SECONDS = int(os.getenv("DATA_QUALITY_SYNC_STALE_SECONDS", "3600"))
DUPLICATE_ACCOUNT_DEFAULT_LIMIT = 1000
DUPLICATE_ACCOUNT_MAX_LIMIT = 1000
MARKETING_LIST_DEFAULT_LIMIT = int(os.getenv("MARKETING_LIST_DEFAULT_LIMIT", "500"))
MARKETING_LIST_CONVERSION_DEFAULT_LIMIT = int(os.getenv("MARKETING_LIST_CONVERSION_DEFAULT_LIMIT", "100"))
MARKETING_LIST_CONVERSION_MAX_LIMIT = int(os.getenv("MARKETING_LIST_CONVERSION_MAX_LIMIT", "500"))
MARKETING_LIST_CONVERSION_DEFAULT_YEARS = tuple(
    year.strip()
    for year in os.getenv("MARKETING_LIST_CONVERSION_YEARS", "2025,2026").split(",")
    if year.strip()
)
MARKETING_LIST_REQUEST_TIMEOUT_SECONDS = 60
MARKETING_LIST_CLIENT_ACCOUNT_SCAN_LIMIT = 25
MARKETING_LIST_CLIENT_ENRICHMENT_LIMIT = int(os.getenv("MARKETING_LIST_CLIENT_ENRICHMENT_LIMIT", "50"))
LEADFEEDER_VISIT_DEFAULT_LIMIT = 200
LEADFEEDER_VISIT_MAX_LIMIT = 1000
LEADFEEDER_VISIT_REQUEST_TIMEOUT_SECONDS = 60
PE_CLIENT_DEFAULT_LIMIT = 1000
PE_CLIENT_MAX_LIMIT = 5000
PE_CLIENT_REQUEST_TIMEOUT_SECONDS = 60
PE_QUALIFIED_LEAD_DEFAULT_LIMIT = 1000
PE_QUALIFIED_LEAD_MAX_LIMIT = 5000
PE_QUALIFIED_LEAD_STATUS_LABEL = "Pending-Sent to Client"
MARKETING_LIST_ACCOUNT_WEBSITE_VISIT_RELATIONSHIP_CANDIDATES = (
    "cr73c_lfapp_websitevisit",
)
WEBSITE_VISIT_CLIENT_RELATIONSHIP_CANDIDATES = ("new_Client",)
_DATA_QUALITY_CACHE = {"expires_at": 0, "data": None, "limit": 0}
_SUMMARY_CACHE = {"expires_at": 0, "data": None}
_MARKETING_LIST_CAMPAIGN_NAVIGATION_CACHE = {"loaded": False, "value": None}
_ACCOUNT_WEBSITE_VISIT_NAVIGATION_CACHE = {"loaded": False, "value": None}
_WEBSITE_VISIT_CLIENT_NAVIGATION_CACHE = {"loaded": False, "value": None}
_WEBSITE_VISIT_ACCOUNT_NAVIGATION_CACHE = {"loaded": False, "value": None}
_DATA_QUALITY_REFRESH_TASK = None
MARKETING_METRICS_CACHE_TTL_SECONDS = 600
MARKETING_METRICS_REQUEST_TIMEOUT_SECONDS = 120
MARKETING_METRICS_SYNC_STALE_SECONDS = int(os.getenv("MARKETING_METRICS_SYNC_STALE_SECONDS", "1800"))
GA4_PROPERTY_ID = os.getenv("GA4_PROPERTY_ID")
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
DATA_QUALITY_FIELDS = (
    ("name", "Company Name"),
    ("new_sector", "Sector"),
    ("new_subsector", "Subsector"),
    ("websiteurl", "Website"),
    ("address1_country", "Country"),
    ("address1_stateorprovince", "State/Province"),
    ("address1_city", "City"),
    ("description", "Description"),
    ("telephone1", "Business Phone"),
    ("new_datasource", "Data Source"),
    ("new_employees", "Employee Count"),
    ("new_naicstext", "NAICS Text"),
)
DATA_QUALITY_SCORE_FIELDS = {
    "websiteurl": 20,
    "telephone1": 20,
    "description": 20,
    "new_employees": 20,
}
DATA_QUALITY_LOCATION_FIELDS = ("address1_city", "address1_stateorprovince", "address1_country")
DATA_QUALITY_MISSING_METRIC_FIELDS = (
    ("new_sector", "Missing Sector"),
    ("new_subsector", "Missing Subsector"),
    ("websiteurl", "Missing Website"),
    ("telephone1", "Missing Business Phone"),
    ("description", "Missing Description"),
    ("new_employees", "Missing Employee Count"),
    ("new_datasource", "Missing Data Source"),
    ("new_naicstext", "Missing NAICS Text"),
)
DATA_QUALITY_FILTERABLE_COLUMNS = {
    "name",
    "new_sector",
    "new_subsector",
    "websiteurl",
    "telephone1",
    "address1_country",
    "address1_stateorprovince",
    "address1_city",
    "new_employees",
    "new_naicstext",
    "missing_fields_summary",
    "data_quality_score",
}
DATA_QUALITY_SORT_COLUMNS = {
    "name": "name",
    "new_sector": "new_sector",
    "new_subsector": "new_subsector",
    "websiteurl": "websiteurl",
    "telephone1": "telephone1",
    "address1_country": "address1_country",
    "address1_stateorprovince": "address1_stateorprovince",
    "address1_city": "address1_city",
    "new_employees": "new_employees",
    "new_naicstext": "new_naicstext",
    "missing_fields_summary": "missing_fields_summary",
    "data_quality_score": "data_quality_score",
}
MISSING_STATE_PROVINCE_FILTER_VALUE = "__missing_state_province__"
TARGET_INDUSTRY_ENTITY_SET_CANDIDATES = (
    "new_targetindustries",
    "new_targetindustrieses",
    "new_targetindustry",
)
ACCOUNT_NAICS_FIELDS = (
    "cr73c_naicsprefix",
    "new_naicsprefixcode",
    "naicscode",
    "new_naicscode",
)
WEBSITE_VISIT_NAICS_LOOKUP_FIELD = "_cr73c_new_naics_value"
NAICS_TABLE = "new_naics"
NAICS_ENTITY_SET_CANDIDATES = (
    "new_naicses",
    "new_naics",
)
NAICS_CODE_FIELDS = (
    "new_code",
    "cr73c_naicsprefix",
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
MARKETING_HISTORY_START_YEAR = 2022
MARKETING_RANGE_OPTIONS = {
    "since_2022": {"label": "Since 2022", "start_year": MARKETING_HISTORY_START_YEAR},
    "last_week": {"label": "Last Week", "days": 7},
    "last_month": {"label": "Last Month", "days": 30},
    "last_6_months": {"label": "Last 6 Months", "months": 6},
    "last_year": {"label": "Last Year", "months": 12},
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


def _is_missing_data_quality_value(value) -> bool:
    return value is None or str(value).strip() == ""


def _normalize_data_quality_value(value) -> str:
    return str(value or "").strip().lower()


def _normalize_data_quality_country(value) -> str:
    normalized = _normalize_data_quality_value(value).replace(".", "").replace(" ", "")
    aliases = {
        "us": "unitedstates",
        "usa": "unitedstates",
        "unitedstatesofamerica": "unitedstates",
        "ca": "canada",
        "can": "canada",
    }
    return aliases.get(normalized, normalized)


def _prepare_data_quality_cache_row(account: dict, synced_at: str) -> dict:
    row = {
        "accountid": account.get("accountid") or "",
        "name": account.get("name") or "",
        "address1_stateorprovince": account.get("address1_stateorprovince") or "",
        "address1_country": account.get("address1_country") or "",
        "address1_city": account.get("address1_city") or "",
        "new_sector": account.get("new_sector") or "",
        "new_subsector": account.get("new_subsector") or "",
        "new_naicstext": account.get("new_naicstext") or "",
        "description": account.get("description") or "",
        "websiteurl": account.get("websiteurl") or "",
        "telephone1": account.get("telephone1") or "",
        "new_datasource": account.get("new_datasource") or "",
        "new_employees": "" if account.get("new_employees") is None else str(account.get("new_employees")),
    }
    missing_fields = [
        {"key": field_key, "label": field_label}
        for field_key, field_label in DATA_QUALITY_FIELDS
        if _is_missing_data_quality_value(row.get(field_key))
    ]
    missing_field_keys = [field["key"] for field in missing_fields]
    missing_field_labels = [field["label"] for field in missing_fields]
    field_score = sum(
        points
        for field_key, points in DATA_QUALITY_SCORE_FIELDS.items()
        if not _is_missing_data_quality_value(row.get(field_key))
    )
    location_score = 20 if all(not _is_missing_data_quality_value(row.get(field_key)) for field_key in DATA_QUALITY_LOCATION_FIELDS) else 0
    search_text = " ".join(
        _normalize_data_quality_value(row.get(field_key))
        for field_key, _field_label in DATA_QUALITY_FIELDS
    )

    row.update(
        {
            "missing_field_keys": ",".join(missing_field_keys),
            "missing_fields_summary": ", ".join(missing_field_labels) if missing_field_labels else "Complete",
            "data_quality_score": field_score + location_score,
            "has_missing_quality_field": 1 if missing_fields else 0,
            "search_text": search_text,
            "synced_at": synced_at,
        }
    )
    return row


async def _fetch_accounts_data_quality_from_dynamics(limit: int | None = None):
    account_limit = max(1, min(limit or DATA_QUALITY_ACCOUNT_LIMIT, DATA_QUALITY_ACCOUNT_LIMIT))
    now = time.time()
    if (
        _DATA_QUALITY_CACHE["data"] is not None
        and _DATA_QUALITY_CACHE["expires_at"] > now
        and _DATA_QUALITY_CACHE["limit"] >= account_limit
    ):
        return _DATA_QUALITY_CACHE["data"][:account_limit]

    token = await get_access_token()

    url = (
        f"{API_URL}/accounts?"
        "$select=accountid,name,address1_stateorprovince,address1_country,address1_city,new_sector,new_subsector,new_naicstext,description,websiteurl,telephone1,new_datasource,new_employees&"
        "$orderby=name asc&"
        f"$top={account_limit}"
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
            while next_url and len(accounts) < account_limit:
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

    accounts = accounts[:account_limit]
    _DATA_QUALITY_CACHE["data"] = accounts
    _DATA_QUALITY_CACHE["limit"] = account_limit
    _DATA_QUALITY_CACHE["expires_at"] = now + DATA_QUALITY_CACHE_TTL_SECONDS

    return accounts


def _get_data_quality_sync_status() -> dict:
    with get_database_connection() as connection:
        row = connection.execute(
            """
            SELECT status, last_started_at, last_completed_at, last_error, row_count
            FROM account_data_quality_sync
            WHERE id = 1
            """
        ).fetchone()

    return dict(row) if row else {
        "status": "idle",
        "last_started_at": None,
        "last_completed_at": None,
        "last_error": "",
        "row_count": 0,
    }


def _is_data_quality_cache_stale(sync_status: dict) -> bool:
    completed_at = sync_status.get("last_completed_at")
    if not completed_at:
        return True

    try:
        completed_time = datetime.fromisoformat(str(completed_at).replace("Z", "+00:00"))
    except ValueError:
        return True

    if completed_time.tzinfo is None:
        completed_time = completed_time.replace(tzinfo=timezone.utc)

    return (datetime.now(timezone.utc) - completed_time).total_seconds() > DATA_QUALITY_SYNC_STALE_SECONDS


async def refresh_accounts_data_quality_cache(limit: int | None = None) -> dict:
    account_limit = max(1, min(limit or DATA_QUALITY_ACCOUNT_LIMIT, DATA_QUALITY_ACCOUNT_LIMIT))
    started_at = datetime.now(timezone.utc).isoformat()
    with get_database_connection() as connection:
        connection.execute(
            """
            UPDATE account_data_quality_sync
            SET status = 'syncing',
                last_started_at = ?,
                last_error = ''
            WHERE id = 1
            """,
            (started_at,),
        )

    try:
        accounts = await _fetch_accounts_data_quality_from_dynamics(account_limit)
        synced_at = datetime.now(timezone.utc).isoformat()
        prepared_rows = [_prepare_data_quality_cache_row(account, synced_at) for account in accounts if account.get("accountid")]

        with get_database_connection() as connection:
            connection.execute("DELETE FROM account_data_quality_cache")
            connection.executemany(
                """
                INSERT INTO account_data_quality_cache (
                    accountid, name, address1_stateorprovince, address1_country, address1_city,
                    new_sector, new_subsector, new_naicstext, description, websiteurl,
                    telephone1, new_datasource, new_employees, missing_field_keys,
                    missing_fields_summary, data_quality_score, has_missing_quality_field,
                    search_text, synced_at
                )
                VALUES (
                    :accountid, :name, :address1_stateorprovince, :address1_country, :address1_city,
                    :new_sector, :new_subsector, :new_naicstext, :description, :websiteurl,
                    :telephone1, :new_datasource, :new_employees, :missing_field_keys,
                    :missing_fields_summary, :data_quality_score, :has_missing_quality_field,
                    :search_text, :synced_at
                )
                """,
                prepared_rows,
            )
            connection.execute(
                """
                UPDATE account_data_quality_sync
                SET status = 'idle',
                    last_completed_at = ?,
                    last_error = '',
                    row_count = ?
                WHERE id = 1
                """,
                (synced_at, len(prepared_rows)),
            )

        return _get_data_quality_sync_status()
    except Exception as exc:
        with get_database_connection() as connection:
            connection.execute(
                """
                UPDATE account_data_quality_sync
                SET status = 'error',
                    last_error = ?
                WHERE id = 1
                """,
                (str(exc),),
            )
        raise


def _build_data_quality_filters(
    *,
    search: str = "",
    sector: str = "all",
    missing_field: str = "all",
    states: list[str] | None = None,
    country: str = "all",
    cities: list[str] | None = None,
    needs_attention: bool = False,
    column_filters: dict[str, str] | None = None,
) -> tuple[str, list]:
    clauses = []
    values = []
    states = states or []
    cities = cities or []
    column_filters = column_filters or {}

    if sector != "all":
        clauses.append("new_sector = ?")
        values.append(sector)
    if missing_field != "all":
        clauses.append("(',' || missing_field_keys || ',') LIKE ?")
        values.append(f"%,{missing_field},%")
    if states:
        state_values = [state for state in states if state != MISSING_STATE_PROVINCE_FILTER_VALUE]
        state_clauses = []
        if state_values:
            state_clauses.append(f"address1_stateorprovince IN ({','.join('?' for _ in state_values)})")
            values.extend(state_values)
        if MISSING_STATE_PROVINCE_FILTER_VALUE in states:
            state_clauses.append("(address1_stateorprovince IS NULL OR TRIM(address1_stateorprovince) = '')")
        clauses.append(f"({' OR '.join(state_clauses)})")
    if country != "all":
        clauses.append(
            """
            CASE LOWER(REPLACE(REPLACE(address1_country, '.', ''), ' ', ''))
                WHEN 'us' THEN 'unitedstates'
                WHEN 'usa' THEN 'unitedstates'
                WHEN 'unitedstatesofamerica' THEN 'unitedstates'
                WHEN 'ca' THEN 'canada'
                WHEN 'can' THEN 'canada'
                ELSE LOWER(REPLACE(REPLACE(address1_country, '.', ''), ' ', ''))
            END = ?
            """
        )
        values.append(_normalize_data_quality_country(country))
    if cities:
        clauses.append(f"address1_city IN ({','.join('?' for _ in cities)})")
        values.extend(cities)
    if needs_attention:
        clauses.append("has_missing_quality_field = 1")
    if search.strip():
        clauses.append("search_text LIKE ?")
        values.append(f"%{_normalize_data_quality_value(search)}%")

    for column_key, filter_value in column_filters.items():
        if column_key not in DATA_QUALITY_FILTERABLE_COLUMNS or not str(filter_value or "").strip():
            continue
        if column_key == "data_quality_score":
            clauses.append("CAST(data_quality_score AS TEXT) LIKE ?")
        else:
            clauses.append(f"LOWER({column_key}) LIKE ?")
        values.append(f"%{_normalize_data_quality_value(filter_value)}%")

    return (" WHERE " + " AND ".join(clauses)) if clauses else "", values


def _rows_to_data_quality_accounts(rows) -> list[dict]:
    accounts = []
    for index, row in enumerate(rows):
        account = dict(row)
        account["missing_field_keys"] = [key for key in account.get("missing_field_keys", "").split(",") if key]
        account["has_missing_quality_field"] = bool(account.get("has_missing_quality_field"))
        account["data_quality_score"] = int(account.get("data_quality_score") or 0)
        account["selectionId"] = account.get("accountid") or f"{account.get('name') or 'account'}-{index}"
        accounts.append(account)
    return accounts


def _get_data_quality_facets(connection, where_clause: str, values: list) -> dict:
    def distinct_values(column_name: str) -> list[str]:
        rows = connection.execute(
            f"""
            SELECT DISTINCT {column_name} AS value
            FROM account_data_quality_cache
            {where_clause}
              {"AND" if where_clause else "WHERE"} {column_name} != ''
            ORDER BY {column_name} COLLATE NOCASE ASC
            LIMIT 1000
            """,
            values,
        ).fetchall()
        return [row["value"] for row in rows]

    state_rows = connection.execute(
        f"""
        SELECT address1_stateorprovince AS state, address1_country AS country
        FROM account_data_quality_cache
        {where_clause}
        """,
        values,
    ).fetchall()
    state_options_by_key = {}
    has_missing_state = False

    for row in state_rows:
        raw_state = row["state"]
        if not str(raw_state or "").strip():
            has_missing_state = True
            continue

        country_group = normalize_country_group(row["country"])
        normalized_state = normalize_state_province(raw_state)
        if normalized_state and country_group in {"us", "canada"}:
            option_key = f"{country_group}:{normalized_state}"
            option = state_options_by_key.setdefault(
                option_key,
                {
                    "value": normalized_state,
                    "country_group": country_group,
                    "status": "recognized",
                    "raw_values": [],
                },
            )
            if raw_state not in option["raw_values"]:
                option["raw_values"].append(raw_state)
            continue

        option_key = f"unrecognized:{str(raw_state).strip()}"
        option = state_options_by_key.setdefault(
            option_key,
            {
                "value": str(raw_state).strip(),
                "country_group": None,
                "status": "unrecognized",
                "raw_values": [],
            },
        )
        if raw_state not in option["raw_values"]:
            option["raw_values"].append(raw_state)

    state_options = list(state_options_by_key.values())
    state_options.sort(key=lambda option: (option["status"], option["country_group"] or "", option["value"]))
    if has_missing_state:
        state_options.append(
            {
                "value": "",
                "country_group": None,
                "status": "missing",
                "raw_values": [""],
            }
        )

    missing_counts = []
    for field_key, field_label in DATA_QUALITY_MISSING_METRIC_FIELDS:
        count = connection.execute(
            f"""
            SELECT COUNT(*) AS count
            FROM account_data_quality_cache
            {where_clause}
              {"AND" if where_clause else "WHERE"} (',' || missing_field_keys || ',') LIKE ?
            """,
            [*values, f"%,{field_key},%"],
        ).fetchone()["count"]
        missing_counts.append({"key": field_key, "label": field_label, "missing": count})

    incomplete_location_count = connection.execute(
        f"""
        SELECT COUNT(*) AS count
        FROM account_data_quality_cache
        {where_clause}
          {"AND" if where_clause else "WHERE"} (
            (',' || missing_field_keys || ',') LIKE '%,address1_city,%'
            OR (',' || missing_field_keys || ',') LIKE '%,address1_stateorprovince,%'
            OR (',' || missing_field_keys || ',') LIKE '%,address1_country,%'
          )
        """,
        values,
    ).fetchone()["count"]
    missing_counts.append(
        {
            "key": "incomplete_location",
            "label": "Incomplete Location",
            "missing": incomplete_location_count,
            "helperText": "Missing city, state, or country",
        }
    )

    return {
        "sectors": distinct_values("new_sector"),
        "countries": distinct_values("address1_country"),
        "states": distinct_values("address1_stateorprovince"),
        "state_options": state_options,
        "cities": distinct_values("address1_city"),
        "missing_counts": missing_counts,
    }


def get_accounts_data_quality_page(
    *,
    page: int = 0,
    page_size: int = 25,
    search: str = "",
    sector: str = "all",
    missing_field: str = "all",
    states: list[str] | None = None,
    country: str = "all",
    cities: list[str] | None = None,
    needs_attention: bool = False,
    column_filters: dict[str, str] | None = None,
    sort_key: str = "",
    sort_direction: str = "asc",
) -> dict:
    page = max(0, page)
    page_size = max(1, min(page_size, 250))
    where_clause, values = _build_data_quality_filters(
        search=search,
        sector=sector,
        missing_field=missing_field,
        states=states,
        country=country,
        cities=cities,
        needs_attention=needs_attention,
        column_filters=column_filters,
    )
    sort_column = DATA_QUALITY_SORT_COLUMNS.get(sort_key or "", "name")
    direction = "DESC" if sort_direction == "desc" else "ASC"
    offset = page * page_size

    with get_database_connection() as connection:
        total_count = connection.execute(
            "SELECT COUNT(*) AS count FROM account_data_quality_cache"
        ).fetchone()["count"]
        filtered_count = connection.execute(
            f"SELECT COUNT(*) AS count FROM account_data_quality_cache{where_clause}",
            values,
        ).fetchone()["count"]
        rows = connection.execute(
            f"""
            SELECT accountid, name, address1_stateorprovince, address1_country, address1_city,
                   new_sector, new_subsector, new_naicstext, description, websiteurl,
                   telephone1, new_datasource, new_employees, missing_field_keys,
                   missing_fields_summary AS missingFieldsSummary,
                   data_quality_score AS dataQualityScore,
                   has_missing_quality_field AS hasMissingQualityField
            FROM account_data_quality_cache
            {where_clause}
            ORDER BY {sort_column} COLLATE NOCASE {direction}, name COLLATE NOCASE ASC
            LIMIT ? OFFSET ?
            """,
            [*values, page_size, offset],
        ).fetchall()
        facets = _get_data_quality_facets(connection, where_clause, values)

    sync_status = _get_data_quality_sync_status()
    return {
        "count": len(rows),
        "data": _rows_to_data_quality_accounts(rows),
        "page": page,
        "page_size": page_size,
        "total_count": total_count,
        "filtered_count": filtered_count,
        "has_more": offset + len(rows) < filtered_count,
        "facets": facets,
        "sync": {
            **sync_status,
            "is_stale": _is_data_quality_cache_stale(sync_status),
        },
    }


async def get_accounts_data_quality(limit: int | None = None):
    await refresh_accounts_data_quality_cache(limit)
    return get_accounts_data_quality_page(page_size=min(limit or DATA_QUALITY_ACCOUNT_LIMIT, 250))["data"]


def get_cached_accounts_data_quality():
    return _DATA_QUALITY_CACHE["data"] or []


def invalidate_account_read_caches():
    _DATA_QUALITY_CACHE["data"] = None
    _DATA_QUALITY_CACHE["expires_at"] = 0
    _DATA_QUALITY_CACHE["limit"] = 0
    _SUMMARY_CACHE["data"] = None
    _SUMMARY_CACHE["expires_at"] = 0


def start_data_quality_refresh():
    global _DATA_QUALITY_REFRESH_TASK

    if _DATA_QUALITY_REFRESH_TASK and not _DATA_QUALITY_REFRESH_TASK.done():
        return

    async def refresh():
        global _DATA_QUALITY_REFRESH_TASK
        try:
            await get_accounts_data_quality(1000)
        except Exception:
            return
        finally:
            _DATA_QUALITY_REFRESH_TASK = None

    _DATA_QUALITY_REFRESH_TASK = asyncio.create_task(refresh())


async def get_duplicate_account_records(limit: int = DUPLICATE_ACCOUNT_DEFAULT_LIMIT):
    account_limit = max(1, min(limit, DUPLICATE_ACCOUNT_MAX_LIMIT))
    token = await get_access_token()

    url = (
        f"{API_URL}/accounts?"
        "$select=accountid,name,websiteurl,emailaddress1,telephone1,address1_line1,address1_city,address1_stateorprovince,address1_postalcode,address1_country,new_sector,new_datasource,new_employees,description,createdon&"
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


async def delete_account(account_id: str):
    token = await get_access_token()
    url = f"{API_URL}/accounts({account_id})"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0",
    }

    async with httpx.AsyncClient() as client:
        response = await client.delete(url, headers=headers)

    if response.status_code not in [200, 204]:
        raise Exception(f"Dynamics DELETE error: {response.text}")

    invalidate_account_read_caches()

    return {"status": "deleted", "account_id": account_id}


def get_formatted_value(record: dict, field_name: str):
    return record.get(f"{field_name}@OData.Community.Display.V1.FormattedValue", record.get(field_name))


def is_guid_like(value):
    if not value:
        return False

    value_text = str(value).strip()
    return len(value_text) == 36 and value_text.count("-") == 4


def get_lookup_display_value(record: dict, field_name: str):
    value = get_formatted_value(record, field_name)
    return "" if is_guid_like(value) else value


def get_related_record_value(record: dict, relationship_name: str, field_names: tuple[str, ...]):
    related_record = record.get(relationship_name)

    if not isinstance(related_record, dict):
        return ""

    for field_name in field_names:
        value = get_formatted_value(related_record, field_name)
        if value:
            return value

    return ""


def get_first_present_record_value(record: dict, field_names: tuple[str, ...]):
    for field_name in field_names:
        value = get_formatted_value(record, field_name)
        if value:
            return value

    return ""


def get_client_name_from_marketing_list_accounts(
    record: dict,
    account_website_visit_relationship_name: str | None = None,
    website_visit_client_relationship_name: str | None = None,
):
    accounts = record.get("listaccount_association")

    if not isinstance(accounts, list):
        return ""

    account_website_visit_relationship_names = []
    if account_website_visit_relationship_name:
        account_website_visit_relationship_names.append(account_website_visit_relationship_name)
    account_website_visit_relationship_names.extend(
        relationship_name
        for relationship_name in MARKETING_LIST_ACCOUNT_WEBSITE_VISIT_RELATIONSHIP_CANDIDATES
        if relationship_name not in account_website_visit_relationship_names
    )

    website_visit_client_relationship_names = []
    if website_visit_client_relationship_name:
        website_visit_client_relationship_names.append(website_visit_client_relationship_name)
    website_visit_client_relationship_names.extend(
        relationship_name
        for relationship_name in WEBSITE_VISIT_CLIENT_RELATIONSHIP_CANDIDATES
        if relationship_name not in website_visit_client_relationship_names
    )

    for account in accounts:
        if not isinstance(account, dict):
            continue

        for account_relationship_name in account_website_visit_relationship_names:
            website_visit = account.get(account_relationship_name)
            if not isinstance(website_visit, dict):
                continue

            for client_relationship_name in website_visit_client_relationship_names:
                client_name = get_related_record_value(
                    website_visit,
                    client_relationship_name,
                    ("name", "new_client"),
                )
                if client_name:
                    return client_name

            client_name = get_first_present_record_value(website_visit, ("new_clientname", "_new_client_value"))
            if client_name:
                return client_name

    return ""


def normalize_marketing_list_record(
    record: dict,
    campaign_relationship_name: str | None = None,
    account_website_visit_relationship_name: str | None = None,
    website_visit_client_relationship_name: str | None = None,
):
    created_by = record.get("createdby", {}) if isinstance(record.get("createdby"), dict) else {}
    client_name = (
        get_related_record_value(record, "new_client", ("name",))
        or get_related_record_value(record, "new_clientid", ("name",))
        or get_related_record_value(record, "new_ClientId", ("name",))
        or get_first_present_record_value(record, ("new_client", "_new_client_value", "_new_clientid_value"))
        or get_client_name_from_marketing_list_accounts(
            record,
            account_website_visit_relationship_name,
            website_visit_client_relationship_name,
        )
    )
    campaign = ""
    if campaign_relationship_name:
        campaign = get_related_record_value(record, campaign_relationship_name, ("name",))

    return {
        "listid": record.get("listid"),
        "name": record.get("listname"),
        "marketing_list_name": record.get("listname"),
        "createdon": record.get("createdon"),
        "created_by": created_by.get("fullname") or get_formatted_value(record, "_createdby_value") or "",
        "member_count": record.get("membercount"),
        "list_member_type": get_formatted_value(record, "createdfromcode") or "",
        "list_type": get_formatted_value(record, "type") or "",
        "client_name": client_name or "",
        "campaign": campaign or "",
    }


async def get_list_campaign_navigation_property(client: httpx.AsyncClient, headers: dict):
    if _MARKETING_LIST_CAMPAIGN_NAVIGATION_CACHE["loaded"]:
        return _MARKETING_LIST_CAMPAIGN_NAVIGATION_CACHE["value"]

    metadata_url = (
        f"{API_URL}/EntityDefinitions(LogicalName='list')/ManyToOneRelationships?"
        "$select=ReferencingAttribute,ReferencingEntityNavigationPropertyName,ReferencedEntity&"
        "$filter=ReferencedEntity%20eq%20'campaign'"
    )

    response = await client.get(metadata_url, headers=headers)
    campaign_navigation_property = None

    if response.status_code == 200:
        relationships = response.json().get("value", [])
        for relationship in relationships:
            referencing_attribute = str(relationship.get("ReferencingAttribute") or "").lower()
            navigation_property = relationship.get("ReferencingEntityNavigationPropertyName")

            if navigation_property and (referencing_attribute == "campaignid" or "campaign" in navigation_property.lower()):
                campaign_navigation_property = navigation_property
                break

    _MARKETING_LIST_CAMPAIGN_NAVIGATION_CACHE["loaded"] = True
    _MARKETING_LIST_CAMPAIGN_NAVIGATION_CACHE["value"] = campaign_navigation_property

    return campaign_navigation_property


async def get_account_website_visit_navigation_property(client: httpx.AsyncClient, headers: dict):
    if _ACCOUNT_WEBSITE_VISIT_NAVIGATION_CACHE["loaded"]:
        return _ACCOUNT_WEBSITE_VISIT_NAVIGATION_CACHE["value"]

    metadata_url = (
        f"{API_URL}/EntityDefinitions(LogicalName='account')/ManyToOneRelationships?"
        "$select=ReferencingAttribute,ReferencingEntityNavigationPropertyName,ReferencedEntity,SchemaName"
    )

    response = await client.get(metadata_url, headers=headers)
    account_website_visit_navigation_property = None

    if response.status_code == 200:
        relationships = response.json().get("value", [])
        for relationship in relationships:
            searchable_values = [
                relationship.get("ReferencingAttribute"),
                relationship.get("ReferencingEntityNavigationPropertyName"),
                relationship.get("ReferencedEntity"),
                relationship.get("SchemaName"),
            ]
            searchable_text = " ".join(str(value or "").lower() for value in searchable_values)

            if "websitevisit" in searchable_text and relationship.get("ReferencedEntity") == "lfapp_websitevisit":
                account_website_visit_navigation_property = relationship.get("ReferencingEntityNavigationPropertyName")
                break

        if not account_website_visit_navigation_property:
            for relationship in relationships:
                navigation_property = relationship.get("ReferencingEntityNavigationPropertyName")
                if navigation_property in MARKETING_LIST_ACCOUNT_WEBSITE_VISIT_RELATIONSHIP_CANDIDATES:
                    account_website_visit_navigation_property = navigation_property
                    break

    _ACCOUNT_WEBSITE_VISIT_NAVIGATION_CACHE["loaded"] = True
    _ACCOUNT_WEBSITE_VISIT_NAVIGATION_CACHE["value"] = account_website_visit_navigation_property

    return account_website_visit_navigation_property


async def get_website_visit_client_navigation_property(client: httpx.AsyncClient, headers: dict):
    if _WEBSITE_VISIT_CLIENT_NAVIGATION_CACHE["loaded"]:
        return _WEBSITE_VISIT_CLIENT_NAVIGATION_CACHE["value"]

    metadata_url = (
        f"{API_URL}/EntityDefinitions(LogicalName='lfapp_websitevisit')/ManyToOneRelationships?"
        "$select=ReferencingAttribute,ReferencingEntityNavigationPropertyName,ReferencedEntity,SchemaName"
    )

    response = await client.get(metadata_url, headers=headers)
    website_visit_client_navigation_property = None

    if response.status_code == 200:
        relationships = response.json().get("value", [])
        for relationship in relationships:
            referencing_attribute = str(relationship.get("ReferencingAttribute") or "").lower()
            referenced_entity = str(relationship.get("ReferencedEntity") or "").lower()
            navigation_property = relationship.get("ReferencingEntityNavigationPropertyName")

            if navigation_property and referencing_attribute == "new_client" and referenced_entity == "account":
                website_visit_client_navigation_property = navigation_property
                break

        if not website_visit_client_navigation_property:
            for relationship in relationships:
                navigation_property = relationship.get("ReferencingEntityNavigationPropertyName")
                if navigation_property in WEBSITE_VISIT_CLIENT_RELATIONSHIP_CANDIDATES:
                    website_visit_client_navigation_property = navigation_property
                    break

    _WEBSITE_VISIT_CLIENT_NAVIGATION_CACHE["loaded"] = True
    _WEBSITE_VISIT_CLIENT_NAVIGATION_CACHE["value"] = website_visit_client_navigation_property

    return website_visit_client_navigation_property


async def get_website_visit_account_navigation_property(client: httpx.AsyncClient, headers: dict):
    if _WEBSITE_VISIT_ACCOUNT_NAVIGATION_CACHE["loaded"]:
        return _WEBSITE_VISIT_ACCOUNT_NAVIGATION_CACHE["value"]

    metadata_url = (
        f"{API_URL}/EntityDefinitions(LogicalName='lfapp_websitevisit')/ManyToOneRelationships?"
        "$select=ReferencingAttribute,ReferencingEntityNavigationPropertyName,ReferencedEntity,SchemaName"
    )

    response = await client.get(metadata_url, headers=headers)
    website_visit_account_navigation_property = None

    if response.status_code == 200:
        relationships = response.json().get("value", [])
        for relationship in relationships:
            referencing_attribute = str(relationship.get("ReferencingAttribute") or "").lower()
            referenced_entity = str(relationship.get("ReferencedEntity") or "").lower()
            navigation_property = relationship.get("ReferencingEntityNavigationPropertyName")

            if navigation_property and referencing_attribute == "lfapp_account" and referenced_entity == "account":
                website_visit_account_navigation_property = navigation_property
                break

        if not website_visit_account_navigation_property:
            for relationship in relationships:
                navigation_property = relationship.get("ReferencingEntityNavigationPropertyName")
                if navigation_property and "account" in navigation_property.lower():
                    website_visit_account_navigation_property = navigation_property
                    break

    _WEBSITE_VISIT_ACCOUNT_NAVIGATION_CACHE["loaded"] = True
    _WEBSITE_VISIT_ACCOUNT_NAVIGATION_CACHE["value"] = website_visit_account_navigation_property

    return website_visit_account_navigation_property


def build_marketing_lists_url(
    limit: int,
    campaign_navigation_property: str | None = None,
    include_client_column: bool = True,
):
    expand_parts = ["createdby($select=fullname)"]
    if campaign_navigation_property:
        expand_parts.append(f"{campaign_navigation_property}($select=name)")
    select_fields = [
        "listid",
        "listname",
        "createdon",
        "membercount",
        "createdfromcode",
        "type",
        "_createdby_value",
    ]
    if include_client_column:
        select_fields.append("new_client")

    return (
        f"{API_URL}/lists?"
        f"$select={','.join(select_fields)}&"
        f"$expand={','.join(expand_parts)}&"
        "$orderby=createdon desc&"
        f"$top={limit}"
    )


async def get_marketing_list_client_name_from_accounts(
    client: httpx.AsyncClient,
    headers: dict,
    list_id: str,
    account_website_visit_relationship_name: str,
    website_visit_client_relationship_name: str,
):
    url = (
        f"{API_URL}/lists({list_id})/listaccount_association?"
        "$select=accountid&"
        f"$top={MARKETING_LIST_CLIENT_ACCOUNT_SCAN_LIMIT}"
    )

    while url:
        response = await client.get(url, headers=headers)
        if response.status_code != 200:
            return ""

        payload = response.json()
        accounts = payload.get("value", [])
        account_ids = [
            account.get("accountid")
            for account in accounts
            if isinstance(account, dict) and account.get("accountid")
        ]

        if account_ids:
            account_id_values = ",".join(f"'{account_id}'" for account_id in account_ids)
            website_visit_url = (
                f"{API_URL}/lfapp_websitevisits?"
                "$select=lfapp_websitevisitid&"
                f"$expand={website_visit_client_relationship_name}($select=name)&"
                "$filter="
                "Microsoft.Dynamics.CRM.In("
                "PropertyName='lfapp_account',"
                f"PropertyValues=[{account_id_values}]"
                ")%20and%20_new_client_value%20ne%20null&"
                "$top=1"
            )
            website_visit_response = await client.get(website_visit_url, headers=headers)
            if website_visit_response.status_code == 200:
                website_visits = website_visit_response.json().get("value", [])
                for website_visit in website_visits:
                    client_name = get_related_record_value(
                        website_visit,
                        website_visit_client_relationship_name,
                        ("name",),
                    )
                    if client_name:
                        return client_name

        url = payload.get("@odata.nextLink")

    return ""


async def enrich_marketing_lists_with_client_names(
    client: httpx.AsyncClient,
    headers: dict,
    marketing_lists: list[dict],
    account_website_visit_relationship_name: str | None,
    website_visit_client_relationship_name: str | None,
):
    if not account_website_visit_relationship_name or not website_visit_client_relationship_name:
        return marketing_lists

    semaphore = asyncio.Semaphore(8)

    async def enrich_row(marketing_list: dict):
        if marketing_list.get("client_name") or not marketing_list.get("listid"):
            return marketing_list

        async with semaphore:
            client_name = await get_marketing_list_client_name_from_accounts(
                client,
                headers,
                marketing_list["listid"],
                account_website_visit_relationship_name,
                website_visit_client_relationship_name,
            )

        if client_name:
            return {**marketing_list, "client_name": client_name}

        return marketing_list

    enrichment_candidates = []
    for marketing_list in marketing_lists:
        if (
            len(enrichment_candidates) < MARKETING_LIST_CLIENT_ENRICHMENT_LIMIT
            and not marketing_list.get("client_name")
            and marketing_list.get("listid")
        ):
            enrichment_candidates.append(marketing_list)

    enriched_rows = await asyncio.gather(*(enrich_row(marketing_list) for marketing_list in enrichment_candidates))
    enriched_by_id = {row.get("listid"): row for row in enriched_rows}
    return [
        enriched_by_id.get(marketing_list.get("listid"), marketing_list)
        for marketing_list in marketing_lists
    ]


def is_missing_dynamics_property_error(response: httpx.Response):
    return response.status_code == 400 and "0x80060888" in response.text and "Could not find a property named" in response.text


async def get_marketing_lists(limit: int = MARKETING_LIST_DEFAULT_LIMIT):
    token = await get_access_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0",
        "Prefer": 'odata.include-annotations="OData.Community.Display.V1.FormattedValue",odata.maxpagesize=5000',
    }

    marketing_lists = []
    timeout = httpx.Timeout(MARKETING_LIST_REQUEST_TIMEOUT_SECONDS)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            campaign_navigation_property = await get_list_campaign_navigation_property(client, headers)
            account_website_visit_relationship_name = await get_account_website_visit_navigation_property(client, headers)
            website_visit_client_relationship_name = await get_website_visit_client_navigation_property(client, headers)
            include_client_column = True
            next_url = build_marketing_lists_url(
                limit,
                campaign_navigation_property,
                include_client_column,
            )

            while next_url and len(marketing_lists) < limit:
                response = await client.get(next_url, headers=headers)

                if response.status_code != 200:
                    if include_client_column and is_missing_dynamics_property_error(response) and "new_client" in response.text:
                        include_client_column = False
                        next_url = build_marketing_lists_url(
                            limit,
                            campaign_navigation_property,
                            include_client_column,
                        )
                        continue

                    if campaign_navigation_property and is_missing_dynamics_property_error(response):
                        campaign_navigation_property = None
                        _MARKETING_LIST_CAMPAIGN_NAVIGATION_CACHE["loaded"] = True
                        _MARKETING_LIST_CAMPAIGN_NAVIGATION_CACHE["value"] = None
                        next_url = build_marketing_lists_url(
                            limit,
                            None,
                            include_client_column,
                        )
                        continue

                    raise Exception(f"Dynamics GET error: {response.text}")

                payload = response.json()
                marketing_lists.extend(
                    normalize_marketing_list_record(
                        record,
                        campaign_navigation_property,
                    )
                    for record in payload.get("value", [])
                )
                next_url = payload.get("@odata.nextLink")

            marketing_lists = await enrich_marketing_lists_with_client_names(
                client,
                headers,
                marketing_lists,
                account_website_visit_relationship_name,
                website_visit_client_relationship_name,
            )
    except httpx.TimeoutException as exc:
        raise Exception(
            f"Dynamics request timed out after {MARKETING_LIST_REQUEST_TIMEOUT_SECONDS} seconds while loading marketing lists"
        ) from exc

    return marketing_lists[:limit]


async def get_leadfeeder_visits(limit: int = LEADFEEDER_VISIT_DEFAULT_LIMIT):
    visit_limit = max(1, min(limit, LEADFEEDER_VISIT_MAX_LIMIT))
    token = await get_access_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0",
        "Prefer": f"odata.maxpagesize={visit_limit}",
    }

    visits = []
    timeout = httpx.Timeout(LEADFEEDER_VISIT_REQUEST_TIMEOUT_SECONDS)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            website_visit_client_relationship_name = await get_website_visit_client_navigation_property(client, headers)
            website_visit_account_relationship_name = await get_website_visit_account_navigation_property(client, headers)

            expand_parts = []
            if website_visit_client_relationship_name:
                expand_parts.append(f"{website_visit_client_relationship_name}($select=name)")
            if website_visit_account_relationship_name:
                expand_parts.append(
                    f"{website_visit_account_relationship_name}($select=name,websiteurl,address1_country,address1_stateorprovince,address1_city,new_sector,telephone1,emailaddress1)"
                )

            next_url = f"{API_URL}/lfapp_websitevisits?$select=lfapp_websitevisitid,createdon,_lfapp_account_value,_new_client_value"
            if expand_parts:
                next_url += f"&$expand={','.join(expand_parts)}"
            next_url += f"&$orderby=createdon desc&$top={visit_limit}"

            while next_url and len(visits) < visit_limit:
                response = await client.get(next_url, headers=headers)

                if response.status_code != 200:
                    raise Exception(f"Dynamics GET error: {response.text}")

                payload = response.json()
                for record in payload.get("value", []):
                    visits.append(
                        {
                            "visit_id": record.get("lfapp_websitevisitid"),
                            "createdon": record.get("createdon"),
                            "account_name": (
                                get_related_record_value(
                                    record,
                                    website_visit_account_relationship_name,
                                    ("name",),
                                )
                                if website_visit_account_relationship_name
                                else ""
                            )
                            or get_lookup_display_value(record, "_lfapp_account_value")
                            or "",
                            "account_id": record.get("_lfapp_account_value") or "",
                            "website": (
                                get_related_record_value(
                                    record,
                                    website_visit_account_relationship_name,
                                    ("websiteurl",),
                                )
                                if website_visit_account_relationship_name
                                else ""
                            ),
                            "country": (
                                get_related_record_value(
                                    record,
                                    website_visit_account_relationship_name,
                                    ("address1_country",),
                                )
                                if website_visit_account_relationship_name
                                else ""
                            ),
                            "state": (
                                get_related_record_value(
                                    record,
                                    website_visit_account_relationship_name,
                                    ("address1_stateorprovince",),
                                )
                                if website_visit_account_relationship_name
                                else ""
                            ),
                            "city": (
                                get_related_record_value(
                                    record,
                                    website_visit_account_relationship_name,
                                    ("address1_city",),
                                )
                                if website_visit_account_relationship_name
                                else ""
                            ),
                            "industry": (
                                get_related_record_value(
                                    record,
                                    website_visit_account_relationship_name,
                                    ("new_sector",),
                                )
                                if website_visit_account_relationship_name
                                else ""
                            ),
                            "phone": (
                                get_related_record_value(
                                    record,
                                    website_visit_account_relationship_name,
                                    ("telephone1",),
                                )
                                if website_visit_account_relationship_name
                                else ""
                            ),
                            "email": (
                                get_related_record_value(
                                    record,
                                    website_visit_account_relationship_name,
                                    ("emailaddress1",),
                                )
                                if website_visit_account_relationship_name
                                else ""
                            ),
                            "client_name": (
                                get_related_record_value(
                                    record,
                                    website_visit_client_relationship_name,
                                    ("name",),
                                )
                                if website_visit_client_relationship_name
                                else ""
                            )
                            or get_lookup_display_value(record, "_new_client_value")
                            or "",
                        }
                    )

                next_url = payload.get("@odata.nextLink")
    except httpx.TimeoutException as exc:
        raise Exception(
            f"Dynamics request timed out after {LEADFEEDER_VISIT_REQUEST_TIMEOUT_SECONDS} seconds while loading Leadfeeder visits"
        ) from exc

    return visits[:visit_limit]


async def _get_marketing_list_relationship_members(list_id: str, relationship: str, select_fields: str):
    token = await get_access_token()
    url = (
        f"{API_URL}/lists({list_id})/{relationship}?"
        f"$select={select_fields}"
    )
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0",
        "Prefer": 'odata.include-annotations="OData.Community.Display.V1.FormattedValue",odata.maxpagesize=5000',
    }
    members = []
    timeout = httpx.Timeout(MARKETING_LIST_REQUEST_TIMEOUT_SECONDS)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            while url:
                response = await client.get(url, headers=headers)

                if response.status_code != 200:
                    raise Exception(f"Dynamics GET error for {relationship}: {response.text}")

                payload = response.json()
                members.extend(payload.get("value", []))
                url = payload.get("@odata.nextLink")
    except httpx.TimeoutException as exc:
        raise Exception(
            f"Dynamics request timed out after {MARKETING_LIST_REQUEST_TIMEOUT_SECONDS} seconds while loading {relationship}"
        ) from exc

    return members


async def get_marketing_list_members(list_id: str):
    accounts, contacts = await asyncio.gather(
        _get_marketing_list_relationship_members(
            list_id,
            "listaccount_association",
            "accountid,name,websiteurl,emailaddress1,telephone1,new_sector,createdon,modifiedon,statuscode,statecode,customertypecode",
        ),
        _get_marketing_list_relationship_members(
            list_id,
            "listcontact_association",
            "contactid,fullname,emailaddress1,telephone1,jobtitle",
        ),
    )

    return {
        "list_id": list_id,
        "account_count": len(accounts),
        "contact_count": len(contacts),
        "accounts": accounts,
        "contacts": contacts,
    }


TRADE_SHOW_TERMS = (
    "hannover messe",
    "berlin air show",
    "mro americas",
    "data center world",
    "airventure",
    "bio",
    "paris air show",
    "farnborough",
    "selectusa",
    "global food forum",
)


PE_TAG_PATTERNS = (
    r"\bpe\b",
    r"prospectengage",
    r"prospect engage",
)


PE_CLIENT_ALIASES = {
    "VCEDA": ("vceda",),
    "Empire State Development": ("empire state development", "esd"),
    "I-77 Alliance": ("i-77 alliance", "i77 alliance", "i 77 alliance"),
    "Upstate South Carolina Alliance": ("upstate south carolina alliance", "upstate sc alliance"),
    "South Carolina Alliance": ("south carolina alliance", "southern carolina alliance", "sca"),
    "Missouri Partnership": ("missouri partnership",),
    "MBREDC": ("mbredc",),
    "Catawba County": ("catawba county",),
    "Nassau County": ("nassau county",),
    "Ohio SE": ("ohio se", "ohiose", "ohio southeast"),
    "SEMO REDI": ("semo redi", "semo"),
}


def _normalized_list_label(marketing_list: dict) -> str:
    return " ".join(
        str(marketing_list.get(field) or "").lower()
        for field in ("campaign", "marketing_list_name", "name")
    )


def _active_trade_show_terms(trade_show_terms: list[str] | tuple[str, ...] | None = None) -> tuple[str, ...]:
    custom_terms = tuple(
        str(term or "").strip().lower()
        for term in trade_show_terms or []
        if str(term or "").strip()
    )
    return custom_terms or TRADE_SHOW_TERMS


def _active_exclusion_rules(exclusion_keywords: list[str] | tuple[str, ...] | None = None) -> tuple[tuple[str, str, tuple[str, ...]], ...]:
    custom_keywords = tuple(
        str(keyword or "").strip().lower()
        for keyword in exclusion_keywords or []
        if str(keyword or "").strip()
    )
    if not custom_keywords:
        return MARKETING_LIST_EXCLUSION_RULES

    return MARKETING_LIST_EXCLUSION_RULES + (
        ("admin_keyword", "Admin exclusion keyword", custom_keywords),
    )


def _get_trade_show_name(marketing_list: dict, trade_show_terms: list[str] | tuple[str, ...] | None = None) -> str:
    label = _normalized_list_label(marketing_list)
    for term in _active_trade_show_terms(trade_show_terms):
        if term in label:
            return term.title()

    return ""


def _is_trade_show_list(marketing_list: dict, trade_show_terms: list[str] | tuple[str, ...] | None = None) -> bool:
    return bool(_get_trade_show_name(marketing_list, trade_show_terms))


def _has_pe_tag(marketing_list: dict) -> bool:
    label = _normalized_list_label(marketing_list)
    return any(re.search(pattern, label) for pattern in PE_TAG_PATTERNS)


def _detect_client_name_from_list(marketing_list: dict) -> str:
    label = _normalized_list_label(marketing_list)
    for client_name, aliases in PE_CLIENT_ALIASES.items():
        if any(alias in label for alias in aliases):
            return client_name

    return ""


def _detect_override_client_name_from_list(marketing_list: dict, override_pe_clients: set[str]) -> str:
    label = _normalized_list_label(marketing_list)
    for client_name in sorted(override_pe_clients):
        if client_name.lower() in label:
            return client_name

    return ""


def _classify_campaign_type(marketing_list: dict, pe_clients: set[str] | None = None) -> str:
    if marketing_list.get("is_trade_show"):
        return "Trade Show"

    client_name = marketing_list.get("client_name") or _detect_client_name_from_list(marketing_list)
    if client_name and pe_clients and client_name in pe_clients:
        return "ProspectEngage (PE)"

    return "Marketing Mission / Other"


MARKETING_LIST_EXCLUSION_RULES = (
    ("camoin_activity", "Camoin/ProspectEngage internal activity", (
        "prospectengage crm",
        "pe crm",
        "pe marketing",
        "pe demo",
        "demo follow-up",
        "pe 3.0",
        "pe release",
        "pe client contacts",
        "pe approved",
        "prospectengage - target",
        "pe past prospects email",
        "nysedc",
        "sedc meet the consultants",
        "sedc survey",
        "expansion solutions",
        "ct - camoin email",
    )),
    ("source_admin_pool", "Source/admin pool", (
        "suppression",
        "source-testing",
        "source testing",
        "account-removal",
        "account removal",
        "missing information",
        "stock ticker",
        "stock-ticker",
        "sector universe",
        "master",
        "not-called",
        "not called",
        "vetting",
        "intent feed",
        "demandbase",
    )),
)


SALESPERSON_LIST_PATTERNS = (
    r"\brob\b",
)


def _get_marketing_list_exclusion(
    marketing_list: dict,
    company_count: int,
    size_threshold: int = 1500,
    exclusion_keywords: list[str] | tuple[str, ...] | None = None,
) -> dict | None:
    if company_count >= size_threshold:
        return {
            "code": "large_pool",
            "reason": f"List has at least {size_threshold:,} companies",
        }

    list_name = str(marketing_list.get("marketing_list_name") or marketing_list.get("name") or "")
    normalized_name = list_name.lower()

    for code, reason, terms in _active_exclusion_rules(exclusion_keywords):
        if any(term in normalized_name for term in terms):
            return {
                "code": code,
                "reason": reason,
            }

    if any(re.search(pattern, normalized_name) for pattern in SALESPERSON_LIST_PATTERNS):
        return {
            "code": "camoin_activity",
            "reason": "Camoin salesperson-named list",
        }

    return None


def _conversion_rate(prospect_count: int, company_count: int) -> float:
    if company_count <= 0:
        return 0
    return round((prospect_count / company_count) * 100, 2)


def _companies_per_prospect(company_count: int, prospect_count: int) -> float | None:
    if prospect_count <= 0:
        return None
    return round(company_count / prospect_count, 2)


def _empty_rollup(key: str, label: str) -> dict:
    return {
        key: label,
        "list_count": 0,
        "_account_ids": set(),
        "_converted_account_ids": set(),
        "conversion_rate": 0,
        "companies_per_prospect": None,
    }


def _finalize_conversion_rollups(rollups: dict[str, dict]) -> list[dict]:
    finalized = []
    for rollup in rollups.values():
        company_count = len(rollup["_account_ids"])
        prospect_count = len(rollup["_converted_account_ids"])
        finalized.append(
            {
                **{
                    key: value
                    for key, value in rollup.items()
                    if not key.startswith("_")
                },
                "company_count": company_count,
                "prospect_count": prospect_count,
                "conversion_rate": _conversion_rate(prospect_count, company_count),
                "companies_per_prospect": _companies_per_prospect(company_count, prospect_count),
            }
        )

    return sorted(
        finalized,
        key=lambda row: (row["prospect_count"], row["conversion_rate"], row["company_count"]),
        reverse=True,
    )


def _finalize_year_bucket_rollups(rollups: dict[tuple[str, str], dict], years: list[str]) -> list[dict]:
    bucket_order = {
        "ProspectEngage (PE)": 0,
        "Trade Show": 1,
        "Marketing Mission / Other": 2,
        "ALL OTHER LEAD GEN (TS+Missions)": 3,
    }
    finalized = []

    for (year, bucket), rollup in rollups.items():
        company_count = len(rollup["_account_ids"])
        prospect_count = len(rollup["_converted_account_ids"])
        finalized.append(
            {
                "year": year,
                "campaign_type": bucket,
                "list_count": rollup["list_count"],
                "company_count": company_count,
                "prospect_count": prospect_count,
                "conversion_rate": _conversion_rate(prospect_count, company_count),
                "companies_per_prospect": _companies_per_prospect(company_count, prospect_count),
            }
        )

    return sorted(
        finalized,
        key=lambda row: (
            years.index(row["year"]) if row["year"] in years else len(years),
            bucket_order.get(row["campaign_type"], 99),
            row["campaign_type"],
        ),
    )


def _summarize_exclusions(excluded_rows: list[dict]) -> list[dict]:
    summary = {}
    for row in excluded_rows:
        exclusion = row.get("exclusion") or {}
        code = exclusion.get("code") or "unknown"
        reason = exclusion.get("reason") or "Excluded"
        summary.setdefault(code, {"code": code, "reason": reason, "list_count": 0, "company_count": 0})
        summary[code]["list_count"] += 1
        summary[code]["company_count"] += row.get("company_count") or 0

    return sorted(summary.values(), key=lambda row: (row["list_count"], row["company_count"]), reverse=True)


def _public_conversion_row(row: dict) -> dict:
    return {
        key: value
        for key, value in row.items()
        if not key.startswith("_")
    }


async def _fetch_dynamics_rows(client: httpx.AsyncClient, headers: dict, url: str) -> list[dict]:
    rows = []
    next_url = url

    while next_url:
        response = await client.get(next_url, headers=headers)
        if response.status_code != 200:
            raise Exception(f"Dynamics GET error: {response.text}")

        payload = response.json()
        rows.extend(payload.get("value", []))
        next_url = payload.get("@odata.nextLink")

    return rows


def _normalize_conversion_years(years: list[str] | tuple[str, ...] | None) -> list[str]:
    source_years = years or MARKETING_LIST_CONVERSION_DEFAULT_YEARS
    normalized_years = []
    for year in source_years:
        year_text = str(year or "").strip()
        if re.fullmatch(r"\d{4}", year_text):
            normalized_years.append(year_text)

    return normalized_years or list(MARKETING_LIST_CONVERSION_DEFAULT_YEARS)


def _normalize_conversion_match_mode(match_mode: str | None) -> str:
    normalized_mode = str(match_mode or "").strip().lower()
    if normalized_mode in {"any_time", "on_after_list_creation"}:
        return normalized_mode

    return "same_year"


def _normalize_override_pe_clients(pe_clients: list[str] | tuple[str, ...] | None) -> set[str]:
    return {
        str(client_name or "").strip()
        for client_name in pe_clients or []
        if str(client_name or "").strip()
    }


def _normalize_bucket_overrides(bucket_overrides: list[str] | tuple[str, ...] | None) -> dict[str, str]:
    allowed_buckets = {"Trade Show", "ProspectEngage (PE)", "Marketing Mission / Other"}
    overrides = {}

    for override in bucket_overrides or []:
        override_text = str(override or "").strip()
        separator = "=" if "=" in override_text else ":"
        if separator not in override_text:
            continue

        key, value = (part.strip() for part in override_text.split(separator, 1))
        if key and value in allowed_buckets:
            overrides[key] = value

    return overrides


def _get_marketing_list_years(marketing_list_name: str, years: list[str]) -> list[str]:
    return [year for year in years if year in str(marketing_list_name or "")]


def _build_marketing_list_conversion_lists_url(limit: int, years: list[str]) -> str:
    year_filter = " or ".join(f"contains(listname,'{year}')" for year in years)
    filters = [f"({year_filter})"] if year_filter else []
    filters.append("(createdfromcode eq 1 or createdfromcode eq 2)")
    filter_query = quote(" and ".join(filters), safe="()',$= ")

    return (
        f"{API_URL}/lists?"
        "$select=listid,listname,createdon,membercount,createdfromcode&"
        f"$filter={filter_query}&"
        "$orderby=createdon desc&"
        f"$top={limit}"
    )


async def _get_conversion_marketing_lists(client: httpx.AsyncClient, headers: dict, limit: int, years: list[str]) -> list[dict]:
    rows = await _fetch_dynamics_rows(
        client,
        headers,
        _build_marketing_list_conversion_lists_url(limit, years),
    )

    return [
        {
            "listid": row.get("listid"),
            "marketing_list_name": row.get("listname") or "",
            "createdon": row.get("createdon"),
            "member_count": row.get("membercount") or 0,
            "list_member_type": get_formatted_value(row, "createdfromcode") or row.get("createdfromcode") or "",
            "createdfromcode": row.get("createdfromcode"),
            "years": _get_marketing_list_years(row.get("listname") or "", years),
        }
        for row in rows[:limit]
    ]


async def _get_listmember_rows(client: httpx.AsyncClient, headers: dict, list_ids: list[str]) -> list[dict]:
    if not list_ids:
        return []

    rows = []
    chunk_size = 20
    for index in range(0, len(list_ids), chunk_size):
        chunk = list_ids[index:index + chunk_size]
        filter_query = " or ".join(f"_listid_value eq {list_id}" for list_id in chunk)
        url = (
            f"{API_URL}/listmembers?"
            "$select=_listid_value,entitytype,_entityid_value&"
            f"$filter={quote(filter_query, safe='()_ =')}"
        )
        rows.extend(await _fetch_dynamics_rows(client, headers, url))

    return rows


async def _get_contact_parent_accounts(client: httpx.AsyncClient, headers: dict, contact_ids: set[str]) -> dict[str, str]:
    if not contact_ids:
        return {}

    parent_accounts = {}
    contact_id_list = sorted(contact_ids)
    chunk_size = 20
    for index in range(0, len(contact_id_list), chunk_size):
        chunk = contact_id_list[index:index + chunk_size]
        filter_query = " or ".join(f"contactid eq {contact_id}" for contact_id in chunk)
        url = (
            f"{API_URL}/contacts?"
            "$select=contactid,_parentcustomerid_value&"
            f"$filter={quote(filter_query, safe='()_ =')}"
        )
        contacts = await _fetch_dynamics_rows(client, headers, url)
        for contact in contacts:
            contact_id = contact.get("contactid")
            parent_account_id = contact.get("_parentcustomerid_value")
            if contact_id and parent_account_id:
                parent_accounts[contact_id] = parent_account_id

    return parent_accounts


def _prospect_year(created_on: str | None) -> str:
    return str(created_on or "")[:4]


async def _get_prospects_by_year_and_account(
    client: httpx.AsyncClient,
    headers: dict,
    years: list[str],
    match_mode: str = "same_year",
) -> dict[str, dict[str, list[dict]]]:
    min_year = min(int(year) for year in years)
    max_year = max(int(year) for year in years)
    start_date = f"{min_year}-01-01T00:00:00Z"
    end_date = f"{max_year + 1}-01-01T00:00:00Z"
    if match_mode in {"any_time", "on_after_list_creation"}:
        filter_query = "_new_prospectaccount_value ne null"
    else:
        filter_query = (
            "_new_prospectaccount_value ne null"
            f" and createdon ge {start_date}"
            f" and createdon lt {end_date}"
        )
    url = (
        f"{API_URL}/new_prospects?"
        "$select=new_prospectid,_new_prospectaccount_value,new_client,createdon&"
        f"$filter={quote(filter_query, safe='_ =:-')}"
    )
    prospects = await _fetch_dynamics_rows(client, headers, url)
    prospects_by_year_and_account = {year: {} for year in years}
    prospects_by_year_and_account["__any_time__"] = {}

    for prospect in prospects:
        account_id = prospect.get("_new_prospectaccount_value")
        year = _prospect_year(prospect.get("createdon"))
        if not account_id:
            continue

        prospect_record = {
            "new_prospectid": prospect.get("new_prospectid"),
            "account_id": account_id,
            "client_name": get_formatted_value(prospect, "new_client") or prospect.get("new_client") or "",
            "createdon": prospect.get("createdon"),
        }
        prospects_by_year_and_account["__any_time__"].setdefault(account_id, []).append(prospect_record)
        if year in prospects_by_year_and_account:
            prospects_by_year_and_account[year].setdefault(account_id, []).append(prospect_record)

    return prospects_by_year_and_account


def _group_company_accounts_by_list(listmember_rows: list[dict], contact_parent_accounts: dict[str, str]) -> dict[str, set[str]]:
    accounts_by_list = {}

    for row in listmember_rows:
        list_id = row.get("_listid_value")
        entity_type = str(row.get("entitytype") or "").lower()
        entity_id = row.get("_entityid_value")

        if not list_id or not entity_id:
            continue

        if entity_type == "account":
            account_id = entity_id
        elif entity_type == "contact":
            account_id = contact_parent_accounts.get(entity_id)
        else:
            account_id = None

        if account_id:
            accounts_by_list.setdefault(list_id, set()).add(account_id)

    return accounts_by_list


def _is_on_or_after_list_creation(prospect: dict, list_created_on: str | None) -> bool:
    prospect_created_on = str(prospect.get("createdon") or "")
    if not prospect_created_on:
        return False
    if not list_created_on:
        return True

    return prospect_created_on >= str(list_created_on)


async def get_marketing_list_conversion_analysis(
    limit: int = MARKETING_LIST_CONVERSION_DEFAULT_LIMIT,
    years: list[str] | tuple[str, ...] | None = None,
    match_mode: str | None = None,
    pe_clients: list[str] | tuple[str, ...] | None = None,
    bucket_overrides: list[str] | tuple[str, ...] | None = None,
    trade_show_terms: list[str] | tuple[str, ...] | None = None,
    exclusion_keywords: list[str] | tuple[str, ...] | None = None,
    size_threshold: int = 1500,
):
    analysis_limit = max(1, min(limit, MARKETING_LIST_CONVERSION_MAX_LIMIT))
    analysis_years = _normalize_conversion_years(years)
    conversion_match_mode = _normalize_conversion_match_mode(match_mode)
    override_pe_clients = _normalize_override_pe_clients(pe_clients)
    per_list_bucket_overrides = _normalize_bucket_overrides(bucket_overrides)
    active_size_threshold = max(1, int(size_threshold or 1500))
    active_trade_show_terms = _active_trade_show_terms(trade_show_terms)
    active_exclusion_rules = _active_exclusion_rules(exclusion_keywords)
    token = await get_access_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0",
        "Prefer": 'odata.include-annotations="OData.Community.Display.V1.FormattedValue",odata.maxpagesize=5000',
    }
    timeout = httpx.Timeout(MARKETING_LIST_REQUEST_TIMEOUT_SECONDS)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            marketing_lists = await _get_conversion_marketing_lists(client, headers, analysis_limit, analysis_years)
            list_ids = [
                marketing_list["listid"]
                for marketing_list in marketing_lists
                if marketing_list.get("listid")
            ]
            listmember_rows = await _get_listmember_rows(client, headers, list_ids)
            contact_ids = {
                row.get("_entityid_value")
                for row in listmember_rows
                if str(row.get("entitytype") or "").lower() == "contact" and row.get("_entityid_value")
            }
            contact_parent_accounts, prospects_by_year_and_account = await asyncio.gather(
                _get_contact_parent_accounts(client, headers, contact_ids),
                _get_prospects_by_year_and_account(client, headers, analysis_years, conversion_match_mode),
            )
    except httpx.TimeoutException as exc:
        raise Exception(
            f"Dynamics request timed out after {MARKETING_LIST_REQUEST_TIMEOUT_SECONDS} seconds while loading marketing-list conversion analysis"
        ) from exc

    accounts_by_list = _group_company_accounts_by_list(listmember_rows, contact_parent_accounts)

    candidate_rows = []
    excluded_rows = []
    for marketing_list in marketing_lists:
        list_id = marketing_list.get("listid")
        list_years = marketing_list.get("years") or _get_marketing_list_years(
            marketing_list.get("marketing_list_name") or "",
            analysis_years,
        )
        account_ids = accounts_by_list.get(list_id, set())
        matching_prospects_by_account = {}
        converted_account_ids_by_year = {year: set() for year in list_years}
        for year in list_years:
            prospects_by_account = (
                prospects_by_year_and_account.get("__any_time__", {})
                if conversion_match_mode in {"any_time", "on_after_list_creation"}
                else prospects_by_year_and_account.get(year, {})
            )
            for account_id in account_ids:
                prospects = prospects_by_account.get(account_id)
                if conversion_match_mode == "on_after_list_creation":
                    prospects = [
                        prospect
                        for prospect in prospects or []
                        if _is_on_or_after_list_creation(prospect, marketing_list.get("createdon"))
                    ]
                if prospects:
                    matching_prospects_by_account.setdefault(account_id, []).extend(prospects)
                    converted_account_ids_by_year.setdefault(year, set()).add(account_id)

        converted_prospect_accounts = {
            account_id: matching_prospects_by_account.get(account_id, [])
            for account_id in account_ids
            if matching_prospects_by_account.get(account_id)
        }
        company_count = len(account_ids)
        exclusion = _get_marketing_list_exclusion(
            marketing_list,
            company_count,
            active_size_threshold,
            exclusion_keywords,
        )
        prospect_count = len(converted_prospect_accounts)
        prospect_records = [
            prospect
            for prospects in converted_prospect_accounts.values()
            for prospect in prospects
        ]
        detected_client_name = (
            _detect_client_name_from_list(marketing_list)
            or _detect_override_client_name_from_list(marketing_list, override_pe_clients)
        )
        prospect_client_name = next(
            (prospect.get("client_name") for prospect in prospect_records if prospect.get("client_name")),
            "",
        )

        row = {
            "listid": marketing_list.get("listid"),
            "marketing_list_name": marketing_list.get("marketing_list_name") or marketing_list.get("name") or "",
            "createdon": marketing_list.get("createdon"),
            "years": list_years,
            "client_name": detected_client_name or prospect_client_name or "Unassigned",
            "campaign": marketing_list.get("campaign") or "Unassigned",
            "has_pe_tag": _has_pe_tag(marketing_list),
            "is_trade_show": _is_trade_show_list(marketing_list, active_trade_show_terms),
            "trade_show_name": _get_trade_show_name(marketing_list, active_trade_show_terms),
            "company_count": company_count,
            "prospect_count": prospect_count,
            "conversion_rate": _conversion_rate(prospect_count, company_count),
            "companies_per_prospect": _companies_per_prospect(company_count, prospect_count),
            "prospect_records": prospect_records[:10],
            "_account_ids": set(account_ids),
            "_converted_account_ids": set(converted_prospect_accounts.keys()),
            "_converted_account_ids_by_year": converted_account_ids_by_year,
        }

        if exclusion:
            excluded_rows.append({**row, "exclusion": exclusion})
            continue

        candidate_rows.append(row)

    pe_clients = {
        row["client_name"]
        for row in candidate_rows
        if row.get("client_name") and row["client_name"] != "Unassigned" and row.get("has_pe_tag")
    } | override_pe_clients

    rows = []
    for row in candidate_rows:
        override_bucket = (
            per_list_bucket_overrides.get(row.get("listid") or "")
            or per_list_bucket_overrides.get(row.get("marketing_list_name") or "")
        )
        rows.append(
            {
                **row,
                "campaign_type": override_bucket or _classify_campaign_type(row, pe_clients),
                "bucket_override": override_bucket or "",
                "is_pe_client": row.get("client_name") in pe_clients,
            }
        )

    campaign_type_rollups = {}
    year_bucket_rollups = {}
    client_rollups = {}
    campaign_rollups = {}
    trade_show_rollups = {}
    total_account_ids = set()
    total_converted_account_ids = set()

    for row in rows:
        total_account_ids.update(row["_account_ids"])
        total_converted_account_ids.update(row["_converted_account_ids"])

        campaign_type = row["campaign_type"]
        campaign_type_rollups.setdefault(campaign_type, _empty_rollup("campaign_type", campaign_type))
        campaign_type_rollups[campaign_type]["_account_ids"].update(row["_account_ids"])
        campaign_type_rollups[campaign_type]["_converted_account_ids"].update(row["_converted_account_ids"])
        campaign_type_rollups[campaign_type]["list_count"] += 1

        for year in row.get("years") or []:
            year_bucket_key = (year, campaign_type)
            year_bucket_rollups.setdefault(
                year_bucket_key,
                {"list_count": 0, "_account_ids": set(), "_converted_account_ids": set()},
            )
            year_bucket_rollups[year_bucket_key]["_account_ids"].update(row["_account_ids"])
            year_bucket_rollups[year_bucket_key]["_converted_account_ids"].update(
                row.get("_converted_account_ids_by_year", {}).get(year, set())
            )
            year_bucket_rollups[year_bucket_key]["list_count"] += 1

            if campaign_type in ("Trade Show", "Marketing Mission / Other"):
                combined_key = (year, "ALL OTHER LEAD GEN (TS+Missions)")
                year_bucket_rollups.setdefault(
                    combined_key,
                    {"list_count": 0, "_account_ids": set(), "_converted_account_ids": set()},
                )
                year_bucket_rollups[combined_key]["_account_ids"].update(row["_account_ids"])
                year_bucket_rollups[combined_key]["_converted_account_ids"].update(
                    row.get("_converted_account_ids_by_year", {}).get(year, set())
                )
                year_bucket_rollups[combined_key]["list_count"] += 1

        client_name = row["client_name"] or "Unassigned"
        client_rollups.setdefault(client_name, _empty_rollup("client_name", client_name))
        client_rollups[client_name]["_account_ids"].update(row["_account_ids"])
        client_rollups[client_name]["_converted_account_ids"].update(row["_converted_account_ids"])
        client_rollups[client_name]["list_count"] += 1

        campaign = row["campaign"] or "Unassigned"
        campaign_rollups.setdefault(campaign, _empty_rollup("campaign", campaign))
        campaign_rollups[campaign]["_account_ids"].update(row["_account_ids"])
        campaign_rollups[campaign]["_converted_account_ids"].update(row["_converted_account_ids"])
        campaign_rollups[campaign]["list_count"] += 1

        if campaign_type == "Trade Show":
            trade_show_name = row.get("trade_show_name") or "Unassigned Trade Show"
            trade_show_rollups.setdefault(trade_show_name, _empty_rollup("trade_show_name", trade_show_name))
            trade_show_rollups[trade_show_name]["_account_ids"].update(row["_account_ids"])
            trade_show_rollups[trade_show_name]["_converted_account_ids"].update(row["_converted_account_ids"])
            trade_show_rollups[trade_show_name]["list_count"] += 1

    total_companies = len(total_account_ids)
    total_prospects = len(total_converted_account_ids)

    return {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "limit": analysis_limit,
        "years": analysis_years,
        "match_mode": conversion_match_mode,
        "list_count": len(rows),
        "excluded_list_count": len(excluded_rows),
        "excluded_company_count": sum(row.get("company_count") or 0 for row in excluded_rows),
        "exclusion_rollups": _summarize_exclusions(excluded_rows),
        "excluded_lists": [
            _public_conversion_row(row)
            for row in sorted(excluded_rows, key=lambda row: row["createdon"] or "", reverse=True)[:100]
        ],
        "pe_clients": sorted(pe_clients),
        "override_pe_clients": sorted(override_pe_clients),
        "bucket_overrides": per_list_bucket_overrides,
        "company_count": total_companies,
        "prospect_count": total_prospects,
        "conversion_rate": _conversion_rate(total_prospects, total_companies),
        "companies_per_prospect": _companies_per_prospect(total_companies, total_prospects),
        "methodology": {
            "member_scope": "Account and contact marketing lists whose list name contains the selected year. Contact members are mapped to parent account before conversion matching.",
            "conversion_rule": "Default conversion is same-year: a company is counted when its account GUID appears in new_prospect._new_prospectaccount_value for the same year named by the marketing list. Any-time mode counts a matched prospect from any created date. On/after list creation mode counts prospects created on or after the list createdon date.",
            "exclusion_rule": "Internal Camoin activity, source/admin pools, salesperson-named lists, and lists with at least 1,500 companies are dropped before campaign/client bucketing.",
            "bucket_rule": "Final bucket order is excluded, then known trade show, then PE client, then Marketing Mission / Other. A client is PE when it has at least one non-excluded PE/ProspectEngage-tagged list.",
            "override_rule": "Admins can flag PE clients and override non-excluded per-list buckets. Overrides are applied after exclusion so excluded/admin/source lists stay out of denominators.",
            "rollup_rule": "Rollups de-duplicate companies within each bucket and use converted companies divided by distinct companies. A company can still appear in multiple buckets, so bucket totals should not be summed.",
            "comparison_rule": "2025 is a full-year cohort and 2026 is partial-year-to-date, so compare conversion rates and companies per prospect instead of raw counts.",
            "causation_caveat": "A member-to-prospect match is correlation, not proof that the list produced the prospect. Treat rates as directional benchmarks.",
            "matching_caveat": "Matching relies on Dynamics GUIDs, never display names, because state/name data is inconsistent.",
        },
        "config": {
            "match_mode": conversion_match_mode,
            "available_match_modes": ["same_year", "any_time", "on_after_list_creation"],
            "list_year_patterns": analysis_years,
            "large_list_company_threshold": active_size_threshold,
            "trade_show_terms": list(active_trade_show_terms),
            "pe_client_aliases": PE_CLIENT_ALIASES,
            "exclusion_rules": [
                {"code": code, "reason": reason, "terms": list(terms)}
                for code, reason, terms in active_exclusion_rules
            ],
            "admin_override_fields": [
                "years",
                "pe_clients",
                "trade_show_terms",
                "exclusion_keywords",
                "size_threshold",
                "per_list_bucket_override",
                "match_mode",
            ],
        },
        "campaign_type_rollups": _finalize_conversion_rollups(campaign_type_rollups),
        "year_bucket_rollups": _finalize_year_bucket_rollups(year_bucket_rollups, analysis_years),
        "client_rollups": _finalize_conversion_rollups(client_rollups),
        "trade_show_rollups": _finalize_conversion_rollups(trade_show_rollups),
        "campaign_rollups": _finalize_conversion_rollups(campaign_rollups),
        "lists": [
            _public_conversion_row(row)
            for row in sorted(rows, key=lambda row: row["createdon"] or "", reverse=True)
        ],
    }


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
    normalized_range = range_key if range_key in MARKETING_RANGE_OPTIONS else "last_year"

    if "days" in option:
        day_count = int(option["days"])
        start_date = (now - timedelta(days=day_count - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
        return {
            "range": normalized_range,
            "label": option["label"],
            "start_date": start_date,
            "buckets": _day_buckets(start_date, day_count),
            "bucket_key": "day_key",
            "bucket_label": "day_label",
            "bucket_grain": "day",
        }

    if "start_year" in option:
        start_year = int(option["start_year"])
        month_count = max(1, ((now.year - start_year) * 12) + now.month)
    else:
        month_count = int(option["months"])

    buckets = _month_buckets(now, month_count)
    return {
        "range": normalized_range,
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


def _run_ga4_total_site_traffic_report(window: dict[str, object]):
    if not GA4_PROPERTY_ID:
        raise RuntimeError("Missing GA4_PROPERTY_ID. Set it in the project .env file or process environment.")

    bucket_grain = window["bucket_grain"]
    dimension_name = "date" if bucket_grain == "day" else "yearMonth"
    start_date = window["start_date"].strftime("%Y-%m-%d")

    client = BetaAnalyticsDataClient()
    request = RunReportRequest(
        property=f"properties/{GA4_PROPERTY_ID}",
        dimensions=[Dimension(name=dimension_name)],
        metrics=[Metric(name="sessions")],
        date_ranges=[DateRange(start_date=start_date, end_date="today")],
        limit=100000,
    )
    return client.run_report(request)


async def _fetch_ga4_total_site_traffic(window: dict[str, object]) -> dict[str, int]:
    response = await asyncio.to_thread(_run_ga4_total_site_traffic_report, window)
    return _build_ga4_total_site_traffic_counts(window, response)


def _build_ga4_total_site_traffic_counts(window: dict[str, object], response) -> dict[str, int]:
    bucket_key = window["bucket_key"]
    bucket_grain = window["bucket_grain"]
    counts_by_bucket = {bucket[bucket_key]: 0 for bucket in window["buckets"]}

    for row in response.rows:
        raw_period = row.dimension_values[0].value
        if bucket_grain == "day":
            period_key = f"{raw_period[:4]}-{raw_period[4:6]}-{raw_period[6:8]}"
        else:
            period_key = f"{raw_period[:4]}-{raw_period[4:6]}"

        if period_key in counts_by_bucket:
            counts_by_bucket[period_key] += int(row.metric_values[0].value)

    return counts_by_bucket


async def _load_website_visit_metrics_from_dynamics(range_key: str = "since_2022"):
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

    timeout = httpx.Timeout(MARKETING_METRICS_REQUEST_TIMEOUT_SECONDS)
    async with httpx.AsyncClient(timeout=timeout) as client:
        ga4_site_traffic, target_naics_codes = await asyncio.gather(
            _fetch_ga4_total_site_traffic(window),
            _fetch_target_industry_naics_codes(client, headers),
        )
        leadfeeder_visit_counts = await _count_website_visits(
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
            "visitors": ga4_site_traffic[bucket[window["bucket_key"]]],
            "target_visitors": leadfeeder_visit_counts["target_counts_by_bucket"][bucket[window["bucket_key"]]],
        }
        for bucket in buckets
    ]

    result = {
        "company_id": INTERNAL_COMPANY_ACCOUNT_ID,
        "range": window["range"],
        "range_label": window["label"],
        "bucket_grain": window["bucket_grain"],
        "visitors_source": "Google Analytics 4 sessions",
        "target_visitors_source": "Leadfeeder target-industry visit records",
        "updated_at": current_time.isoformat(),
        "total_visitors": sum(ga4_site_traffic.values()),
        "target_total_visitors": leadfeeder_visit_counts["target_total"],
        "months": visit_buckets,
        "landing_pages": leadfeeder_visit_counts["landing_pages"],
    }
    cached_data[cache_key] = result
    _MARKETING_METRICS_CACHE["data"] = cached_data
    _MARKETING_METRICS_CACHE["expires_at"] = now + MARKETING_METRICS_CACHE_TTL_SECONDS

    return result


def _normalize_marketing_metrics_range(range_key: str) -> str:
    return range_key if range_key in MARKETING_RANGE_OPTIONS else "last_year"


def _marketing_metrics_empty_payload(range_key: str) -> dict:
    current_time = datetime.now(timezone.utc)
    window = _marketing_window(range_key, current_time)
    return {
        "company_id": INTERNAL_COMPANY_ACCOUNT_ID,
        "range": window["range"],
        "range_label": window["label"],
        "bucket_grain": window["bucket_grain"],
        "visitors_source": "Google Analytics 4 sessions",
        "target_visitors_source": "Leadfeeder target-industry visit records",
        "updated_at": "",
        "total_visitors": 0,
        "target_total_visitors": 0,
        "months": [
            {
                "period": bucket[window["bucket_label"]],
                "period_key": bucket[window["bucket_key"]],
                "visitors": 0,
                "target_visitors": 0,
            }
            for bucket in window["buckets"]
        ],
        "landing_pages": [],
    }


def _is_marketing_metrics_cache_stale(cache_row: dict | None) -> bool:
    if not cache_row or not cache_row.get("last_completed_at"):
        return True

    try:
        completed_time = datetime.fromisoformat(str(cache_row["last_completed_at"]).replace("Z", "+00:00"))
    except ValueError:
        return True

    if completed_time.tzinfo is None:
        completed_time = completed_time.replace(tzinfo=timezone.utc)

    return (datetime.now(timezone.utc) - completed_time).total_seconds() > MARKETING_METRICS_SYNC_STALE_SECONDS


def _marketing_metrics_payload_uses_ga4_site_traffic(payload: dict) -> bool:
    return payload.get("visitors_source") == "Google Analytics 4 sessions"


def _get_marketing_metrics_cache_row(range_key: str) -> dict | None:
    with get_database_connection() as connection:
        row = connection.execute(
            """
            SELECT range_key, payload, status, last_started_at, last_completed_at, last_error
            FROM marketing_metrics_cache
            WHERE range_key = ?
            """,
            (range_key,),
        ).fetchone()

    return dict(row) if row else None


async def refresh_website_visit_metrics_cache(range_key: str = "since_2022") -> dict:
    normalized_range = _normalize_marketing_metrics_range(range_key)
    started_at = datetime.now(timezone.utc).isoformat()
    with get_database_connection() as connection:
        connection.execute(
            """
            INSERT INTO marketing_metrics_cache (
                range_key, payload, status, last_started_at, last_error, updated_at
            )
            VALUES (?, ?, 'syncing', ?, '', CURRENT_TIMESTAMP)
            ON CONFLICT(range_key) DO UPDATE SET
                status = 'syncing',
                last_started_at = excluded.last_started_at,
                last_error = '',
                updated_at = CURRENT_TIMESTAMP
            """,
            (normalized_range, json.dumps(_marketing_metrics_empty_payload(normalized_range)), started_at),
        )

    try:
        payload = await _load_website_visit_metrics_from_dynamics(normalized_range)
        completed_at = datetime.now(timezone.utc).isoformat()
        with get_database_connection() as connection:
            connection.execute(
                """
                UPDATE marketing_metrics_cache
                SET payload = ?,
                    status = 'idle',
                    last_completed_at = ?,
                    last_error = '',
                    updated_at = CURRENT_TIMESTAMP
                WHERE range_key = ?
                """,
                (json.dumps(payload), completed_at, normalized_range),
            )
        return get_website_visit_metrics(normalized_range)
    except Exception as exc:
        with get_database_connection() as connection:
            connection.execute(
                """
                UPDATE marketing_metrics_cache
                SET status = 'error',
                    last_error = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE range_key = ?
                """,
                (str(exc), normalized_range),
            )
        raise


def get_website_visit_metrics(range_key: str = "since_2022") -> dict:
    normalized_range = _normalize_marketing_metrics_range(range_key)
    cache_row = _get_marketing_metrics_cache_row(normalized_range)
    if cache_row:
        try:
            payload = json.loads(cache_row.get("payload") or "{}")
        except json.JSONDecodeError:
            payload = _marketing_metrics_empty_payload(normalized_range)
    else:
        payload = _marketing_metrics_empty_payload(normalized_range)

    uses_current_site_traffic_source = _marketing_metrics_payload_uses_ga4_site_traffic(payload)
    sync = {
        "status": cache_row.get("status") if cache_row else "idle",
        "last_started_at": cache_row.get("last_started_at") if cache_row else None,
        "last_completed_at": cache_row.get("last_completed_at") if cache_row else None,
        "last_error": cache_row.get("last_error") if cache_row else "",
        "is_stale": _is_marketing_metrics_cache_stale(cache_row) or not uses_current_site_traffic_source,
    }
    return {
        **payload,
        "sync": sync,
    }


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
    contracted_projects_url = (
        f"{API_URL}/new_projects?"
        "$select=new_projectid,new_feeforcamoin,new_contractdate&"
        f"$filter=new_contractdate ge {start_date}&"
        "$orderby=new_contractdate desc"
    )
    proposed_opportunities_url = (
        f"{API_URL}/opportunities?"
        "$select=opportunityid,name,new_feeforcamoin,cr73c_dateproposed&"
        f"$filter=cr73c_dateproposed ge {start_date}&"
        "$orderby=cr73c_dateproposed desc"
    )

    financial_rows_errors = []

    async with httpx.AsyncClient() as client:
        project_counts = await _count_projects_by_month_and_service_line(
            client,
            projects_url,
            headers,
            months,
        )
        contracted_projects_result, proposed_opportunities_result = await asyncio.gather(
            _fetch_project_financial_rows(
                client,
                contracted_projects_url,
                headers,
                "new_projectid",
                "new_contractdate",
            ),
            _fetch_project_financial_rows(
                client,
                proposed_opportunities_url,
                headers,
                "opportunityid",
                "cr73c_dateproposed",
                name_field="name",
            ),
            return_exceptions=True,
        )

    if isinstance(contracted_projects_result, Exception):
        contracted_projects = []
        financial_rows_errors.append(f"Unable to load contracted project fees: {contracted_projects_result}")
    else:
        contracted_projects = contracted_projects_result

    if isinstance(proposed_opportunities_result, Exception):
        proposed_opportunities = []
        financial_rows_errors.append(f"Unable to load proposed opportunity fees: {proposed_opportunities_result}")
    else:
        proposed_opportunities = proposed_opportunities_result

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
        "contracted_projects": contracted_projects,
        "proposed_opportunities": proposed_opportunities,
        "financial_rows_errors": financial_rows_errors,
    }
    _PROJECT_METRICS_CACHE["data"] = result
    _PROJECT_METRICS_CACHE["expires_at"] = now + MARKETING_METRICS_CACHE_TTL_SECONDS

    return result


def _month_date_window(year: int, month: int | None = None) -> tuple[str, str]:
    start = datetime(year, month or 1, 1, tzinfo=timezone.utc)
    if month == 12:
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    elif month:
        end = datetime(year, month + 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)

    return (
        start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        end.strftime("%Y-%m-%dT%H:%M:%SZ"),
    )


def _matches_pe_qualified_status(record: dict) -> bool:
    target = PE_QUALIFIED_LEAD_STATUS_LABEL.casefold()
    for key, value in record.items():
        if not key.endswith("@OData.Community.Display.V1.FormattedValue"):
            continue

        if str(value or "").strip().casefold() == target:
            return True

    return any(str(value or "").strip().casefold() == target for value in record.values())


def _get_prospect_client_name(record: dict) -> str:
    return (
        get_lookup_display_value(record, "_new_client_value")
        or get_lookup_display_value(record, "new_Client")
        or get_lookup_display_value(record, "new_client")
        or str(record.get("new_Client") or record.get("new_client") or "").strip()
    )


def _canonical_pe_client_name(client_name: str) -> str:
    normalized_name = " ".join(str(client_name or "").strip().casefold().split())
    if not normalized_name:
        return ""

    for canonical_name, aliases in PE_CLIENT_ALIASES.items():
        if normalized_name in {alias.casefold() for alias in aliases}:
            return canonical_name

    return str(client_name or "").strip()


def _build_pe_qualified_lead_rollups(rows: list[dict]) -> list[dict]:
    counts = {}
    for row in rows:
        client_name = row.get("client_name") or "Missing"
        counts[client_name] = counts.get(client_name, 0) + 1

    return sorted(
        (
            {
                "client_name": client_name,
                "qualified_leads": qualified_leads,
            }
            for client_name, qualified_leads in counts.items()
        ),
        key=lambda row: (-row["qualified_leads"], row["client_name"].casefold()),
    )


async def get_pe_qualified_leads(year: int | None = None, month: int | None = None, limit: int = PE_QUALIFIED_LEAD_DEFAULT_LIMIT):
    token = await get_access_token()
    if year:
        start_date, end_date = _month_date_window(year, month)
        filter_query = f"createdon ge {start_date} and createdon lt {end_date}"
    else:
        start_date = "2000-01-01T00:00:00Z"
        end_date = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        filter_query = f"createdon ge {start_date} and createdon lt {end_date}"
    url = (
        f"{API_URL}/new_prospects?"
        f"$filter={quote(filter_query, safe='_ =:-')}&"
        "$orderby=createdon desc"
    )
    headers = _dynamics_read_headers(token)
    rows = []

    async with httpx.AsyncClient(timeout=PE_CLIENT_REQUEST_TIMEOUT_SECONDS) as client:
        next_url = url
        while next_url and len(rows) < limit:
            response = await client.get(next_url, headers=headers)
            if response.status_code != 200:
                raise Exception(f"Dynamics GET error: {response.text}")

            payload = response.json()
            for record in payload.get("value", []):
                if len(rows) >= limit:
                    break

                if not _matches_pe_qualified_status(record):
                    continue

                client_name = _canonical_pe_client_name(_get_prospect_client_name(record))
                rows.append(
                    {
                        "id": record.get("new_prospectid"),
                        "prospect_name": record.get("new_prospectname") or "",
                        "client_name": client_name,
                        "status": PE_QUALIFIED_LEAD_STATUS_LABEL,
                        "createdon": record.get("createdon"),
                        "createdon_formatted": get_formatted_value(record, "createdon") or "",
                    }
                )

            next_url = payload.get("@odata.nextLink")

    return {
        "count": len(rows),
        "data": rows,
        "from": start_date,
        "limit": limit,
        "rollups": _build_pe_qualified_lead_rollups(rows),
        "status": PE_QUALIFIED_LEAD_STATUS_LABEL,
        "to": end_date,
        "year": year,
        "month": month if year else None,
    }


async def _fetch_project_financial_rows(
    client: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
    id_field: str,
    date_field: str,
    name_field: str | None = None,
    limit: int = 100,
) -> list[dict]:
    rows = []

    while url and len(rows) < limit:
        response = await client.get(url, headers=headers)

        if response.status_code != 200:
            raise Exception(f"Dynamics GET error: {response.text}")

        payload = response.json()
        for record in payload.get("value", []):
            if len(rows) >= limit:
                break

            rows.append(
                {
                    "id": record.get(id_field),
                    "name": record.get(name_field) if name_field else "",
                    "fee_for_camoin": record.get("new_feeforcamoin"),
                    "fee_for_camoin_formatted": get_formatted_value(record, "new_feeforcamoin") or "",
                    "date": record.get(date_field),
                    "date_formatted": get_formatted_value(record, date_field) or "",
                }
            )

        url = payload.get("@odata.nextLink")

    return rows


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
    visits_with_naics = []
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

            visit_naics_id = _clean_guid(visit.get(WEBSITE_VISIT_NAICS_LOOKUP_FIELD))
            if visit_naics_id:
                visits_with_naics.append(
                    {
                        "bucket_key": current_key,
                        "naics_id": visit_naics_id,
                    }
                )
                continue

            visitor_account_id = _get_visitor_account_id(visit)
            if visitor_account_id:
                visits_for_targeting.append(
                    {
                        "bucket_key": current_key,
                        "visitor_account_id": visitor_account_id,
                    }
                )

        url = payload.get("@odata.nextLink")

    if target_naics_codes and visits_with_naics:
        naics_ids = {
            visit["naics_id"]
            for visit in visits_with_naics
        }
        visit_naics_codes = await _fetch_naics_codes(client, headers, naics_ids)

        for visit in visits_with_naics:
            naics_codes = visit_naics_codes.get(visit["naics_id"], set())
            if _has_target_naics_match(naics_codes, target_naics_codes):
                target_counts_by_bucket[visit["bucket_key"]] += 1
                target_total += 1

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


async def _fetch_naics_codes(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    naics_ids: set[str],
) -> dict[str, set[str]]:
    naics_codes = {}
    naics_id_list = sorted(naics_ids)
    chunk_size = 50
    entity_set_name = await _resolve_entity_set_name(
        client,
        headers,
        NAICS_TABLE,
        NAICS_ENTITY_SET_CANDIDATES,
    )
    code_field = await _resolve_existing_field(
        client,
        headers,
        entity_set_name,
        NAICS_CODE_FIELDS,
        "NAICS code",
    )

    for index in range(0, len(naics_id_list), chunk_size):
        chunk = naics_id_list[index:index + chunk_size]
        naics_filter = " or ".join(
            f"new_naicsid eq {naics_id}"
            for naics_id in chunk
        )
        url = (
            f"{API_URL}/{entity_set_name}?"
            f"$select=new_naicsid,{code_field}&"
            f"$filter={naics_filter}"
        )

        while url:
            response = await client.get(url, headers=headers)

            if response.status_code != 200:
                raise Exception(f"Dynamics GET error: {response.text}")

            payload = response.json()

            for naics in payload.get("value", []):
                naics_id = _clean_guid(naics.get("new_naicsid"))
                if not naics_id:
                    continue

                naics_codes[naics_id] = _normalize_naics_codes(
                    naics.get(code_field)
                )

            url = payload.get("@odata.nextLink")

    return naics_codes


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
        "$filter=(websiteurl eq null or telephone1 eq null) and address1_country eq 'United States'&"
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


def normalize_pe_client_record(account: dict):
    return {
        "account_id": account.get("accountid", ""),
        "client_name": account.get("name", ""),
        "city": account.get("address1_city", ""),
        "state": account.get("address1_stateorprovince", ""),
        "users": len(account.get("new_account_contact") or []),
        "contract_expiration": account.get("cr73c_softwarecontractexpirationdate"),
    }


async def get_pe_clients(limit: int | None = None):
    client_limit = max(1, min(limit or PE_CLIENT_DEFAULT_LIMIT, PE_CLIENT_MAX_LIMIT))
    token = await get_access_token()
    url = (
        f"{API_URL}/accounts?"
        "$select=accountid,name,address1_city,address1_stateorprovince,"
        "cr73c_softwarecontractexpirationdate&"
        "$expand=new_account_contact($select=contactid)&"
        "$filter=new_client eq true&"
        "$orderby=name asc&"
        f"$top={client_limit}"
    )
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0",
        "Prefer": "odata.maxpagesize=5000",
    }
    accounts = []
    next_url = url

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(PE_CLIENT_REQUEST_TIMEOUT_SECONDS)) as client:
            while next_url and len(accounts) < client_limit:
                response = await client.get(next_url, headers=headers)

                if response.status_code != 200:
                    raise Exception(f"Dynamics GET error: {response.text}")

                payload = response.json()
                accounts.extend(payload.get("value", []))
                next_url = payload.get("@odata.nextLink")
    except httpx.TimeoutException as exc:
        raise Exception(
            f"Dynamics request timed out after {PE_CLIENT_REQUEST_TIMEOUT_SECONDS} seconds while loading PE clients"
        ) from exc

    return [normalize_pe_client_record(account) for account in accounts[:client_limit]]


async def create_pe_client(client_details: dict):
    token = await get_access_token()
    url = f"{API_URL}/accounts"
    payload = {
        "name": client_details["client_name"],
        "address1_city": client_details.get("city") or None,
        "address1_stateorprovince": client_details.get("state") or None,
        "cr73c_softwarecontractexpirationdate": client_details.get("contract_expiration") or None,
        "new_client": True,
    }
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "OData-Version": "4.0",
        "Prefer": "return=representation",
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(PE_CLIENT_REQUEST_TIMEOUT_SECONDS)) as client:
        response = await client.post(url, headers=headers, json=payload)

    if response.status_code not in (200, 201, 204):
        raise Exception(f"Dynamics CREATE error: {response.text}")

    account = response.json() if response.status_code != 204 else payload
    if response.status_code == 204:
        entity_url = response.headers.get("OData-EntityId", "")
        account["accountid"] = entity_url.rsplit("(", 1)[-1].rstrip(")") if entity_url else ""

    return normalize_pe_client_record(account)


async def create_pe_client_user(user_details: dict):
    token = await get_access_token()
    account_id = user_details["account_id"]
    url = f"{API_URL}/contacts"
    payload = {
        "firstname": user_details["first_name"],
        "lastname": user_details["last_name"],
        "emailaddress1": user_details["email"],
        "telephone1": user_details.get("phone") or None,
        "adx_identity_username": user_details.get("username") or user_details["email"],
        "adx_identity_newpassword": user_details["password"],
        "adx_identity_logonenabled": True,
        "new_client@odata.bind": f"/accounts({account_id})",
        "parentcustomerid_account@odata.bind": f"/accounts({account_id})",
    }
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "OData-Version": "4.0",
        "Prefer": "return=representation",
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(PE_CLIENT_REQUEST_TIMEOUT_SECONDS)) as client:
        response = await client.post(url, headers=headers, json=payload)

    if response.status_code not in (200, 201, 204):
        raise Exception(f"Dynamics CREATE contact error: {response.text}")

    contact = response.json() if response.status_code != 204 else payload
    return {
        "contact_id": contact.get("contactid", ""),
        "account_id": account_id,
        "first_name": contact.get("firstname", user_details["first_name"]),
        "last_name": contact.get("lastname", user_details["last_name"]),
        "email": contact.get("emailaddress1", user_details["email"]),
        "phone": contact.get("telephone1", user_details.get("phone") or ""),
        "username": contact.get(
            "adx_identity_username",
            user_details.get("username") or user_details["email"],
        ),
    }


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
        raise DynamicsApiError(f"Dynamics UPDATE error: {response.text}", response.status_code)

    return True


ENRICHMENT_ACCOUNT_FIELDS = (
    "accountid,name,websiteurl,telephone1,description,numberofemployees,"
    "address1_city,address1_stateorprovince,address1_country,"
    "cr73c_enrichmentattempted"
)
ENRICHMENT_FIELD_NAMES = (
    "websiteurl",
    "telephone1",
    "description",
    "numberofemployees",
    "address1_city",
    "address1_stateorprovince",
    "address1_country",
)


def _is_blank(value: object) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _normalise_enrichment_value(field_name: str, value: object) -> object | None:
    if _is_blank(value):
        return None
    if field_name == "numberofemployees":
        try:
            return int(str(value).replace(",", ""))
        except (TypeError, ValueError):
            logger.warning("Ignoring invalid Seamless employee count: %r", value)
            return None
    return str(value).strip() if isinstance(value, str) else value


async def _mark_enrichment_attempted(account_id: str, updates: dict[str, object]) -> None:
    """Set the required attempt flag and include the optional timestamp when available."""
    attempt_updates = {
        **updates,
        "cr73c_enrichmentattempted": True,
        "cr73c_enrichmentlastattemptedon": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    try:
        await update_account(account_id, attempt_updates)
    except DynamicsApiError as exc:
        if exc.status_code != 400:
            raise
        # Some Dataverse environments do not have the optional timestamp field.
        # Retry without it so the required attempt flag is never lost for that reason.
        logger.warning("Could not update optional enrichment timestamp for %s: %s", account_id, exc)
        attempt_updates.pop("cr73c_enrichmentlastattemptedon")
        await update_account(account_id, attempt_updates)


async def enrich_one_account(account_id: str) -> dict[str, object]:
    """Enrich one Account for the Power Automate trigger without overwriting data."""
    try:
        account = await get_account(account_id, ENRICHMENT_ACCOUNT_FIELDS)
    except Exception as exc:
        logger.exception("Enrichment failed while fetching Dynamics account %s", account_id)
        return {
            "account_id": account_id,
            "account_name": None,
            "status": "failed",
            "fields_updated": [],
            "skipped_reason": f"Unable to fetch Dynamics account: {exc}",
        }

    account_name = account.get("name")
    if account.get("cr73c_enrichmentattempted") is True:
        logger.info("Enrichment skipped for account_id=%s name=%r: already attempted", account_id, account_name)
        return {
            "account_id": account_id,
            "account_name": account_name,
            "status": "skipped_already_attempted",
            "fields_updated": [],
            "skipped_reason": "Enrichment has already been attempted for this account.",
        }

    if not account_name:
        try:
            await _mark_enrichment_attempted(account_id, {})
        except Exception:
            logger.exception("Could not mark nameless account attempted for account_id=%s", account_id)
            return {
                "account_id": account_id,
                "account_name": account_name,
                "status": "failed",
                "fields_updated": [],
                "skipped_reason": "Unable to update Dynamics account.",
            }
        logger.info("Enrichment no_match for account_id=%s: account has no name", account_id)
        return {
            "account_id": account_id,
            "account_name": account_name,
            "status": "no_match",
            "fields_updated": [],
            "skipped_reason": "Account has no name to search.",
        }

    if not os.getenv("SEAMLESS_API_KEY"):
        logger.error("Seamless enrichment cannot run for account_id=%s: SEAMLESS_API_KEY is not configured", account_id)
        try:
            await _mark_enrichment_attempted(account_id, {})
        except Exception:
            logger.exception("Could not mark unconfigured enrichment attempted for account_id=%s", account_id)
        return {
            "account_id": account_id,
            "account_name": account_name,
            "status": "failed",
            "fields_updated": [],
            "skipped_reason": "Seamless enrichment is not configured.",
        }

    if not can_make_request():
        logger.warning("Enrichment skipped for account_id=%s name=%r: weekly credit limit reached", account_id, account_name)
        return {
            "account_id": account_id,
            "account_name": account_name,
            "status": "skipped_credit_limit",
            "fields_updated": [],
            "skipped_reason": f"Weekly Seamless credit limit ({WEEKLY_LIMIT}) has been reached.",
        }

    try:
        # A credit is consumed once a Seamless request is attempted, even if it has no match or errors.
        try:
            seamless_data = await enrich_with_seamless(account)
        finally:
            usage = increment_usage()
            logger.info("Seamless credit used for account_id=%s; usage=%s/%s", account_id, usage.get("credits_used"), WEEKLY_LIMIT)
    except Exception as exc:
        logger.exception("Seamless enrichment failed for account_id=%s name=%r", account_id, account_name)
        try:
            await _mark_enrichment_attempted(account_id, {})
        except Exception:
            logger.exception("Could not mark failed enrichment attempted for account_id=%s", account_id)
        return {
            "account_id": account_id,
            "account_name": account_name,
            "status": "failed",
            "fields_updated": [],
            "skipped_reason": "Seamless enrichment request failed.",
        }

    updates: dict[str, object] = {}
    for field_name in ENRICHMENT_FIELD_NAMES:
        value = _normalise_enrichment_value(field_name, seamless_data.get(field_name))
        if _is_blank(account.get(field_name)) and value is not None:
            updates[field_name] = value

    try:
        await _mark_enrichment_attempted(account_id, updates)
    except Exception as exc:
        logger.exception("Dynamics update failed for account_id=%s name=%r", account_id, account_name)
        return {
            "account_id": account_id,
            "account_name": account_name,
            "status": "failed",
            "fields_updated": [],
            "skipped_reason": "Unable to update Dynamics account.",
        }

    if not seamless_data:
        result_status = "no_match"
    elif updates:
        result_status = "updated"
    else:
        result_status = "no_updates_needed"
    logger.info("Enrichment %s for account_id=%s name=%r fields=%s", result_status, account_id, account_name, list(updates))
    return {
        "account_id": account_id,
        "account_name": account_name,
        "status": result_status,
        "fields_updated": list(updates),
        "skipped_reason": None,
    }


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
    print("✅ Proceeding with enrichment")

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

    confidence_score = int(seamless_data.get("confidence_score", 0))
    matched_fields = seamless_data.get("matched_fields", [])
    if confidence_score < 60 or not seamless_data.get("meets_confidence_threshold", False):
        return {
            "account_id": account_id,
            "updated": False,
            "skipped": True,
            "reason": "Match confidence below 60%",
            "confidence_score": confidence_score,
            "matched_fields": matched_fields,
        }

    updates = {}

    # WEBSITE
    website = seamless_data.get("websiteurl")
    if should_update_field("websiteurl", requested_fields) and not account.get("websiteurl") and website:
        if not website.startswith("http"):
            website = f"https://{website}"
        updates["websiteurl"] = website

    # PHONE
    phone = seamless_data.get("telephone1")
    if should_update_field("telephone1", requested_fields) and not account.get("telephone1") and phone:
        updates["telephone1"] = phone

    # STATE
    state = seamless_data.get("address1_stateorprovince")
    print(f"📍 Raw state: {state}")
    if should_update_field("address1_stateorprovince", requested_fields) and state:
        state_clean = state.strip()
        state_abbr = normalize_state_province(state_clean) or state_clean
        print(f"📍 Converted state: {state_abbr}")
        if not account.get("address1_stateorprovince"):
            updates["address1_stateorprovince"] = state_abbr

    # COUNTRY
    country = seamless_data.get("address1_country")
    if should_update_field("address1_country", requested_fields) and not account.get("address1_country") and country:
        updates["address1_country"] = country

    # EMPLOYEES
    employees = seamless_data.get("numberofemployees")
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

    city = seamless_data.get("address1_city")
    if not account.get("address1_city") and city:
        updates["address1_city"] = city

    if updates:
        print(f"🚀 Updating: {updates}")
        await update_account(account_id, updates)
        log_update(company_name, updates)

    return {
        "account_id": account_id,
        "updated": bool(updates),
        "updates": updates or None,
        "confidence_score": confidence_score,
        "matched_fields": matched_fields,
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
    skipped_count = sum(1 for result in results if result.get("skipped"))

    return {
        "processed": len(results),
        "updated": updated_count,
        "skipped": skipped_count,
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
