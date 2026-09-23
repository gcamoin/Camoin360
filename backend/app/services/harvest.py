import os
import json
import re
import asyncio
from calendar import monthrange
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from ..database import get_database_connection
from .reporting_period import reporting_days, matches_reporting_date

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = Path(__file__).resolve().parents[2]

load_dotenv(REPO_ROOT / ".env")
load_dotenv(BACKEND_ROOT / ".env")

HARVEST_ACCESS_TOKEN = os.getenv("HARVEST_ACCESS_TOKEN")
HARVEST_ACCOUNT_ID = os.getenv("HARVEST_ACCOUNT_ID")
HARVEST_API_BASE = os.getenv("HARVEST_API_BASE", "https://api.harvestapp.com/v2").rstrip("/")
HARVEST_HISTORY_START_DATE = date.fromisoformat(os.getenv("HARVEST_HISTORY_START_DATE", "2022-01-01"))
EMPLOYEE_PRODUCTIVITY_SYNC_STALE_SECONDS = int(os.getenv("EMPLOYEE_PRODUCTIVITY_SYNC_STALE_SECONDS", "1800"))
EMPLOYEE_PRODUCTIVITY_SYNC_TIMEOUT_SECONDS = 300
EMPLOYEE_PRODUCTIVITY_SYNC_LEASE_SECONDS = 360
PROSPECT_ENGAGE_PATTERN = re.compile(r"\b(?:prospect\s*engage|prospect-?engage|pe)\b", re.IGNORECASE)
PROPOSAL_PREP_PATTERN = re.compile(r"\bproposal[\s_-]+prep(?:aration)?\b", re.IGNORECASE)
DEFAULT_PROSPECT_ENGAGE_EMPLOYEE_NAMES = {"garrett", "jacob"}
PROSPECT_ENGAGE_EMPLOYEE_NAMES = DEFAULT_PROSPECT_ENGAGE_EMPLOYEE_NAMES | {
    name.strip().lower()
    for name in os.getenv("HARVEST_PROSPECT_ENGAGE_EMPLOYEES", "").split(",")
    if name.strip()
}
UTILIZATION_EMPLOYEE_LAST_NAMES = {
    "mcconnell",
    "walker",
    "otterby",
    "hallowell",
    "mcniff",
    "byrnes",
    "johnson",
    "tranmer",
    "dworetsky",
    "black",
    "wittek",
    "damicis",
    "kirk",
    "booker",
    "gundersen",
    "selsky",
    "franzi",
}


def _get_harvest_headers():
    if not HARVEST_ACCESS_TOKEN:
        raise RuntimeError("HARVEST_ACCESS_TOKEN is not configured.")

    if not HARVEST_ACCOUNT_ID:
        raise RuntimeError("HARVEST_ACCOUNT_ID is not configured.")

    return {
        "Authorization": f"Bearer {HARVEST_ACCESS_TOKEN}",
        "Harvest-Account-ID": HARVEST_ACCOUNT_ID,
        "User-Agent": "dynamics-enrichment-dashboard",
    }


def _get_user_name(time_entry):
    user = time_entry.get("user") or {}
    return user.get("name") or "Unknown Employee"


def _normalize_name_part(value):
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def _get_employee_last_name(time_entry):
    name_parts = str(_get_user_name(time_entry) or "").strip().split()
    if not name_parts:
        return ""
    return _normalize_name_part(name_parts[-1])


def _is_billable_time_entry(time_entry):
    task_assignment = time_entry.get("task_assignment") or {}

    if isinstance(task_assignment.get("billable"), bool):
        return task_assignment["billable"]

    if isinstance(time_entry.get("billable"), bool):
        return time_entry["billable"]

    return False


def _get_nested_name(time_entry, field_name):
    field = time_entry.get(field_name) or {}
    if isinstance(field, dict):
        return field.get("name") or ""
    return ""


def _is_prospect_engage_time_entry(time_entry):
    employee_name = _get_user_name(time_entry).strip().lower()
    employee_first_name = employee_name.split(" ", 1)[0]
    if employee_name in PROSPECT_ENGAGE_EMPLOYEE_NAMES or employee_first_name in PROSPECT_ENGAGE_EMPLOYEE_NAMES:
        return True

    searchable_values = [
        _get_nested_name(time_entry, "client"),
        _get_nested_name(time_entry, "project"),
        _get_nested_name(time_entry, "task"),
        _get_nested_name(time_entry, "task_assignment"),
        str(time_entry.get("notes") or ""),
    ]
    return any(PROSPECT_ENGAGE_PATTERN.search(value) for value in searchable_values if value)


