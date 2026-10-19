import unittest
from unittest.mock import patch

from fastapi import BackgroundTasks

from . import marketing


class EmployeeHoursRouteTest(unittest.IsolatedAsyncioTestCase):
    async def check_sync(self, sync_status, stale, refresh, expected_tasks):
        cached = {"employees": [], "sync": {
            "status": sync_status, "is_stale": stale,
            "last_error": "Harvest unavailable" if sync_status == "error" else "",
        }}
        tasks = BackgroundTasks()
        with patch.object(marketing, "get_employee_weekly_hours", return_value=cached):
            result = await marketing.fetch_employee_weekly_hours(
                background_tasks=tasks, year=None, month=None, refresh=refresh, _user={},
            )
        self.assertEqual(len(tasks.tasks), expected_tasks)
        self.assertEqual(result["sync"]["status"], "syncing" if expected_tasks else sync_status)
        if expected_tasks:
            self.assertEqual(result["sync"]["last_error"], "")
            self.assertFalse(tasks.tasks[0].is_async)

    async def test_stale_data_starts_sync(self):
        await self.check_sync("idle", True, False, 1)

    async def test_failure_is_returned_without_restarting_sync(self):
        await self.check_sync("error", True, False, 0)

    async def test_explicit_refresh_retries_failure(self):
        await self.check_sync("error", True, True, 1)

    async def test_active_sync_is_not_duplicated(self):
        await self.check_sync("syncing", True, True, 0)

    async def test_fresh_empty_result_is_not_refreshed(self):
        await self.check_sync("idle", False, False, 0)

    async def test_reporting_period_reaches_cache_read_and_background_refresh(self):
        from datetime import date
        cached = {"employees": [], "sync": {"status": "idle", "is_stale": True}}
        tasks = BackgroundTasks()
        with patch.object(marketing, "get_employee_weekly_hours", return_value=cached) as read:
            await marketing.fetch_employee_weekly_hours(
                background_tasks=tasks, year=2024, month=None, refresh=False,
                quarter=2, start_date=date(2024, 4, 15), end_date=date(2024, 6, 20), _user={},
            )
        filters = {"quarter": 2, "start_date": "2024-04-15", "end_date": "2024-06-20"}
        read.assert_called_once_with(year=2024, month=None, reporting_filters=filters)
        self.assertEqual(tasks.tasks[0].kwargs, {"reporting_filters": filters})
