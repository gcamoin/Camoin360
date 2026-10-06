import unittest
from datetime import timedelta
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from backend.app import main
from backend.app.routes import auth, maintenance, accounts
from backend.app.services.test_maintenance_observations import NOW


class EnrichmentWorkspaceApiTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.addCleanup(self.client.close)
        for module in (main, auth):
            patcher = patch.object(module, "get_user_from_token", side_effect=self.user)
            patcher.start()
            self.addCleanup(patcher.stop)

    @staticmethod
    def user(token):
        if token == "allowed":
            return {"role": "user", "modules": ["main"]}
        if token == "denied":
            return {"role": "user", "modules": ["management"]}
        raise HTTPException(401, "Invalid token")

    def get(self, path="/maintenance/enrichment/credits", token="allowed"):
        return self.client.get(path, headers={"Authorization": f"Bearer {token}"} if token else {})

    def test_credit_authorization(self):
        self.assertEqual(self.get(token=None).status_code, 401)
        self.assertEqual(self.get(token="denied").status_code, 403)

    def test_narrow_credit_read_and_freshness_without_legacy_dashboard_or_network(self):
        with patch.object(maintenance, "load_usage", return_value={"credits_used": 500, "total_credits_remaining": 1284, "total_credits_updated_at": NOW.isoformat()}) as usage, patch.object(maintenance, "utc_now", return_value=NOW), patch("httpx.AsyncClient.get", side_effect=AssertionError("Network forbidden")), patch("httpx.AsyncClient.post", side_effect=AssertionError("Network forbidden")), patch("backend.app.routes.metrics.start_data_quality_refresh") as legacy:
            response = self.get()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"remaining": 1284, "weekly_remaining": 1500, "weekly_limit": 2000, "reported_at": NOW.isoformat(), "is_stale": False})
        self.assertEqual(response.headers["cache-control"], "private, no-store")
        usage.assert_called_once()
        legacy.assert_not_called()

    def test_unknown_zero_and_stale_credit_are_distinct(self):
        for balance in (None, 0):
            with patch.object(maintenance, "load_usage", return_value={"credits_used": 0, "total_credits_remaining": balance, "total_credits_updated_at": (NOW - timedelta(days=2)).isoformat()}), patch.object(maintenance, "utc_now", return_value=NOW):
                data = self.get().json()
            self.assertEqual(data["remaining"], balance)
            self.assertTrue(data["is_stale"])
        with patch.object(maintenance, "load_usage", return_value={"total_credits_remaining": "SECRET", "credits_used": "unknown"}):
            data = self.get().json()
        self.assertIsNone(data["remaining"])
        self.assertIsNone(data["weekly_remaining"])
        self.assertNotIn("SECRET", str(data))

    def test_credit_failure_sanitized(self):
        with patch.object(maintenance, "load_usage", side_effect=RuntimeError("Bearer SECRET")), self.assertLogs(maintenance.logger, level="WARNING") as logs:
            response = self.get()
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("SECRET", response.text + str(logs.output))

    def test_search_passes_canonical_mode_and_no_cache_refresh(self):
        with patch.object(accounts, "search_accounts_data_quality_from_dynamics", new=AsyncMock(return_value={"data": [], "has_more": False})) as search:
            response = self.get("/accounts/data-quality/search?enrichment_fields=true&missing_field=cr73c_naicscode&page_size=25")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(search.await_args.kwargs["enrichment_fields"])
        self.assertEqual(search.await_args.kwargs["missing_field"], "cr73c_naicscode")
        self.assertEqual(search.await_args.kwargs["page_size"], 25)

    def test_search_provider_error_is_not_exposed(self):
        with patch.object(accounts, "search_accounts_data_quality_from_dynamics", new=AsyncMock(side_effect=RuntimeError("Bearer SECRET raw response"))):
            response = self.get("/accounts/data-quality/search?enrichment_fields=true")
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("SECRET", response.text)
