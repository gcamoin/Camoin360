import asyncio
import json
import os
import re
from collections import defaultdict
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx
from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import DateRange, Dimension, Metric, RunReportRequest

from ..database import get_database_connection
from .auth import get_access_token
from .dynamics import API_URL

GA4_PROPERTY_ID = os.getenv("GA4_PROPERTY_ID")
SERVICE_LINE_METRICS_START_DATE = "2022-01-01"
SERVICE_LINE_METRICS_SYNC_STALE_SECONDS = int(
    os.getenv("SERVICE_LINE_METRICS_SYNC_STALE_SECONDS", str(6 * 60 * 60))
)
SERVICE_LINE_METRICS_REQUEST_TIMEOUT_SECONDS = 120
CACHE_KEY = "default"

SERVICE_LINE_DEFINITIONS = [
    {"key": "prospect_engage", "label": "ProspectEngage", "pattern": re.compile(r"prospect-?engage", re.IGNORECASE)},
    {
        "key": "prospecting",
        "label": "Prospecting",
        "pattern": re.compile(r"^/services/[^?#]*prospecting", re.IGNORECASE),
    },
    {
        "key": "impact_analysis",
        "label": "Impact Analysis",
        "pattern": re.compile(r"^/services/[^?#]*impact-analysis", re.IGNORECASE),
    },
    {
        "key": "real_estate",
        "label": "Real Estate",
        "pattern": re.compile(r"^/services/[^?#]*real-estate", re.IGNORECASE),
    },
    {
        "key": "strategic_planning",
        "label": "Strategic Planning",
        "pattern": re.compile(r"^/services/[^?#]*strategic-planning", re.IGNORECASE),
    },
    {
        "key": "entrepreneurship",
        "label": "Entrepreneurship",
        "pattern": re.compile(r"^/services/entrepreneurship-innovation"),
    },
    {
        "key": "workforce",
        "label": "Workforce",
        "pattern": re.compile(r"^/services/workforce-development-talent-retention"),
    },
    {
        "key": "industry_analytics",
        "label": "Industry Analytics",
        "pattern": re.compile(r"^/services/industry-analytics"),
    },
]


def _match_service_line(path: str) -> str | None:
    if not path:
        return None
    for definition in SERVICE_LINE_DEFINITIONS:
        if definition["pattern"].search(path):
            return definition["label"]
    return None


def _run_ga4_report():
    client = BetaAnalyticsDataClient()
    request = RunReportRequest(
        property=f"properties/{GA4_PROPERTY_ID}",
        dimensions=[Dimension(name="yearMonth"), Dimension(name="landingPage")],
        metrics=[Metric(name="sessions")],
        date_ranges=[DateRange(start_date=SERVICE_LINE_METRICS_START_DATE, end_date="today")],
        limit=100000,
    )
    return client.run_report(request)


async def _fetch_ga4_monthly_sessions() -> dict:
    response = await asyncio.to_thread(_run_ga4_report)
    aggregated: dict = defaultdict(int)
    for row in response.rows:
        year_month = row.dimension_values[0].value
        path = row.dimension_values[1].value
        sessions = int(row.metric_values[0].value)
        label = _match_service_line(path)
        if label:
            aggregated[(label, year_month)] += sessions
    return aggregated


async def _fetch_leadfeeder_monthly_visits() -> dict:
    token = await get_access_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "OData-Version": "4.0",
        "Prefer": "odata.maxpagesize=5000",
    }
    aggregated: dict = defaultdict(int)
    url = (
        f"{API_URL}/lfapp_websitevisits?"
        "$select=lfapp_landingpage,createdon&"
        f"$filter=createdon ge {SERVICE_LINE_METRICS_START_DATE}T00:00:00Z"
    )
    timeout = httpx.Timeout(SERVICE_LINE_METRICS_REQUEST_TIMEOUT_SECONDS)
    async with httpx.AsyncClient(timeout=timeout) as client:
        while url:
            response = await client.get(url, headers=headers)
            if response.status_code != 200:
                raise Exception(f"Dynamics GET error: {response.text}")

            payload = response.json()
            for record in payload.get("value", []):
                landing_page = record.get("lfapp_landingpage")
                created_on = record.get("createdon")
                if not landing_page or not created_on:
                    continue

                label = _match_service_line(urlparse(landing_page).path)
                if not label:
                    continue

                year_month = created_on[:7].replace("-", "")
                aggregated[(label, year_month)] += 1

            url = payload.get("@odata.nextLink")

    return aggregated


def _month_period_label(year_month: str) -> str:
    year = int(year_month[:4])
    month = int(year_month[4:6])
    return datetime(year, month, 1).strftime("%b '%y")


