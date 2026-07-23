import unittest
from unittest.mock import AsyncMock, patch

from . import service_line_metrics


class ServiceLineMetricsTest(unittest.IsolatedAsyncioTestCase):
    def test_matches_new_landing_page_service_lines(self):
        cases = {
            "/services/prospecting": "Prospecting",
            "/services/impact-analysis": "Impact Analysis",
            "/services/real-estate": "Real Estate",
            "/services/strategic-planning": "Strategic Planning",
        }

        for path, expected_label in cases.items():
            with self.subTest(path=path):
                self.assertEqual(service_line_metrics._match_service_line(path), expected_label)

    def test_adds_missing_service_lines_to_old_cached_payload(self):
        payload = {
            "service_lines": [
                {"key": "prospect_engage", "label": "ProspectEngage", "months": [{"period": "Jan '26"}]},
                {"key": "industry_workforce_analytics", "label": "Industry & Workforce Analytics", "months": []},
            ],
            "updated_at": "2026-01-01T00:00:00+00:00",
        }

        updated_payload = service_line_metrics._ensure_current_service_lines(payload)
        keys = [line["key"] for line in updated_payload["service_lines"]]

        self.assertIn("prospecting", keys)
        self.assertIn("impact_analysis", keys)
        self.assertIn("real_estate", keys)
        self.assertIn("strategic_planning", keys)
        self.assertNotIn("industry_workforce_analytics", keys)
        self.assertEqual(updated_payload["service_lines"][0]["key"], "prospect_engage")
        self.assertEqual(updated_payload["service_lines"][0]["months"], [{"period": "Jan '26"}])

    async def test_refresh_records_error_without_raising(self):
        connection = self._fake_connection()
        with (
            patch.object(service_line_metrics, "get_database_connection", return_value=connection),
            patch.object(
                service_line_metrics,
                "_load_service_line_marketing_metrics",
                new=AsyncMock(side_effect=RuntimeError("missing credentials")),
            ),
        ):
            result = await service_line_metrics.refresh_service_line_marketing_metrics_cache()

        self.assertEqual(result["sync"]["status"], "error")
        self.assertEqual(result["sync"]["last_error"], "missing credentials")

    @staticmethod
    def _fake_connection():
        class FakeConnection:
            row = {
                "cache_key": service_line_metrics.CACHE_KEY,
                "payload": "{}",
                "status": "idle",
                "last_started_at": None,
                "last_completed_at": None,
                "last_error": "",
            }

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def execute(self, query, params=()):
                if "SELECT cache_key" in query:
                    pass
                elif "status = 'error'" in query:
                    self.row = {
                        **self.row,
                        "status": "error",
                        "last_error": params[0],
                    }
                elif "VALUES (?, ?, 'syncing'" in query:
                    self.row = {
                        **self.row,
                        "status": "syncing",
                        "payload": params[1],
                        "last_started_at": params[2],
                        "last_error": "",
                    }
                return self

            def fetchone(self):
                return self.row

        return FakeConnection()


if __name__ == "__main__":
    unittest.main()
