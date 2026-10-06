"""Read-only Dynamics maintenance worker. Run with --once for a bounded validation."""
import argparse
import asyncio
import logging
import os
import signal
import time
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv

# Load before database/auth modules capture their environment. Existing process vars win.
load_dotenv(Path(__file__).resolve().parents[3] / ".env")
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from ..database import initialize_database
from ..services import maintenance_observations as observations
from ..services.maintenance_home import read_home_refresh_version

logger = logging.getLogger(__name__)
RECONCILE_DAYS = 2
SHUTDOWN_GRACE_SECONDS = 15


@dataclass(frozen=True)
class WorkerConfig:
    interval_seconds: int = 60
    reconcile_seconds: int = 21600

    def __post_init__(self):
        if (type(self.interval_seconds) is not int or not 60 <= self.interval_seconds <= 300 or
            type(self.reconcile_seconds) is not int or not 3600 <= self.reconcile_seconds <= 604800):
            raise ValueError("Invalid maintenance worker configuration")

    @classmethod
    def from_env(cls):
        try:
            return cls(interval_seconds=int(os.getenv("MAINTENANCE_REFRESH_INTERVAL_SECONDS", "60")),
                       reconcile_seconds=int(os.getenv("MAINTENANCE_RECONCILE_SECONDS", "21600")))
        except (ValueError, TypeError):
            raise ValueError("Invalid maintenance worker configuration") from None


def validate_cadences(config):
    # Step 2's general-purpose/manual settings permit small test cadences; production does not.
    if config.discovery_seconds < 60 or config.today_seconds < 120 or config.total_seconds < 1800:
        raise ValueError("Unsafe maintenance worker refresh cadence")


def read_due_plan(now, config, worker_config):
    """Persisted state is authoritative; reads happen inside the cycle advisory lock."""
    def read(connection):
        states = {row["sync_key"]: dict(row) for row in connection.execute("SELECT * FROM maintenance_sync_state").fetchall()}
        discovery = states.get("discovery", {})
        discovery_due = not (discovery.get("status") == "idle" and discovery.get("last_succeeded_at") and
                             now - discovery["last_succeeded_at"] < timedelta(seconds=config.discovery_seconds))
        total = observations._total_snapshot(connection)
        total_due = not (total and states.get("total", {}).get("status") == "idle" and
                         now - total["fetched_at"] < timedelta(seconds=config.total_seconds))
        today = now.astimezone(observations.REPORTING_ZONE).date()
        cached = observations._daily_rows(connection, today - timedelta(days=13), today)
        days = observations.creation_days_due(cached, today, now, 14, config,
            reconcile_days=RECONCILE_DAYS, reconcile_before=now - timedelta(seconds=worker_config.reconcile_seconds))
        return {"discovery": bool(discovery_due), "total": bool(total_due), "counts": bool(days),
                "count_days_due": len(days)}
    return observations._db(read)


async def run_cycle(*, now=None, config=None, worker_config=None, stop=None):
    now = now or observations.utc_now()
    config = config or observations.MaintenanceConfig.from_env()
    worker_config = worker_config or WorkerConfig.from_env()
    validate_cadences(config)
    stop = stop or asyncio.Event()
    started = time.monotonic()
    results = {}
    logger.info("event=maintenance_cycle_start")
    try:
        async with observations._refresh_lock("worker") as acquired:
            if not acquired:
                logger.info("event=maintenance_lock_skip task=cycle")
                return {"status": "busy", "tasks": {}}
            if stop.is_set():
                return {"status": "stopped", "tasks": {}}
            plan = await asyncio.to_thread(read_due_plan, now, config, worker_config)
            before = await asyncio.to_thread(read_home_refresh_version)
            logger.info("event=maintenance_due discovery=%s total=%s counts=%s count_days=%s",
                        plan["discovery"], plan["total"], plan["counts"], plan["count_days_due"])
            for task in ("discovery", "total", "counts"):
                if stop.is_set():
                    break
                if not plan[task]:
                    continue
                try:
                    if task == "discovery":
                        result = await observations.refresh_account_discovery(now=now, config=config)
                    elif task == "total":
                        result = await observations.refresh_total_account_count(now=now, config=config)
                    else:
                        result = await observations.refresh_account_creation_counts(now=now, config=config, days=14,
                            reconcile_days=RECONCILE_DAYS,
                            reconcile_before=now - timedelta(seconds=worker_config.reconcile_seconds))
                    # Allowlisted log fields only: no returned error text, Account names or cursor.
                    status = result.get("status")
                    status = status if status in {"idle", "busy", "incomplete", "error"} else "error"
                    results[task] = status
                    requests, rows = result.get("requests_last_refresh", 0), result.get("rows_last_refresh", 0)
                    requests = requests if type(requests) is int and requests >= 0 else 0
                    rows = rows if type(rows) is int and rows >= 0 else 0
                    logger.info("event=maintenance_refresh task=%s status=%s requests=%s rows=%s coverage=%s",
                                task, status, requests, rows, bool(result.get("coverage_complete")))
                    if status == "busy":
                        logger.info("event=maintenance_lock_skip task=%s", task)
                    if result.get("error") == "database_unavailable" or result.get("last_error") == "database_unavailable":
                        # Lost persistence: don't start additional remote work this cycle.
                        break
                except asyncio.CancelledError:
                    raise
                except Exception:
                    results[task] = "error"
                    logger.warning("event=maintenance_refresh_failed task=%s reason=unexpected", task)
                    # Other tasks still independently prove PostgreSQL availability before querying.
            after = await asyncio.to_thread(read_home_refresh_version)
            changed = before != after
            if changed:
                # Durable commits are the cross-process invalidation signal checked by Home.
                logger.info("event=maintenance_home_cache_invalidated")
            status = "error" if any(value in {"error", "incomplete"} for value in results.values()) else "idle"
            return {"status": "stopped" if stop.is_set() else status, "tasks": results, "changed": changed}
    except asyncio.CancelledError:
        logger.info("event=maintenance_cycle_cancelled")
        raise
    except Exception:
        logger.warning("event=maintenance_cycle_failed reason=persistence_or_internal")
        return {"status": "error", "tasks": results}
    finally:
        logger.info("event=maintenance_cycle_end duration_seconds=%.3f", time.monotonic() - started)


