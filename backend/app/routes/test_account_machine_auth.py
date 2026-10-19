import os
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app import main
from backend.app.routes import accounts


class AccountMachineAuthenticationTest(unittest.TestCase):
    """Exercise the real middleware and route dependency together."""

    def setUp(self):
        self.machine_key = "machine-secret-for-auth-tests"
        self.environment = patch.dict(os.environ, {"POWER_AUTOMATE_API_KEY": self.machine_key})
        self.environment.start()
        self.enrich = AsyncMock(return_value={
            "account_id": "account-1",
            "status": "updated",
            "fields_updated": ["websiteurl"],
            "skipped_reason": None,
        })
        self.enrich_patch = patch.object(accounts, "enrich_one_account", self.enrich)
        self.enrich_patch.start()
        self.invalidate_patch = patch.object(accounts, "invalidate_account_endpoint_caches")
        self.invalidate = self.invalidate_patch.start()
        self.user_patch = patch.object(main, "get_user_from_token", side_effect=self.user_from_token)
        self.user_lookup = self.user_patch.start()
        self.client = TestClient(main.app)
        self.addCleanup(self.client.close)
        self.addCleanup(self.user_patch.stop)
        self.addCleanup(self.invalidate_patch.stop)
        self.addCleanup(self.enrich_patch.stop)
        self.addCleanup(self.environment.stop)

    @staticmethod
    def user_from_token(token):
        if token == "maintenance-user":
            return {"role": "user", "modules": ["main"]}
        if token == "prospecting-user":
            return {"role": "user", "modules": ["prospecting"]}
        if token == "admin-user":
            return {"role": "admin", "modules": []}
        raise HTTPException(status_code=401, detail="Invalid token")

    def assert_rejected(self, response, expected_status=401, submitted_key=None):
        self.assertEqual(response.status_code, expected_status)
        self.assertNotIn(self.machine_key, response.text)
        if submitted_key:
            self.assertNotIn(submitted_key, response.text)
        self.enrich.assert_not_awaited()
        self.invalidate.assert_not_called()

    def test_valid_machine_key_reaches_existing_enrichment(self):
        response = self.client.post("/accounts/enrich-one/account-1", headers={"x-api-key": self.machine_key})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "updated")
        self.enrich.assert_awaited_once_with("account-1")
        self.invalidate.assert_called_once_with()
        self.user_lookup.assert_not_called()
        self.assertNotIn(self.machine_key, response.text)

    def test_missing_machine_key_is_rejected(self):
        self.assert_rejected(self.client.post("/accounts/enrich-one/account-1"))

    def test_incorrect_machine_key_is_rejected_without_disclosure(self):
        submitted_key = "incorrect-secret-for-auth-tests"
        response = self.client.post("/accounts/enrich-one/account-1", headers={"x-api-key": submitted_key})
        self.assert_rejected(response, submitted_key=submitted_key)

    def test_empty_machine_key_is_rejected(self):
        self.assert_rejected(self.client.post("/accounts/enrich-one/account-1", headers={"x-api-key": ""}))

    def test_unconfigured_machine_authentication_fails_closed(self):
        os.environ.pop("POWER_AUTOMATE_API_KEY", None)
        for headers in ({}, {"x-api-key": self.machine_key}):
            with self.subTest(headers_present=bool(headers)):
                self.assert_rejected(self.client.post("/accounts/enrich-one/account-1", headers=headers))

    def test_empty_configured_secret_fails_closed(self):
        os.environ["POWER_AUTOMATE_API_KEY"] = ""
        self.assert_rejected(self.client.post("/accounts/enrich-one/account-1", headers={"x-api-key": self.machine_key}))

    def test_non_ascii_secret_uses_constant_time_byte_comparison(self):
        os.environ["POWER_AUTOMATE_API_KEY"] = "secret-\N{LATIN SMALL LETTER E WITH ACUTE}"
        self.assert_rejected(self.client.post("/accounts/enrich-one/account-1", headers={"x-api-key": self.machine_key}))

    def test_machine_key_does_not_unlock_other_account_routes(self):
        for method, path in (
            ("GET", "/accounts/missing-data"),
            ("GET", "/accounts/data-quality"),
            ("POST", "/accounts/enrich-all"),
            ("POST", "/accounts/enrich/account-1"),
            ("POST", "/accounts/enrichment-run"),
            ("DELETE", "/accounts/account-1"),
            ("GET", "/metrics"),
        ):
            with self.subTest(method=method, path=path):
                response = self.client.request(method, path, headers={"x-api-key": self.machine_key})
                self.assert_rejected(response)
                self.assertEqual(response.json()["detail"], "Missing token")

    def test_exception_is_limited_to_exact_path_and_method(self):
        for method, path in (
            ("GET", "/accounts/enrich-one/account-1"),
            ("DELETE", "/accounts/enrich-one/account-1"),
            ("POST", "/accounts/enrich-one"),
            ("POST", "/accounts/enrich-one/account-1/extra"),
            ("POST", "/accounts/enrich-one-other/account-1"),
        ):
            with self.subTest(method=method, path=path):
                self.assert_rejected(self.client.request(method, path, headers={"x-api-key": self.machine_key}))

    def test_maintenance_user_can_call_endpoint_without_machine_key(self):
        response = self.client.post("/accounts/enrich-one/account-1", headers={"Authorization": "Bearer maintenance-user"})
        self.assertEqual(response.status_code, 200)
        self.enrich.assert_awaited_once_with("account-1")

    def test_maintenance_user_can_call_when_machine_auth_is_unconfigured(self):
        os.environ.pop("POWER_AUTOMATE_API_KEY", None)
        response = self.client.post("/accounts/enrich-one/account-1", headers={"Authorization": "Bearer maintenance-user"})
        self.assertEqual(response.status_code, 200)
        self.enrich.assert_awaited_once_with("account-1")

    def test_admin_retains_access(self):
        response = self.client.post("/accounts/enrich-one/account-1", headers={"Authorization": "Bearer admin-user"})
        self.assertEqual(response.status_code, 200)

    def test_invalid_user_token_is_not_rescued_by_machine_key(self):
        response = self.client.post("/accounts/enrich-one/account-1", headers={
            "Authorization": "Bearer invalid-user", "x-api-key": self.machine_key,
        })
        self.assert_rejected(response)

    def test_wrong_module_user_is_not_rescued_by_machine_key(self):
        response = self.client.post("/accounts/enrich-one/account-1", headers={
            "Authorization": "Bearer prospecting-user", "x-api-key": self.machine_key,
        })
        self.assert_rejected(response, expected_status=403)

    def test_malformed_authorization_is_rejected(self):
        response = self.client.post("/accounts/enrich-one/account-1", headers={
            "Authorization": "Basic malformed", "x-api-key": self.machine_key,
        })
        self.assert_rejected(response)

    def test_existing_account_user_access_and_module_checks_remain(self):
        with patch.object(accounts, "get_accounts_missing_data", new=AsyncMock(return_value=[])) as fetch:
            response = self.client.get("/accounts/missing-data", headers={"Authorization": "Bearer maintenance-user"})
            self.assertEqual(response.status_code, 200)
            fetch.assert_awaited_once_with()
            fetch.reset_mock()
            for token, status in (("invalid-user", 401), ("prospecting-user", 403)):
                with self.subTest(token=token):
                    response = self.client.get("/accounts/missing-data", headers={"Authorization": f"Bearer {token}"})
                    self.assert_rejected(response, expected_status=status)
                    fetch.assert_not_awaited()

    def test_enrichment_failure_response_does_not_expose_machine_key(self):
        self.enrich.return_value = {
            "account_id": "account-1", "status": "failed",
            "fields_updated": [], "skipped_reason": "Seamless enrichment request failed.",
        }
        with self.assertNoLogs(level="WARNING"):
            response = self.client.post("/accounts/enrich-one/account-1", headers={"x-api-key": self.machine_key})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "failed")
        self.assertNotIn(self.machine_key, response.text)

    def test_authentication_logs_do_not_disclose_keys(self):
        submitted_key = "incorrect-secret-for-log-tests"
        with self.assertLogs("httpx", level="INFO") as captured:
            for headers in ({}, {"x-api-key": submitted_key}, {"x-api-key": self.machine_key}):
                self.client.post("/accounts/enrich-one/account-1", headers=headers)
        output = "\n".join(captured.output)
        self.assertNotIn(self.machine_key, output)
        self.assertNotIn(submitted_key, output)
