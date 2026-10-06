import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from backend.app import main
from backend.app.routes import accounts, auth


class ManualEnrichmentContractTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.addCleanup(self.client.close)
        for module in (main, auth):
            patcher = patch.object(module, "get_user_from_token", return_value={"role": "user", "modules": ["main"]})
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.object(accounts, "enrich_selected_accounts", new=AsyncMock())
        self.run = patcher.start()
        self.addCleanup(patcher.stop)
        patcher = patch.object(accounts, "invalidate_account_endpoint_caches")
        self.invalidate = patcher.start()
        self.addCleanup(patcher.stop)

    def post(self, payload):
        return self.client.post("/accounts/enrichment-run", json=payload, headers={"Authorization": "Bearer allowed"})

    def test_requires_explicit_nonempty_supported_fields(self):
        for payload in (
            {"account_ids": ["account-1"]},
            {"account_ids": ["account-1"], "fields_to_update": []},
            {"account_ids": [], "fields_to_update": ["websiteurl"]},
            {"account_ids": [" "], "fields_to_update": ["websiteurl"]},
            *({"account_ids": ["account-1"], "fields_to_update": [field]} for field in ("new_datasource", "new_employees", "new_naicstext")),
        ):
            with self.subTest(payload=payload):
                self.assertEqual(self.post(payload).status_code, 422)
        self.run.assert_not_awaited()
        self.invalidate.assert_not_called()

    def test_canonical_fields_and_per_account_results_pass_through(self):
        expected = {"processed": 1, "updated": 1, "skipped": 0, "results": [{
            "account_id": "account-1", "account_name": "Acme", "status": "updated", "updated": True,
            "fields_updated": ["numberofemployees", "cr73c_naicscode"],
            "updates": {"numberofemployees": 12, "cr73c_naicscode": "051111"}}]}
        self.run.return_value = expected
        response = self.post({"account_ids": ["account-1"], "fields_to_update": ["numberofemployees", "cr73c_naicscode"]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), expected)
        self.run.assert_awaited_once_with(["account-1"], ["numberofemployees", "cr73c_naicscode"])
        self.invalidate.assert_called_once()

    def test_failed_account_does_not_report_confirmed_updates(self):
        expected = {"processed": 1, "updated": 0, "skipped": 0, "results": [{
            "account_id": "account-1", "account_name": "Acme", "status": "failed", "updated": False,
            "fields_updated": [], "updates": None, "reason": "Dynamics did not confirm the Account update.",
            "error_category": "dynamics_write", "completion_uncertain": True}]}
        self.run.return_value = expected
        self.assertEqual(self.post({"account_ids": ["account-1"], "fields_to_update": ["websiteurl"]}).json(), expected)

    def test_unexpected_failure_returns_sanitized_error(self):
        self.run.side_effect = RuntimeError("Bearer SECRET provider payload")
        response = self.post({"account_ids": ["account-1"], "fields_to_update": ["websiteurl"]})
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("SECRET", response.text)
