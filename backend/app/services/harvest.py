import os
from calendar import monthrange
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

import httpx
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = Path(__file__).resolve().parents[2]

load_dotenv(REPO_ROOT / ".env")
load_dotenv(BACKEND_ROOT / ".env")

HARVEST_ACCESS_TOKEN = os.getenv("HARVEST_ACCESS_TOKEN")
HARVEST_ACCOUNT_ID = os.getenv("HARVEST_ACCOUNT_ID")
HARVEST_API_BASE = os.getenv("HARVEST_API_BASE", "https://api.harvestapp.com/v2").rstrip("/")
HARVEST_WINDOW_WEEKS = 12


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


def _is_billable_time_entry(time_entry):
    task_assignment = time_entry.get("task_assignment") or {}

    if isinstance(task_assignment.get("billable"), bool):
        return task_assignment["billable"]

    if isinstance(time_entry.get("billable"), bool):
        return time_entry["billable"]

    return False


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


async def get_employee_weekly_hours(year=None, month=None):
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
    total_hours_by_employee = defaultdict(float)

    for time_entry in await _fetch_time_entries(start_date, end_date):
        employee_name = _get_user_name(time_entry)
        total_hours_by_employee[employee_name] += float(time_entry.get("hours") or 0)

    employees = [
        {
            "employee": employee_name,
            "average_weekly_hours": round(total_hours / average_weeks, 2),
            "total_hours": round(total_hours, 2),
        }
        for employee_name, total_hours in total_hours_by_employee.items()
    ]
    employees.sort(key=lambda employee: employee["average_weekly_hours"], reverse=True)

    return {
        "employees": employees,
        "from": start_date.isoformat(),
        "to": end_date.isoformat(),
        "weeks": round(average_weeks, 2),
        "updated_at": datetime.utcnow().isoformat(),
    }


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
    }
