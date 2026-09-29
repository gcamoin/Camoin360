"""Weekly subscriber observations reported as the latest count for each month."""
import asyncio
from datetime import datetime, timedelta, timezone
import logging
import os
from zoneinfo import ZoneInfo

import httpx

from ..database import get_database_connection, initialize_database
from .auth import get_access_token

SEGMENT_DEFINITION_ID = "32d99679-2af5-ef11-be20-7c1e520d6c2f"
SEGMENT_NAME = "Economic Navigator Newsletter (Real Time)"
REPORTING_ZONE = ZoneInfo("America/New_York")
logger = logging.getLogger(__name__)


def weekly_snapshot_at(now):
    local = now.astimezone(REPORTING_ZONE)
    return (local - timedelta(days=local.weekday())).replace(hour=9, minute=0, second=0, microsecond=0)


def next_snapshot_at(now):
    scheduled = weekly_snapshot_at(now)
    return scheduled if now < scheduled else scheduled + timedelta(days=7)


def read_snapshots():
    with get_database_connection() as connection:
        rows = connection.execute(
            """SELECT snapshot_key, subscriber_count, captured_at, segment_name
               FROM newsletter_subscriber_observations
               WHERE segment_definition_id = ? ORDER BY captured_at""",
            (SEGMENT_DEFINITION_ID,),
        ).fetchall()
    return [{**dict(row), "period_key": datetime.fromisoformat(row["captured_at"]).astimezone(REPORTING_ZONE).date().isoformat()} for row in rows]


def save_snapshot(count, name, captured_at, snapshot_key=None):
    with get_database_connection() as connection:
        connection.execute(
            """INSERT INTO newsletter_subscriber_observations
               (segment_definition_id, snapshot_key, subscriber_count, captured_at, segment_name)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT (segment_definition_id, snapshot_key) DO NOTHING""",
            (SEGMENT_DEFINITION_ID, snapshot_key or weekly_snapshot_at(captured_at).date().isoformat(), count, captured_at.isoformat(), name),
        )


async def fetch_subscriber_count():
    token = await get_access_token()
    base = os.getenv("DYNAMICS_API_URL", "").rstrip("/")
    if not base:
        raise RuntimeError("DYNAMICS_API_URL is required for newsletter snapshots.")
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(
            f"{base}/msdynmkt_segments",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            params={
                "$filter": f"msdynmkt_sourcesegmentuid eq '{SEGMENT_DEFINITION_ID}'",
                "$select": "msdynmkt_membercount,msdynmkt_displayname",
            },
        )
        response.raise_for_status()
    rows = response.json().get("value", [])
    if len(rows) != 1:
        raise RuntimeError("Expected one Dynamics segment for the Economic Navigator newsletter.")
    count = rows[0].get("msdynmkt_membercount")
    if type(count) is not int or count < 0:
        raise RuntimeError("Dynamics did not return a valid newsletter subscriber count.")
    return count, rows[0].get("msdynmkt_displayname") or SEGMENT_NAME


async def capture_if_due(now=None):
    now = now or datetime.now(timezone.utc)
    scheduled = weekly_snapshot_at(now)
    if now < scheduled:
        return False
    rows = await asyncio.to_thread(read_snapshots)
    if any(datetime.fromisoformat(row["captured_at"]) >= scheduled for row in rows):
        return False
    count, name = await fetch_subscriber_count()
    # Record the actual observation time, including when catching up after downtime.
    captured_at = datetime.now(timezone.utc)
    await asyncio.to_thread(save_snapshot, count, name, captured_at, scheduled.date().isoformat())
    return True


def monthly_snapshots(rows):
    """Use the latest observation in each Eastern calendar month, never a sum."""
    latest_by_month = {}
    for row in rows:
        captured_at = datetime.fromisoformat(row["captured_at"])
        month = captured_at.astimezone(REPORTING_ZONE).strftime("%Y-%m")
        previous = latest_by_month.get(month)
        if previous is None or captured_at > datetime.fromisoformat(previous["captured_at"]):
            latest_by_month[month] = {**row, "month_key": month, "period_key": month}
    return [latest_by_month[month] for month in sorted(latest_by_month)]


async def get_newsletter_metrics():
    warning = ""
    try:
        await capture_if_due()
    except Exception:
        logger.exception("Newsletter subscriber snapshot failed")
        warning = "The latest newsletter count could not be retrieved from Dynamics. Saved snapshots are shown; the next automatic check will retry."
    rows = await asyncio.to_thread(read_snapshots)
    return {
        "segment_name": SEGMENT_NAME,
        "snapshots": monthly_snapshots(rows),
        "next_snapshot_at": next_snapshot_at(datetime.now(timezone.utc)).isoformat(),
        "warning": warning,
    }


async def run_snapshot_scheduler():
    """Start immediately, retry failures hourly, and wake at the next Monday at 9 a.m. Eastern."""
    while True:
        try:
            await capture_if_due()
        except Exception:
            logger.exception("Scheduled newsletter subscriber snapshot failed; will retry")
        now = datetime.now(timezone.utc)
        seconds_until_next_week = (next_snapshot_at(now).astimezone(timezone.utc) - now).total_seconds()
        await asyncio.sleep(max(1, min(3600, seconds_until_next_week)))


if __name__ == "__main__":
    # Also usable as an independent Render cron job if the web service sleeps.
    initialize_database()
    captured = asyncio.run(capture_if_due())
    print("Newsletter snapshot saved." if captured else "No newsletter snapshot is due for this week.")
