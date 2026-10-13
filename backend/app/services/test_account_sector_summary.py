import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from xml.etree import ElementTree as ET

from . import account_sector_summary as summary, dynamics
from .maintenance_dynamics import AggregateLimitExceeded, BudgetExceeded, MaintenanceQueryError, RequestBudget

START = datetime(2026, 1, 1, tzinfo=timezone.utc)
END = START + timedelta(days=2)


class SectorSummaryTest(unittest.IsolatedAsyncioTestCase):
    async def test_grouped_query_has_half_open_boundaries_and_no_record_enumeration(self):
        client = summary.SectorCountClient()
        client.base_url = "https://crm.example/api/data/v9.2"
        client.headers = {}
        client._get = AsyncMock(return_value={"value": [
            {"sector": "Retail", "account_count": "205242"},
            {"sector": None, "account_count": 12},
            {"sector": 1, "sector@OData.Community.Display.V1.FormattedValue": "Services", "account_count": 42},
        ]})
        result = await client.sector_counts(START, END)
        self.assertEqual(result, {"Retail": 205242, "Unspecified": 12, "Services": 42})
        xml = ET.fromstring(client._get.await_args.kwargs["params"]["fetchXml"])
        self.assertEqual(xml.attrib, {"aggregate": "true"})
        self.assertEqual(xml.find("entity/attribute").attrib, {"name": "new_sector", "alias": "sector", "groupby": "true"})
        self.assertEqual([c.get("operator") for c in xml.findall("entity/filter/condition")], ["ge", "lt"])
        self.assertNotIn("aggregatelimit", xml.attrib)

    async def test_aggregate_limit_splits_intervals_and_merges_exactly(self):
        client = AsyncMock()
        client.sector_counts.side_effect = [AggregateLimitExceeded(), {"Retail": 30, "Other": 2}, {"Retail": 70}]
        result = await summary.count_sector_interval(client, START, END, RequestBudget(3))
        self.assertEqual(result, {"Retail": 100, "Other": 2})
        middle = START + (END - START) / 2
        self.assertEqual(client.sector_counts.await_args_list[1].args, (START, middle))
        self.assertEqual(client.sector_counts.await_args_list[2].args, (middle, END))

    async def test_budget_failure_never_returns_partial_totals(self):
        client = AsyncMock()
        client.sector_counts.side_effect = [AggregateLimitExceeded(), {"Retail": 30}]
        with self.assertRaises(BudgetExceeded):
            await summary.count_sector_interval(client, START, END, RequestBudget(2))
        self.assertEqual(client.sector_counts.await_count, 2)

    async def test_single_instant_limit_fails_without_scanning_accounts(self):
        client = AsyncMock()
        client.sector_counts.side_effect = AggregateLimitExceeded()
        with self.assertRaisesRegex(MaintenanceQueryError, "unsplittable"):
            await summary.count_sector_interval(client, START, START + timedelta(microseconds=1), RequestBudget(2))
        client.sector_counts.assert_awaited_once()

    async def test_truncated_groups_do_not_become_complete_totals(self):
        client = summary.SectorCountClient()
        client.base_url = "https://crm.example/api/data/v9.2"
        client.headers = {}
        client._get = AsyncMock(return_value={"value": [{"sector": "Retail", "account_count": 30}], "@odata.nextLink": "untrusted"})
        with self.assertRaises(AggregateLimitExceeded):
            await client.sector_counts(START, END)
        client._get.assert_awaited_once()

    async def test_earliest_boundary_reads_only_one_timestamp(self):
        client = summary.SectorCountClient()
        client.base_url = "https://crm.example/api/data/v9.2"
        client._get = AsyncMock(return_value={"value": [{"createdon": "2026-01-01T00:00:00Z"}]})
        self.assertEqual(await client.first_created_on(), START)
        self.assertEqual(client._get.await_args.kwargs["params"], {"$select": "createdon", "$orderby": "createdon asc", "$top": 1})

    async def test_summary_ordering_zero_and_no_writes(self):
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.first_created_on.return_value = START
        client.sector_counts.return_value = {"Other": 2, "Retail": 100}
        with patch.object(summary, "SectorCountClient", return_value=client):
            result = await summary.load_sector_summary()
        self.assertEqual(result, {"total_accounts": 102, "sector_count": 2, "sectors": [{"sector": "Retail", "account_count": 100}, {"sector": "Other", "account_count": 2}]})
        client.post.assert_not_awaited(); client.patch.assert_not_awaited()
        client.first_created_on.return_value = None
        with patch.object(summary, "SectorCountClient", return_value=client):
            empty = await summary.load_sector_summary()
        self.assertEqual(empty, {"total_accounts": 0, "sector_count": 0, "sectors": []})

    async def test_valid_cache_avoids_query_and_failure_retains_last_snapshot(self):
        previous = {"total_accounts": 102, "sector_count": 1, "sectors": [{"sector": "Retail", "account_count": 102}]}
        with patch.dict(dynamics._SUMMARY_CACHE, {"data": previous, "expires_at": float("inf")}), patch.object(summary, "load_sector_summary", new=AsyncMock()) as load:
            self.assertEqual(await dynamics.get_account_sector_counts(), previous)
            load.assert_not_awaited()
        with patch.dict(dynamics._SUMMARY_CACHE, {"data": previous, "expires_at": 0}), patch.object(summary, "load_sector_summary", new=AsyncMock(side_effect=MaintenanceQueryError("dynamics_query_failed"))):
            with self.assertRaises(MaintenanceQueryError):
                await dynamics.get_account_sector_counts()
            self.assertEqual(dynamics._SUMMARY_CACHE["data"], previous)
