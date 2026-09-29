import asyncio
from contextlib import contextmanager
from datetime import datetime, timezone
import sqlite3
import unittest
from unittest.mock import AsyncMock, patch

from . import newsletter


class NewsletterSnapshotsTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.connection = sqlite3.connect(":memory:", check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("""CREATE TABLE newsletter_subscriber_observations (
            segment_definition_id TEXT, snapshot_key TEXT, subscriber_count INTEGER,
            captured_at TEXT, segment_name TEXT,
            PRIMARY KEY (segment_definition_id, snapshot_key))""")

        @contextmanager
        def database():
            yield self.connection
            self.connection.commit()
        self.patcher = patch.object(newsletter, "get_database_connection", database)
        self.patcher.start()

    def tearDown(self):
        self.patcher.stop()
        self.connection.close()

    def test_weekly_schedule_tracks_daylight_saving_and_year_rollover(self):
        for now, expected in [
            (datetime(2026, 9, 28, 12, 59, tzinfo=timezone.utc), "2026-09-28T09:00:00-04:00"),
            (datetime(2026, 9, 28, 13, tzinfo=timezone.utc), "2026-10-05T09:00:00-04:00"),
            (datetime(2026, 11, 2, 13, tzinfo=timezone.utc), "2026-11-02T09:00:00-05:00"),
            (datetime(2026, 12, 31, tzinfo=timezone.utc), "2027-01-04T09:00:00-05:00"),
        ]:
            self.assertEqual(newsletter.next_snapshot_at(now).isoformat(), expected)

    async def test_does_not_capture_before_nine_on_monday(self):
        with patch.object(newsletter, "fetch_subscriber_count", AsyncMock()) as fetch:
            self.assertFalse(await newsletter.capture_if_due(datetime(2026, 11, 2, 13, tzinfo=timezone.utc)))
        fetch.assert_not_awaited()

    def test_multiple_weeks_in_one_month_are_preserved(self):
        newsletter.save_snapshot(4293, newsletter.SEGMENT_NAME, datetime(2026, 9, 21, 13, tzinfo=timezone.utc))
        newsletter.save_snapshot(4300, newsletter.SEGMENT_NAME, datetime(2026, 9, 28, 13, tzinfo=timezone.utc))
        self.assertEqual([row["subscriber_count"] for row in newsletter.read_snapshots()], [4293, 4300])

    async def test_repeated_checks_do_not_fetch_or_overwrite_current_week(self):
        now = datetime(2026, 9, 28, 13, tzinfo=timezone.utc)
        newsletter.save_snapshot(4293, newsletter.SEGMENT_NAME, now)
        with patch.object(newsletter, "fetch_subscriber_count", AsyncMock()) as fetch:
            self.assertFalse(await newsletter.capture_if_due(now))
        fetch.assert_not_awaited()
        newsletter.save_snapshot(5000, newsletter.SEGMENT_NAME, now)
        self.assertEqual(newsletter.read_snapshots()[0]["subscriber_count"], 4293)

    async def test_new_week_saves_actual_count_including_zero(self):
        with patch.object(newsletter, "fetch_subscriber_count", AsyncMock(return_value=(0, newsletter.SEGMENT_NAME))):
            self.assertTrue(await newsletter.capture_if_due(datetime(2026, 9, 28, 13, tzinfo=timezone.utc)))
        rows = newsletter.read_snapshots()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["subscriber_count"], 0)
        self.assertTrue(rows[0]["captured_at"])

    async def test_failure_keeps_history_and_does_not_insert_zero(self):
        newsletter.save_snapshot(4293, newsletter.SEGMENT_NAME, datetime(2022, 9, 23, tzinfo=timezone.utc))
        with patch.object(newsletter, "fetch_subscriber_count", AsyncMock(side_effect=RuntimeError("unavailable"))), patch.object(newsletter.logger, "exception"):
            result = await newsletter.get_newsletter_metrics()
        self.assertEqual(len(result["snapshots"]), 1)
        self.assertEqual(result["snapshots"][0]["subscriber_count"], 4293)
        self.assertTrue(result["warning"])

    async def test_scheduler_retries_failures_and_can_be_cancelled(self):
        with patch.object(newsletter, "capture_if_due", AsyncMock(side_effect=RuntimeError("unavailable"))) as capture, patch.object(newsletter.asyncio, "sleep", AsyncMock(side_effect=asyncio.CancelledError)) as sleep, patch.object(newsletter.logger, "exception"):
            with self.assertRaises(asyncio.CancelledError):
                await newsletter.run_snapshot_scheduler()
        capture.assert_awaited_once()
        self.assertGreater(sleep.call_args.args[0], 0)
        self.assertLessEqual(sleep.call_args.args[0], 3600)


