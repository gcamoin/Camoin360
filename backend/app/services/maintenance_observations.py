"""Durable, bounded maintenance observation and snapshot refreshes.

No scheduler, browser API, provider calls, or Dynamics writes live here.
"""
import asyncio
import logging
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from ..database import get_database_connection
from .maintenance_dynamics import (
    BudgetExceeded, MaintenanceDynamicsClient, MaintenanceQueryError, RequestBudget,
    TOTAL_SOURCE, count_creation_interval,
)

logger = logging.getLogger(__name__)
REPORTING_ZONE = ZoneInfo("America/New_York")
SAFE_ERRORS = frozenset({
    "request_budget_exhausted", "observation_row_limit", "discovery_retention_gap",
    "invalid_discovery_cursor", "invalid_discovery_page", "invalid_count_response",
    "invalid_dynamics_response", "dynamics_query_failed", "aggregate_interval_unsplittable",
    "dynamics_configuration_unavailable", "database_unavailable", "dynamics_unavailable",
    "refresh_clock_regression", "refresh_interrupted",
})


@dataclass(frozen=True)
class MaintenanceConfig:
    bootstrap_days: int = 14
    retention_days: int = 30
    max_observations: int = 50000
    page_size: int = 500
    max_discovery_pages: int = 10
    overlap_seconds: int = 300
    discovery_seconds: int = 120
    pending_grace_seconds: int = 300
    today_seconds: int = 180
    total_seconds: int = 3600
    max_count_requests: int = 64

    def __post_init__(self):
        limits = {
            "bootstrap_days": (1, 30), "retention_days": (1, 90),
            "max_observations": (1, 500000), "page_size": (1, 5000),
            "max_discovery_pages": (1, 100), "overlap_seconds": (1, 86400),
            "discovery_seconds": (1, 3600), "pending_grace_seconds": (1, 86400),
            "today_seconds": (1, 3600), "total_seconds": (1, 86400),
            "max_count_requests": (1, 256),
        }
        if any(type(getattr(self, key)) is not int or not low <= getattr(self, key) <= high for key, (low, high) in limits.items()) or self.retention_days < self.bootstrap_days:
            raise ValueError("Invalid maintenance refresh configuration")

    @classmethod
    def from_env(cls):
        try:
            return cls(**{name: int(os.environ[f"MAINTENANCE_{name.upper()}"])
                          for name in cls.__dataclass_fields__ if f"MAINTENANCE_{name.upper()}" in os.environ})
        except (TypeError, ValueError):
            raise ValueError("Invalid maintenance refresh configuration") from None


def utc_now():
    return datetime.now(timezone.utc)


def aware_timestamp(value):
    try:
        parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError, OverflowError):
        raise MaintenanceQueryError("invalid_discovery_page") from None


def reporting_day_bounds(day):
    """Convert each local midnight independently: a reporting day can be 23/25 hours."""
    start = datetime.combine(day, time.min, REPORTING_ZONE)
    end = datetime.combine(day + timedelta(days=1), time.min, REPORTING_ZONE)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def reporting_week_bounds(now):
    day = aware_timestamp(now).astimezone(REPORTING_ZONE).date()
    monday = day - timedelta(days=day.weekday())
    return reporting_day_bounds(monday)[0], reporting_day_bounds(monday + timedelta(days=6))[1]


def _db(action, *args):
    with get_database_connection(connect_timeout=2) as connection:
        connection.execute("SET LOCAL statement_timeout = '2000ms'")
        connection.execute("SET LOCAL lock_timeout = '1000ms'")
        connection.execute("SET LOCAL TIME ZONE 'UTC'")
        return action(connection, *args)


async def _run_db(action, *args):
    try:
        return await asyncio.to_thread(_db, action, *args)
    except MaintenanceQueryError:
        raise
    except Exception:
        raise MaintenanceQueryError("database_unavailable") from None


@asynccontextmanager
async def _refresh_lock(key):
    # A dedicated session lock survives individual page transactions and worker processes.
    cm = get_database_connection(connect_timeout=2)
    connection = None
    def acquire():
        nonlocal connection
        connection = cm.__enter__()
        connection.execute("SET LOCAL statement_timeout = '2000ms'")
        locked = connection.execute("SELECT pg_try_advisory_lock(66360, ?) AS acquired", ({"discovery": 1, "total": 2, "counts": 3, "worker": 4}[key],)).fetchone()["acquired"]
        connection.commit()
        return locked
    task = asyncio.create_task(asyncio.to_thread(acquire))
    try:
        acquired = await asyncio.shield(task)
        yield acquired
    finally:
        if not task.done():
            # A cancelled coroutine must still close a session opened by its worker thread.
            try:
                await asyncio.shield(task)
            except Exception:
                pass
        if connection is not None:
            # Closing the session releases its advisory lock, including on cancellation.
            await asyncio.shield(asyncio.to_thread(cm.__exit__, None, None, None))


