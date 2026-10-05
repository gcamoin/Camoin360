import os
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import httpx

from . import dynamics


class AutomaticEnrichmentPolicyTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.account = {"accountid": "account-1", "name": "Acme", "cr73c_enrichmentattempted": False}
        self.started_at = datetime.now(timezone.utc).replace(microsecond=0)
        self.get_account = self.start_patch("get_account", new=AsyncMock(side_effect=lambda *args: dict(self.account)))
        self.provider = self.start_patch("enrich_with_seamless", new=AsyncMock(return_value={"websiteurl": "https://acme.example"}))
        self.credit_check = self.start_patch("can_make_request", return_value=True)
        self.record_usage = self.start_patch("increment_usage", return_value={"credits_used": 1})
        self.update = self.start_patch("update_account", new=AsyncMock(side_effect=self.confirm_update))
        environment = patch.dict(os.environ, {"SEAMLESS_API_KEY": "provider-key-for-tests"})
        environment.start()
        self.addCleanup(environment.stop)

    def start_patch(self, name, **kwargs):
        replacement = patch.object(dynamics, name, **kwargs)
        result = replacement.start()
        self.addCleanup(replacement.stop)
        return result

    async def confirm_update(self, account_id, updates):
        self.account.update(updates)
        return True

    def assert_not_attempted(self):
        self.update.assert_not_awaited()
        self.assertFalse(self.account["cr73c_enrichmentattempted"])
        self.assertNotIn("cr73c_enrichmentlastattemptedon", self.account)

    def assert_completed(self, result, expected_status, expected_updates=None):
        self.assertEqual(result["status"], expected_status)
        self.update.assert_awaited_once()
        account_id, payload = self.update.await_args.args
        self.assertEqual(account_id, "account-1")
        self.assertIs(payload["cr73c_enrichmentattempted"], True)
        attempted_at = datetime.strptime(payload["cr73c_enrichmentlastattemptedon"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        self.assertGreaterEqual(attempted_at, self.started_at)
        self.assertLessEqual(attempted_at, datetime.now(timezone.utc))
        field_updates = {key: value for key, value in payload.items() if key not in {
            "cr73c_enrichmentattempted", "cr73c_enrichmentlastattemptedon",
        }}
        self.assertEqual(field_updates, expected_updates or {})
        self.assertEqual(result["fields_updated"], list(field_updates))

    async def test_account_retrieval_failure_leaves_account_retryable(self):
        self.get_account.side_effect = RuntimeError("Dynamics unavailable")
        result = await dynamics.enrich_one_account("account-1")
        self.assertEqual(result["status"], "failed")
        self.assert_not_attempted()
        self.provider.assert_not_awaited()

    async def test_missing_configuration_leaves_account_retryable(self):
        os.environ.pop("SEAMLESS_API_KEY", None)
        result = await dynamics.enrich_one_account("account-1")
        self.assertEqual(result["status"], "failed")
        self.assert_not_attempted()
        self.provider.assert_not_awaited()
        self.record_usage.assert_not_called()

    async def test_provider_exception_leaves_account_retryable(self):
        self.provider.side_effect = RuntimeError("Provider unavailable")
        result = await dynamics.enrich_one_account("account-1")
        self.assertEqual(result["status"], "failed")
        self.assert_not_attempted()
        self.record_usage.assert_called_once_with()

    async def test_network_exception_leaves_account_retryable(self):
        self.provider.side_effect = httpx.ReadTimeout("Provider timeout")
        result = await dynamics.enrich_one_account("account-1")
        self.assertEqual(result["status"], "failed")
        self.assert_not_attempted()

    async def test_credit_limit_does_not_mark_attempted(self):
        self.credit_check.return_value = False
        result = await dynamics.enrich_one_account("account-1")
        self.assertEqual(result["status"], "skipped_credit_limit")
        self.assert_not_attempted()
        self.provider.assert_not_awaited()
        self.record_usage.assert_not_called()

    async def test_credit_budget_read_failure_stops_before_provider(self):
        self.credit_check.side_effect = OSError("Usage file inaccessible")
        result = await dynamics.enrich_one_account("account-1")
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["skipped_reason"], "Unable to check Seamless credit usage.")
        self.assert_not_attempted()
        self.provider.assert_not_awaited()

    async def test_missing_name_is_completed_without_provider_call(self):
        self.account["name"] = None
        result = await dynamics.enrich_one_account("account-1")
        self.assert_completed(result, "no_match")
        self.provider.assert_not_awaited()
        self.record_usage.assert_not_called()

    async def test_whitespace_name_is_completed_without_provider_call(self):
        self.account["name"] = "  "
        result = await dynamics.enrich_one_account("account-1")
        self.assert_completed(result, "no_match")
        self.provider.assert_not_awaited()

    async def test_no_match_completes_attempt(self):
        self.provider.return_value = {}
        result = await dynamics.enrich_one_account("account-1")
        self.assert_completed(result, "no_match")
        self.record_usage.assert_called_once_with()

    async def test_no_eligible_fields_completes_attempt(self):
        self.account["websiteurl"] = "https://human-entered.example"
        result = await dynamics.enrich_one_account("account-1")
        self.assert_completed(result, "no_updates_needed")
        self.assertEqual(self.account["websiteurl"], "https://human-entered.example")

    async def test_success_updates_fields_and_completes_attempt(self):
        result = await dynamics.enrich_one_account("account-1")
        self.assert_completed(result, "updated", {"websiteurl": "https://acme.example"})
        self.get_account.assert_awaited_once_with("account-1", dynamics.ENRICHMENT_ACCOUNT_FIELDS)

    async def test_already_attempted_account_never_reaches_provider(self):
        self.account["cr73c_enrichmentattempted"] = True
        result = await dynamics.enrich_one_account("account-1")
        self.assertEqual(result["status"], "skipped_already_attempted")
        self.provider.assert_not_awaited()
        self.update.assert_not_awaited()
        self.credit_check.assert_not_called()
        self.record_usage.assert_not_called()

    async def test_provider_failure_can_be_retried_then_skips_after_success(self):
        self.provider.side_effect = [RuntimeError("Temporary provider failure"), {"websiteurl": "https://acme.example"}]
        failed = await dynamics.enrich_one_account("account-1")
        self.assertEqual(failed["status"], "failed")
        self.assert_not_attempted()
        succeeded = await dynamics.enrich_one_account("account-1")
        self.assert_completed(succeeded, "updated", {"websiteurl": "https://acme.example"})
        skipped = await dynamics.enrich_one_account("account-1")
        self.assertEqual(skipped["status"], "skipped_already_attempted")
        self.assertEqual(self.provider.await_count, 2)

    async def test_missing_configuration_can_be_retried_after_configuration(self):
        os.environ.pop("SEAMLESS_API_KEY", None)
        failed = await dynamics.enrich_one_account("account-1")
        self.assertEqual(failed["status"], "failed")
        self.assert_not_attempted()
        os.environ["SEAMLESS_API_KEY"] = "provider-key-for-tests"
        succeeded = await dynamics.enrich_one_account("account-1")
        self.assert_completed(succeeded, "updated", {"websiteurl": "https://acme.example"})

    async def test_usage_write_failure_does_not_invalidate_success(self):
        self.record_usage.side_effect = OSError("Usage file unwritable")
        with self.assertLogs(dynamics.logger, level="ERROR") as captured:
            result = await dynamics.enrich_one_account("account-1")
        self.assert_completed(result, "updated", {"websiteurl": "https://acme.example"})
        self.assertIn("Unable to record Seamless credit usage", "\n".join(captured.output))

    async def test_usage_write_failure_does_not_invalidate_no_match(self):
        self.record_usage.side_effect = OSError("Usage file unwritable")
        self.provider.return_value = {}
        result = await dynamics.enrich_one_account("account-1")
        self.assert_completed(result, "no_match")

    async def test_usage_write_failure_does_not_invalidate_no_updates(self):
        self.record_usage.side_effect = OSError("Usage file unwritable")
        self.account["websiteurl"] = "https://human-entered.example"
        result = await dynamics.enrich_one_account("account-1")
        self.assert_completed(result, "no_updates_needed")

    async def test_usage_write_failure_does_not_mask_provider_failure(self):
        self.record_usage.side_effect = OSError("Usage file unwritable")
        self.provider.side_effect = RuntimeError("Provider unavailable")
        result = await dynamics.enrich_one_account("account-1")
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["skipped_reason"], "Seamless enrichment request failed.")
        self.assert_not_attempted()

    async def test_dynamics_patch_failure_never_reports_completion(self):
        self.update.side_effect = dynamics.DynamicsApiError("Dynamics rejected update", 500)
        result = await dynamics.enrich_one_account("account-1")
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["fields_updated"], [])
        self.assertFalse(self.account["cr73c_enrichmentattempted"])
        self.update.assert_awaited_once()

    async def test_dynamics_400_does_not_retry_without_required_timestamp(self):
        self.update.side_effect = dynamics.DynamicsApiError("Invalid Dynamics field", 400)
        result = await dynamics.enrich_one_account("account-1")
        self.assertEqual(result["status"], "failed")
        self.update.assert_awaited_once()
        self.assertIn("cr73c_enrichmentlastattemptedon", self.update.await_args.args[1])
        self.assertFalse(self.account["cr73c_enrichmentattempted"])

    async def test_nameless_account_patch_failure_returns_failed(self):
        self.account["name"] = None
        self.update.side_effect = httpx.ReadTimeout("Dynamics response timeout")
        result = await dynamics.enrich_one_account("account-1")
        self.assertEqual(result["status"], "failed")
        self.assertFalse(self.account["cr73c_enrichmentattempted"])
        self.provider.assert_not_awaited()

    async def test_dynamics_response_timeout_is_not_reported_as_success(self):
        async def write_then_timeout(account_id, updates):
            self.account.update(updates)
            raise httpx.ReadTimeout("Dynamics may have committed before response timeout")

        self.update.side_effect = write_then_timeout
        result = await dynamics.enrich_one_account("account-1")
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["fields_updated"], [])
        # A later read can observe completion, despite the unconfirmed response.
        self.assertTrue(self.account["cr73c_enrichmentattempted"])
        retried = await dynamics.enrich_one_account("account-1")
        self.assertEqual(retried["status"], "skipped_already_attempted")
        self.provider.assert_awaited_once()
