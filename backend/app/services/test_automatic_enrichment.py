import os
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import httpx

from . import dynamics, seamless


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

    def populated_targets(self):
        values = {field: "human-entered" for field in dynamics.ENRICHMENT_FIELD_NAMES}
        values["numberofemployees"] = 0  # Zero is populated under existing semantics.
        values["cr73c_naicscode"] = "541511"
        values["address1_postalcode"] = "12866"
        return values

    def test_credit_worthy_targets_are_exact_subset_of_all_targets(self):
        self.assertEqual(dynamics.CREDIT_WORTHY_ENRICHMENT_FIELDS, {
            "websiteurl", "telephone1", "numberofemployees", "address1_postalcode", "cr73c_naicscode",
        })
        self.assertTrue(dynamics.CREDIT_WORTHY_ENRICHMENT_FIELDS.issubset(dynamics.ENRICHMENT_FIELD_NAMES))

    async def test_optional_only_missing_fields_skip_provider_and_complete_evaluation(self):
        optional = ("description", "address1_city", "address1_stateorprovince", "address1_country")
        for missing in [(field,) for field in optional] + [optional]:
            with self.subTest(missing=missing):
                existing = self.populated_targets()
                self.account = {"name": "Acme", "cr73c_enrichmentattempted": False, **existing}
                for field in missing:
                    self.account[field] = None
                self.update.reset_mock()
                os.environ.pop("SEAMLESS_API_KEY", None)
                result = await dynamics.enrich_one_account("account-1")
                self.assert_completed(result, "no_updates_needed")
                self.provider.assert_not_awaited()
                self.credit_check.assert_not_called()
                self.record_usage.assert_not_called()
                for field, value in existing.items():
                    self.assertEqual(self.account[field], None if field in missing else value)
                skipped = await dynamics.enrich_one_account("account-1")
                self.assertEqual(skipped["status"], "skipped_already_attempted")
                self.update.assert_awaited_once()

    async def test_optional_only_metadata_failure_remains_retryable(self):
        self.account.update(self.populated_targets())
        self.account["description"] = "   "
        self.update.side_effect = RuntimeError("Dynamics unavailable")
        failed = await dynamics.enrich_one_account("account-1")
        self.assertEqual(failed["status"], "failed")
        self.assertFalse(self.account["cr73c_enrichmentattempted"])
        self.assertNotIn("cr73c_enrichmentlastattemptedon", self.account)
        self.provider.assert_not_awaited()
        self.credit_check.assert_not_called()
        self.record_usage.assert_not_called()
        self.update.reset_mock()
        self.update.side_effect = self.confirm_update
        result = await dynamics.enrich_one_account("account-1")
        self.assert_completed(result, "no_updates_needed")
        self.provider.assert_not_awaited()

    async def test_fallback_is_one_invocation_but_two_http_searches(self):
        self.account.update(self.populated_targets())
        self.account["cr73c_naicscode"] = None
        first = MagicMock(status_code=200, headers={})
        first.json.return_value = {"data": []}
        second = MagicMock(status_code=200, headers={})
        second.json.return_value = {"data": [{"name": "Acme", "domain": "acme.example", "naicsCode": 511210}]}
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.post.side_effect = [first, second]
        with (
            patch.object(dynamics, "enrich_with_seamless", wraps=seamless.enrich_with_seamless) as provider,
            patch.object(seamless, "SEAMLESS_API_KEY", "test-key"),
            patch.object(seamless.httpx, "AsyncClient", return_value=client),
        ):
            result = await dynamics.enrich_one_account("account-1")
        self.assert_completed(result, "updated", {"cr73c_naicscode": "511210"})
        provider.assert_awaited_once()
        self.assertEqual(client.post.await_count, 2)
        self.assertEqual(client.post.await_args_list[1].kwargs["json"], {"companyName": ["Acme"], "limit": 5})
        self.credit_check.assert_called_once_with()
        self.record_usage.assert_called_once_with()

    async def test_complete_account_skips_provider_configuration_credits_and_usage(self):
        existing = self.populated_targets()
        self.account.update(existing)
        os.environ.pop("SEAMLESS_API_KEY", None)
        result = await dynamics.enrich_one_account("account-1")
        self.assert_completed(result, "no_updates_needed")
        self.provider.assert_not_awaited()
        self.credit_check.assert_not_called()
        self.record_usage.assert_not_called()
        for field, value in existing.items():
            self.assertEqual(self.account[field], value)
        skipped = await dynamics.enrich_one_account("account-1")
        self.assertEqual(skipped["status"], "skipped_already_attempted")
        self.provider.assert_not_awaited()
        self.update.assert_awaited_once()

    async def test_complete_account_metadata_write_failure_is_retryable_without_provider(self):
        self.account.update(self.populated_targets())
        self.update.side_effect = RuntimeError("Dynamics unavailable")
        result = await dynamics.enrich_one_account("account-1")
        self.assertEqual(result["status"], "failed")
        self.assertFalse(self.account["cr73c_enrichmentattempted"])
        self.assertNotIn("cr73c_enrichmentlastattemptedon", self.account)
        self.provider.assert_not_awaited()
        self.credit_check.assert_not_called()
        self.record_usage.assert_not_called()
        self.update.reset_mock()
        self.update.side_effect = self.confirm_update
        result = await dynamics.enrich_one_account("account-1")
        self.assert_completed(result, "no_updates_needed")
        self.provider.assert_not_awaited()

    async def test_missing_fields_use_one_actual_search_and_preserve_other_values(self):
        scenarios = (
            (("websiteurl",), {}, {"websiteurl": "https://provider.example"}),
            (("telephone1",), {}, {"telephone1": "555-0100"}),
            (("numberofemployees",), {"employeeCount": 42}, {"numberofemployees": 42}),
            (("cr73c_naicscode", "description"), {"naicsCode": 511210, "description": "Company description"},
             {"description": "Company description", "cr73c_naicscode": "511210"}),
            (("websiteurl", "address1_city", "address1_stateorprovince"), {},
             {"websiteurl": "https://provider.example", "address1_city": "Cambridge", "address1_stateorprovince": "Massachusetts"}),
            (("cr73c_naicscode",), {"naicsCode": 511210}, {"cr73c_naicscode": "511210"}),
            (("address1_postalcode",), {"postCode": "02141"}, {"address1_postalcode": "02141"}),
            (("address1_postalcode", "cr73c_naicscode"),
             {"postCode": "02141", "naicsCode": 511210},
             {"address1_postalcode": "02141", "cr73c_naicscode": "511210"}),
            (("address1_postalcode", "cr73c_naicscode"), {}, {}),
        )
        for missing, provider_values, expected in scenarios:
            with self.subTest(missing=missing, provider_values=provider_values):
                existing = self.populated_targets()
                self.account = {"name": "Acme", "cr73c_enrichmentattempted": False, **existing}
                for field in missing:
                    self.account[field] = "   "
                self.update.reset_mock()
                self.credit_check.reset_mock()
                self.record_usage.reset_mock()
                response = MagicMock(status_code=200, headers={})
                response.json.return_value = {"data": [{
                    "name": "Acme", "domain": "provider.example", "phones": ["555-0100"],
                    "city": "Cambridge", "state": "Massachusetts", "country": "United States",
                    **provider_values,
                }]}
                client = AsyncMock()
                client.__aenter__.return_value = client
                client.post.return_value = response
                with (
                    patch.object(dynamics, "enrich_with_seamless", wraps=seamless.enrich_with_seamless) as provider,
                    patch.object(seamless, "SEAMLESS_API_KEY", "test-key"),
                    patch.object(seamless.httpx, "AsyncClient", return_value=client),
                ):
                    result = await dynamics.enrich_one_account("account-1")
                self.assert_completed(result, "updated" if expected else "no_updates_needed", expected)
                provider.assert_awaited_once()
                client.post.assert_awaited_once()
                self.credit_check.assert_called_once_with()
                self.record_usage.assert_called_once_with()
                for field, value in existing.items():
                    if field not in missing:
                        self.assertEqual(self.account[field], value)

    async def test_naics_only_updates_blank_values_in_metadata_patch(self):
        for blank, value in ((None, 511210), ("", "511210"), ("   ", " 511210 ")):
            with self.subTest(blank=blank, value=value):
                self.account = {"name": "Acme", "cr73c_enrichmentattempted": False,
                                "cr73c_naicscode": blank}
                self.update.reset_mock()
                self.provider.return_value = {"cr73c_naicscode": value}
                result = await dynamics.enrich_one_account("account-1")
                self.assert_completed(result, "updated", {"cr73c_naicscode": "511210"})
                self.assertIn("cr73c_naicscode", self.get_account.await_args.args[1].split(","))

    async def test_existing_naics_is_preserved(self):
        self.account["cr73c_naicscode"] = "541511"
        self.provider.return_value = {"cr73c_naicscode": "511210"}
        result = await dynamics.enrich_one_account("account-1")
        self.assert_completed(result, "no_updates_needed")
        self.assertEqual(self.account["cr73c_naicscode"], "541511")

    async def test_missing_invalid_naics_does_not_interfere_with_other_fields(self):
        for fields in [{}, *({"cr73c_naicscode": v} for v in
                            (None, "", "Technology", "51121", "511210.0", 511210.0, True, [], {}))]:
            with self.subTest(fields=fields):
                self.account = {"name": "Acme", "cr73c_enrichmentattempted": False}
                self.update.reset_mock()
                expected = {"websiteurl": "https://acme.example", "telephone1": "555-0100",
                            "address1_city": "Cambridge", "address1_postalcode": "02141"}
                self.provider.return_value = {**expected, **fields}
                result = await dynamics.enrich_one_account("account-1")
                self.assert_completed(result, "updated", expected)
                self.assertNotIn("cr73c_naicscode", self.account)

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

    async def test_postal_text_formats_and_blank_dynamics_values(self):
        for blank, postal, expected in (
            (None, "02141", "02141"),
            ("", " 02141 ", "02141"),
            ("   ", "02141-1234", "02141-1234"),
            (None, " SW1A 1AA ", "SW1A 1AA"),
        ):
            with self.subTest(blank=blank, postal=postal):
                self.account = {"name": "Acme", "cr73c_enrichmentattempted": False,
                                "websiteurl": "https://acme.example", "address1_postalcode": blank}
                self.update.reset_mock()
                self.provider.return_value = {"websiteurl": "https://acme.example", "address1_postalcode": postal}
                result = await dynamics.enrich_one_account("account-1")
                self.assert_completed(result, "updated", {"address1_postalcode": expected})
                self.assertIsInstance(self.account["address1_postalcode"], str)
        self.assertIn("address1_postalcode", self.get_account.await_args.args[1].split(","))

    async def test_populated_postal_is_preserved(self):
        self.account["address1_postalcode"] = "12866"
        self.provider.return_value = {"address1_postalcode": "02141"}
        result = await dynamics.enrich_one_account("account-1")
        self.assert_completed(result, "no_updates_needed")
        self.assertEqual(self.account["address1_postalcode"], "12866")

    async def test_unusable_postal_does_not_interfere_with_other_fields(self):
        cases = [{}, *({"address1_postalcode": value} for value in (
            None, "", "   ", 2141, 0, True, {}, [],
        ))]
        for postal_fields in cases:
            with self.subTest(postal_fields=postal_fields):
                self.account = {"name": "Acme", "cr73c_enrichmentattempted": False}
                self.update.reset_mock()
                self.provider.return_value = {"websiteurl": "https://acme.example", **postal_fields}
                result = await dynamics.enrich_one_account("account-1")
                self.assert_completed(result, "updated", {"websiteurl": "https://acme.example"})
                self.assertNotIn("address1_postalcode", self.account)

    async def test_only_invalid_postal_does_not_produce_field_update(self):
        self.provider.return_value = {"address1_postalcode": 2141}
        result = await dynamics.enrich_one_account("account-1")
        self.assert_completed(result, "no_updates_needed")

    async def test_existing_fields_and_postal_share_one_patch(self):
        expected = {
            "websiteurl": "https://acme.example", "telephone1": "555-0100",
            "description": "Company description", "numberofemployees": 1200,
            "address1_city": "Cambridge", "address1_stateorprovince": "Massachusetts",
            "address1_country": "United States", "address1_postalcode": "02141",
            "cr73c_naicscode": "511210",
        }
        self.provider.return_value = {**expected, "numberofemployees": "1,200"}
        result = await dynamics.enrich_one_account("account-1")
        self.assert_completed(result, "updated", expected)

    async def test_all_existing_fields_are_preserved_while_postal_is_added(self):
        existing = {
            "websiteurl": "https://human.example", "telephone1": "555-9999",
            "description": "Human description", "numberofemployees": 0,
            "address1_city": "Saratoga Springs", "address1_stateorprovince": "NY",
            "address1_country": "United States",
        }
        self.account.update(existing)
        self.provider.return_value = {
            "websiteurl": "https://provider.example", "telephone1": "555-0100",
            "description": "Provider description", "numberofemployees": 1200,
            "address1_city": "Cambridge", "address1_stateorprovince": "MA",
            "address1_country": "Canada", "address1_postalcode": "02141",
        }
        result = await dynamics.enrich_one_account("account-1")
        self.assert_completed(result, "updated", {"address1_postalcode": "02141"})
        for field, value in existing.items():
            self.assertEqual(self.account[field], value)

    async def test_shared_mapping_does_not_broaden_manual_updates(self):
        self.provider.return_value = {"address1_postalcode": "02141", "cr73c_naicscode": "511210"}
        with patch.object(dynamics, "increment_processed"), patch.object(dynamics, "load_usage", return_value={"credits_used": 0}):
            result = await dynamics.enrich_account("account-1")
        self.assertFalse(result["updated"])
        self.update.assert_not_awaited()


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
