import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from backend.app.services import maintenance_total as total
from backend.app.services.test_maintenance_observations import NOW


class TotalFallbackTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        cache = patch.object(total, "total_fallback_cache", total.AsyncStaleCache())
        cache.start()
        self.addCleanup(cache.stop)
        self.client = AsyncMock()
        self.client.__aenter__.return_value = self.client
        self.client.total_count.return_value = 1749732
        patcher = patch.object(total, "MaintenanceDynamicsClient", return_value=self.client)
        patcher.start()
        self.addCleanup(patcher.stop)

    async def test_concurrent_missing_requests_share_one_lookup_and_persistence(self):
        started, release = asyncio.Event(), asyncio.Event()
        async def lookup():
            started.set()
            await release.wait()
            return 1749732
        self.client.total_count.side_effect = lookup
        with patch.object(total, "_db", return_value=None) as db:
            requests = [asyncio.create_task(total.missing_total_snapshot()) for _ in range(20)]
            await started.wait()
            release.set()
            results = await asyncio.gather(*requests)
        self.assertTrue(all(result["snapshot"]["value"] == 1749732 for result in results))
        self.client.total_count.assert_awaited_once()
        self.assertEqual(db.call_count, 2)  # one snapshot recheck and one save
        self.assertEqual(db.call_args.args[0], total._save_total)

    async def test_worker_snapshot_committed_before_lookup_is_reused(self):
        snapshot = {"value": 1749732, "fetched_at": NOW, "source": total.TOTAL_SOURCE}
        with patch.object(total, "_db", return_value=snapshot), patch.object(total, "utc_now", return_value=NOW):
            result = await total.missing_total_snapshot()
        self.assertEqual(result["snapshot"]["value"], 1749732)
        self.client.total_count.assert_not_awaited()

    async def test_database_unavailable_still_returns_and_caches_dynamics_result(self):
        with patch.object(total, "_db", side_effect=RuntimeError("Bearer SECRET")), self.assertLogs(total.logger, level="WARNING") as logs:
            first = await total.missing_total_snapshot()
            second = await total.missing_total_snapshot()
        self.assertEqual(first["snapshot"]["value"], 1749732)
        self.assertFalse(first["persisted"])
        self.assertEqual(first, second)
        self.client.total_count.assert_awaited_once()
        self.assertNotIn("SECRET", str(logs.output))

    async def test_dynamics_outage_is_coalesced_without_inventing_zero(self):
        self.client.total_count.side_effect = RuntimeError("Bearer SECRET")
        with patch.object(total, "_db", return_value=None), self.assertLogs(total.logger, level="WARNING") as logs:
            results = await asyncio.gather(*(total.missing_total_snapshot() for _ in range(20)))
        self.assertTrue(all(result["snapshot"] is None for result in results))
        self.client.total_count.assert_awaited_once()
        self.assertNotIn("SECRET", str(logs.output))
