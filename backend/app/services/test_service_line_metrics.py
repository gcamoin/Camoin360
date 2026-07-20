import unittest

from . import service_line_metrics


class ServiceLineMetricsTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
