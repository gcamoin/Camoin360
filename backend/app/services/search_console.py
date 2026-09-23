import asyncio
import os
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build

from ..database import get_database_connection


SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
SEARCH_CONSOLE_SITE_URL = os.getenv(
    "GOOGLE_SEARCH_CONSOLE_SITE_URL", "sc-domain:camoinassociates.com"
)
SEARCH_CONSOLE_CACHE_TTL_SECONDS = int(
    os.getenv("SEARCH_CONSOLE_CACHE_TTL_SECONDS", "21600")
)
DEFAULT_CREDENTIALS_PATH = (
    Path(__file__).resolve().parents[2]
    / "secrets"
    / "google-analytics-service-account.json"
)


def _credentials_path() -> Path:
    configured_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    return Path(configured_path) if configured_path else DEFAULT_CREDENTIALS_PATH


def _build_search_console_service():
    credentials_path = _credentials_path()
    if not credentials_path.is_file():
        raise RuntimeError(
            "Google service-account credentials were not found. Set "
            "GOOGLE_APPLICATION_CREDENTIALS or install the shared credentials file."
        )
    credentials = service_account.Credentials.from_service_account_file(
        str(credentials_path), scopes=[SEARCH_CONSOLE_SCOPE]
    )
    return build("searchconsole", "v1", credentials=credentials, cache_discovery=False)


def _execute_search_analytics_query(service, body: dict) -> dict:
    return (
        service.searchanalytics()
        .query(siteUrl=SEARCH_CONSOLE_SITE_URL, body=body)
        .execute()
    )


def _discover_available_date_range(service, today: date) -> tuple[date, date] | None:
    response = _execute_search_analytics_query(
        service,
        {
            "startDate": "2000-01-01",
            "endDate": today.isoformat(),
            "dimensions": ["date"],
            "dataState": "all",
            "aggregationType": "byProperty",
            "rowLimit": 25000,
        },
    )
    available_dates = [
        date.fromisoformat(row["keys"][0])
        for row in response.get("rows", [])
        if row.get("keys")
    ]
    if not available_dates:
        return None
    return min(available_dates), max(available_dates)


def _iter_months(start_date: date, end_date: date):
    cursor = start_date.replace(day=1)
    final_month = end_date.replace(day=1)
    while cursor <= final_month:
        yield cursor
        cursor = date(cursor.year + (cursor.month == 12), (cursor.month % 12) + 1, 1)


def _query_month(service, month: date, available_end: date) -> dict:
    month_end = date(month.year, month.month, monthrange(month.year, month.month)[1])
    query_end = min(month_end, available_end)
    response = _execute_search_analytics_query(
        service,
        {
            "startDate": month.isoformat(),
            "endDate": query_end.isoformat(),
            "dataState": "all" if query_end == available_end else "final",
            "aggregationType": "byProperty",
            "rowLimit": 1,
        },
    )
    rows = response.get("rows", [])
    row = rows[0] if rows else {}
    clicks = float(row.get("clicks", 0))
    impressions = float(row.get("impressions", 0))
    return {
        "month": month.strftime("%Y-%m"),
        "clicks": int(round(clicks)),
        "impressions": int(round(impressions)),
        "ctr": clicks / impressions if impressions else 0.0,
        "average_position": float(row.get("position", 0)),
        "data_through_date": query_end.isoformat(),
    }


def fetch_search_console_monthly_metrics(
    service=None, today: date | None = None
) -> tuple[list[dict], date | None, date | None]:
    service = service or _build_search_console_service()
    today = today or datetime.now(timezone.utc).date()
    available_range = _discover_available_date_range(service, today)
    if not available_range:
        return [], None, None

    available_start, available_end = available_range
    existing_months = _get_existing_month_keys()
    refresh_from = today.replace(day=1)
    for _ in range(2):
        refresh_from = (refresh_from - timedelta(days=1)).replace(day=1)
    months_to_fetch = [
        month
        for month in _iter_months(available_start, available_end)
        if month.strftime("%Y-%m") not in existing_months or month >= refresh_from
    ]
    metrics = [_query_month(service, month, available_end) for month in months_to_fetch]
    return metrics, available_start, available_end


def _get_existing_month_keys() -> set[str]:
    with get_database_connection() as connection:
        rows = connection.execute(
            "SELECT month_key FROM search_console_monthly_metrics"
        ).fetchall()
    return {str(row["month_key"]) for row in rows}


