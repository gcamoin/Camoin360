import unittest
import json
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
import asyncio
import sqlite3
from contextlib import contextmanager

from . import harvest


def _time_entry(employee, hours, billable=False, client="", project="", task="", notes=""):
    return {
        "user": {"name": employee},
        "hours": hours,
        "billable": billable,
        "client": {"name": client},
        "project": {"name": project},
        "task": {"name": task},
        "notes": notes,
    }


class HarvestMetricsTest(unittest.IsolatedAsyncioTestCase):
    async def test_proposal_prep_totals_use_project_and_task_and_preserve_billing(self):
        async def fake_fetch_time_entries(start_date, end_date):
            return [
                _time_entry("Casey Smith", 2.5, task="Proposal Prep"),
                _time_entry("Casey Smith", 1.5, billable=True, task="Proposal Preparation"),
                _time_entry("Alex Jones", 8, task="Business Development - PROPOSAL PREP"),
                _time_entry("Casey Smith", 20, task="Research", notes="Proposal Prep"),
                _time_entry("Alex Jones", 3, task="NonBillable", project="Marketing - Proposal Prep & Interviews"),
                _time_entry("Casey Smith", 30, project="PE - Marketing - Proposal Prep & Interviews"),
            ]

        harvest._fetch_time_entries = fake_fetch_time_entries
        result = await harvest._load_employee_weekly_hours_from_harvest(year=2026, month=1)
        rows = result["proposal_prep_employees"]
        self.assertEqual([row["employee"] for row in rows], ["Alex Jones", "Casey Smith"])
        self.assertEqual(rows[0]["total_hours"], 11)
        self.assertEqual(rows[1]["total_hours"], 4)
        self.assertEqual(rows[1]["billable_hours"], 1.5)
        self.assertEqual(rows[1]["non_billable_hours"], 2.5)

    async def test_abandoned_sync_reports_error_instead_of_staying_busy(self):
        cache_row = {
            "payload": json.dumps(harvest._employee_productivity_empty_payload()),
            "status": "syncing",
            "last_started_at": (datetime.now(timezone.utc) - timedelta(minutes=7)).isoformat(),
        }
        with patch.object(harvest, "_get_employee_productivity_cache_row", return_value=cache_row):
            result = harvest.get_employee_weekly_hours()
        self.assertEqual(result["sync"]["status"], "error")
        self.assertIn("interrupted", result["sync"]["last_error"])

    async def test_old_cache_refreshes_to_add_proposal_prep_without_losing_existing_data(self):
        payload = {"employees": [{"employee": "Casey Smith", "total_hours": 10}]}
        cache_row = {
            "payload": json.dumps(payload),
            "status": "idle",
            "last_completed_at": datetime.now(timezone.utc).isoformat(),
        }
        with patch.object(harvest, "_get_employee_productivity_cache_row", return_value=cache_row):
            result = harvest.get_employee_weekly_hours()
        self.assertTrue(result["sync"]["is_stale"])
        self.assertEqual(result["employees"], payload["employees"])

    async def test_completed_empty_period_remains_fresh(self):
        cache_row = {
            "payload": json.dumps(harvest._employee_productivity_empty_payload(2026, 1)),
            "status": "idle",
            "last_completed_at": datetime.now(timezone.utc).isoformat(),
        }
        with patch.object(harvest, "_get_employee_productivity_cache_row", return_value=cache_row):
            result = harvest.get_employee_weekly_hours(2026, 1)
        self.assertFalse(result["sync"]["has_rows"])
        self.assertFalse(result["sync"]["is_stale"])

    async def asyncSetUp(self):
        self.original_fetch_time_entries = harvest._fetch_time_entries
        self.original_prospect_engage_employee_names = set(harvest.PROSPECT_ENGAGE_EMPLOYEE_NAMES)

    async def asyncTearDown(self):
        harvest._fetch_time_entries = self.original_fetch_time_entries
        harvest.PROSPECT_ENGAGE_EMPLOYEE_NAMES.clear()
        harvest.PROSPECT_ENGAGE_EMPLOYEE_NAMES.update(self.original_prospect_engage_employee_names)

    async def test_employee_hours_are_consulting_only(self):
        captured_dates = {}

        async def fake_fetch_time_entries(start_date, end_date):
            captured_dates["start_date"] = start_date
            return [
                _time_entry("Consultant McConnell", 30, billable=True, project="Consulting Retainer"),
                _time_entry("Consultant McConnell", 10, billable=False, project="Internal Admin"),
                _time_entry("Consultant Outside", 80, billable=True, project="Consulting Retainer"),
                _time_entry("Garrett Example", 20, billable=True, project="Consulting Retainer"),
                _time_entry("Jacob Example", 20, billable=True, project="Consulting Retainer"),
                _time_entry("PE Employee", 20, billable=True, project="ProspectEngage Campaign"),
            ]

        harvest._fetch_time_entries = fake_fetch_time_entries

        result = await harvest._load_employee_weekly_hours_from_harvest(year=2026)

        self.assertEqual(captured_dates["start_date"].isoformat(), "2026-01-01")
        self.assertEqual(result["scope"], "consulting")
        self.assertEqual(result["excluded_scope"], "prospect_engage")
        employees_by_name = {employee["employee"]: employee for employee in result["employees"]}
        self.assertEqual(employees_by_name["Consultant McConnell"]["total_hours"], 40)
        self.assertEqual(employees_by_name["Consultant Outside"]["total_hours"], 80)
        self.assertEqual(employees_by_name["Garrett Example"]["total_hours"], 20)
        self.assertEqual(employees_by_name["Jacob Example"]["total_hours"], 20)
        self.assertEqual(employees_by_name["PE Employee"]["total_hours"], 20)
        self.assertEqual(len(result["utilization_employees"]), 1)
        self.assertEqual(result["utilization_employees"][0]["employee"], "Consultant McConnell")
        self.assertEqual(result["utilization_employees"][0]["billable_hours"], 30)
        self.assertEqual(result["utilization_employees"][0]["total_hours"], 40)
        self.assertEqual(result["utilization_employees"][0]["utilization_rate"], 75)

    async def test_utilization_last_name_allowlist_normalizes_punctuation(self):
        self.assertTrue(harvest._is_utilization_employee_time_entry(_time_entry("Casey D'Amicis", 1)))
        self.assertFalse(harvest._is_utilization_employee_time_entry(_time_entry("Casey Smith", 1)))

    async def test_billable_breakdown_excludes_configured_prospect_engage_employees(self):
        harvest.PROSPECT_ENGAGE_EMPLOYEE_NAMES.clear()
        harvest.PROSPECT_ENGAGE_EMPLOYEE_NAMES.update({"garrett", "jacob", "pe employee"})

        async def fake_fetch_time_entries(start_date, end_date):
            return [
                _time_entry("Consultant One", 12, billable=True),
                _time_entry("Consultant One", 3, billable=False),
                _time_entry("Garrett Example", 8, billable=True),
                _time_entry("Jacob Example", 8, billable=True),
                _time_entry("PE Employee", 8, billable=True),
            ]

        harvest._fetch_time_entries = fake_fetch_time_entries

        result = await harvest.get_billable_breakdown(year=2026, month=1)

        self.assertEqual(result["billable_hours"], 12)
        self.assertEqual(result["non_billable_hours"], 3)
        self.assertEqual(result["total_hours"], 15)
        self.assertEqual(result["scope"], "consulting")


