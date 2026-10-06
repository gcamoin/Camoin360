import asyncio
import json
import os
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import httpx

from backend.app import database
from backend.app.routes import accounts
from backend.app.services import account_enrichment_history as history, dynamics, seamless
from backend.app.testing_support import temporary_database


class AutomaticEnrichmentHistoryTest(unittest.IsolatedAsyncioTestCase):
    """Exercise the real automatic route, enrichment policy, provider, and PostgreSQL."""

    def setUp(self):
        isolated = temporary_database()
        isolated.start()
        self.addCleanup(isolated.stop)
        self.account = {
            "accountid": "account-1", "name": "Acme", "createdon": "2026-10-05T12:00:00Z",
            "cr73c_enrichmentattempted": False,
        }
        self.patch_object(dynamics, "get_account", AsyncMock(side_effect=lambda *args: dict(self.account)))
        self.update = self.patch_object(dynamics, "update_account", AsyncMock(side_effect=self.confirm_update))
        self.credit_check = self.patch_object(dynamics, "can_make_request", MagicMock(return_value=True))
        self.usage = self.patch_object(dynamics, "increment_usage", MagicMock(return_value={"credits_used": 1}))
        self.patch_object(accounts, "invalidate_account_endpoint_caches", MagicMock())
        self.patch_object(seamless, "SEAMLESS_API_KEY", "secret-provider-key")
        environment = patch.dict(os.environ, {"SEAMLESS_API_KEY": "secret-provider-key"})
        environment.start()
        self.addCleanup(environment.stop)
        self.client = AsyncMock()
        self.client.__aenter__.return_value = self.client
        self.client.post.return_value = self.response([{"name": "Acme", "domain": "acme.example"}])
        self.patch_object(seamless.httpx, "AsyncClient", MagicMock(return_value=self.client))

    def patch_object(self, target, name, replacement):
        patcher = patch.object(target, name, replacement)
        patcher.start()
        self.addCleanup(patcher.stop)
        return replacement

    @staticmethod
    def response(data, status=200):
        response = MagicMock(status_code=status, headers={})
        response.json.return_value = {"data": data}
        response.text = "provider-payload secret-provider-key Bearer secret-token"
        return response

    async def confirm_update(self, account_id, updates):
        self.account.update(updates)
        return True

    def rows(self):
        with database.get_database_connection() as connection:
            connection.execute("SET LOCAL TIME ZONE 'UTC'")
            return connection.execute("SELECT * FROM account_enrichment_history ORDER BY received_at, id").fetchall()

    async def run_request(self, account_id="account-1"):
        return await accounts.enrich_one(account_id, _api_key=None)

    def assert_terminal(self, result, status, count):
        self.assertEqual(result["status"], status)
        rows = self.rows()
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["status"], status)
        self.assertEqual(row["provider"], "seamless")
        self.assertEqual(row["provider_called"], count > 0)
        self.assertEqual(row["provider_request_count"], count)
        self.assertLessEqual(row["received_at"], row["started_at"])
        self.assertLessEqual(row["started_at"], row["completed_at"])
        self.assertEqual(row["received_at"].utcoffset().total_seconds(), 0)
        self.assertEqual(row["account_created_on"], datetime(2026, 10, 5, 12, tzinfo=timezone.utc))
        self.assertEqual(row["account_name"], "Acme")
        return row

    async def test_updated_is_durable_before_provider_and_records_confirmed_fields(self):
        async def search(*args, **kwargs):
            row = self.rows()[0]
            self.assertIsNone(row["status"])
            self.assertIsNone(row["completed_at"])
            self.assertIsNotNone(row["started_at"])
            return self.response([{"name": "Acme", "domain": "acme.example", "phones": ["555-0100"],
                                   "employeeCount": 25, "postCode": "01234", "naicsCode": "541511"}])
        self.client.post.side_effect = search
        result = await self.run_request()
        row = self.assert_terminal(result, "updated", 1)
        self.assertEqual(row["fields_updated"], result["fields_updated"])
        self.assertEqual(set(row["fields_updated"]), {"websiteurl", "telephone1", "numberofemployees", "address1_postalcode", "cr73c_naicscode"})
        self.assertFalse(row["completion_uncertain"])
        self.usage.assert_called_once()
        self.client.post.assert_awaited_once()

    async def test_unpaid_no_updates_needed(self):
        self.account.update({field: "populated" for field in dynamics.CREDIT_WORTHY_ENRICHMENT_FIELDS})
        result = await self.run_request()
        row = self.assert_terminal(result, "no_updates_needed", 0)
        self.assertEqual(row["reason_code"], "no_credit_worthy_fields_missing")
        self.client.post.assert_not_awaited()
        self.usage.assert_not_called()
        self.credit_check.assert_not_called()

    async def test_paid_no_updates_needed_remains_distinct(self):
        self.account.update({"websiteurl": "existing.example", "telephone1": "existing phone"})
        result = await self.run_request()
        row = self.assert_terminal(result, "no_updates_needed", 1)
        self.assertEqual(row["reason_code"], "provider_no_fields_added")
        self.assertEqual(row["fields_updated"], [])
        self.usage.assert_called_once()

    async def test_no_match_after_fallback_is_terminal(self):
        self.client.post.return_value = self.response([])
        result = await self.run_request()
        row = self.assert_terminal(result, "no_match", 2)
        self.assertEqual(row["reason_code"], "provider_no_usable_match")
        self.assertEqual(row["fields_updated"], [])
        self.assertTrue(self.account["cr73c_enrichmentattempted"])
        self.usage.assert_called_once()

    async def test_fallback_counts_two_searches_but_one_usage_increment(self):
        self.client.post.side_effect = [self.response([]), self.response([{"name": "Acme", "domain": "acme.example"}])]
        row = self.assert_terminal(await self.run_request(), "updated", 2)
        self.assertEqual(row["fields_updated"], ["websiteurl"])
        self.assertEqual(self.client.post.await_count, 2)
        self.usage.assert_called_once()
        payloads = [call.kwargs["json"] for call in self.client.post.await_args_list]
        self.assertIn("companyCity", payloads[0])
        self.assertEqual(payloads[1], {"companyName": ["Acme"], "limit": 5})

    async def test_credit_limit_has_no_provider_activity(self):
        self.credit_check.return_value = False
        row = self.assert_terminal(await self.run_request(), "skipped_credit_limit", 0)
        self.assertEqual(row["error_category"], "credit_limit")
        self.assertFalse(self.account["cr73c_enrichmentattempted"])
        self.client.post.assert_not_awaited()
        self.usage.assert_not_called()

    async def test_provider_failure_is_sanitized_and_remains_eligible_for_resubmission(self):
        self.client.post.return_value = self.response([], status=503)
        row = self.assert_terminal(await self.run_request(), "failed", 1)
        self.assertEqual(row["error_category"], "provider")
        self.assertEqual(row["error_message"], "The Seamless search failed.")
        serialized = json.dumps(row, default=str)
        for secret in ("provider-payload", "secret-provider-key", "secret-token", "Bearer"):
            self.assertNotIn(secret, serialized)
        self.assertFalse(self.account["cr73c_enrichmentattempted"])
        self.client.post.return_value = self.response([{"name": "Acme", "domain": "acme.example"}])
        self.assertEqual((await self.run_request())["status"], "updated")
        self.assertEqual([r["status"] for r in self.rows()], ["failed", "updated"])
        self.assertEqual(self.client.post.await_count, 2)
        self.assertEqual(self.usage.call_count, 2)

    async def test_failed_dynamics_write_does_not_record_intended_fields(self):
        async def fail_write(*args):
            checkpoint = self.rows()[0]
            self.assertIsNone(checkpoint["completed_at"])
            self.assertTrue(checkpoint["provider_called"])
            self.assertEqual(checkpoint["provider_request_count"], 1)
            self.assertEqual(checkpoint["fields_updated"], [])
            raise dynamics.DynamicsApiError("unsafe-response secret-token", 400)
        self.update.side_effect = fail_write
        row = self.assert_terminal(await self.run_request(), "failed", 1)
        self.assertEqual(row["error_category"], "dynamics_write")
        self.assertEqual(row["fields_updated"], [])
        self.assertFalse(row["completion_uncertain"])
        self.assertNotIn("secret-token", json.dumps(row, default=str))
        self.assertFalse(self.account["cr73c_enrichmentattempted"])

    async def test_patch_timeout_preserves_uncertainty_and_duplicate_does_not_claim_success(self):
        async def write_then_timeout(account_id, updates):
            self.account.update(updates)
            raise httpx.ReadTimeout("unconfirmed-write secret-token")
        self.update.side_effect = write_then_timeout
        row = self.assert_terminal(await self.run_request(), "failed", 1)
        self.assertTrue(row["completion_uncertain"])
        self.assertEqual(row["reason_code"], "dynamics_write_unconfirmed")
        self.assertEqual(row["fields_updated"], [])
        await self.run_request()
        rows = self.rows()
        self.assertEqual([r["status"] for r in rows], ["failed", "skipped_already_attempted"])
        self.assertTrue(rows[0]["completion_uncertain"])
        self.assertEqual(rows[1]["reason_code"], "duplicate_delivery")
        self.client.post.assert_awaited_once()

    async def test_duplicate_delivery_preserves_meaningful_history(self):
        await self.run_request()
        original = dict(self.rows()[0])
        result = await self.run_request()
        rows = self.rows()
        self.assertEqual(result["status"], "skipped_already_attempted")
        self.assertEqual(dict(rows[0]), original)
        self.assertNotEqual(rows[0]["id"], rows[1]["id"])
        self.assertEqual(rows[1]["status"], "skipped_already_attempted")
        self.assertEqual(rows[1]["provider_request_count"], 0)
        self.assertEqual(rows[1]["fields_updated"], [])
        self.client.post.assert_awaited_once()

    async def test_history_failure_is_fail_open_and_logs_no_secrets(self):
        with patch.object(history, "get_database_connection", side_effect=RuntimeError("postgresql://user:secret-token@host Authorization: Bearer secret-provider-key")):
            with self.assertLogs(history.logger, level="WARNING") as logs:
                result = await self.run_request()
        self.assertEqual(result["status"], "updated")
        self.assertEqual(self.rows(), [])
        self.client.post.assert_awaited_once()
        self.usage.assert_called_once()
        self.assertTrue(self.account["cr73c_enrichmentattempted"])
        output = " ".join(logs.output)
        self.assertIn("tracking gap", output)
        for secret in ("secret-token", "Bearer", "secret-provider-key", "postgresql://", "Traceback"):
            self.assertNotIn(secret, output)

    async def test_failed_receipt_can_recover_at_completion_without_reprocessing(self):
        original = history.AutomaticAttempt._write
        calls = 0
        def fail_first(attempt):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("secret-token")
            return original(attempt)
        with patch.object(history.AutomaticAttempt, "_write", fail_first):
            with self.assertLogs(history.logger, level="WARNING"):
                result = await self.run_request()
        self.assert_terminal(result, "updated", 1)
        self.client.post.assert_awaited_once()
        self.usage.assert_called_once()

    async def test_completion_failure_leaves_an_open_row_without_repeating_provider(self):
        original = history.AutomaticAttempt._write
        def fail_completion(attempt):
            if attempt.completed_at:
                raise RuntimeError("secret-token")
            return original(attempt)
        with patch.object(history.AutomaticAttempt, "_write", fail_completion):
            with self.assertLogs(history.logger, level="WARNING"):
                result = await self.run_request()
        self.assertEqual(result["status"], "updated")
        row = self.rows()[0]
        self.assertIsNone(row["status"])
        self.assertIsNone(row["completed_at"])
        self.client.post.assert_awaited_once()
        self.usage.assert_called_once()

    async def test_failure_categories_and_unpaid_validation(self):
        cases = [("read", "dynamics_read", "dynamics_read_failed"),
                 ("configuration", "configuration", "provider_not_configured"),
                 ("budget", "credit_check", "credit_check_failed")]
        for scenario, category, reason in cases:
            with self.subTest(scenario=scenario):
                with database.get_database_connection() as connection:
                    connection.execute("DELETE FROM account_enrichment_history")
                with patch.object(dynamics, "get_account", AsyncMock(side_effect=RuntimeError("Bearer secret-token")) if scenario == "read" else AsyncMock(return_value=dict(self.account))), \
                     patch.dict(os.environ, {"SEAMLESS_API_KEY": "" if scenario == "configuration" else "secret-provider-key"}), \
                     patch.object(dynamics, "can_make_request", side_effect=RuntimeError("secret-token") if scenario == "budget" else None, return_value=True):
                    result = await self.run_request()
                row = self.rows()[0]
                self.assertEqual(result["status"], "failed")
                self.assertEqual(row["error_category"], category)
                self.assertEqual(row["reason_code"], reason)
                self.assertEqual(row["provider_request_count"], 0)
                self.assertNotIn("secret-token", json.dumps(row, default=str))
        with database.get_database_connection() as connection:
            connection.execute("DELETE FROM account_enrichment_history")
        self.account["name"] = None
        result = await self.run_request()
        row = self.rows()[0]
        self.assertEqual(result["status"], "no_match")
        self.assertEqual(row["reason_code"], "missing_company_name")
        self.assertEqual(row["error_category"], "validation")
        self.assertEqual(row["provider_request_count"], 0)
        self.client.post.assert_not_awaited()

    async def test_unhandled_exception_and_cancellation_do_not_change_control_flow(self):
        with patch.object(accounts, "enrich_one_account", AsyncMock(side_effect=RuntimeError("secret-token"))):
            with self.assertRaises(RuntimeError):
                await self.run_request()
        row = self.rows()[0]
        self.assertEqual(row["status"], "failed")
        self.assertNotIn("secret-token", json.dumps(row, default=str))
        with patch.object(accounts, "enrich_one_account", AsyncMock(side_effect=asyncio.CancelledError)):
            with self.assertRaises(asyncio.CancelledError):
                await self.run_request()
        row = self.rows()[1]
        self.assertIsNone(row["completed_at"])
        self.assertIsNone(row["status"])
        self.assertIsNone(history._active_attempt.get())

    async def test_context_isolation_keeps_concurrent_provider_counts_separate(self):
        async def process(account_id):
            async with history.automatic_enrichment_request(account_id) as attempt:
                history.note_account({"name": account_id, "createdon": "2026-10-05T12:00:00Z"})
                for _ in range(1 if account_id == "one" else 2):
                    history.note_provider_request()
                    await asyncio.sleep(0)
                attempt.finish({"status": "no_match", "fields_updated": []})
        await asyncio.gather(process("one"), process("two"))
        self.assertEqual({r["dynamics_account_id"]: r["provider_request_count"] for r in self.rows()}, {"one": 1, "two": 2})
        self.assertIsNone(history._active_attempt.get())

    async def test_no_active_request_leaves_manual_provider_calls_untracked(self):
        await seamless.enrich_with_seamless({"name": "Acme"})
        self.client.post.assert_awaited_once()
        self.assertEqual(self.rows(), [])

    async def test_provider_cancellation_preserves_open_attempt_and_observed_search(self):
        self.client.post.side_effect = asyncio.CancelledError
        with self.assertRaises(asyncio.CancelledError):
            await self.run_request()
        row = self.rows()[0]
        self.assertIsNone(row["status"])
        self.assertIsNone(row["completed_at"])
        self.assertEqual(row["provider_request_count"], 1)
        self.assertTrue(row["provider_called"])
        self.assertEqual(row["fields_updated"], [])
        self.assertFalse(self.account["cr73c_enrichmentattempted"])
        self.usage.assert_called_once()
        self.assertIsNone(history._active_attempt.get())

    async def test_provider_client_failure_before_dispatch_is_not_counted(self):
        self.client.__aenter__.side_effect = RuntimeError("secret-provider-key")
        row = self.assert_terminal(await self.run_request(), "failed", 0)
        self.assertEqual(row["error_category"], "provider")
        self.client.post.assert_not_awaited()
        # Preserve the existing invocation-level credit policy, even in this failure path.
        self.usage.assert_called_once()

    async def test_initialization_is_additive_and_idempotent_with_expected_indexes(self):
        await self.run_request()
        original = dict(self.rows()[0])
        database.initialize_database(force=True)
        self.assertEqual(dict(self.rows()[0]), original)
        with database.get_database_connection() as connection:
            indexes = connection.execute("SELECT indexname FROM pg_indexes WHERE tablename = 'account_enrichment_history' AND schemaname = current_schema()").fetchall()
        self.assertTrue({"idx_enrichment_history_account", "idx_enrichment_history_completed", "idx_enrichment_history_open", "idx_enrichment_history_created"}.issubset({r["indexname"] for r in indexes}))