class DynamicsNewsletterTest(unittest.IsolatedAsyncioTestCase):
    async def test_reads_count_from_segment_linked_to_definition(self):
        import httpx
        requests = []
        def respond(request):
            requests.append(request)
            return httpx.Response(200, json={"value": [{"msdynmkt_membercount": 4293, "msdynmkt_displayname": newsletter.SEGMENT_NAME}]})
        client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        with patch.object(newsletter, "get_access_token", AsyncMock(return_value="test-token")), patch.dict(newsletter.os.environ, {"DYNAMICS_API_URL": "https://example.crm/api/data/v9.2"}), patch.object(newsletter.httpx, "AsyncClient", return_value=client):
            self.assertEqual(await newsletter.fetch_subscriber_count(), (4293, newsletter.SEGMENT_NAME))
        self.assertIn(newsletter.SEGMENT_DEFINITION_ID, requests[0].url.params["$filter"])
        self.assertTrue(requests[0].url.path.endswith("/msdynmkt_segments"))

    async def test_missing_or_invalid_count_never_becomes_zero(self):
        import httpx
        for rows in [[], [{}], [{"msdynmkt_membercount": None}], [{"msdynmkt_membercount": -1}], [{"msdynmkt_membercount": True}]]:
            client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"value": rows})))
            with patch.object(newsletter, "get_access_token", AsyncMock(return_value="test-token")), patch.dict(newsletter.os.environ, {"DYNAMICS_API_URL": "https://example.crm/api/data/v9.2"}), patch.object(newsletter.httpx, "AsyncClient", return_value=client):
                with self.assertRaises(RuntimeError):
                    await newsletter.fetch_subscriber_count()


class MonthlyNewsletterReportTest(unittest.IsolatedAsyncioTestCase):
    async def test_endpoint_replaces_current_month_count_and_preserves_previous_month(self):
        rows = [
            {"captured_at": "2026-08-31T13:00:00+00:00", "subscriber_count": 4200},
            {"captured_at": "2026-09-21T13:00:00+00:00", "subscriber_count": 4293},
            {"captured_at": "2026-09-28T13:00:00+00:00", "subscriber_count": 4310},
        ]
        with patch.object(newsletter, "capture_if_due", AsyncMock(return_value=False)), patch.object(newsletter, "read_snapshots", return_value=rows):
            result = await newsletter.get_newsletter_metrics()
        self.assertEqual([(row["month_key"], row["subscriber_count"]) for row in result["snapshots"]], [("2026-08", 4200), ("2026-09", 4310)])
        rows.append({"captured_at": "2026-10-05T13:00:00+00:00", "subscriber_count": 4320})
        self.assertEqual([row["subscriber_count"] for row in newsletter.monthly_snapshots(rows)], [4200, 4310, 4320])

    def test_uses_eastern_month_and_latest_timestamp_even_when_unsorted_or_decreasing(self):
        rows = [
            {"captured_at": "2026-10-01T02:00:00+00:00", "subscriber_count": 4100},
            {"captured_at": "2026-09-28T13:00:00+00:00", "subscriber_count": 4293},
            {"captured_at": "2026-10-05T13:00:00+00:00", "subscriber_count": 0},
        ]
        result = newsletter.monthly_snapshots(rows)
        self.assertEqual([(row["period_key"], row["subscriber_count"]) for row in result], [("2026-09", 4100), ("2026-10", 0)])
        self.assertEqual(newsletter.monthly_snapshots([]), [])