def _ensure_state(connection, key, now):
    connection.execute("INSERT INTO maintenance_sync_state (sync_key, tracking_started_at) VALUES (?, ?) ON CONFLICT (sync_key) DO NOTHING", (key, now))
    return dict(connection.execute("SELECT * FROM maintenance_sync_state WHERE sync_key = ?", (key,)).fetchone())


def _begin(connection, key, now):
    state = _ensure_state(connection, key, now)
    connection.execute("UPDATE maintenance_sync_state SET status = 'running', coverage_complete = FALSE, last_started_at = ?, requests_last_refresh = 0, rows_last_refresh = 0 WHERE sync_key = ?", (now, key))
    return state


def _finish(connection, key, now, status, requests, rows=0, error=None):
    connection.execute(
        """UPDATE maintenance_sync_state SET status = ?, coverage_complete = ?, last_finished_at = ?,
           last_succeeded_at = CASE WHEN ? = 'idle' THEN ? ELSE last_succeeded_at END,
           last_error = ?, last_error_at = ?, requests_last_refresh = ?, rows_last_refresh = ?
           WHERE sync_key = ?""",
        (status, status == "idle", now, status, now, error, now if error else None, requests, rows, key),
    )
    return dict(connection.execute("SELECT * FROM maintenance_sync_state WHERE sync_key = ?", (key,)).fetchone())


def _safe_error(exc):
    code = str(exc) if isinstance(exc, MaintenanceQueryError) else "dynamics_unavailable"
    return code if code in SAFE_ERRORS else "dynamics_unavailable"


async def _failure(key, now, exc, requests, rows=0):
    code = _safe_error(exc)
    try:
        status = "incomplete" if isinstance(exc, BudgetExceeded) else "error"
        state = await _run_db(_finish, key, now, status, requests, rows, code)
    except Exception:
        logger.warning("Maintenance %s refresh persistence unavailable; snapshots preserved", key)
        return {"status": "error", "error": "database_unavailable", "coverage_complete": False}
    logger.warning("Maintenance %s refresh incomplete (%s); previous snapshots preserved", key, code)
    return state


def _prepare_interval(connection, now, config):
    state = _ensure_state(connection, "discovery", now)
    if (state["watermark"] and state["watermark"] > now) or (state["interval_end"] and state["interval_end"] > now):
        raise MaintenanceQueryError("refresh_clock_regression")
    cutoff = now - timedelta(days=config.retention_days)
    connection.execute("DELETE FROM maintenance_account_observations WHERE dynamics_created_on < ?", (cutoff,))
    coverage_start = state["coverage_started_at"]
    if coverage_start is None:
        today = now.astimezone(REPORTING_ZONE).date()
        coverage_start = reporting_day_bounds(today - timedelta(days=config.bootstrap_days - 1))[0]
        connection.execute("UPDATE maintenance_sync_state SET coverage_started_at = ? WHERE sync_key = 'discovery'", (coverage_start,))
    if state["interval_end"] is None:
        start = max(coverage_start, (state["watermark"] or coverage_start) - timedelta(seconds=config.overlap_seconds))
        if start < cutoff:
            raise MaintenanceQueryError("discovery_retention_gap")
        connection.execute("UPDATE maintenance_sync_state SET interval_start = ?, interval_end = ?, next_link = NULL, page_size = ? WHERE sync_key = 'discovery'", (start, now, config.page_size))
    elif state["interval_start"] < cutoff:
        raise MaintenanceQueryError("discovery_retention_gap")
    return dict(connection.execute("SELECT * FROM maintenance_sync_state WHERE sync_key = 'discovery'").fetchone())


def _normalize_observation(row, start, end, observed_at):
    if not isinstance(row, dict) or not isinstance(row.get("accountid"), str) or not row["accountid"] or len(row["accountid"]) > 128:
        raise MaintenanceQueryError("invalid_discovery_page")
    created = aware_timestamp(row.get("createdon"))
    if not start <= created < end:
        raise MaintenanceQueryError("invalid_discovery_page")
    name, attempted = row.get("name"), row.get("cr73c_enrichmentattempted")
    if (name is not None and not isinstance(name, str)) or (attempted is not None and type(attempted) is not bool):
        raise MaintenanceQueryError("invalid_discovery_page")
    last_attempted = row.get("cr73c_enrichmentlastattemptedon")
    return (row["accountid"], name, created, attempted,
            aware_timestamp(last_attempted) if last_attempted else None, observed_at, observed_at)


