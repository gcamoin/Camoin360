import unittest
from unittest.mock import patch

from fastapi import BackgroundTasks, HTTPException

from . import marketing


class MarketingSeoRouteTest(unittest.IsolatedAsyncioTestCase):
    async def test_returns_cached_metrics_and_schedules_stale_refresh(self):
        cached = {
            "months": [{"month": "2026-08", "clicks": 10}],
            "sync": {"status": "idle", "is_stale": True, "last_started_at": None},
        }
        background_tasks = BackgroundTasks()
        with patch.object(marketing, "get_search_console_metrics", return_value=cached):
            result = await marketing.fetch_search_console_metrics(
                background_tasks=background_tasks,
                range="last_year",
                refresh=False,
                _user={"email": "user@example.com"},
            )

        self.assertEqual(result["months"][0]["clicks"], 10)
        self.assertEqual(result["sync"]["status"], "syncing")
        self.assertEqual(len(background_tasks.tasks), 1)

    async def test_converts_cache_failure_to_502(self):
        with patch.object(marketing, "get_search_console_metrics", side_effect=RuntimeError("database unavailable")):
            with self.assertRaises(HTTPException) as raised:
                await marketing.fetch_search_console_metrics(
                    background_tasks=BackgroundTasks(),
                    range="last_year",
                    refresh=False,
                    _user={"email": "user@example.com"},
                )

        self.assertEqual(raised.exception.status_code, 502)


if __name__ == "__main__":
    unittest.main()