class AutomaticHistoryAuthenticationTest(unittest.TestCase):
    def setUp(self):
        from backend.app import main
        from fastapi import HTTPException
        from fastapi.testclient import TestClient
        isolated = temporary_database()
        isolated.start()
        self.addCleanup(isolated.stop)
        self.result = {"account_id": "account-1", "status": "no_updates_needed",
                       "fields_updated": [], "skipped_reason": "No credit-worthy automatic enrichment fields are missing."}
        self.enrich = AsyncMock(return_value=self.result)
        def user_from_token(token):
            if token == "secret-bearer-token":
                return {"role": "user", "modules": ["main"]}
            if token == "wrong-module":
                return {"role": "user", "modules": ["prospecting"]}
            raise HTTPException(status_code=401, detail="Invalid token")
        patches = [patch.dict(os.environ, {"POWER_AUTOMATE_API_KEY": "secret-machine-key"}),
                   patch.object(main, "get_user_from_token", side_effect=user_from_token),
                   patch.object(accounts, "enrich_one_account", self.enrich),
                   patch.object(accounts, "invalidate_account_endpoint_caches")]
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)
        self.client = TestClient(main.app)
        self.addCleanup(self.client.close)

    def rows(self):
        with database.get_database_connection() as connection:
            return connection.execute("SELECT * FROM account_enrichment_history ORDER BY received_at").fetchall()

    def test_rejected_requests_never_create_receipts(self):
        for headers, status in [({}, 401), ({"x-api-key": "incorrect-key"}, 401),
                                ({"Authorization": "Bearer wrong-module"}, 403)]:
            with self.subTest(status=status, header_names=list(headers)):
                response = self.client.post("/accounts/enrich-one/account-1", headers=headers)
                self.assertEqual(response.status_code, status)
                self.assertEqual(self.rows(), [])
                self.enrich.assert_not_awaited()

    def test_machine_and_user_requests_keep_contract_and_do_not_persist_credentials(self):
        for headers in [{"x-api-key": "secret-machine-key"}, {"Authorization": "Bearer secret-bearer-token"}]:
            response = self.client.post("/accounts/enrich-one/account-1", headers=headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), self.result)
        rows = self.rows()
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row["status"] == "no_updates_needed" for row in rows))
        serialized = json.dumps(rows, default=str)
        for secret in ("secret-machine-key", "secret-bearer-token", "Authorization", "x-api-key"):
            self.assertNotIn(secret, serialized)


if __name__ == "__main__":
    unittest.main()
