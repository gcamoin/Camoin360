import os
import json
import re
from calendar import monthrange
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from ..database import get_database_connection

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = Path(__file__).resolve().parents[2]

load_dotenv(REPO_ROOT / ".env")
load_dotenv(BACKEND_ROOT / ".env")

HARVEST_ACCESS_TOKEN = os.getenv("HARVEST_ACCESS_TOKEN")
HARVEST_ACCOUNT_ID = os.getenv("HARVEST_ACCOUNT_ID")
HARVEST_API_BASE = os.getenv("HARVEST_API_BASE", "https://api.harvestapp.com/v2").rstrip("/")
HARVEST_WINDOW_WEEKS = 12
EMPLOYEE_PRODUCTIVITY_SYNC_STALE_SECONDS = int(os.getenv("EMPLOYEE_PRODUCTIVITY_SYNC_STALE_SECONDS", "1800"))
PROSPECT_ENGAGE_PATTERN = re.compile(r"\b(?:prospect\s*engage|prospect-?engage|pe)\b", re.IGNORECASE)
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
    time_entries = []
    page = 1
    total_pages = 1

    async with httpx.AsyncClient(timeout=30) as client:
        while page <= total_pages:
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
            data = response.json()

            time_entries.extend(data.get("time_entries", []))
            total_pages = int(data.get("total_pages") or 1)
            page += 1

    return time_entries


async def _load_employee_weekly_hours_from_harvest(year=None, month=None):
    if year and month:
        start_date = date(year, month, 1)
        end_date = date(year, month, monthrange(year, month)[1])
    elif year:
        start_date = date(year, 1, 1)
        end_date = date(year, 12, 31)
    else:
        end_date = date.today()
        start_date = end_date - timedelta(weeks=HARVEST_WINDOW_WEEKS) + timedelta(days=1)

    average_weeks = max((end_date - start_date).days + 1, 1) / 7
    hours_by_employee = defaultdict(lambda: {"billable": 0.0, "non_billable": 0.0})
    utilization_hours_by_employee = defaultdict(lambda: {"billable": 0.0, "non_billable": 0.0})

    for time_entry in await _fetch_time_entries(start_date, end_date):
        employee_name = _get_user_name(time_entry)
        hours = float(time_entry.get("hours") or 0)
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
        "from": start_date.isoformat(),
        "to": end_date.isoformat(),
        "weeks": round(average_weeks, 2),
        "scope": "consulting",
        "excluded_scope": "prospect_engage",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _employee_productivity_cache_key(year=None, month=None) -> str:
    return f"{year or 'rolling'}:{month or 'all'}"


def _employee_productivity_empty_payload(year=None, month=None) -> dict:
    if year and month:
        start_date = date(year, month, 1)
        end_date = date(year, month, monthrange(year, month)[1])
    elif year:
        start_date = date(year, 1, 1)
        end_date = date(year, 12, 31)
    else:
        end_date = date.today()
        start_date = end_date - timedelta(weeks=HARVEST_WINDOW_WEEKS) + timedelta(days=1)

    return {
        "employees": [],
        "utilization_employees": [],
        "from": start_date.isoformat(),
        "to": end_date.isoformat(),
        "weeks": round(max((end_date - start_date).days + 1, 1) / 7, 2),
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

    return (datetime.now(timezone.utc) - started_time).total_seconds() <= EMPLOYEE_PRODUCTIVITY_SYNC_STALE_SECONDS


def get_employee_weekly_hours(year=None, month=None):
    cache_key = _employee_productivity_cache_key(year, month)
    cache_row = _get_employee_productivity_cache_row(cache_key)
    if cache_row:
        try:
            payload = json.loads(cache_row.get("payload") or "{}")
        except json.JSONDecodeError:
            payload = _employee_productivity_empty_payload(year, month)
    else:
        payload = _employee_productivity_empty_payload(year, month)

    sync_status = cache_row.get("status") if cache_row else "idle"
    if sync_status == "syncing" and not _is_employee_productivity_sync_active(cache_row):
        sync_status = "idle"

    payload_has_rows = _employee_productivity_payload_has_rows(payload)
    return {
        **payload,
        "sync": {
            "status": sync_status,
            "last_started_at": cache_row.get("last_started_at") if cache_row else None,
            "last_completed_at": cache_row.get("last_completed_at") if cache_row else None,
            "last_error": cache_row.get("last_error") if cache_row else "",
            "is_stale": _is_employee_productivity_cache_stale(cache_row) or not payload_has_rows,
            "has_rows": payload_has_rows,
        },
    }


async def refresh_employee_weekly_hours_cache(year=None, month=None) -> dict:
    cache_key = _employee_productivity_cache_key(year, month)
    started_at = datetime.now(timezone.utc).isoformat()
    with get_database_connection() as connection:
        connection.execute(
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
            """,
            (cache_key, json.dumps(_employee_productivity_empty_payload(year, month)), started_at),
        )

    try:
        payload = await _load_employee_weekly_hours_from_harvest(year=year, month=month)
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
                WHERE cache_key = ?
                """,
                (json.dumps(payload), completed_at, cache_key),
            )
        return get_employee_weekly_hours(year=year, month=month)
    except Exception as exc:
        with get_database_connection() as connection:
            connection.execute(
                """
                UPDATE employee_productivity_cache
                SET status = 'error',
                    last_error = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE cache_key = ?
                """,
                (str(exc), cache_key),
            )
        raise


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
