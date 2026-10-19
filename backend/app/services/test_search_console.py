import unittest
from datetime import date
from unittest.mock import patch

from . import search_console


class FakeQuery:
    def __init__(self, response):
        self.response = response

    def execute(self):
        return self.response


class FakeSearchAnalytics:
    def __init__(self, responses, requests):
        self.responses = responses
        self.requests = requests

    def query(self, siteUrl, body):
        self.requests.append({"siteUrl": siteUrl, "body": body})
        return FakeQuery(self.responses.pop(0))


class FakeService:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def searchanalytics(self):
        return FakeSearchAnalytics(self.responses, self.requests)


class SearchConsoleServiceTest(unittest.TestCase):
    def test_fetches_each_month_as_an_api_aggregate(self):
        service = FakeService([
            {
                "rows": [
                    {"keys": ["2026-07-01"]},
                    {"keys": ["2026-08-15"]},
                ]
            },
            {"rows": [{"clicks": 10, "impressions": 200, "ctr": 0.99, "position": 8.25}]},
            {"rows": [{"clicks": 20, "impressions": 500, "ctr": 0.01, "position": 9.75}]},
        ])

        with patch.object(search_console, "_get_existing_month_keys", return_value=set()):
            metrics, earliest, latest = search_console.fetch_search_console_monthly_metrics(
                service=service, today=date(2026, 8, 20)
            )

        self.assertEqual((earliest, latest), (date(2026, 7, 1), date(2026, 8, 15)))
        self.assertEqual([metric["month"] for metric in metrics], ["2026-07", "2026-08"])
        self.assertEqual(metrics[0]["ctr"], 0.05)
        self.assertEqual(metrics[1]["average_position"], 9.75)
        self.assertNotIn("dimensions", service.requests[1]["body"])
        self.assertEqual(service.requests[1]["body"]["aggregationType"], "byProperty")
        self.assertEqual(service.requests[2]["body"]["endDate"], "2026-08-15")

    def test_only_refetches_recent_or_missing_months(self):
        service = FakeService([
            {"rows": [{"keys": ["2026-04-01"]}, {"keys": ["2026-08-15"]}]},
            {"rows": [{"clicks": 5, "impressions": 100, "position": 10}]},
            {"rows": [{"clicks": 6, "impressions": 100, "position": 11}]},
            {"rows": [{"clicks": 7, "impressions": 100, "position": 12}]},
        ])
        existing = {"2026-04", "2026-05", "2026-06", "2026-07", "2026-08"}

        with patch.object(search_console, "_get_existing_month_keys", return_value=existing):
            metrics, _, _ = search_console.fetch_search_console_monthly_metrics(
                service=service, today=date(2026, 8, 20)
            )

        self.assertEqual([metric["month"] for metric in metrics], ["2026-06", "2026-07", "2026-08"])

    def test_upsert_is_idempotent_by_month(self):
        class Connection:
            def __init__(self):
                self.calls = []

            def executemany(self, sql, parameters):
                self.calls.append((sql, parameters))

        connection = Connection()
        metric = {
            "month": "2026-08", "clicks": 10, "impressions": 100,
            "ctr": 0.1, "average_position": 12.5,
            "data_through_date": "2026-08-20",
        }
        search_console._upsert_monthly_metrics(connection, [metric])
        search_console._upsert_monthly_metrics(connection, [{**metric, "clicks": 11}])

        self.assertEqual(len(connection.calls), 2)
        self.assertIn("ON CONFLICT(month_key) DO UPDATE", connection.calls[0][0])
        self.assertEqual(connection.calls[1][1][0][1], 11)


if __name__ == "__main__":
    unittest.main()
