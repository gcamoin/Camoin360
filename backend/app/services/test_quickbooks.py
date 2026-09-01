import os
import unittest
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from . import quickbooks


class QuickBooksFinancialsTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        quickbooks._cache["loaded_at"] = None
        quickbooks._cache["data"] = None

    async def test_missing_configuration_returns_sample_financials(self):
        env_without_quickbooks = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith(("QUICKBOOKS_", "QB_", "INTUIT_"))
        }

        with patch.dict(os.environ, env_without_quickbooks, clear=True):
            result = await quickbooks.get_company_financials(force_refresh=True)

        self.assertEqual(result["source"], "Sample QuickBooks financials")
        self.assertGreaterEqual(len(result["rows"]), 12)
        self.assertEqual(
            {
                "cashOnHand",
                "currentRatio",
                "debtToAssets",
                "debtToEquity",
                "month",
                "monthNumber",
                "monthKey",
                "netIncome",
                "ownerEquity",
                "quarter",
                "returnOnAssets",
                "sales",
                "year",
            },
            set(result["rows"][0]),
        )

    async def test_connection_status_does_not_expose_tokens(self):
        expires_at = datetime.now(timezone.utc) + timedelta(days=30)
        with patch.object(
            quickbooks,
            "get_database_connection",
            return_value=_fake_connection(
                {
                    "realm_id": "12345",
                    "company_name": "Camoin Associates",
                    "environment": "production",
                    "status": "connected",
                    "connected_at": "2026-09-01T12:00:00+00:00",
                    "updated_at": "2026-09-01T12:00:00+00:00",
                    "refresh_token_expires_at": expires_at,
                    "access_token": "secret-access-token",
                    "refresh_token": "secret-refresh-token",
                }
            ),
        ):
            result = quickbooks.get_connection_status()

        self.assertEqual(result["status"], "connected")
        self.assertEqual(result["realm_id"], "12345")
        self.assertNotIn("access_token", result)
        self.assertNotIn("refresh_token", result)

    async def test_build_authorization_url_requires_valid_state(self):
        with (
            patch.dict(
                os.environ,
                {
                    "QUICKBOOKS_CLIENT_ID": "client-id",
                    "QUICKBOOKS_CLIENT_SECRET": "client-secret",
                    "QUICKBOOKS_REDIRECT_URI": "https://api.camoin360.com/quickbooks/callback",
                },
                clear=True,
            ),
            patch.object(quickbooks, "get_database_connection", return_value=_fake_connection({"state": "abc"})),
        ):
            authorization_url = quickbooks.build_authorization_url("abc")

        self.assertIn("https://appcenter.intuit.com/connect/oauth2?", authorization_url)
        self.assertIn("client_id=client-id", authorization_url)
        self.assertIn("state=abc", authorization_url)
        self.assertIn("scope=com.intuit.quickbooks.accounting", authorization_url)

class _FakeCursor:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _FakeConnection:
    def __init__(self, row):
        self._row = row

    def execute(self, *_args, **_kwargs):
        return _FakeCursor(self._row)


@contextmanager
def _fake_connection(row):
    yield _FakeConnection(row)


if __name__ == "__main__":
    unittest.main()
