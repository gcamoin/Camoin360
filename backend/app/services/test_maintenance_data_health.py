import asyncio
import unittest
from datetime import timedelta
from unittest.mock import AsyncMock, patch
from xml.etree import ElementTree as ET

from backend.app.testing_support import temporary_database
from . import maintenance_data_health as health, maintenance_observations as observations
from .maintenance_dynamics import AggregateLimitExceeded, BudgetExceeded, MaintenanceQueryError, RequestBudget
from .maintenance_home import read_home_refresh_version
from .test_maintenance_observations import NOW


def counts(**values):
    return {**dict.fromkeys(health.COUNTERS, 0), **values}


def snapshot(total=100, scored=80, poor=10, needs=20, good=30, excellent=20, score_sum=5840):
    classified = poor + needs + good + excellent
    return counts(total_accounts=total, scored_accounts=scored, score_sum=score_sum,
                  poor_count=poor, needs_enrichment_count=needs, good_count=good, excellent_count=excellent) | {
        "average_score": score_sum / scored if scored else None, "unscored_accounts": total - scored,
        "classified_accounts": classified, "unclassified_accounts": total - classified,
    }


class DataHealthAggregationTest(unittest.IsolatedAsyncioTestCase):
    def test_verified_field_names_and_choice_values(self):
        self.assertEqual(health.HEALTH_FIELD, "cr73c_datahealth")
        self.assertEqual(health.SCORE_FIELD, "cr73c_datahealthscore")
        self.assertEqual([row[2] for row in health.CATEGORIES], [732660003, 732660002, 732660001, 732660000])

    async def test_grouped_sum_and_nonnull_count_use_only_persisted_fields(self):
        client = health.DataHealthClient()
        client.base_url = "https://crm.example/api/data/v9.2"
        client._get = AsyncMock(return_value={"value": [
            {"health": 732660000, "total_accounts": 10, "scored_accounts": 10, "score_sum": 100},
            {"health": 732660001, "total_accounts": 20, "scored_accounts": 20, "score_sum": 800},
            {"health": 732660002, "total_accounts": 30, "scored_accounts": 30, "score_sum": 2100},
            {"health": 732660003, "total_accounts": 20, "scored_accounts": 20, "score_sum": 1800},
            {"total_accounts": 20, "scored_accounts": 0},
        ]})
        result = await client.health_counts(NOW - timedelta(days=1), NOW)
        self.assertEqual(result, counts(total_accounts=100, scored_accounts=80, score_sum=4800,
                         poor_count=10, needs_enrichment_count=20, good_count=30, excellent_count=20))
        xml = ET.fromstring(client._get.await_args.kwargs["params"]["fetchXml"])
        self.assertEqual(xml.attrib, {"aggregate": "true"})
        self.assertEqual([a.attrib for a in xml.findall("entity/attribute")], [
            {"name": "cr73c_datahealth", "alias": "health", "groupby": "true"},
            {"name": "accountid", "alias": "total_accounts", "aggregate": "count"},
            {"name": "cr73c_datahealthscore", "alias": "scored_accounts", "aggregate": "countcolumn"},
            {"name": "cr73c_datahealthscore", "alias": "score_sum", "aggregate": "sum"},
        ])
        self.assertEqual([c.get("operator") for c in xml.findall("entity/filter/condition")], ["ge", "lt"])
        self.assertNotIn("$select", client._get.await_args.kwargs["params"])

    async def test_split_average_is_weighted_and_null_scores_excluded(self):
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.first_created_on.return_value = NOW - timedelta(days=2)
        client.health_counts.side_effect = [AggregateLimitExceeded(),
            counts(total_accounts=100, scored_accounts=10, score_sum=1000, excellent_count=10),
            counts(total_accounts=20, scored_accounts=20, score_sum=0, poor_count=20)]
        with patch.object(health, "DataHealthClient", return_value=client):
            result = await health.collect_data_health(NOW, RequestBudget(4))
        self.assertAlmostEqual(result["average_score"], 1000 / 30)
        self.assertEqual(result["unscored_accounts"], 90)
        self.assertEqual(result["classified_accounts"], 30)
        self.assertEqual(result["poor_count"], 20)
        client.post.assert_not_awaited(); client.patch.assert_not_awaited()

    async def test_budget_and_unsplittable_limits_never_return_partial_metrics(self):
        client = AsyncMock()
        client.health_counts.side_effect = AggregateLimitExceeded()
        with self.assertRaises(BudgetExceeded):
            await health.count_health_interval(client, NOW - timedelta(days=1), NOW, RequestBudget(2))
        client.health_counts.reset_mock()
        with self.assertRaisesRegex(MaintenanceQueryError, "unsplittable"):
            await health.count_health_interval(client, NOW, NOW + timedelta(microseconds=1), RequestBudget(1))
        client.health_counts.assert_awaited_once()

    def test_grouped_kpis_exclude_unclassified_and_keep_distribution_separate(self):
        result = health.home_data_health({**snapshot(), "fetched_at": NOW, "source": health.SOURCE}, {"status": "idle"}, NOW)
        self.assertEqual(result["metrics"]["needs_enrichment"], {"count": 30, "percentage": 37.5})
        self.assertEqual(result["metrics"]["healthy_accounts"], {"count": 50, "percentage": 62.5})
        self.assertEqual([row["count"] for row in result["data_health_distribution"]], [20, 30, 20, 10])
        self.assertEqual(result["data_health"]["unscored_accounts"], 20)

    def test_missing_snapshot_and_zero_classification_are_distinct(self):
        missing = health.home_data_health(None, {}, NOW)
        self.assertIsNone(missing["metrics"]["needs_enrichment"]["count"])
        self.assertIsNone(missing["metrics"]["average_data_health"]["value"])
        known = {**snapshot(total=10, scored=0, poor=0, needs=0, good=0, excellent=0, score_sum=0), "fetched_at": NOW, "source": health.SOURCE}
        result = health.home_data_health(known, {"status": "idle"}, NOW)
        self.assertEqual(result["metrics"]["needs_enrichment"]["count"], 0)
        self.assertIsNone(result["metrics"]["needs_enrichment"]["percentage"])
        self.assertIsNone(result["metrics"]["average_data_health"]["value"])
        self.assertEqual(result["data_health"]["unscored_accounts"], 10)


class DataHealthPersistenceTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        isolated = temporary_database(); isolated.start(); self.addCleanup(isolated.stop)
        self.collect = AsyncMock(return_value=snapshot())
        patcher = patch.object(health, "collect_data_health", self.collect); patcher.start(); self.addCleanup(patcher.stop)

    async def test_snapshot_cache_version_cadence_and_no_account_mirror(self):
        before = read_home_refresh_version()
        result = await health.refresh_data_health(now=NOW)
        self.assertEqual(result["status"], "idle")
        saved = observations._db(health.read_snapshot)
        self.assertEqual(saved["average_score"], 73)
        self.assertEqual(saved["unscored_accounts"], 20)
        self.assertEqual(saved["source"], health.SOURCE)
        self.assertNotEqual(before, read_home_refresh_version())
        self.assertTrue((await health.refresh_data_health(now=NOW + timedelta(seconds=1799)))["skipped"])
        self.collect.assert_awaited_once()
        await health.refresh_data_health(now=NOW + timedelta(seconds=1800))
        self.assertEqual(self.collect.await_count, 2)

    async def test_failure_retains_valid_snapshot_and_sanitizes_error(self):
        await health.refresh_data_health(now=NOW)
        self.collect.side_effect = RuntimeError("Bearer SECRET raw provider payload")
        result = await health.refresh_data_health(now=NOW + timedelta(hours=1))
        self.assertEqual(result["status"], "error")
        self.assertNotIn("SECRET", str(result))
        saved = observations._db(health.read_snapshot)
        self.assertEqual(saved["average_score"], 73)
        self.assertEqual(saved["fetched_at"], NOW)
        self.assertTrue(health.home_data_health(saved, result, NOW + timedelta(hours=1))["freshness"]["is_stale"])

    async def test_database_failure_prevents_dynamics_read(self):
        with patch.object(observations, "get_database_connection", side_effect=RuntimeError("SECRET")):
            result = await health.refresh_data_health(now=NOW)
        self.assertEqual(result["error"], "database_unavailable")
        self.collect.assert_not_awaited()

    async def test_lock_skip_and_cancellation_release(self):
        async with observations._refresh_lock("data_health"):
            self.assertEqual((await health.refresh_data_health(now=NOW))["status"], "busy")
        self.collect.assert_not_awaited()
        entered = asyncio.Event()
        async def blocked(*_args):
            entered.set(); await asyncio.Event().wait()
        self.collect.side_effect = blocked
        task = asyncio.create_task(health.refresh_data_health(now=NOW))
        await entered.wait(); task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        async with observations._refresh_lock("data_health") as acquired:
            self.assertTrue(acquired)
        state = observations._db(lambda connection: dict(connection.execute("SELECT * FROM maintenance_sync_state WHERE sync_key = 'data_health'").fetchone()))
        self.assertEqual(state["status"], "error")
        self.assertEqual(state["last_error"], "refresh_interrupted")