def _save_page(connection, rows, state, next_link, now, config):
    prepared = [_normalize_observation(row, state["interval_start"], state["interval_end"], now) for row in rows]
    ids = list({row[0] for row in prepared})
    existing = connection.execute("SELECT dynamics_account_id FROM maintenance_account_observations WHERE dynamics_account_id = ANY(?)", (ids,)).fetchall()
    count = connection.execute("SELECT COUNT(*) AS count FROM maintenance_account_observations").fetchone()["count"]
    if count + len(ids) - len(existing) > config.max_observations:
        raise BudgetExceeded("observation_row_limit")
    connection.executemany(
        """INSERT INTO maintenance_account_observations (
           dynamics_account_id, account_name, dynamics_created_on, enrichment_attempted,
           enrichment_last_attempted_on, first_observed_at, last_observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (dynamics_account_id) DO UPDATE SET
           account_name = EXCLUDED.account_name, dynamics_created_on = EXCLUDED.dynamics_created_on,
           enrichment_attempted = EXCLUDED.enrichment_attempted,
           enrichment_last_attempted_on = EXCLUDED.enrichment_last_attempted_on,
           last_observed_at = EXCLUDED.last_observed_at
        WHERE EXCLUDED.last_observed_at >= maintenance_account_observations.last_observed_at""", prepared,
    )
    if next_link:
        connection.execute("UPDATE maintenance_sync_state SET next_link = ? WHERE sync_key = 'discovery'", (next_link,))
    else:
        connection.execute("""UPDATE maintenance_sync_state SET watermark = interval_end,
                           interval_start = NULL, interval_end = NULL, next_link = NULL, page_size = NULL
                           WHERE sync_key = 'discovery'""")
    return len(prepared)


async def refresh_account_discovery(*, now=None, config=None, force=False):
    now, config = aware_timestamp(now or utc_now()), config or MaintenanceConfig.from_env()
    requests = rows = 0
    try:
        async with _refresh_lock("discovery") as acquired:
            if not acquired:
                return {"status": "busy"}
            state = await _run_db(_ensure_state, "discovery", now)
            if not force and state["status"] == "idle" and state["last_succeeded_at"] and now - state["last_succeeded_at"] < timedelta(seconds=config.discovery_seconds):
                return {**state, "skipped": True}
            await _run_db(_begin, "discovery", now)
            try:
                async with MaintenanceDynamicsClient() as client:
                    while requests < config.max_discovery_pages:
                        state = await _run_db(_prepare_interval, now, config)
                        requests += 1
                        page, link = await client.discovery_page(state["interval_start"], state["interval_end"], state["page_size"], state["next_link"])
                        rows += await _run_db(_save_page, page, state, link, now, config)
                        if link is None and state["interval_end"] >= now:
                            return await _run_db(_finish, "discovery", now, "idle", requests, rows)
                    raise BudgetExceeded("request_budget_exhausted")
            except asyncio.CancelledError:
                await asyncio.shield(_failure("discovery", now, MaintenanceQueryError("refresh_interrupted"), requests, rows))
                raise
            except Exception as exc:
                return await _failure("discovery", now, exc, requests, rows)
    except Exception:
        logger.warning("Maintenance discovery database unavailable; no refresh performed")
        return {"status": "error", "error": "database_unavailable", "coverage_complete": False}


def _total_snapshot(connection):
    row = connection.execute("SELECT value, fetched_at, source FROM maintenance_total_account_snapshot WHERE id = 1").fetchone()
    return dict(row) if row else None


def _save_total(connection, value, now):
    connection.execute("""INSERT INTO maintenance_total_account_snapshot (id, value, fetched_at, source) VALUES (1, ?, ?, ?)
                       ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, fetched_at = EXCLUDED.fetched_at, source = EXCLUDED.source""", (value, now, TOTAL_SOURCE))