def _upsert_monthly_metrics(connection, metrics: list[dict]):
    connection.executemany(
        """
        INSERT INTO search_console_monthly_metrics (
            month_key, clicks, impressions, ctr, average_position,
            data_through_date, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(month_key) DO UPDATE SET
            clicks = excluded.clicks,
            impressions = excluded.impressions,
            ctr = excluded.ctr,
            average_position = excluded.average_position,
            data_through_date = excluded.data_through_date,
            updated_at = CURRENT_TIMESTAMP
        """,
        [
            (
                metric["month"], metric["clicks"], metric["impressions"],
                metric["ctr"], metric["average_position"],
                metric["data_through_date"],
            )
            for metric in metrics
        ],
    )


async def refresh_search_console_metrics_cache() -> dict:
    started_at = datetime.now(timezone.utc).isoformat()
    with get_database_connection() as connection:
        connection.execute(
            """
            UPDATE search_console_sync
            SET status = 'syncing', last_started_at = ?, last_error = ''
            WHERE id = 1
            """,
            (started_at,),
        )

    try:
        metrics, earliest_date, latest_date = await asyncio.to_thread(
            fetch_search_console_monthly_metrics
        )
        completed_at = datetime.now(timezone.utc).isoformat()
        with get_database_connection() as connection:
            _upsert_monthly_metrics(connection, metrics)
            connection.execute(
                """
                UPDATE search_console_sync
                SET status = 'idle', last_completed_at = ?, last_error = '',
                    earliest_available_date = ?, latest_available_date = ?
                WHERE id = 1
                """,
                (
                    completed_at,
                    earliest_date.isoformat() if earliest_date else None,
                    latest_date.isoformat() if latest_date else None,
                ),
            )
        return get_search_console_metrics()
    except Exception as exc:
        with get_database_connection() as connection:
            connection.execute(
                """
                UPDATE search_console_sync
                SET status = 'error', last_error = ? WHERE id = 1
                """,
                (str(exc),),
            )
        raise


def _range_start(range_key: str, today: date) -> date | None:
    if range_key == "last_week":
        return today - timedelta(days=6)
    if range_key == "last_month":
        return today - timedelta(days=29)
    if range_key == "last_6_months":
        month = today.replace(day=1)
        for _ in range(5):
            month = (month - timedelta(days=1)).replace(day=1)
        return month
    if range_key == "last_year":
        month = today.replace(day=1)
        for _ in range(11):
            month = (month - timedelta(days=1)).replace(day=1)
        return month
    return None


def _is_sync_stale(sync_row: dict | None) -> bool:
    if not sync_row or not sync_row.get("last_completed_at"):
        return True
    try:
        completed = datetime.fromisoformat(
            str(sync_row["last_completed_at"]).replace("Z", "+00:00")
        )
        if completed.tzinfo is None:
            completed = completed.replace(tzinfo=timezone.utc)
    except ValueError:
        return True
    return (datetime.now(timezone.utc) - completed).total_seconds() > SEARCH_CONSOLE_CACHE_TTL_SECONDS


def get_search_console_metrics(range_key: str = "since_2022") -> dict:
    today = datetime.now(timezone.utc).date()
    start_date = _range_start(range_key, today)
    with get_database_connection() as connection:
        rows = connection.execute(
            """
            SELECT month_key, clicks, impressions, ctr, average_position,
                   data_through_date
            FROM search_console_monthly_metrics
            ORDER BY month_key
            """
        ).fetchall()
        sync_row = connection.execute(
            """
            SELECT status, last_started_at, last_completed_at, last_error,
                   earliest_available_date, latest_available_date
            FROM search_console_sync WHERE id = 1
            """
        ).fetchone()

    metrics = []
    for row in rows:
        month_date = date.fromisoformat(f"{row['month_key']}-01")
        month_end = date(
            month_date.year, month_date.month,
            monthrange(month_date.year, month_date.month)[1],
        )
        if start_date and month_end < start_date:
            continue
        metrics.append(
            {
                "month": row["month_key"],
                "period": month_date.strftime("%b '%y"),
                "clicks": int(round(row["clicks"])),
                "impressions": int(round(row["impressions"])),
                "ctr": float(row["ctr"]),
                "average_position": float(row["average_position"]),
                "data_through_date": row["data_through_date"],
            }
        )

    sync = dict(sync_row) if sync_row else {}
    return {
        "site_url": SEARCH_CONSOLE_SITE_URL,
        "months": metrics,
        "updated_at": sync.get("last_completed_at") or "",
        "sync": {
            **sync,
            "status": sync.get("status", "idle"),
            "last_error": sync.get("last_error", ""),
            "is_stale": _is_sync_stale(sync),
        },
    }