def _is_consulting_time_entry(time_entry):
    return not _is_prospect_engage_time_entry(time_entry)


def _is_utilization_employee_time_entry(time_entry):
    return _get_employee_last_name(time_entry) in UTILIZATION_EMPLOYEE_LAST_NAMES


def _build_employee_hours_rows(hours_by_employee: dict, average_weeks: float) -> list[dict]:
    employees = []
    for employee_name, hours in hours_by_employee.items():
        total_hours = hours["billable"] + hours["non_billable"]
        utilization_rate = (hours["billable"] / total_hours) * 100 if total_hours else 0
        employees.append(
            {
                "employee": employee_name,
                "average_weekly_billable_hours": round(hours["billable"] / average_weeks, 2),
                "average_weekly_non_billable_hours": round(hours["non_billable"] / average_weeks, 2),
                "average_weekly_hours": round(total_hours / average_weeks, 2),
                "billable_hours": round(hours["billable"], 2),
                "non_billable_hours": round(hours["non_billable"], 2),
                "total_hours": round(total_hours, 2),
                "utilization_rate": round(utilization_rate, 2),
            }
        )
    employees.sort(key=lambda employee: employee["average_weekly_hours"], reverse=True)
    return employees


async def _fetch_time_entries(start_date, end_date):
    async with httpx.AsyncClient(timeout=30) as client:
        async def fetch_page(page):
            response = await client.get(
                f"{HARVEST_API_BASE}/time_entries",
                headers=_get_harvest_headers(),
                params={
                    "from": start_date.isoformat(),
                    "to": end_date.isoformat(),
                    "page": page,
                    "per_page": 2000,
                },
            )
            response.raise_for_status()
            return response.json()

        first_page = await fetch_page(1)
        time_entries = list(first_page.get("time_entries", []))
        total_pages = int(first_page.get("total_pages") or 1)
        # Bound concurrency so large histories do not create a request burst.
        for first in range(2, total_pages + 1, 4):
            pages = await asyncio.gather(*(
                fetch_page(page) for page in range(first, min(first + 4, total_pages + 1))
            ))
            for data in pages:
                time_entries.extend(data.get("time_entries", []))

    return time_entries