async def _until_stop(operation, stop, grace=SHUTDOWN_GRACE_SECONDS):
    """Drain bounded work; after grace cancel so Step 2 checkpoints and locks clean up."""
    task = asyncio.create_task(operation)
    stopped = asyncio.create_task(stop.wait())
    try:
        done, _ = await asyncio.wait({task, stopped}, return_when=asyncio.FIRST_COMPLETED)
        if task in done:
            return await task
        logger.info("event=maintenance_shutdown_drain")
        try:
            return await asyncio.wait_for(asyncio.shield(task), timeout=grace)
        except asyncio.TimeoutError:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            return {"status": "stopped"}
    finally:
        stopped.cancel()
        await asyncio.gather(stopped, return_exceptions=True)
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


async def _initialize():
    task = asyncio.create_task(asyncio.to_thread(initialize_database, connect_timeout=2,
        options="-c statement_timeout=5000 -c lock_timeout=1000"))
    try:
        await asyncio.shield(task)
    finally:
        # Cancellation cannot abandon the bounded DDL thread/connection.
        await asyncio.shield(task)
    return {"status": "idle"}


async def run_worker(*, once=False, stop=None, config=None, worker_config=None, install_signals=True):
    config = config or observations.MaintenanceConfig.from_env()
    worker_config = worker_config or WorkerConfig.from_env()
    validate_cadences(config)
    stop = stop or asyncio.Event()
    loop = asyncio.get_running_loop()
    signals = []
    if install_signals:
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, stop.set)
            signals.append(sig)
    logger.info("event=maintenance_worker_start once=%s interval_seconds=%s", once, worker_config.interval_seconds)
    initialized = False
    try:
        while not stop.is_set():
            result = {"status": "error"}
            try:
                if not initialized:
                    await _until_stop(_initialize(), stop)
                    initialized = not stop.is_set()
                if initialized and not stop.is_set():
                    result = await _until_stop(run_cycle(config=config, worker_config=worker_config, stop=stop), stop)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("event=maintenance_worker_retry reason=startup_or_internal")
            if stop.is_set():
                return 0
            if once:
                return 0 if result["status"] in {"idle", "busy"} else 1
            # Every outcome, including exceptions, takes the same conservative retry wait.
            try:
                await asyncio.wait_for(stop.wait(), timeout=worker_config.interval_seconds)
            except asyncio.TimeoutError:
                pass
        return 0
    finally:
        for sig in signals:
            loop.remove_signal_handler(sig)
        logger.info("event=maintenance_worker_stop")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Refresh Sophie Home observations and counts; no enrichment.")
    parser.add_argument("--once", action="store_true", help="Run one bounded due cycle and exit (nonzero if incomplete/failed).")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    # httpx INFO includes request URLs (FetchXML/cookies); keep transport logs out of operations.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    try:
        config = observations.MaintenanceConfig.from_env()
        worker_config = WorkerConfig.from_env()
        validate_cadences(config)
    except (ValueError, TypeError):
        logger.error("event=maintenance_configuration_invalid")
        return 2
    return asyncio.run(run_worker(once=args.once, config=config, worker_config=worker_config))


if __name__ == "__main__":
    raise SystemExit(main())