async def refresh_total_account_count(*, now=None, config=None, force=False):
    now, config = aware_timestamp(now or utc_now()), config or MaintenanceConfig.from_env()
    requests = 0
    try:
        async with _refresh_lock("total") as acquired:
            if not acquired:
                return {"status": "busy"}
            snapshot = await _run_db(_total_snapshot)
            state = await _run_db(_ensure_state, "total", now)
            if not force and snapshot and state["status"] == "idle" and now - snapshot["fetched_at"] < timedelta(seconds=config.total_seconds):
                return {**state, "skipped": True}
            await _run_db(_begin, "total", now)
            try:
                async with MaintenanceDynamicsClient() as client:
                    requests = 1
                    value = await client.total_count()
                await _run_db(_save_total, value, now)
                return await _run_db(_finish, "total", now, "idle", requests)
            except asyncio.CancelledError:
                await asyncio.shield(_failure("total", now, MaintenanceQueryError("refresh_interrupted"), requests))
                raise
            except Exception as exc:
                return await _failure("total", now, exc, requests)
    except Exception:
        logger.warning("Maintenance total database unavailable; snapshots preserved")
        return {"status": "error", "error": "database_unavailable", "coverage_complete": False}


def _daily_rows(connection, first, last):
    return {row["reporting_date"]: dict(row) for row in connection.execute(
        "SELECT * FROM maintenance_account_creation_counts WHERE reporting_date >= ? AND reporting_date <= ? ORDER BY reporting_date", (first, last),
    ).fetchall()}


def _save_day(connection, day, start, end, value, now, complete):
    connection.execute("""INSERT INTO maintenance_account_creation_counts
        (reporting_date, interval_start, interval_end, value, fetched_at, is_complete) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (reporting_date) DO UPDATE SET interval_start = EXCLUDED.interval_start,
        interval_end = EXCLUDED.interval_end, value = EXCLUDED.value, fetched_at = EXCLUDED.fetched_at,
        is_complete = EXCLUDED.is_complete""", (day, start, end, value, now, complete))


def creation_days_due(cached, today, now, days, config, *, force=False,
                      reconcile_days=0, reconcile_before=None):
    """Shared due policy; optional reconciliation touches only recent completed days."""
    if type(reconcile_days) is not int or not 0 <= reconcile_days <= 3:
        raise ValueError("Invalid reconciliation window")
    if reconcile_days and reconcile_before is None:
        raise ValueError("Reconciliation cutoff is required")
    needed = []
    for offset in range(days):
        day = today - timedelta(days=offset)
        row = cached.get(day)
        if (force or row is None or (day < today and not row["is_complete"]) or
            (day == today and now - row["fetched_at"] >= timedelta(seconds=config.today_seconds)) or
            (0 < offset <= reconcile_days and row["fetched_at"] <= reconcile_before)):
            needed.append(day)
    return needed


async def refresh_account_creation_counts(*, now=None, days=14, config=None, force=False,
                                          reconcile_days=0, reconcile_before=None):
    if type(days) is not int or not 7 <= days <= 30:
        raise ValueError("Creation counts support 7 to 30 reporting days")
    now, config = aware_timestamp(now or utc_now()), config or MaintenanceConfig.from_env()
    today = now.astimezone(REPORTING_ZONE).date()
    budget = RequestBudget(config.max_count_requests)
    saved = 0
    try:
        async with _refresh_lock("counts") as acquired:
            if not acquired:
                return {"status": "busy"}
            await _run_db(_begin, "counts", now)
            cached = await _run_db(_daily_rows, today - timedelta(days=days - 1), today)
            needed = creation_days_due(cached, today, now, days, config, force=force,
                                       reconcile_days=reconcile_days, reconcile_before=reconcile_before)
            try:
                if needed:
                    async with MaintenanceDynamicsClient() as client:
                        for day in needed:
                            start, end = reporting_day_bounds(day)
                            value = await count_creation_interval(client, start, min(end, now), budget)
                            await _run_db(_save_day, day, start, min(end, now), value, now, day < today)
                            saved += 1
                return await _run_db(_finish, "counts", now, "idle", budget.used, saved)
            except asyncio.CancelledError:
                await asyncio.shield(_failure("counts", now, MaintenanceQueryError("refresh_interrupted"), budget.used, saved))
                raise
            except Exception as exc:
                return await _failure("counts", now, exc, budget.used, saved)
    except Exception:
        logger.warning("Maintenance creation-count database unavailable; snapshots preserved")
        return {"status": "error", "error": "database_unavailable", "coverage_complete": False}


