import asyncio
import json
import os
import unittest
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from urllib.parse import urlencode
from xml.etree import ElementTree as ET

import httpx

from backend.app import database
from backend.app.services import maintenance_dynamics as query
from backend.app.services import maintenance_observations as service
from backend.app.services.account_enrichment_history import AutomaticAttempt
from backend.app.testing_support import temporary_database

NOW = datetime(2026, 10, 7, 16, tzinfo=timezone.utc)
BASE = "https://example.crm.dynamics.com/api/data/v9.2"


class ReportingBoundariesTest(unittest.TestCase):
    def test_new_york_half_open_day_boundaries(self):
        self.assertEqual(service.reporting_day_bounds(date(2026, 10, 7)),
                         (datetime(2026, 10, 7, 4, tzinfo=timezone.utc), datetime(2026, 10, 8, 4, tzinfo=timezone.utc)))

    def test_dst_spring_day_is_23_hours(self):
        start, end = service.reporting_day_bounds(date(2026, 3, 8))
        self.assertEqual(start.hour, 5)
        self.assertEqual(end.hour, 4)
        self.assertEqual(end - start, timedelta(hours=23))

    def test_dst_fall_day_is_25_hours(self):
        start, end = service.reporting_day_bounds(date(2026, 11, 1))
        self.assertEqual(start.hour, 4)
        self.assertEqual(end.hour, 5)
        self.assertEqual(end - start, timedelta(hours=25))

    def test_monday_start_week_crosses_dst_correctly(self):
        start, end = service.reporting_week_bounds(datetime(2026, 11, 1, 16, tzinfo=timezone.utc))
        self.assertEqual(start, datetime(2026, 10, 26, 4, tzinfo=timezone.utc))
        self.assertEqual(end, datetime(2026, 11, 2, 5, tzinfo=timezone.utc))
        self.assertEqual(end - start, timedelta(hours=169))

    def test_near_utc_midnight_still_uses_previous_local_day(self):
        start, _ = service.reporting_week_bounds(datetime(2026, 10, 5, 2, tzinfo=timezone.utc))
        self.assertEqual(start, datetime(2026, 9, 28, 4, tzinfo=timezone.utc))

    def test_configurable_grace_and_bounded_config(self):
        with patch.dict(os.environ, {"MAINTENANCE_PENDING_GRACE_SECONDS": "600"}):
            self.assertEqual(service.MaintenanceConfig.from_env().pending_grace_seconds, 600)
        self.assertEqual(service.MaintenanceConfig().pending_grace_seconds, 300)
        for values in ({"max_discovery_pages": 0}, {"page_size": 5001}, {"bootstrap_days": 31}, {"retention_days": 5}, {"max_count_requests": 257}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                service.MaintenanceConfig(**values)
        with patch.dict(os.environ, {"MAINTENANCE_PENDING_GRACE_SECONDS": "secret-token"}):
            with self.assertRaisesRegex(ValueError, "^Invalid maintenance refresh configuration$"):
                service.MaintenanceConfig.from_env()


class MaintenanceObservationTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        isolated = temporary_database()
        isolated.start()
        self.addCleanup(isolated.stop)
        self.client = AsyncMock()
        self.client.__aenter__.return_value = self.client
        self.client.get.side_effect = self.respond
        self.environment = patch.dict(os.environ, {"DYNAMICS_API_URL": BASE})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.patches = [patch.object(query, "get_access_token", AsyncMock(return_value="secret-bearer-token")),
                        patch.object(query.httpx, "AsyncClient", return_value=self.client)]
        for patcher in self.patches:
            patcher.start()
            self.addCleanup(patcher.stop)
        self.config = service.MaintenanceConfig(page_size=2)
        self.discovery_pages = [{"value": [self.account()]}]
        self.intervals = []

    def tearDown(self):
        # No Dynamics mutation or provider search can occur through this HTTP client.
        self.client.post.assert_not_awaited()
        self.client.patch.assert_not_awaited()
        self.client.delete.assert_not_awaited()

    @staticmethod
    def account(account_id="account-1", created=None, **extra):
        return {"accountid": account_id, "name": "Acme", "createdon": query.utc_timestamp(created or NOW - timedelta(minutes=2)),
                "cr73c_enrichmentattempted": False, "cr73c_enrichmentlastattemptedon": None, **extra}

    @staticmethod
    def response(data, status=200):
        return httpx.Response(status, json=data)

    def interval(self, params):
        root = ET.fromstring(params["fetchXml"])
        self.assertEqual(root.attrib, {"aggregate": "true"})
        self.assertEqual(root.find("entity").attrib["name"], "account")
        self.assertEqual(root.find("entity/attribute").attrib, {"name": "accountid", "alias": "account_count", "aggregate": "count"})
        conditions = root.findall("entity/filter/condition")
        self.assertEqual([condition.attrib["operator"] for condition in conditions], ["ge", "lt"])
        self.assertTrue(all(condition.attrib["attribute"] == "createdon" for condition in conditions))
        boundaries = tuple(service.aware_timestamp(condition.attrib["value"]) for condition in conditions)
        self.intervals.append(boundaries)
        return boundaries

    async def respond(self, url, *, params=None, headers=None):
        self.assertEqual(headers["Authorization"], "Bearer secret-bearer-token")
        if "RetrieveTotalRecordCount" in url:
            self.assertEqual(params, {"@p1": '["account"]'})
            return self.response({"EntityRecordCountCollection": {"Keys": ["account"], "Values": [3000001]}})
        if params and "fetchXml" in params:
            start, _ = self.interval(params)
            return self.response({"value": [{"account_count": start.astimezone(service.REPORTING_ZONE).day}]})
        return self.response(self.discovery_pages.pop(0))

    def link(self, start=None, end=NOW, cookie="opaque-paging-cookie"):
        start = start or service.reporting_day_bounds(NOW.astimezone(service.REPORTING_ZONE).date() - timedelta(days=13))[0]
        return BASE + "/accounts?" + urlencode({**query.discovery_params(start, end), "$skiptoken": cookie})

    def rows(self, table):
        self.assertIn(table, {"maintenance_account_observations", "maintenance_sync_state", "maintenance_total_account_snapshot", "maintenance_account_creation_counts"})
        with database.get_database_connection() as connection:
            connection.execute("SET LOCAL TIME ZONE 'UTC'")
            return [dict(row) for row in connection.execute(f"SELECT * FROM {table}").fetchall()]

    async def discover(self, now=NOW, **kwargs):
        return await service.refresh_account_discovery(now=now, config=kwargs.pop("config", self.config), **kwargs)

    async def counts(self, now=NOW, **kwargs):
        return await service.refresh_account_creation_counts(now=now, config=kwargs.pop("config", self.config), **kwargs)

    async def test_recent_discovery_persists_only_selected_metadata(self):
        self.discovery_pages = [{"value": [self.account(unnecessary_payload="secret-provider-payload")]}]
        state = await self.discover()
        self.assertEqual(state["status"], "idle")
        self.assertTrue(state["coverage_complete"])
        self.assertEqual(state["watermark"], NOW)
        self.assertEqual(state["tracking_started_at"], NOW)
        row = self.rows("maintenance_account_observations")[0]
        self.assertEqual(row["dynamics_account_id"], "account-1")
        self.assertEqual(row["first_observed_at"], NOW)
        self.assertEqual(row["last_observed_at"], NOW)
        self.assertFalse(row["enrichment_attempted"])
        self.assertNotIn("secret-provider-payload", json.dumps(row, default=str))
        call = self.client.get.await_args
        self.assertEqual(call.kwargs["params"]["$select"], query.ACCOUNT_FIELDS)
        self.assertEqual(call.kwargs["params"]["$orderby"], "createdon asc,accountid asc")
        self.assertNotIn("$top", call.kwargs["params"])
        self.assertNotIn("$count", call.kwargs["params"])
        self.assertEqual(call.kwargs["headers"]["Prefer"], "odata.maxpagesize=2")

    async def test_upsert_preserves_first_seen_and_overlapping_window(self):
        await self.discover()
        later = NOW + timedelta(minutes=2)
        self.discovery_pages = [{"value": [self.account(name="Renamed", cr73c_enrichmentattempted=True,
                                                       cr73c_enrichmentlastattemptedon=query.utc_timestamp(NOW))]}]
        state = await self.discover(now=later)
        rows = self.rows("maintenance_account_observations")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["first_observed_at"], NOW)
        self.assertEqual(rows[0]["last_observed_at"], later)
        self.assertEqual(rows[0]["account_name"], "Renamed")
        self.assertTrue(rows[0]["enrichment_attempted"])
        self.assertEqual(rows[0]["enrichment_last_attempted_on"], NOW)
        self.assertEqual(state["watermark"], later)
        self.assertEqual(self.client.get.await_args.kwargs["params"]["$filter"],
                         f"createdon ge {query.utc_timestamp(NOW - timedelta(minutes=5))} and createdon lt {query.utc_timestamp(later)}")

    async def test_pagination_follows_unchanged_cursor_and_completes_interval(self):
        link = self.link(cookie="cookie-with-%-escapes")
        self.discovery_pages = [{"value": [self.account("a")], "@odata.nextLink": link}, {"value": [self.account("b")]}]
        state = await self.discover()
        self.assertEqual(state["requests_last_refresh"], 2)
        self.assertEqual(len(self.rows("maintenance_account_observations")), 2)
        self.assertEqual(state["watermark"], NOW)
        self.assertIsNone(state["next_link"])
        self.assertEqual(self.client.get.await_args_list[1].args[0], link)
        self.assertIsNone(self.client.get.await_args_list[1].kwargs["params"])
        self.assertEqual(self.client.get.await_args_list[1].kwargs["headers"]["Prefer"], "odata.maxpagesize=2")

    async def test_page_budget_resumes_durably_without_advancing_unfinished_watermark(self):
        link = self.link()
        self.discovery_pages = [{"value": [self.account("a")], "@odata.nextLink": link}, {"value": [self.account("b")]}]
        config = replace(self.config, max_discovery_pages=1)
        state = await self.discover(config=config)
        self.assertEqual(state["status"], "incomplete")
        self.assertFalse(state["coverage_complete"])
        self.assertIsNone(state["watermark"])
        self.assertEqual(state["next_link"], link)
        self.assertEqual(state["last_error"], "request_budget_exhausted")
        self.assertEqual(self.client.get.await_count, 1)
        state = await self.discover(config=replace(config, page_size=1))
        self.assertEqual(state["status"], "idle")
        self.assertEqual(state["watermark"], NOW)
        # Resume must preserve the original page-size preference even after configuration changes.
        self.assertEqual(self.client.get.await_args.kwargs["headers"]["Prefer"], "odata.maxpagesize=2")
        self.assertEqual(len(self.rows("maintenance_account_observations")), 2)

    async def test_failed_page_preserves_observations_cursor_and_previous_watermark(self):
        await self.discover()
        later = NOW + timedelta(minutes=2)
        link = self.link(NOW - timedelta(minutes=5), later)
        self.client.get.side_effect = [self.response({"value": [self.account("new")], "@odata.nextLink": link}),
                                     self.response({"error": {"code": "failure", "message": "secret-bearer-token"}}, 503)]
        state = await self.discover(now=later)
        self.assertEqual(state["status"], "error")
        self.assertFalse(state["coverage_complete"])
        self.assertEqual(state["watermark"], NOW)
        self.assertEqual(state["next_link"], link)
        self.assertEqual(len(self.rows("maintenance_account_observations")), 2)
        self.assertEqual(state["last_succeeded_at"], NOW)
        self.assertNotIn("secret-bearer-token", json.dumps(state, default=str))

    async def test_resumed_old_interval_then_catches_up_with_remaining_budget(self):
        link = self.link()
        self.discovery_pages = [{"value": [self.account("a")], "@odata.nextLink": link}]
        await self.discover(config=replace(self.config, max_discovery_pages=1))
        later = NOW + timedelta(minutes=2)
        self.discovery_pages = [{"value": [self.account("b")]}, {"value": []}]
        state = await self.discover(now=later)
        self.assertEqual(state["watermark"], later)
        self.assertEqual(state["status"], "idle")
        self.assertEqual(state["requests_last_refresh"], 2)

    async def test_row_cap_never_silently_evicts_covered_accounts(self):
        await self.discover(config=replace(self.config, max_observations=1))
        self.discovery_pages = [{"value": [self.account("new")]}]
        state = await self.discover(now=NOW + timedelta(minutes=2), config=replace(self.config, max_observations=1))
        self.assertEqual(state["last_error"], "observation_row_limit")
        self.assertFalse(state["coverage_complete"])
        self.assertEqual(state["watermark"], NOW)
        self.assertEqual(len(self.rows("maintenance_account_observations")), 1)

    async def test_retention_prunes_only_old_observation_metadata(self):
        await self.discover()
        with database.get_database_connection() as connection:
            connection.execute("""INSERT INTO maintenance_account_observations
                (dynamics_account_id, dynamics_created_on, first_observed_at, last_observed_at)
                VALUES ('ancient', ?, ?, ?)""", (NOW - timedelta(days=40), NOW, NOW))
        self.discovery_pages = [{"value": []}]
        await self.discover(now=NOW + timedelta(minutes=2))
        self.assertEqual([row["dynamics_account_id"] for row in self.rows("maintenance_account_observations")], ["account-1"])

    async def test_long_outage_is_an_explicit_retention_gap_not_a_watermark_jump(self):
        await self.discover()
        state = await self.discover(now=NOW + timedelta(days=40))
        self.assertEqual(state["last_error"], "discovery_retention_gap")
        self.assertEqual(state["watermark"], NOW)
        self.assertFalse(state["coverage_complete"])
        self.assertEqual(self.client.get.await_count, 1)

    async def test_unsafe_unbounded_and_repeating_next_links_are_rejected(self):
        for link in ("https://attacker.example/accounts?$skiptoken=secret", BASE + "/accounts?$skiptoken=unbounded",
                     BASE + "/contacts?" + urlencode(query.discovery_params(NOW, NOW)), self.link() + "&access_token=secret"):
            with self.subTest(link_host=link.split("?")[0]):
                self.discovery_pages = [{"value": [self.account()], "@odata.nextLink": link}]
                state = await self.discover(force=True)
                self.assertEqual(state["last_error"], "invalid_discovery_cursor")
                self.assertIsNone(state["watermark"])
                self.assertEqual(self.rows("maintenance_account_observations"), [])
        link = self.link()
        self.discovery_pages = [{"value": [self.account()], "@odata.nextLink": link},
                                {"value": [self.account()], "@odata.nextLink": link}]
        state = await self.discover(force=True)
        self.assertEqual(state["last_error"], "invalid_discovery_cursor")
        self.assertIsNone(state["watermark"])

    async def test_invalid_or_out_of_window_page_is_not_committed(self):
        for row in ({"accountid": "bad", "createdon": "not-a-date"}, self.account(created=NOW),
                    self.account(created=NOW - timedelta(days=60)), self.account(cr73c_enrichmentattempted="false")):
            with self.subTest(field_names=list(row)):
                self.discovery_pages = [{"value": [row]}]
                state = await self.discover(force=True)
                self.assertEqual(state["last_error"], "invalid_discovery_page")
                self.assertIsNone(state["watermark"])
                self.assertEqual(self.rows("maintenance_account_observations"), [])

    async def test_cross_worker_lock_prevents_duplicate_refresh(self):
        async with service._refresh_lock("discovery") as locked:
            self.assertTrue(locked)
            self.assertEqual(await self.discover(), {"status": "busy"})
        self.client.get.assert_not_awaited()
        self.assertEqual((await self.discover())["status"], "idle")

    async def test_clock_regression_cannot_move_watermark_backwards(self):
        await self.discover()
        state = await self.discover(now=NOW - timedelta(seconds=1), force=True)
        self.assertEqual(state["last_error"], "refresh_clock_regression")
        self.assertEqual(state["watermark"], NOW)
        self.assertEqual(self.client.get.await_count, 1)

    async def test_cancelled_refresh_records_incomplete_state_and_releases_worker_lock(self):
        self.client.get.side_effect = asyncio.CancelledError
        with self.assertRaises(asyncio.CancelledError):
            await self.discover()
        state = self.rows("maintenance_sync_state")[0]
        self.assertFalse(state["coverage_complete"])
        self.assertIsNone(state["watermark"])
        self.assertEqual(state["last_error"], "refresh_interrupted")
        self.client.get.side_effect = self.respond
        self.assertEqual((await self.discover())["status"], "idle")

    async def test_refresh_cadence_reuses_recent_discovery_and_hourly_total(self):
        await self.discover()
        state = await self.discover(now=NOW + timedelta(seconds=60))
        self.assertTrue(state["skipped"])
        await service.refresh_total_account_count(now=NOW, config=self.config)
        state = await service.refresh_total_account_count(now=NOW + timedelta(minutes=30), config=self.config)
        self.assertTrue(state["skipped"])
        self.assertEqual(self.client.get.await_count, 2)

    async def test_total_snapshot_is_not_limited_to_5000(self):
        state = await service.refresh_total_account_count(now=NOW, config=self.config)
        self.assertEqual(state["status"], "idle")
        row = self.rows("maintenance_total_account_snapshot")[0]
        self.assertEqual(row["value"], 3000001)
        self.assertEqual(row["source"], query.TOTAL_SOURCE)
        self.assertEqual(row["fetched_at"], NOW)
        self.assertIn("RetrieveTotalRecordCount(EntityNames=@p1)", self.client.get.await_args.args[0])

    async def test_failed_total_refresh_retains_previous_value_and_reports_error(self):
        await service.refresh_total_account_count(now=NOW, config=self.config)
        self.client.get.side_effect = httpx.ConnectError("Bearer secret-bearer-token")
        with self.assertLogs(service.logger, level="WARNING") as logs:
            state = await service.refresh_total_account_count(now=NOW + timedelta(hours=1), config=self.config)
        cached = service.read_count_snapshots(now=NOW + timedelta(hours=1), config=self.config)
        self.assertEqual(state["status"], "error")
        self.assertEqual(cached["total"]["value"], 3000001)
        self.assertEqual(cached["total"]["fetched_at"], NOW)
        self.assertTrue(cached["total"]["is_stale"])
        self.assertNotIn("secret-bearer-token", json.dumps(cached, default=str))
        self.assertNotIn("secret-bearer-token", " ".join(logs.output))

    async def test_missing_counts_are_null_not_zero(self):
        self.client.get.side_effect = httpx.ConnectError("secret-bearer-token")
        await service.refresh_total_account_count(now=NOW, config=self.config)
        await self.counts()
        cached = service.read_count_snapshots(now=NOW, config=self.config)
        self.assertIsNone(cached["total"])
        self.assertIsNone(cached["today"])
        self.assertIsNone(cached["this_week"]["value"])
        self.assertTrue(all(row["value"] is None for row in cached["daily"]))

    async def test_successful_zero_count_is_distinct_from_missing_snapshot(self):
        self.client.get.side_effect = None
        self.client.get.return_value = self.response({"EntityRecordCountCollection": {"Keys": ["account"], "Values": [0]}})
        self.assertEqual((await service.refresh_total_account_count(now=NOW))["status"], "idle")
        self.client.get.return_value = self.response({"value": [{"account_count": 0}]})
        await self.counts()
        cached = service.read_count_snapshots(now=NOW)
        self.assertEqual(cached["total"]["value"], 0)
        self.assertEqual(cached["today"]["value"], 0)
        self.assertEqual(cached["this_week"]["value"], 0)

    async def test_invalid_total_responses_do_not_invent_values(self):
        for values in ([], [None], [-1], [True], ["bad"], [0, 1]):
            self.client.get.return_value = self.response({"EntityRecordCountCollection": {"Keys": ["account"], "Values": values}})
            self.client.get.side_effect = None
            state = await service.refresh_total_account_count(now=NOW, config=self.config, force=True)
            self.assertEqual(state["last_error"], "invalid_count_response")
            self.assertEqual(self.rows("maintenance_total_account_snapshot"), [])

    async def test_today_week_and_14_daily_counts_use_only_server_aggregates(self):
        state = await self.counts()
        self.assertEqual(state["status"], "idle")
        self.assertEqual(state["requests_last_refresh"], 14)
        cached = service.read_count_snapshots(now=NOW, config=self.config)
        self.assertEqual(cached["today"]["value"], 7)
        self.assertEqual(cached["this_week"]["value"], 5 + 6 + 7)
        self.assertEqual(cached["this_week"]["start"], datetime(2026, 10, 5, 4, tzinfo=timezone.utc))
        self.assertEqual(len(cached["daily"]), 14)
        self.assertEqual(cached["daily"][0]["date"], date(2026, 9, 24))
        self.assertEqual(cached["daily"][-1]["date"], date(2026, 10, 7))
        self.assertFalse(cached["today"]["is_complete"])
        self.assertTrue(all(row["is_complete"] for row in cached["daily"][:-1]))
        self.assertEqual(self.intervals[0], (datetime(2026, 10, 7, 4, tzinfo=timezone.utc), NOW))
        self.assertTrue(all("fetchXml" in call.kwargs["params"] for call in self.client.get.await_args_list))
        self.client.get.reset_mock()
        service.read_count_snapshots(now=NOW, config=self.config)
        service.read_recent_account_observations(now=NOW, config=self.config)
        self.client.get.assert_not_awaited()

    async def test_completed_days_are_reused_and_today_refreshed_only_when_due(self):
        await self.counts()
        self.client.get.reset_mock()
        await self.counts(now=NOW + timedelta(minutes=2))
        self.client.get.assert_not_awaited()
        state = await self.counts(now=NOW + timedelta(minutes=4))
        self.assertEqual(state["requests_last_refresh"], 1)
        self.assertEqual(self.client.get.await_count, 1)

    async def test_day_rollover_finalizes_yesterday_and_queries_new_today(self):
        await self.counts()
        self.client.get.reset_mock()
        later = datetime(2026, 10, 8, 4, 1, tzinfo=timezone.utc)
        state = await self.counts(now=later)
        self.assertEqual(state["requests_last_refresh"], 2)
        previous = next(row for row in self.rows("maintenance_account_creation_counts") if row["reporting_date"] == date(2026, 10, 7))
        self.assertTrue(previous["is_complete"])
        self.assertEqual(previous["interval_end"], datetime(2026, 10, 8, 4, tzinfo=timezone.utc))

    async def test_supports_30_days_without_record_enumeration(self):
        state = await self.counts(days=30)
        self.assertEqual(state["requests_last_refresh"], 30)
        self.assertEqual(len(service.read_count_snapshots(now=NOW, days=30)["daily"]), 30)

    async def test_aggregate_overflow_splits_into_nonoverlapping_intervals(self):
        async def overflow(url, *, params, headers):
            start, end = self.interval(params)
            if end - start > timedelta(hours=12):
                return self.response({"error": {"code": "0x8004E023", "message": "unsafe raw response"}}, 400)
            return self.response({"value": [{"account_count": "17"}]})
        self.client.get.side_effect = overflow
        start, end = service.reporting_day_bounds(date(2026, 10, 5))
        budget = query.RequestBudget(10)
        async with query.MaintenanceDynamicsClient() as client:
            value = await query.count_creation_interval(client, start, end, budget)
        self.assertEqual(value, 34)
        self.assertEqual(budget.used, 3)
        self.assertEqual(self.intervals[0], (start, end))
        self.assertEqual(self.intervals[1][1], self.intervals[2][0])
        self.assertEqual(self.intervals[1][0], start)
        self.assertEqual(self.intervals[2][1], end)

    async def test_splitting_budget_does_not_replace_previous_count_with_partial_sum(self):
        await self.counts()
        original = self.rows("maintenance_account_creation_counts")
        async def overflow(url, *, params, headers):
            start, end = self.interval(params)
            if end - start > timedelta(hours=8):
                return self.response({"error": {"code": "8004E023"}}, 400)
            return self.response({"value": [{"account_count": 999}]})
        self.client.get.side_effect = overflow
        state = await self.counts(force=True, config=replace(self.config, max_count_requests=2))
        self.assertEqual(state["status"], "incomplete")
        self.assertEqual(state["requests_last_refresh"], 2)
        self.assertEqual(self.rows("maintenance_account_creation_counts"), original)

    async def test_unsplittable_overflow_fails_without_enumeration(self):
        self.client.get.side_effect = None
        self.client.get.return_value = self.response({"error": {"code": "8004E023"}}, 400)
        async with query.MaintenanceDynamicsClient() as client:
            with self.assertRaisesRegex(query.MaintenanceQueryError, "aggregate_interval_unsplittable"):
                await query.count_creation_interval(client, NOW, NOW + timedelta(seconds=1), query.RequestBudget(8))
        self.assertEqual(self.client.get.await_count, 1)

    async def test_missing_or_malformed_aggregate_response_is_not_zero(self):
        self.client.get.side_effect = None
        for payload in ({"value": []}, {"value": [{}]}, {"value": [{"account_count": None}]},
                        {"value": [{"account_count": True}]}, {"value": [{"account_count": -1}]}):
            with self.subTest(fields=list(payload)):
                self.client.get.return_value = self.response(payload)
                state = await self.counts(force=True)
                self.assertEqual(state["last_error"], "invalid_count_response")
                self.assertEqual(self.rows("maintenance_account_creation_counts"), [])

    async def test_partial_daily_refresh_keeps_successful_days_and_missing_week_is_unknown(self):
        state = await self.counts(config=replace(self.config, max_count_requests=1))
        self.assertEqual(state["status"], "incomplete")
        cached = service.read_count_snapshots(now=NOW)
        self.assertEqual(cached["today"]["value"], 7)
        self.assertIsNone(cached["this_week"]["value"])
        self.assertTrue(any(row["value"] is None for row in cached["daily"]))
        await self.counts()
        self.assertEqual(service.read_count_snapshots(now=NOW)["this_week"]["value"], 18)

    async def test_failed_today_refresh_preserves_valid_snapshot_and_error_freshness(self):
        await self.counts()
        self.client.get.side_effect = httpx.ConnectError("secret-bearer-token")
        state = await self.counts(now=NOW + timedelta(minutes=4))
        cached = service.read_count_snapshots(now=NOW + timedelta(minutes=4))
        self.assertEqual(state["status"], "error")
        self.assertEqual(cached["today"]["value"], 7)
        self.assertEqual(cached["today"]["fetched_at"], NOW)
        self.assertTrue(cached["today"]["is_stale"])

    async def test_postgresql_failure_prevents_dynamics_queries_and_logs_no_secrets(self):
        with patch.object(service, "get_database_connection", side_effect=RuntimeError("postgresql://secret-password Bearer secret-bearer-token")):
            with self.assertLogs(service.logger, level="WARNING") as logs:
                results = await service.refresh_maintenance_observations(now=NOW, config=self.config)
        self.assertTrue(all(result["error"] == "database_unavailable" for result in results.values()))
        self.client.get.assert_not_awaited()
        self.assertNotIn("secret-password", " ".join(logs.output))
        self.assertNotIn("secret-bearer-token", " ".join(logs.output))

    async def test_page_persistence_failure_rolls_back_without_advancing_watermark(self):
        await self.discover()
        self.discovery_pages = [{"value": [self.account("new")]}]
        with patch.object(service, "_save_page", side_effect=RuntimeError("secret-db-password")):
            state = await self.discover(now=NOW + timedelta(minutes=2))
        self.assertEqual(state["last_error"], "database_unavailable")
        self.assertEqual(state["watermark"], NOW)
        self.assertEqual(len(self.rows("maintenance_account_observations")), 1)
        self.assertFalse(state["coverage_complete"])

    async def test_no_receipt_is_distinguishable_without_assigning_a_failed_status(self):
        await self.discover()
        result = service.read_recent_account_observations(now=NOW)
        self.assertFalse(result["accounts"][0]["has_sophie_request"])
        self.assertFalse(result["accounts"][0]["forward_tracking_eligible"])
        self.assertFalse(result["accounts"][0]["no_request_overdue"])
        self.assertNotIn("status", result["accounts"][0])
        self.assertNotIn("next_link", result["sync"])

    async def test_history_join_uses_account_identity_and_preserves_attempt_rows(self):
        await self.discover()
        attempt = AutomaticAttempt(dynamics_account_id="account-1", received_at=NOW)
        attempt.started_at = NOW
        attempt.finish({"status": "no_updates_needed", "fields_updated": []})
        attempt._write()
        rows = service.read_recent_account_observations(now=NOW)["accounts"]
        self.assertTrue(rows[0]["has_sophie_request"])
        self.assertEqual(rows[0]["first_receipt_at"], NOW)
        self.assertFalse(rows[0]["no_request_overdue"])
        with database.get_database_connection() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) AS count FROM account_enrichment_history").fetchone()["count"], 1)

    async def test_forward_tracking_grace_is_calculated_from_later_creation_or_observation(self):
        await self.discover()
        created = NOW + timedelta(minutes=1)
        observed = NOW + timedelta(minutes=2)
        self.discovery_pages = [{"value": [self.account("forward", created)]}]
        await self.discover(now=observed)
        row = next(row for row in service.read_recent_account_observations(now=observed)["accounts"] if row["dynamics_account_id"] == "forward")
        self.assertTrue(row["forward_tracking_eligible"])
        self.assertFalse(row["no_request_overdue"])
        later = NOW + timedelta(minutes=7)
        self.discovery_pages = [{"value": []}]
        await self.discover(now=later)
        row = next(row for row in service.read_recent_account_observations(now=later)["accounts"] if row["dynamics_account_id"] == "forward")
        self.assertTrue(row["no_request_overdue"])
        row = next(row for row in service.read_recent_account_observations(now=later, config=replace(self.config, pending_grace_seconds=600))["accounts"] if row["dynamics_account_id"] == "forward")
        self.assertFalse(row["no_request_overdue"])
        row = next(row for row in service.read_recent_account_observations(now=later + timedelta(minutes=3))["accounts"] if row["dynamics_account_id"] == "forward")
        self.assertFalse(row["forward_tracking_eligible"])
        self.assertFalse(row["no_request_overdue"])

    async def test_incomplete_bootstrap_never_claims_historical_request_coverage(self):
        self.discovery_pages = [{"value": [self.account()], "@odata.nextLink": self.link()}]
        await self.discover(config=replace(self.config, max_discovery_pages=1))
        result = service.read_recent_account_observations(now=NOW)
        self.assertFalse(result["coverage_fresh"])
        self.assertFalse(result["accounts"][0]["forward_tracking_eligible"])
        self.assertFalse(result["accounts"][0]["no_request_overdue"])
        self.assertNotIn("next_link", service.read_count_snapshots(now=NOW)["sync"]["discovery"])

    async def test_additive_initializer_preserves_observations_and_snapshots(self):
        await self.discover()
        await self.counts()
        original = self.rows("maintenance_account_observations")
        database.initialize_database(force=True)
        self.assertEqual(self.rows("maintenance_account_observations"), original)
        self.assertEqual(len(self.rows("maintenance_account_creation_counts")), 14)
        with database.get_database_connection() as connection:
            indexes = connection.execute("SELECT indexname FROM pg_indexes WHERE tablename = 'maintenance_account_observations' AND schemaname = current_schema()").fetchall()
        self.assertTrue({"idx_maintenance_observed_created", "idx_maintenance_observed_seen", "idx_maintenance_observed_attempted"}.issubset({row["indexname"] for row in indexes}))


if __name__ == "__main__":
    unittest.main()