async def _load_service_line_marketing_metrics() -> dict:
    ga_visits, leadfeeder_visits = await asyncio.gather(
        _fetch_ga4_monthly_sessions(), _fetch_leadfeeder_monthly_visits()
    )

    all_months = sorted({year_month for (_, year_month) in ga_visits} | {year_month for (_, year_month) in leadfeeder_visits})

    service_lines = []
    for definition in SERVICE_LINE_DEFINITIONS:
        label = definition["label"]
        line_months = [
            year_month
            for year_month in all_months
            if ga_visits.get((label, year_month), 0) or leadfeeder_visits.get((label, year_month), 0)
        ]
        if line_months:
            first_active_month = line_months[0]
            months_in_range = [ym for ym in all_months if ym >= first_active_month]
        else:
            months_in_range = []

        months = [
            {
                "year": int(year_month[:4]),
                "month": int(year_month[4:6]),
                "period": _month_period_label(year_month),
                "ga_visits": ga_visits.get((label, year_month), 0),
                "leadfeeder_visits": leadfeeder_visits.get((label, year_month), 0),
            }
            for year_month in months_in_range
        ]

        service_lines.append({"key": definition["key"], "label": label, "months": months})

    return {
        "service_lines": service_lines,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _empty_service_line_marketing_payload() -> dict:
    return {
        "service_lines": [
            {"key": definition["key"], "label": definition["label"], "months": []}
            for definition in SERVICE_LINE_DEFINITIONS
        ],
        "updated_at": "",
    }


def _service_line_keys_are_current(payload: dict) -> bool:
    payload_keys = {line.get("key") for line in payload.get("service_lines", [])}
    configured_keys = {definition["key"] for definition in SERVICE_LINE_DEFINITIONS}
    return payload_keys == configured_keys


def _ensure_current_service_lines(payload: dict) -> dict:
    existing_lines_by_key = {
        line.get("key"): line
        for line in payload.get("service_lines", [])
    }

    if _service_line_keys_are_current(payload):
        return payload

    service_lines = []
    for definition in SERVICE_LINE_DEFINITIONS:
        service_lines.append(
            existing_lines_by_key.get(
                definition["key"],
                {"key": definition["key"], "label": definition["label"], "months": []},
            )
        )

    return {
        **payload,
        "service_lines": service_lines,
    }


def _get_service_line_marketing_cache_row() -> dict | None:
    with get_database_connection() as connection:
        row = connection.execute(
            """
            SELECT cache_key, payload, status, last_started_at, last_completed_at, last_error
            FROM service_line_marketing_cache
            WHERE cache_key = ?
            """,
            (CACHE_KEY,),
        ).fetchone()

    return dict(row) if row else None


def _is_service_line_marketing_cache_stale(cache_row: dict | None) -> bool:
    if not cache_row:
        return True
    if cache_row.get("status") == "error":
        return True

    completed_at = cache_row.get("last_completed_at")
    if not completed_at:
        return True

    try:
        completed_time = datetime.fromisoformat(completed_at)
    except ValueError:
        return True

    if completed_time.tzinfo is None:
        completed_time = completed_time.replace(tzinfo=timezone.utc)

    return (datetime.now(timezone.utc) - completed_time).total_seconds() > SERVICE_LINE_METRICS_SYNC_STALE_SECONDS


def get_service_line_marketing_metrics() -> dict:
    cache_row = _get_service_line_marketing_cache_row()
    if cache_row:
        try:
            payload = json.loads(cache_row.get("payload") or "{}")
        except json.JSONDecodeError:
            payload = _empty_service_line_marketing_payload()
    else:
        payload = _empty_service_line_marketing_payload()

    has_current_service_lines = _service_line_keys_are_current(payload)
    payload = _ensure_current_service_lines(payload)

    sync = {
        "status": cache_row.get("status") if cache_row else "idle",
        "last_started_at": cache_row.get("last_started_at") if cache_row else None,
        "last_completed_at": cache_row.get("last_completed_at") if cache_row else None,
        "last_error": cache_row.get("last_error") if cache_row else "",
        "is_stale": _is_service_line_marketing_cache_stale(cache_row) or not has_current_service_lines,
    }
    return {
        **payload,
        "sync": sync,
    }


async def refresh_service_line_marketing_metrics_cache() -> dict:
    started_at = datetime.now(timezone.utc).isoformat()
    with get_database_connection() as connection:
        connection.execute(
            """
            INSERT INTO service_line_marketing_cache (
                cache_key, payload, status, last_started_at, last_error, updated_at
            )
            VALUES (?, ?, 'syncing', ?, '', CURRENT_TIMESTAMP)
            ON CONFLICT(cache_key) DO UPDATE SET
                status = 'syncing',
                last_started_at = excluded.last_started_at,
                last_error = '',
                updated_at = CURRENT_TIMESTAMP
            """,
            (CACHE_KEY, json.dumps(_empty_service_line_marketing_payload()), started_at),
        )

    try:
        payload = await _load_service_line_marketing_metrics()
        completed_at = datetime.now(timezone.utc).isoformat()
        with get_database_connection() as connection:
            connection.execute(
                """
                UPDATE service_line_marketing_cache
                SET payload = ?,
                    status = 'idle',
                    last_completed_at = ?,
                    last_error = '',
                    updated_at = CURRENT_TIMESTAMP
                WHERE cache_key = ?
                """,
                (json.dumps(payload), completed_at, CACHE_KEY),
            )
        return get_service_line_marketing_metrics()
    except Exception as exc:
        with get_database_connection() as connection:
            connection.execute(
                """
                UPDATE service_line_marketing_cache
                SET status = 'error',
                    last_error = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE cache_key = ?
                """,
                (str(exc), CACHE_KEY),
            )
        raise
