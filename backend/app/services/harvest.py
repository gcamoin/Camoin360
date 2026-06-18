import os
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


async def get_employee_weekly_hours():
    end_date = date.today()
    start_date = end_date - timedelta(weeks=HARVEST_WINDOW_WEEKS) + timedelta(days=1)
    total_hours_by_employee = defaultdict(float)
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

            for time_entry in data.get("time_entries", []):
                employee_name = _get_user_name(time_entry)
                total_hours_by_employee[employee_name] += float(time_entry.get("hours") or 0)

            total_pages = int(data.get("total_pages") or 1)
            page += 1

    employees = [
        {
            "employee": employee_name,
            "average_weekly_hours": round(total_hours / HARVEST_WINDOW_WEEKS, 2),
            "total_hours": round(total_hours, 2),
        }
        for employee_name, total_hours in total_hours_by_employee.items()
    ]
    employees.sort(key=lambda employee: employee["average_weekly_hours"], reverse=True)

    return {
        "employees": employees,
        "from": start_date.isoformat(),
        "to": end_date.isoformat(),
        "weeks": HARVEST_WINDOW_WEEKS,
        "updated_at": datetime.utcnow().isoformat(),
    }
