import unittest
from unittest.mock import AsyncMock, patch

import httpx

from backend.app.services import dynamics, seamless


class ManualEnrichmentTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.account = {"accountid": "account-1", "name": "Acme"}
        self.values = {
            "websiteurl": "acme.example", "telephone1": "555-0100", "description": "Provider description",
            "numberofemployees": "1,200", "address1_city": "Boston", "address1_stateorprovince": "Massachusetts",
            "address1_country": "United States", "address1_postalcode": "02141", "cr73c_naicscode": "051111",
        }
        self.get = self.mock("get_account", new=AsyncMock(return_value=self.account))
        self.provider = self.mock("enrich_with_seamless", new=AsyncMock(return_value=self.values))
        self.update = self.mock("update_account", new=AsyncMock(return_value=True))
        self.credit = self.mock("can_make_request", return_value=True)
        self.usage = self.mock("increment_usage", return_value={"credits_used": 1})
        self.mock("increment_processed")
        self.audit = self.mock("log_update")
        sleeper = patch.object(dynamics.asyncio, "sleep", new=AsyncMock())
        self.sleep = sleeper.start()
        self.addCleanup(sleeper.stop)

    def mock(self, name, **kwargs):
        patcher = patch.object(dynamics, name, **kwargs)
        mocked = patcher.start()
        self.addCleanup(patcher.stop)
        return mocked

    async def run_one(self, fields):
        return await dynamics.enrich_account("account-1", fields)

    async def test_each_selected_field_updates_only_that_field_when_blank(self):
        expected = {**self.values, "websiteurl": "https://acme.example", "numberofemployees": 1200,
                    "address1_stateorprovince": "MA"}
        for field in dynamics.MANUAL_ENRICHMENT_FIELDS:
            with self.subTest(field=field):
                self.update.reset_mock()
                result = await self.run_one([field])
                self.update.assert_awaited_once_with("account-1", {field: expected[field]})
                self.assertEqual(result["status"], "updated")
                self.assertEqual(result["fields_updated"], [field])
                self.assertEqual(result["updates"], {field: expected[field]})
                self.assertEqual(result["account_name"], "Acme")
        self.assertEqual(self.provider.await_count, 9)
        self.assertEqual(self.usage.call_count, 9)
        selected = self.get.await_args.args[1].split(",")
        self.assertTrue(set(dynamics.MANUAL_ENRICHMENT_FIELDS).issubset(selected))
        self.assertNotIn("new_employees", selected)
        self.assertNotIn("new_naicstext", selected)

    async def test_populated_values_are_preserved_without_provider_or_credits(self):
        for field in dynamics.MANUAL_ENRICHMENT_FIELDS:
            with self.subTest(field=field):
                self.account.clear()
                self.account.update(name="Acme", **{field: 0 if field == "numberofemployees" else "Human value"})
                result = await self.run_one([field])
                self.assertEqual(result["status"], "no_updates_needed")
                self.assertEqual(result["fields_updated"], [])
        self.provider.assert_not_awaited()
        self.credit.assert_not_called()
        self.usage.assert_not_called()
        self.update.assert_not_awaited()

    async def test_populated_description_is_preserved_during_other_selected_updates(self):
        self.account["description"] = "Human description"
        result = await self.run_one(["description", "websiteurl"])
        self.assertEqual(result["fields_updated"], ["websiteurl"])
        self.assertIn("description", self.get.await_args.args[1].split(","))
        self.update.assert_awaited_once_with("account-1", {"websiteurl": "https://acme.example"})

    async def test_unselected_city_and_description_never_update(self):
        result = await self.run_one(["telephone1"])
        self.assertEqual(result["fields_updated"], ["telephone1"])
        self.update.assert_awaited_once_with("account-1", {"telephone1": "555-0100"})

    async def test_whitespace_fields_are_blank(self):
        self.account.update(description="  ", address1_postalcode="\t")
        result = await self.run_one(["description", "address1_postalcode"])
        self.assertEqual(result["fields_updated"], ["description", "address1_postalcode"])
        self.assertEqual(result["updates"]["address1_postalcode"], "02141")

    async def test_empty_and_unsupported_selections_rejected_before_work(self):
        for fields in ([], ["new_datasource"], ["new_employees"], ["new_naicstext"], ["websiteurl", "new_datasource"]):
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                await dynamics.enrich_selected_accounts(["account-1"], fields)
        with self.assertRaises(ValueError):
            await self.run_one([])
        self.get.assert_not_awaited()
        self.provider.assert_not_awaited()
        self.usage.assert_not_called()

    async def test_legacy_omitted_selection_does_not_add_postal_or_naics_targets(self):
        self.provider.return_value = {"address1_postalcode": "02141", "cr73c_naicscode": "541511"}
        result = await dynamics.enrich_account("account-1")
        self.assertEqual(result["status"], "no_updates_needed")
        self.update.assert_not_awaited()

    async def test_invalid_optional_values_do_not_block_other_updates(self):
        for field, values in {
            "cr73c_naicscode": (None, "1", "31-33", "311.0", 311.5, False, "", "   ", "5415110", "5415AA", "NAICS 541511", 541511.0, True),
            "address1_postalcode": (None, 2141, True, "  "),
            "numberofemployees": (None, True, -1, "many", 1.5, 2147483648),
            "description": (None, {}, True),
            "websiteurl": (None, "ftp://acme.example", {}, "https://"),
        }.items():
            for invalid in values:
                with self.subTest(field=field, invalid=invalid):
                    self.values[field] = invalid
                    result = await self.run_one([field, "telephone1"])
                    self.assertEqual(result["fields_updated"], ["telephone1"])
                    self.assertEqual(result["status"], "updated")

    async def test_naics_hierarchy_codes_are_selected_blank_only_text(self):
        for code in ("31", "311", "3118", "31181", "311811", "051111"):
            for value in (code, int(code), f" {code} "):
                with self.subTest(value=value):
                    self.account.pop("cr73c_naicscode", None)
                    self.provider.reset_mock(); self.update.reset_mock(); self.usage.reset_mock()
                    self.values["cr73c_naicscode"] = value
                    result = await self.run_one(["cr73c_naicscode"])
                    expected = str(value).strip()
                    self.assertEqual(result["updates"], {"cr73c_naicscode": expected})
                    self.assertEqual(result["fields_updated"], ["cr73c_naicscode"])
                    self.update.assert_awaited_once_with("account-1", {"cr73c_naicscode": expected})
                    self.provider.assert_awaited_once(); self.usage.assert_called_once()
                    self.account["cr73c_naicscode"] = code
                    self.provider.reset_mock(); self.update.reset_mock(); self.usage.reset_mock()
                    preserved = await self.run_one(["cr73c_naicscode"])
                    self.assertEqual(preserved["status"], "no_updates_needed")
                    self.assertEqual(self.account["cr73c_naicscode"], code)
                    self.provider.assert_not_awaited(); self.update.assert_not_awaited(); self.usage.assert_not_called()

    async def test_paid_lookup_without_selected_values_is_completed_without_updates(self):
        self.provider.return_value = {"telephone1": "555-0100"}
        result = await self.run_one(["description"])
        self.assertEqual(result["status"], "no_updates_needed")
        self.assertEqual(result["reason_code"], "no_selected_values")
        self.provider.assert_awaited_once()
        self.usage.assert_called_once()
        self.update.assert_not_awaited()

    async def test_no_match_and_credit_limit_have_explicit_outcomes(self):
        self.provider.return_value = {}
        self.assertEqual((await self.run_one(["websiteurl"]))["status"], "no_match")
        self.usage.assert_called_once()
        self.provider.reset_mock()
        self.credit.return_value = False
        result = await self.run_one(["websiteurl"])
        self.assertEqual(result["status"], "skipped_credit_limit")
        self.provider.assert_not_awaited()
        self.update.assert_not_awaited()

    async def test_failures_are_sanitized_and_do_not_report_intended_updates(self):
        for phase, mocked in (("dynamics_read", self.get), ("provider", self.provider), ("dynamics_write", self.update)):
            with self.subTest(phase=phase):
                mocked.side_effect = RuntimeError("Bearer SECRET provider raw payload")
                result = await self.run_one(["websiteurl"])
                mocked.side_effect = None
                self.assertEqual(result["status"], "failed")
                self.assertEqual(result["error_category"], phase)
                self.assertEqual(result["fields_updated"], [])
                self.assertIsNone(result["updates"])
                self.assertNotIn("SECRET", str(result))
        self.audit.assert_not_called()

    async def test_patch_timeout_reports_uncertainty_not_confirmed_fields(self):
        self.update.side_effect = httpx.ReadTimeout("SECRET")
        result = await self.run_one(["address1_postalcode"])
        self.assertEqual(result["status"], "failed")
        self.assertTrue(result["completion_uncertain"])
        self.assertEqual(result["fields_updated"], [])
        self.assertIsNone(result["updates"])

    async def test_missing_name_skips_provider(self):
        self.account["name"] = " "
        result = await self.run_one(["websiteurl"])
        self.assertEqual(result["reason_code"], "missing_company_name")
        self.provider.assert_not_awaited()
        self.usage.assert_not_called()

    async def test_confirmed_patch_survives_audit_failure(self):
        self.audit.side_effect = RuntimeError("SECRET")
        with self.assertLogs(dynamics.logger, level="WARNING") as logs:
            result = await self.run_one(["telephone1"])
        self.assertEqual(result["status"], "updated")
        self.assertEqual(result["fields_updated"], ["telephone1"])
        self.assertNotIn("SECRET", str(logs.output))

    async def test_batch_reports_each_result_and_continues_after_write_failure(self):
        self.update.side_effect = [RuntimeError("SECRET"), True]
        result = await dynamics.enrich_selected_accounts(["first", "second"], ["websiteurl"])
        self.assertEqual(result["processed"], 2)
        self.assertEqual(result["updated"], 1)
        self.assertEqual([item["status"] for item in result["results"]], ["failed", "updated"])
        self.assertEqual(result["results"][0]["fields_updated"], [])
        self.assertEqual(self.sleep.await_count, 2)

    async def test_manual_adapter_fallback_uses_two_searches_and_one_usage_increment(self):
        self.account.update(address1_city="Boston", address1_stateorprovince="MA")
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.post.side_effect = [httpx.Response(200, json={"data": []}), httpx.Response(200, json={"data": [
            {"name": "Acme", "domain": "acme.example", "postCode": "02141", "naicsCode": "051111"}]})]
        self.provider.side_effect = seamless.enrich_with_seamless
        with patch.object(seamless, "SEAMLESS_API_KEY", "test-key"), patch.object(seamless.httpx, "AsyncClient", return_value=client):
            result = await self.run_one(["address1_postalcode", "cr73c_naicscode"])
        self.assertEqual(result["status"], "updated")
        self.assertEqual(result["updates"], {"address1_postalcode": "02141", "cr73c_naicscode": "051111"})
        self.assertEqual(client.post.await_count, 2)
        self.provider.assert_awaited_once()
        self.usage.assert_called_once()
