import asyncio
import os
import signal
import subprocess
import sys
import unittest
from dataclasses import replace
from datetime import timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch

from backend.app import database
from backend.app.services import maintenance_observations as service
from backend.app.services import test_maintenance_observations as fixtures
from backend.app.services.maintenance_home import read_home_refresh_version
from backend.app.workers import maintenance_refresh as worker

NOW = fixtures.NOW


class WorkerConfigurationTest(unittest.TestCase):
    def test_safe_defaults_and_environment(self):
        self.assertEqual(worker.WorkerConfig(), worker.WorkerConfig(60, 21600))
        with patch.dict(os.environ, {"MAINTENANCE_REFRESH_INTERVAL_SECONDS": "90", "MAINTENANCE_RECONCILE_SECONDS": "43200"}):
            self.assertEqual(worker.WorkerConfig.from_env(), worker.WorkerConfig(90, 43200))

    def test_invalid_configuration_is_sanitized(self):
        for value in ("SECRET", "1", "0", "301", "-60"):
            with self.subTest(value=value), patch.dict(os.environ, {"MAINTENANCE_REFRESH_INTERVAL_SECONDS": value}):
                with self.assertRaisesRegex(ValueError, "^Invalid maintenance worker configuration$"):
                    worker.WorkerConfig.from_env()
        for config in (replace(service.MaintenanceConfig(), discovery_seconds=1),
                       replace(service.MaintenanceConfig(), today_seconds=1),
                       replace(service.MaintenanceConfig(), total_seconds=1)):
            with self.assertRaisesRegex(ValueError, "Unsafe maintenance worker refresh cadence"):
                worker.validate_cadences(config)

    def test_cli_once_and_exit_code(self):
        run = AsyncMock(return_value=0)
        with patch.object(worker, "run_worker", run):
            self.assertEqual(worker.main(["--once"]), 0)
        self.assertTrue(run.await_args.kwargs["once"])

    def test_cli_bad_environment_logs_no_secret(self):
        with patch.dict(os.environ, {"MAINTENANCE_REFRESH_INTERVAL_SECONDS": "SECRET"}), self.assertLogs(worker.logger, "ERROR") as logs:
            self.assertEqual(worker.main(["--once"]), 2)
        self.assertNotIn("SECRET", str(logs.output))

    def test_worker_import_does_not_start_web_newsletter_or_provider(self):
        code = """import sys
import backend.app.workers.maintenance_refresh
from backend.app import database
assert not database._initialized
assert 'backend.app.main' not in sys.modules
assert 'backend.app.services.newsletter' not in sys.modules
assert 'backend.app.services.seamless' not in sys.modules
"""
        result = subprocess.run([sys.executable, "-c", code], capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, "Worker import unexpectedly initialized resources")