async def _load_employee_weekly_hours_from_harvest(year=None, month=None, reporting_filters=None):
    if year and month:
        start_date = date(year, month, 1)
        end_date = date(year, month, monthrange(year, month)[1])
    elif year:
        start_date = date(year, 1, 1)
        end_date = min(date(year, 12, 31), date.today())
    else:
        end_date = date.today()
        start_date = HARVEST_HISTORY_START_DATE

    days = None
    if reporting_filters:
        days = reporting_days(HARVEST_HISTORY_START_DATE, year=year, month=month, **reporting_filters)
        if not days:
            return _employee_productivity_empty_payload(year, month, reporting_filters)
        start_date, end_date = days[0], days[-1]
    average_weeks = max(len(days) if days is not None else (end_date - start_date).days + 1, 1) / 7
    hours_by_employee = defaultdict(lambda: {"billable": 0.0, "non_billable": 0.0})
    utilization_hours_by_employee = defaultdict(lambda: {"billable": 0.0, "non_billable": 0.0})
    proposal_prep_hours_by_employee = defaultdict(lambda: {"billable": 0.0, "non_billable": 0.0})

    for time_entry in await _fetch_time_entries(start_date, end_date):
        if reporting_filters and not matches_reporting_date(time_entry.get("spent_date"), year=year, month=month, **reporting_filters):
            continue
        employee_name = _get_user_name(time_entry)
        hours = float(time_entry.get("hours") or 0)
        project_name = _get_nested_name(time_entry, "project")
        is_proposal_prep = (
            PROPOSAL_PREP_PATTERN.search(_get_nested_name(time_entry, "task"))
            or PROPOSAL_PREP_PATTERN.search(project_name)
        )
        if is_proposal_prep and not PROSPECT_ENGAGE_PATTERN.search(project_name):
            billing_key = "billable" if _is_billable_time_entry(time_entry) else "non_billable"
            proposal_prep_hours_by_employee[employee_name][billing_key] += hours
        if _is_billable_time_entry(time_entry):
            hours_by_employee[employee_name]["billable"] += hours
        else:
            hours_by_employee[employee_name]["non_billable"] += hours

        if _is_utilization_employee_time_entry(time_entry) and _is_consulting_time_entry(time_entry):
            if _is_billable_time_entry(time_entry):
                utilization_hours_by_employee[employee_name]["billable"] += hours
            else:
                utilization_hours_by_employee[employee_name]["non_billable"] += hours

    return {
        "employees": _build_employee_hours_rows(hours_by_employee, average_weeks),
        "utilization_employees": _build_employee_hours_rows(utilization_hours_by_employee, average_weeks),
        "proposal_prep_employees": _build_employee_hours_rows(proposal_prep_hours_by_employee, average_weeks),
        "proposal_prep_version": 1,
        "from": start_date.isoformat(),
        "to": end_date.isoformat(),
        "weeks": round(average_weeks, 2),
        "scope": "consulting",
        "excluded_scope": "prospect_engage",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _employee_productivity_cache_key(year=None, month=None, reporting_filters=None) -> str:
    base = f"{year or 'history'}:{month or 'all'}"
    return f"{base}:{json.dumps(reporting_filters, sort_keys=True, default=str)}" if reporting_filters else base


def _employee_productivity_empty_payload(year=None, month=None, reporting_filters=None) -> dict:
    if year and month:
        start_date = date(year, month, 1)
        end_date = date(year, month, monthrange(year, month)[1])
    elif year:
        start_date = date(year, 1, 1)
        end_date = min(date(year, 12, 31), date.today())
    else:
        end_date = date.today()
        start_date = HARVEST_HISTORY_START_DATE

    days = reporting_days(HARVEST_HISTORY_START_DATE, year=year, month=month, **reporting_filters) if reporting_filters else None
    if days:
        start_date, end_date = days[0], days[-1]
    return {
        "employees": [],
        "utilization_employees": [],
        "proposal_prep_employees": [],
        "proposal_prep_version": 1,
        "from": start_date.isoformat() if days != [] else "",
        "to": end_date.isoformat() if days != [] else "",
        "weeks": round(max(len(days) if days is not None else (end_date - start_date).days + 1, 1) / 7, 2),
        "scope": "consulting",
        "excluded_scope": "prospect_engage",
        "updated_at": "",
    }


def _get_employee_productivity_cache_row(cache_key: str) -> dict | None:
    with get_database_connection() as connection:
        row = connection.execute(
            """
            SELECT cache_key, payload, status, last_started_at, last_completed_at, last_error
            FROM employee_productivity_cache
            WHERE cache_key = ?
            """,
            (cache_key,),
        ).fetchone()

    return dict(row) if row else None


def _is_employee_productivity_cache_stale(cache_row: dict | None) -> bool:
    if not cache_row or not cache_row.get("last_completed_at"):
        return True

    try:
        completed_time = datetime.fromisoformat(str(cache_row["last_completed_at"]).replace("Z", "+00:00"))
    except ValueError:
        return True

    if completed_time.tzinfo is None:
        completed_time = completed_time.replace(tzinfo=timezone.utc)

    return (datetime.now(timezone.utc) - completed_time).total_seconds() > EMPLOYEE_PRODUCTIVITY_SYNC_STALE_SECONDS


def _employee_productivity_payload_has_rows(payload: dict) -> bool:
    return bool(payload.get("employees") or payload.get("utilization_employees"))


def _is_employee_productivity_sync_active(cache_row: dict | None) -> bool:
    if not cache_row or cache_row.get("status") != "syncing" or not cache_row.get("last_started_at"):
        return False

    try:
        started_time = datetime.fromisoformat(str(cache_row["last_started_at"]).replace("Z", "+00:00"))
    except ValueError:
        return False

    if started_time.tzinfo is None:
        started_time = started_time.replace(tzinfo=timezone.utc)

    return (datetime.now(timezone.utc) - started_time).total_seconds() <= EMPLOYEE_PRODUCTIVITY_SYNC_LEASE_SECONDS


def get_employee_weekly_hours(year=None, month=None, reporting_filters=None):
    cache_key = _employee_productivity_cache_key(year, month, reporting_filters)
    cache_row = _get_employee_productivity_cache_row(cache_key)
    if cache_row:
        try:
            payload = json.loads(cache_row.get("payload") or "{}")
        except json.JSONDecodeError:
            payload = _employee_productivity_empty_payload(year, month, reporting_filters)
    else:
        payload = _employee_productivity_empty_payload(year, month, reporting_filters)

    sync_status = cache_row.get("status") if cache_row else "idle"
    last_error = cache_row.get("last_error") if cache_row else ""
    if sync_status == "syncing" and not _is_employee_productivity_sync_active(cache_row):
        sync_status = "error"
        last_error = "Harvest sync was interrupted. Select Refresh to retry."

    payload_has_rows = _employee_productivity_payload_has_rows(payload)
    return {
        **payload,
        "sync": {
            "status": sync_status,
            "last_started_at": cache_row.get("last_started_at") if cache_row else None,
            "last_completed_at": cache_row.get("last_completed_at") if cache_row else None,
            "last_error": last_error,
            "is_stale": _is_employee_productivity_cache_stale(cache_row) or payload.get("proposal_prep_version") != 1,
            "has_rows": payload_has_rows,
        },
    }


async def refresh_employee_weekly_hours_cache(year=None, month=None, reporting_filters=None) -> dict:
    cache_key = _employee_productivity_cache_key(year, month, reporting_filters)
    started_at = datetime.now(timezone.utc).isoformat()
    expired_before = (datetime.now(timezone.utc) - timedelta(seconds=EMPLOYEE_PRODUCTIVITY_SYNC_LEASE_SECONDS)).isoformat()
    with get_database_connection() as connection:
        claimed = connection.execute(
            """
            INSERT INTO employee_productivity_cache (
                cache_key, payload, status, last_started_at, last_error, updated_at
            )
            VALUES (?, ?, 'syncing', ?, '', CURRENT_TIMESTAMP)
            ON CONFLICT(cache_key) DO UPDATE SET
                status = 'syncing',
                last_started_at = excluded.last_started_at,
                last_error = '',
                updated_at = CURRENT_TIMESTAMP
            WHERE employee_productivity_cache.status != 'syncing'
                OR employee_productivity_cache.last_started_at IS NULL
                OR employee_productivity_cache.last_started_at < ?
            RETURNING cache_key
            """,
            (cache_key, json.dumps(_employee_productivity_empty_payload(year, month, reporting_filters)), started_at, expired_before),
        ).fetchone()

    if not claimed:
        return get_employee_weekly_hours(year=year, month=month, reporting_filters=reporting_filters)

    try:
        payload = await asyncio.wait_for(
            _load_employee_weekly_hours_from_harvest(year=year, month=month, **({"reporting_filters": reporting_filters} if reporting_filters else {})),
            timeout=EMPLOYEE_PRODUCTIVITY_SYNC_TIMEOUT_SECONDS,
        )
        completed_at = datetime.now(timezone.utc).isoformat()
        with get_database_connection() as connection:
            connection.execute(
                """
                UPDATE employee_productivity_cache
                SET payload = ?,
                    status = 'idle',
                    last_completed_at = ?,
                    last_error = '',
                    updated_at = CURRENT_TIMESTAMP
                WHERE cache_key = ? AND last_started_at = ?
                """,
                (json.dumps(payload), completed_at, cache_key, started_at),
            )
        return get_employee_weekly_hours(year=year, month=month, reporting_filters=reporting_filters)
    except Exception as exc:
        with get_database_connection() as connection:
            connection.execute(
                """
                UPDATE employee_productivity_cache
                SET status = 'error',
                    last_error = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE cache_key = ? AND last_started_at = ?
                """,
                (str(exc) or "Harvest sync timed out. Select Refresh to retry.", cache_key, started_at),
            )
        raise


def run_employee_weekly_hours_refresh(year=None, month=None, reporting_filters=None):
    # A synchronous background task runs in FastAPI's thread pool, isolating
    # database access and large JSON responses from HTTP request handling.
    return asyncio.run(refresh_employee_weekly_hours_cache(year, month, reporting_filters))


async def get_billable_breakdown(year, month=None):
    if month:
        start_date = date(year, month, 1)
        end_date = date(year, month, monthrange(year, month)[1])
    else:
        start_date = date(year, 1, 1)
        end_date = date(year, 12, 31)

    billable_hours = 0.0
    non_billable_hours = 0.0

    for time_entry in await _fetch_time_entries(start_date, end_date):
        if not _is_consulting_time_entry(time_entry):
            continue

        hours = float(time_entry.get("hours") or 0)

        if _is_billable_time_entry(time_entry):
            billable_hours += hours
        else:
            non_billable_hours += hours

    billable_hours = round(billable_hours, 2)
    non_billable_hours = round(non_billable_hours, 2)

    return {
        "billable_hours": billable_hours,
        "non_billable_hours": non_billable_hours,
        "total_hours": round(billable_hours + non_billable_hours, 2),
        "scope": "consulting",
        "excluded_scope": "prospect_engage",
    }