class HarvestPaginationTest(unittest.IsolatedAsyncioTestCase):
    async def test_pages_are_fetched_concurrently_with_a_limit(self):
        active = 0
        peak = 0
        seen = []

        async def get(url, headers, params):
            nonlocal active, peak
            page = params["page"]
            seen.append(page)
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.001)
            active -= 1
            return harvest.httpx.Response(200, request=harvest.httpx.Request("GET", url),
                json={"total_pages": 10, "time_entries": [{"id": page}]})

        client = AsyncMock()
        client.get.side_effect = get
        with patch.object(harvest.httpx, "AsyncClient") as factory, patch.object(harvest, "_get_harvest_headers", return_value={}):
            factory.return_value.__aenter__.return_value = client
            entries = await harvest._fetch_time_entries(date(2026, 1, 1), date(2026, 9, 23))
        self.assertEqual([entry["id"] for entry in entries], list(range(1, 11)))
        self.assertEqual(sorted(seen), list(range(1, 11)))
        self.assertGreater(peak, 1)
        self.assertLessEqual(peak, 4)


class HarvestRefreshTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.connection = sqlite3.connect(":memory:")
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("""CREATE TABLE employee_productivity_cache (
            cache_key TEXT PRIMARY KEY, payload TEXT, status TEXT,
            last_started_at TEXT, last_completed_at TEXT, last_error TEXT,
            updated_at TEXT)""")

        @contextmanager
        def database():
            yield self.connection
            self.connection.commit()

        self.patcher = patch.object(harvest, "get_database_connection", database)
        self.patcher.start()

    async def asyncTearDown(self):
        self.patcher.stop()
        self.connection.close()

    async def test_duplicate_sync_does_not_fetch_again_and_completion_saves_data(self):
        started = asyncio.Event()
        finish = asyncio.Event()
        payload = harvest._employee_productivity_empty_payload()
        payload["proposal_prep_employees"] = [{"employee": "Test", "total_hours": 10}]

        async def load(**kwargs):
            started.set()
            await finish.wait()
            return payload

        with patch.object(harvest, "_load_employee_weekly_hours_from_harvest", side_effect=load) as loader:
            task = asyncio.create_task(harvest.refresh_employee_weekly_hours_cache())
            done, _ = await asyncio.wait([task, asyncio.create_task(started.wait())], timeout=1, return_when=asyncio.FIRST_COMPLETED)
            if task in done:
                await task
            self.assertTrue(started.is_set())
            duplicate = await harvest.refresh_employee_weekly_hours_cache()
            self.assertEqual(duplicate["sync"]["status"], "syncing")
            self.assertEqual(loader.call_count, 1)
            finish.set()
            result = await task
        self.assertEqual(result["proposal_prep_employees"], payload["proposal_prep_employees"])
        self.assertEqual(result["sync"]["status"], "idle")

    async def test_timeout_preserves_cached_results_and_reports_error(self):
        payload = harvest._employee_productivity_empty_payload()
        payload["employees"] = [{"employee": "Test", "total_hours": 8}]
        self.connection.execute("INSERT INTO employee_productivity_cache (cache_key, payload, status) VALUES (?, ?, ?)",
                                ("history:all", json.dumps(payload), "idle"))

        async def load(**kwargs):
            await asyncio.sleep(1)

        with patch.object(harvest, "_load_employee_weekly_hours_from_harvest", side_effect=load), patch.object(harvest, "EMPLOYEE_PRODUCTIVITY_SYNC_TIMEOUT_SECONDS", 0.001):
            with self.assertRaises(asyncio.TimeoutError):
                await harvest.refresh_employee_weekly_hours_cache()
        result = harvest.get_employee_weekly_hours()
        self.assertEqual(result["employees"], payload["employees"])
        self.assertEqual(result["sync"]["status"], "error")
        self.assertIn("timed out", result["sync"]["last_error"])


if __name__ == "__main__":
    unittest.main()