class WorkerRefreshTest(unittest.IsolatedAsyncioTestCase):
    # Reuse only the real-PostgreSQL/mock-HTTP fixture, not its test cases.
    account = staticmethod(fixtures.MaintenanceObservationTest.account)
    response = staticmethod(fixtures.MaintenanceObservationTest.response)
    interval = fixtures.MaintenanceObservationTest.interval
    respond = fixtures.MaintenanceObservationTest.respond
    rows = fixtures.MaintenanceObservationTest.rows
    link = fixtures.MaintenanceObservationTest.link

    def setUp(self):
        fixtures.MaintenanceObservationTest.setUp(self)
        self.worker_config = worker.WorkerConfig()
        self.usage_path = Path(__file__).resolve().parents[1] / "services/usage_tracker.json"
        self.usage_before = self.usage_path.read_bytes()
        self.guards = []
        for target in ("backend.app.services.seamless.enrich_with_seamless",
                       "backend.app.services.seamless.update_total_credits_remaining",
                       "backend.app.services.usage.increment_usage",
                       "backend.app.services.dynamics.increment_usage",
                       "backend.app.services.dynamics.enrich_one_account",
                       "backend.app.services.dynamics.enrich_account",
                       "backend.app.services.dynamics.update_account"):
            patcher = patch(target, side_effect=AssertionError("Forbidden enrichment/write operation"))
            self.guards.append(patcher.start())
            self.addCleanup(patcher.stop)

    def tearDown(self):
        fixtures.MaintenanceObservationTest.tearDown(self)
        for guard in self.guards:
            guard.assert_not_called()
        self.assertEqual(self.usage_before, self.usage_path.read_bytes())

    async def cycle(self, now=NOW, **kwargs):
        return await worker.run_cycle(now=now, config=self.config, worker_config=self.worker_config, **kwargs)

    async def test_initial_cycle_and_second_cycle_reuses_all_data(self):
        result = await self.cycle()
        self.assertEqual(result["tasks"], {"discovery": "idle", "total": "idle", "counts": "idle"})
        self.assertTrue(result["changed"])
        self.assertEqual(self.client.get.await_count, 16)
        self.assertEqual(len(self.rows("maintenance_account_observations")), 1)
        self.assertEqual(len(self.rows("maintenance_account_creation_counts")), 14)
        version = read_home_refresh_version()
        result = await self.cycle(now=NOW + timedelta(seconds=60))
        self.assertEqual(result["tasks"], {})
        self.assertFalse(result["changed"])
        self.assertEqual(version, read_home_refresh_version())
        self.assertEqual(self.client.get.await_count, 16)

    async def test_discovery_today_and_total_individual_cadences(self):
        await self.cycle()
        plan = worker.read_due_plan(NOW + timedelta(seconds=119), self.config, self.worker_config)
        self.assertFalse(plan["discovery"])
        self.assertFalse(plan["counts"])
        self.discovery_pages = [{"value": []}]
        result = await self.cycle(now=NOW + timedelta(seconds=120))
        self.assertEqual(result["tasks"], {"discovery": "idle"})
        result = await self.cycle(now=NOW + timedelta(seconds=180))
        self.assertEqual(result["tasks"], {"counts": "idle"})
        self.assertEqual(self.client.get.await_count, 18)
        self.assertFalse(worker.read_due_plan(NOW + timedelta(seconds=3599), self.config, self.worker_config)["total"])
        self.assertTrue(worker.read_due_plan(NOW + timedelta(seconds=3600), self.config, self.worker_config)["total"])

    async def test_reconciliation_only_two_recent_completed_days(self):
        await self.cycle()
        self.discovery_pages = [{"value": []}]
        old = {row["reporting_date"]: row["fetched_at"] for row in self.rows("maintenance_account_creation_counts")}
        self.assertEqual(worker.read_due_plan(NOW + timedelta(hours=5), self.config, self.worker_config)["count_days_due"], 1)
        result = await self.cycle(now=NOW + timedelta(hours=6))
        self.assertEqual(result["tasks"]["counts"], "idle")
        self.assertEqual(self.client.get.await_count, 21)  # discovery + total + three dates
        current = {row["reporting_date"]: row["fetched_at"] for row in self.rows("maintenance_account_creation_counts")}
        today = NOW.astimezone(service.REPORTING_ZONE).date()
        for offset in range(14):
            day = today - timedelta(days=offset)
            self.assertEqual(current[day], NOW + timedelta(hours=6) if offset <= 2 else old[day])

    async def test_midnight_finalizes_yesterday_and_creates_new_day(self):
        await self.cycle()
        # Use a long reconciliation cadence to isolate rollover work.
        tomorrow = service.reporting_day_bounds(NOW.astimezone(service.REPORTING_ZONE).date())[1]
        plan = worker.read_due_plan(tomorrow, self.config, replace(self.worker_config, reconcile_seconds=604800))
        self.assertEqual(plan["count_days_due"], 2)  # new day and yesterday's incomplete count

    async def test_overlap_pagination_budget_and_durable_resume(self):
        self.config = replace(self.config, max_discovery_pages=1)
        self.discovery_pages = [{"value": [self.account("a")], "@odata.nextLink": self.link()}, {"value": [self.account("b")]}]
        first = await self.cycle()
        self.assertEqual(first["tasks"]["discovery"], "incomplete")
        state = next(row for row in self.rows("maintenance_sync_state") if row["sync_key"] == "discovery")
        self.assertIsNone(state["watermark"])
        self.assertEqual(state["next_link"], self.link())
        second = await self.cycle()
        self.assertEqual(second["tasks"], {"discovery": "idle"})
        self.assertEqual(len(self.rows("maintenance_account_observations")), 2)
        self.assertIsNone(next(row for row in self.rows("maintenance_sync_state") if row["sync_key"] == "discovery")["next_link"])

    async def test_concurrent_owner_skips_without_remote_work(self):
        entered, release = asyncio.Event(), asyncio.Event()
        original = self.respond
        async def gated(*args, **kwargs):
            entered.set()
            await release.wait()
            return await original(*args, **kwargs)
        self.client.get.side_effect = gated
        first = asyncio.create_task(self.cycle())
        await entered.wait()
        second = await self.cycle()
        self.assertEqual(second, {"status": "busy", "tasks": {}})
        self.assertEqual(self.client.get.await_count, 1)
        release.set()
        self.assertEqual((await first)["status"], "idle")
        async with service._refresh_lock("worker") as acquired:
            self.assertTrue(acquired)

    async def test_service_lock_skip_does_not_duplicate_queries(self):
        async with service._refresh_lock("discovery") as acquired:
            self.assertTrue(acquired)
            result = await self.cycle()
        self.assertEqual(result["tasks"]["discovery"], "busy")
        self.assertEqual(self.client.get.await_count, 15)  # total + daily counts only

    async def test_failure_releases_lock_and_next_cycle_recovers(self):
        with patch.object(worker, "read_due_plan", side_effect=RuntimeError("SECRET")), self.assertLogs(worker.logger, "WARNING") as logs:
            first = await self.cycle()
        self.assertEqual(first["status"], "error")
        self.assertNotIn("SECRET", str(logs.output))
        self.client.get.assert_not_awaited()
        self.assertEqual((await self.cycle())["status"], "idle")

    async def test_dynamics_failure_preserves_snapshot_and_other_tasks_run(self):
        await self.cycle()
        original = self.respond
        async def unavailable(url, **kwargs):
            if "RetrieveTotalRecordCount" in url:
                raise RuntimeError("Bearer SECRET raw response")
            return await original(url, **kwargs)
        self.client.get.side_effect = unavailable
        self.discovery_pages = [{"value": []}]
        with self.assertLogs(level="WARNING") as logs:
            result = await self.cycle(now=NOW + timedelta(hours=1))
        self.assertEqual(result["tasks"], {"discovery": "idle", "total": "error", "counts": "idle"})
        self.assertNotIn("SECRET", str(logs.output))
        self.assertEqual(self.rows("maintenance_total_account_snapshot")[0]["value"], 3000001)
        state = next(row for row in self.rows("maintenance_sync_state") if row["sync_key"] == "total")
        self.assertEqual(state["last_error"], "dynamics_unavailable")
        self.client.get.side_effect = original
        self.assertEqual((await self.cycle(now=NOW + timedelta(hours=1, seconds=60)))["tasks"], {"total": "idle"})

    async def test_database_unavailable_prevents_remote_work(self):
        with patch.object(service, "get_database_connection", side_effect=RuntimeError("postgres password SECRET")), self.assertLogs(worker.logger, "WARNING") as logs:
            result = await self.cycle()
        self.assertEqual(result["status"], "error")
        self.client.get.assert_not_awaited()
        self.assertNotIn("SECRET", str(logs.output))

    async def test_midcycle_database_failure_aborts_remaining_tasks(self):
        with patch.object(service, "refresh_account_discovery", AsyncMock(return_value={"status": "error", "last_error": "database_unavailable"})), patch.object(service, "refresh_total_account_count", AsyncMock()) as total:
            result = await self.cycle()
        self.assertEqual(result["tasks"], {"discovery": "error"})
        total.assert_not_awaited()
        self.client.get.assert_not_awaited()

    async def test_unexpected_task_failure_is_isolated(self):
        with patch.object(service, "refresh_account_discovery", AsyncMock(side_effect=RuntimeError("SECRET"))):
            result = await self.cycle()
        self.assertEqual(result["tasks"], {"discovery": "error", "total": "idle", "counts": "idle"})
        self.assertEqual(self.client.get.await_count, 15)

    async def test_cancellation_checkpoints_and_releases_both_locks(self):
        entered = asyncio.Event()
        async def blocked(*args, **kwargs):
            entered.set()
            await asyncio.Event().wait()
        self.client.get.side_effect = blocked
        task = asyncio.create_task(self.cycle())
        await entered.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        state = next(row for row in self.rows("maintenance_sync_state") if row["sync_key"] == "discovery")
        self.assertEqual(state["status"], "error")
        self.assertEqual(state["last_error"], "refresh_interrupted")
        self.assertFalse(state["coverage_complete"])
        for key in ("worker", "discovery"):
            async with service._refresh_lock(key) as acquired:
                self.assertTrue(acquired)

    async def test_stop_prevents_new_tasks(self):
        stop = asyncio.Event()
        original = self.respond
        async def stop_after_discovery(*args, **kwargs):
            response = await original(*args, **kwargs)
            stop.set()
            return response
        self.client.get.side_effect = stop_after_discovery
        result = await self.cycle(stop=stop)
        self.assertEqual(result["status"], "stopped")
        self.assertEqual(result["tasks"], {"discovery": "idle"})
        self.assertEqual(self.client.get.await_count, 1)
        stop.set()
        self.assertEqual((await self.cycle(stop=stop))["status"], "stopped")
        self.assertEqual(self.client.get.await_count, 1)

    async def test_once_mode_runs_one_bounded_cycle(self):
        with patch.object(service, "utc_now", return_value=NOW), patch.object(worker, "_initialize", AsyncMock(return_value={"status": "idle"})) as initialize:
            code = await worker.run_worker(once=True, config=self.config, worker_config=self.worker_config, install_signals=False)
        self.assertEqual(code, 0)
        self.assertEqual(self.client.get.await_count, 16)
        initialize.assert_awaited_once()

    async def test_once_respects_lock_and_incomplete_exit(self):
        async with service._refresh_lock("worker"):
            with patch.object(worker, "_initialize", AsyncMock(return_value={"status": "idle"})):
                self.assertEqual(await worker.run_worker(once=True, config=self.config, install_signals=False), 0)
        self.client.get.assert_not_awaited()
        self.config = replace(self.config, max_discovery_pages=1)
        self.discovery_pages = [{"value": [self.account()], "@odata.nextLink": self.link()}]
        with patch.object(worker, "_initialize", AsyncMock(return_value={"status": "idle"})), patch.object(service, "utc_now", return_value=NOW):
            self.assertEqual(await worker.run_worker(once=True, config=self.config, install_signals=False), 1)

    async def test_loop_retries_after_startup_failure_without_tight_loop(self):
        stop = asyncio.Event()
        calls = 0
        async def start():
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("SECRET")
            stop.set()
            return {"status": "idle"}
        original = asyncio.wait_for
        async def fast_wait(awaitable, timeout):
            return await original(awaitable, timeout=0.001)
        with patch.object(worker, "_initialize", AsyncMock(side_effect=start)), patch.object(worker.asyncio, "wait_for", side_effect=fast_wait) as waits, self.assertLogs(worker.logger, "WARNING") as logs:
            self.assertEqual(await worker.run_worker(stop=stop, config=self.config, install_signals=False), 0)
        self.assertEqual(calls, 2)
        self.assertEqual(waits.call_args.kwargs["timeout"], 60)
        self.assertNotIn("SECRET", str(logs.output))

    async def test_signal_handlers_stop_and_are_removed(self):
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        callbacks = {}
        def handler(sig, callback):
            callbacks[sig] = callback
        async def initialize():
            callbacks[signal.SIGTERM]()
            return {"status": "idle"}
        with patch.object(loop, "add_signal_handler", side_effect=handler), patch.object(loop, "remove_signal_handler") as remove, patch.object(worker, "_initialize", AsyncMock(side_effect=initialize)):
            self.assertEqual(await worker.run_worker(stop=stop, config=self.config), 0)
        self.assertEqual(set(callbacks), {signal.SIGTERM, signal.SIGINT})
        self.assertEqual(remove.call_count, 2)
        self.client.get.assert_not_awaited()

    async def test_shutdown_grace_cancels_bounded_inflight_work(self):
        stop, entered, cleaned = asyncio.Event(), asyncio.Event(), asyncio.Event()
        async def inflight():
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cleaned.set()
        task = asyncio.create_task(worker._until_stop(inflight(), stop, grace=0.01))
        await entered.wait()
        stop.set()
        self.assertEqual(await task, {"status": "stopped"})
        self.assertTrue(cleaned.is_set())

    async def test_stop_before_loop_starts_no_cycle(self):
        stop = asyncio.Event()
        stop.set()
        with patch.object(worker, "run_cycle", AsyncMock()) as cycle:
            self.assertEqual(await worker.run_worker(stop=stop, config=self.config, install_signals=False), 0)
        cycle.assert_not_awaited()

    async def test_initialization_uses_bounded_database_options(self):
        with patch.object(worker, "initialize_database") as initialize:
            await worker._initialize()
        initialize.assert_called_once_with(connect_timeout=2, options="-c statement_timeout=5000 -c lock_timeout=1000")

    async def test_shutdown_during_real_cycle_preserves_incomplete_state(self):
        stop, entered = asyncio.Event(), asyncio.Event()
        async def blocked(*args, **kwargs):
            entered.set()
            await asyncio.Event().wait()
        self.client.get.side_effect = blocked
        task = asyncio.create_task(worker._until_stop(self.cycle(stop=stop), stop, grace=0.01))
        await entered.wait()
        stop.set()
        self.assertEqual(await task, {"status": "stopped"})
        state = next(row for row in self.rows("maintenance_sync_state") if row["sync_key"] == "discovery")
        self.assertEqual(state["last_error"], "refresh_interrupted")
        self.assertFalse(state["coverage_complete"])
        self.assertIsNone(state["watermark"])
        self.assertEqual(self.client.get.await_count, 1)
        async with service._refresh_lock("worker") as acquired:
            self.assertTrue(acquired)

    async def test_loop_recovers_after_unexpected_cycle_exception(self):
        stop = asyncio.Event()
        calls = 0
        async def cycle(**kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("SECRET")
            stop.set()
            return {"status": "idle"}
        original = asyncio.wait_for
        async def fast_wait(awaitable, timeout):
            return await original(awaitable, timeout=0.001)
        with patch.object(worker, "_initialize", AsyncMock(return_value={"status": "idle"})), patch.object(worker, "run_cycle", AsyncMock(side_effect=cycle)), patch.object(worker.asyncio, "wait_for", side_effect=fast_wait) as waits:
            self.assertEqual(await worker.run_worker(stop=stop, config=self.config, install_signals=False), 0)
        self.assertEqual(calls, 2)
        self.assertEqual(waits.call_args.kwargs["timeout"], 60)