def read_count_snapshots(*, now=None, days=14, config=None):
    """Read-only cached primitives for Step 3; never performs a Dynamics query."""
    if type(days) is not int or not 7 <= days <= 30:
        raise ValueError("Creation counts support 7 to 30 reporting days")
    now, config = aware_timestamp(now or utc_now()), config or MaintenanceConfig.from_env()
    today = now.astimezone(REPORTING_ZONE).date()
    def read(connection):
        total = _total_snapshot(connection)
        daily = _daily_rows(connection, today - timedelta(days=days - 1), today)
        state = {row["sync_key"]: dict(row) for row in connection.execute("SELECT * FROM maintenance_sync_state").fetchall()}
        for sync in state.values():
            sync.pop("next_link", None)
        result = []
        for offset in reversed(range(days)):
            day = today - timedelta(days=offset)
            row = daily.get(day)
            result.append({"date": day, "value": row["value"] if row else None,
                           "fetched_at": row["fetched_at"] if row else None,
                           "is_complete": bool(row and row["is_complete"]),
                           "is_stale": not row or (day < today and not row["is_complete"]) or (day == today and now - row["fetched_at"] >= timedelta(seconds=config.today_seconds))})
        week_days = [today - timedelta(days=offset) for offset in range(today.weekday() + 1)]
        week_known = all(day in daily and (day == today or daily[day]["is_complete"]) for day in week_days)
        if total:
            total["is_stale"] = now - total["fetched_at"] >= timedelta(seconds=config.total_seconds) or state.get("total", {}).get("status") != "idle"
            total["maximum_source_age_hours"] = 24
        today_row = daily.get(today)
        if today_row:
            today_row = {**today_row, "is_stale": result[-1]["is_stale"] or state.get("counts", {}).get("status") != "idle"}
        return {"total": total, "today": today_row,
                "this_week": {"value": sum(daily[day]["value"] for day in week_days) if week_known else None,
                              "start": reporting_week_bounds(now)[0], "through": daily[today]["interval_end"] if today in daily else None,
                              "is_stale": not week_known or result[-1]["is_stale"] or state.get("counts", {}).get("status") != "idle"},
                "daily": result, "sync": state, "timezone": "America/New_York"}
    return _db(read)


def read_recent_account_observations(*, now=None, limit=25, config=None):
    """Receipt presence and eligibility/grace facts only; no final display-status mapper."""
    if type(limit) is not int or not 1 <= limit <= 100:
        raise ValueError("Recent observations support 1 to 100 rows")
    now, config = aware_timestamp(now or utc_now()), config or MaintenanceConfig.from_env()
    def read(connection):
        row = connection.execute("SELECT * FROM maintenance_sync_state WHERE sync_key = 'discovery'").fetchone()
        state = dict(row) if row else None
        rows = connection.execute("""SELECT o.*, receipt.first_receipt_at FROM maintenance_account_observations o
            LEFT JOIN LATERAL (SELECT MIN(received_at) AS first_receipt_at FROM account_enrichment_history h
                               WHERE h.dynamics_account_id = o.dynamics_account_id) receipt ON TRUE
            WHERE o.dynamics_created_on >= ?
            ORDER BY o.dynamics_created_on DESC, o.dynamics_account_id LIMIT ?""", (now - timedelta(days=config.retention_days), limit)).fetchall()
        fresh_coverage = bool(state and state["coverage_complete"] and state["watermark"] and
                              now - state["watermark"] < timedelta(seconds=config.discovery_seconds))
        observations = []
        for row in rows:
            row = dict(row)
            eligible = bool(fresh_coverage and row["dynamics_created_on"] >= state["tracking_started_at"] and row["dynamics_created_on"] < state["watermark"])
            row["has_sophie_request"] = row["first_receipt_at"] is not None
            row["forward_tracking_eligible"] = eligible
            row["no_request_overdue"] = bool(eligible and not row["has_sophie_request"] and now >= max(row["dynamics_created_on"], row["first_observed_at"]) + timedelta(seconds=config.pending_grace_seconds))
            observations.append(row)
        # Paging cursor stays internal, not part of future browser data.
        if state:
            state.pop("next_link", None)
        return {"accounts": observations, "sync": state, "pending_grace_seconds": config.pending_grace_seconds,
                "coverage_fresh": fresh_coverage}
    return _db(read)


async def refresh_maintenance_observations(*, now=None, config=None):
    """Reusable invocation for a future worker/cron; independent snapshots retain successes."""
    now, config = aware_timestamp(now or utc_now()), config or MaintenanceConfig.from_env()
    return {
        "discovery": await refresh_account_discovery(now=now, config=config),
        "total": await refresh_total_account_count(now=now, config=config),
        "counts": await refresh_account_creation_counts(now=now, config=config),
    }
