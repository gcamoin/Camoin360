import base64
import json
import os
import unittest
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app import main, database
from backend.app.routes import maintenance, auth
from backend.app.services import maintenance_home as home
from backend.app.services import maintenance_observations as observations
from backend.app.services.test_maintenance_observations import NOW
from backend.app.testing_support import temporary_database


class HomeApiTest(unittest.TestCase):
    def setUp(self):
        isolated = temporary_database()
        isolated.start()
        self.addCleanup(isolated.stop)
        self.client = TestClient(main.app)
        self.addCleanup(self.client.close)
        maintenance.home_cache.invalidate()
        self.addCleanup(maintenance.home_cache.invalidate)
        for module in (main, auth):
            patcher = patch.object(module, "get_user_from_token", side_effect=self.user)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.object(home, "utc_now", return_value=NOW)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.forbidden = []
        for target in ("backend.app.services.maintenance_dynamics.MaintenanceDynamicsClient",
                       "backend.app.services.seamless.enrich_with_seamless",
                       "backend.app.services.dynamics._fetch_accounts_data_quality_from_dynamics",
                       "backend.app.services.dynamics.update_account",
                       "httpx.AsyncClient.get", "httpx.AsyncClient.post", "httpx.AsyncClient.patch"):
            patcher = patch(target, side_effect=AssertionError("Network call forbidden"))
            self.forbidden.append(patcher.start())
            self.addCleanup(patcher.stop)
        self.seed_snapshots()

    def tearDown(self):
        for mocked in self.forbidden:
            mocked.assert_not_called()

    @staticmethod
    def user(token):
        if token == "allowed":
            return {"role": "user", "modules": ["main"]}
        if token == "denied":
            return {"role": "user", "modules": ["management"]}
        raise HTTPException(401, "Invalid token")

    def get(self, path="/maintenance/home", token="allowed"):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return self.client.get(path, headers=headers)

    def seed_snapshots(self):
        with database.get_database_connection() as connection:
            observations._ensure_state(connection, "discovery", NOW - timedelta(days=14))
            connection.execute("""UPDATE maintenance_sync_state SET watermark = ?, coverage_started_at = ?,
                status = 'idle', coverage_complete = TRUE, last_succeeded_at = ? WHERE sync_key = 'discovery'""",
                (NOW, NOW - timedelta(days=14), NOW))
            observations._ensure_state(connection, "total", NOW)
            observations._finish(connection, "total", NOW, "idle", 1)
            observations._save_total(connection, 3124821, NOW)
            observations._ensure_state(connection, "counts", NOW)
            observations._finish(connection, "counts", NOW, "idle", 14)
            today = NOW.astimezone(observations.REPORTING_ZONE).date()
            for offset in range(14):
                day = today - timedelta(days=offset)
                start, end = observations.reporting_day_bounds(day)
                observations._save_day(connection, day, start, min(end, NOW), 0 if offset == 2 else 10, NOW, offset > 0)

    def account(self, account_id, status=None, *, called=False, fields=None, uncertain=False,
                reason=None, age=10, received_age=9, history=True, created=None):
        created = created or NOW - timedelta(minutes=age)
        with database.get_database_connection() as connection:
            connection.execute("""INSERT INTO maintenance_account_observations
                (dynamics_account_id, account_name, dynamics_created_on, enrichment_attempted, first_observed_at, last_observed_at)
                VALUES (?, ?, ?, TRUE, ?, ?) ON CONFLICT (dynamics_account_id) DO NOTHING""",
                (account_id, "Company " + account_id, created, created, NOW))
            if history:
                connection.execute("""INSERT INTO account_enrichment_history
                    (id, dynamics_account_id, received_at, completed_at, status, reason_code,
                     provider_called, provider_request_count, fields_updated, completion_uncertain, error_message)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (uuid4(), account_id, NOW - timedelta(minutes=received_age), NOW if status else None,
                     status, reason, called, 2 if called else 0, fields or [], uncertain, "secret raw payload must never be exposed"))

    def test_authorization_and_machine_key_rejection(self):
        for token, code in ((None, 401), ("denied", 403), ("bad", 401), ("allowed", 200)):
            with self.subTest(token=token):
                self.assertEqual(self.get(token=token).status_code, code)
        self.assertEqual(self.client.get("/maintenance/home", headers={"x-api-key": "secret"}).status_code, 401)

    def test_authorization_precedes_cache(self):
        self.assertEqual(self.get().status_code, 200)
        self.assertEqual(self.get(token="denied").status_code, 403)
        self.assertEqual(self.get(token=None).status_code, 401)

    def test_all_statuses_and_fields(self):
        cases = [
            ("updated", "updated", "enriched", {"called": True, "fields": list(home.FIELD_LABELS)}),
            ("unpaid", "no_updates_needed", "no_paid_enrichment_needed", {}),
            ("paid", "no_updates_needed", "completed_no_fields_added", {"called": True}),
            ("no_match", "no_match", "no_usable_match", {"called": True}),
            ("missing_name", "no_match", "missing_company_name", {"reason": "missing_company_name"}),
            ("failed", "failed", "failed", {}),
            ("uncertain", "failed", "update_unconfirmed", {"uncertain": True, "fields": ["websiteurl"]}),
            ("credit", "skipped_credit_limit", "credit_limit", {}),
            ("processing", None, "processing", {"received_age": 1}),
            ("delayed", None, "processing_delayed", {"received_age": 30}),
            ("pending", None, "pending", {"history": False, "age": 2}),
            ("missing_request", None, "no_sophie_request", {"history": False}),
            ("duplicate", "skipped_already_attempted", "history_unavailable", {}),
        ]
        for account_id, status, expected, options in cases:
            self.account(account_id, status, **options)
        response = self.get()
        self.assertEqual(response.status_code, 200, response.text)
        result = {row["account_id"]: row for row in response.json()["recent_accounts"]}
        for account_id, _, expected, _ in cases:
            self.assertEqual(result[account_id]["display_status"], expected)
        self.assertEqual(result["updated"]["field_labels"], list(home.FIELD_LABELS.values()))
        self.assertEqual(result["uncertain"]["fields_updated"], [])
        self.assertNotIn("secret raw payload", response.text)
        self.assertNotIn("reason_code", response.text)

    def test_duplicate_does_not_replace_meaningful_outcome(self):
        self.account("a", "updated", called=True, fields=["websiteurl"], received_age=10)
        self.account("a", "skipped_already_attempted", received_age=1)
        row = self.get().json()["recent_accounts"][0]
        self.assertEqual(row["backend_status"], "updated")
        self.assertEqual(row["display_status"], "enriched")
        self.assertEqual(row["fields_updated"], ["websiteurl"])

    def test_latest_meaningful_open_attempt_supersedes_old_success(self):
        self.account("a", "updated", received_age=20)
        self.account("a", None, received_age=1)
        result = self.get().json()
        self.assertEqual(result["recent_accounts"][0]["display_status"], "processing")
        self.assertIsNone(result["metrics"]["enrichment_success_rate"]["value"])

    def test_success_rate_unique_accounts_and_paid_no_fields_decision(self):
        self.account("a", "updated", called=True)
        self.account("a", "skipped_already_attempted", received_age=1)
        self.account("b", "no_updates_needed")
        self.account("c", "no_updates_needed", called=True)
        self.account("d", "no_match", called=True)
        self.account("e", "failed")
        self.account("f", "skipped_credit_limit")
        self.account("g", None, history=False, age=1)
        self.account("h", None, received_age=1)
        self.account("i", "skipped_already_attempted")
        self.account("j", None, history=False)
        self.account("old", "updated", created=NOW - timedelta(days=10))
        rate = self.get().json()["metrics"]["enrichment_success_rate"]
        self.assertEqual(rate["successful_accounts"], 2)
        self.assertEqual(rate["known_terminal_accounts"], 6)
        self.assertEqual(rate["value"], 33.3)
        self.assertFalse(rate["paid_no_fields_added_is_success"])
        self.assertTrue(rate["coverage_complete"])

    def test_zero_denominator_unknown(self):
        self.account("a", "skipped_already_attempted")
        self.assertIsNone(self.get().json()["metrics"]["enrichment_success_rate"]["value"])

    def test_incomplete_coverage_prevents_missing_request_conclusion(self):
        self.account("a", None, history=False)
        with database.get_database_connection() as connection:
            connection.execute("UPDATE maintenance_sync_state SET coverage_complete = FALSE WHERE sync_key = 'discovery'")
        result = self.get().json()
        self.assertEqual(result["recent_accounts"][0]["display_status"], "history_unavailable")
        self.assertFalse(result["metrics"]["enrichment_success_rate"]["coverage_complete"])
        self.assertFalse(result["reporting"]["coverage_complete"])

    def test_pretracking_account_not_declared_missing_request(self):
        self.account("a", None, history=False, created=NOW - timedelta(days=10))
        with database.get_database_connection() as connection:
            connection.execute("UPDATE maintenance_sync_state SET tracking_started_at = ? WHERE sync_key = 'discovery'", (NOW - timedelta(days=1),))
        result = self.get().json()
        self.assertEqual(result["recent_accounts"][0]["display_status"], "history_unavailable")
        self.assertFalse(result["metrics"]["enrichment_success_rate"]["coverage_complete"])

    def test_counts_chart_known_zero_unknown_and_ranges(self):
        result = self.get().json()
        self.assertEqual(result["metrics"]["total_dynamics_accounts"]["value"], 3124821)
        self.assertEqual(result["metrics"]["new_accounts_today"], 10)
        self.assertEqual(result["metrics"]["new_accounts_this_week"], 20)
        self.assertEqual(len(result["account_creation_by_day"]), 14)
        self.assertEqual(result["account_creation_by_day"][-3]["count"], 0)
        result = self.get("/maintenance/home?days=30").json()
        self.assertEqual(len(result["account_creation_by_day"]), 30)
        self.assertIsNone(result["account_creation_by_day"][0]["count"])
        self.assertTrue(result["warnings"])

    def test_missing_snapshots_never_zero(self):
        with database.get_database_connection() as connection:
            connection.execute("DELETE FROM maintenance_total_account_snapshot")
            connection.execute("DELETE FROM maintenance_account_creation_counts")
        result = self.get().json()
        self.assertIsNone(result["metrics"]["total_dynamics_accounts"]["value"])
        self.assertIsNone(result["metrics"]["new_accounts_today"])
        self.assertIsNone(result["metrics"]["new_accounts_this_week"])
        self.assertTrue(all(day["count"] is None for day in result["account_creation_by_day"]))

    def test_stale_snapshots_preserve_values(self):
        with database.get_database_connection() as connection:
            connection.execute("UPDATE maintenance_total_account_snapshot SET fetched_at = ?", (NOW - timedelta(hours=2),))
            connection.execute("UPDATE maintenance_sync_state SET status = 'error', last_error = 'SECRET' WHERE sync_key IN ('discovery', 'counts')")
        result = self.get().json()
        self.assertEqual(result["metrics"]["total_dynamics_accounts"]["value"], 3124821)
        self.assertTrue(result["metrics"]["total_dynamics_accounts"]["is_stale"])
        self.assertTrue(result["freshness"]["creation_counts"]["today_stale"])
        self.assertNotIn("SECRET", json.dumps(result))

    def test_attention_filter_excludes_ordinary_pending_and_completed(self):
        for account_id, status, options in (
            ("a", "updated", {}), ("b", "no_updates_needed", {}),
            ("c", "no_updates_needed", {"called": True}), ("d", None, {"history": False, "age": 1}),
            ("e", "failed", {}), ("f", "no_match", {"called": True}),
            ("g", None, {"received_age": 30}), ("h", None, {"history": False})):
            self.account(account_id, status, **options)
        result = self.get("/maintenance/home?view=attention").json()
        self.assertEqual({row["account_id"] for row in result["recent_accounts"]}, {"e", "f", "g", "h"})
        self.assertTrue(all(row["needs_attention"] for row in result["recent_accounts"]))

    def test_stable_pagination_ties_and_new_accounts(self):
        for account_id in ("a", "b", "c", "d", "e"):
            self.account(account_id, "updated")
        first = self.get("/maintenance/home?limit=2").json()
        self.assertEqual([row["account_id"] for row in first["recent_accounts"]], ["e", "d"])
        self.account("new", "updated", created=NOW + timedelta(seconds=1))
        second = self.get("/maintenance/home?limit=2&cursor=" + first["next_cursor"]).json()
        self.assertEqual([row["account_id"] for row in second["recent_accounts"]], ["c", "b"])
        third = self.get("/maintenance/home?limit=2&cursor=" + second["next_cursor"]).json()
        self.assertEqual([row["account_id"] for row in third["recent_accounts"]], ["a"])
        self.assertIsNone(third["next_cursor"])

    def test_attention_cursor(self):
        for account_id in ("a", "b", "c"):
            self.account(account_id, "failed")
        first = self.get("/maintenance/home?view=attention&limit=1").json()
        second = self.get("/maintenance/home?view=attention&limit=1&cursor=" + first["next_cursor"]).json()
        self.assertEqual(second["recent_accounts"][0]["account_id"], "b")
        self.assertEqual(self.get("/maintenance/home?cursor=" + first["next_cursor"]).status_code, 400)

    def test_cursor_validation_and_query_bounds(self):
        for query in ("days=6", "days=31", "limit=0", "limit=101", "view=alerts"):
            self.assertEqual(self.get("/maintenance/home?" + query).status_code, 422)
        for cursor in ("invalid", base64.urlsafe_b64encode(b'{"secret":"bad"}').decode()):
            self.assertEqual(self.get("/maintenance/home?cursor=" + cursor).status_code, 400)

    def test_database_failure_sanitized(self):
        with patch.object(home, "read_count_snapshots", side_effect=RuntimeError("Bearer SECRET raw response")), self.assertLogs(maintenance.logger, level="WARNING") as logs:
            result = self.get()
        self.assertEqual(result.status_code, 503)
        self.assertNotIn("SECRET", result.text + str(logs.output))
        self.assertEqual(result.json()["detail"], "Maintenance Home data is temporarily unavailable")

    def test_cache_and_expiry_after_enrichment_completion(self):
        self.account("a", None, received_age=1)
        with patch.object(maintenance, "read_home", wraps=home.read_home) as loader:
            first = self.get().json()
            self.account("a", "updated", received_age=0)
            second = self.get().json()
            self.assertEqual(first, second)
            self.assertEqual(loader.call_count, 1)
            for entry in maintenance.home_cache._entries.values():
                entry["fresh_until"] = 0
                entry["stale_until"] = 0
            third = self.get().json()
            self.assertEqual(loader.call_count, 2)
            self.assertEqual(third["recent_accounts"][0]["display_status"], "enriched")
        self.assertEqual(self.get().headers["cache-control"], "private, no-store")

    def test_only_confirmed_allowlisted_fields_are_displayed(self):
        self.account("a", "updated", called=True, fields=["websiteurl", "websiteurl", "raw_provider_response", "token"])
        result = self.get().json()["recent_accounts"][0]
        self.assertEqual(result["fields_updated"], ["websiteurl"])
        self.assertEqual(result["result_summary"], "Website added")

    def test_incomplete_historical_day_is_unknown_in_chart(self):
        yesterday = NOW.astimezone(observations.REPORTING_ZONE).date() - timedelta(days=1)
        with database.get_database_connection() as connection:
            connection.execute("UPDATE maintenance_account_creation_counts SET value = 4, is_complete = FALSE WHERE reporting_date = ?", (yesterday,))
        result = self.get().json()
        self.assertIsNone(result["account_creation_by_day"][-2]["count"])
        self.assertTrue(result["account_creation_by_day"][-2]["stale"])
        self.assertIsNone(result["metrics"]["new_accounts_this_week"])

    def test_missing_name_is_terminal_not_successful(self):
        self.account("a", "no_match", reason="missing_company_name")
        rate = self.get().json()["metrics"]["enrichment_success_rate"]
        self.assertEqual(rate["known_terminal_accounts"], 1)
        self.assertEqual(rate["successful_accounts"], 0)
        self.assertEqual(rate["value"], 0)

    def test_pending_grace_uses_later_observation_and_config(self):
        self.account("a", None, history=False)
        with database.get_database_connection() as connection:
            connection.execute("UPDATE maintenance_account_observations SET first_observed_at = ?", (NOW - timedelta(minutes=1),))
        self.assertEqual(self.get().json()["recent_accounts"][0]["display_status"], "pending")
        maintenance.home_cache.invalidate()
        with database.get_database_connection() as connection:
            connection.execute("UPDATE maintenance_account_observations SET first_observed_at = dynamics_created_on")
        with patch.dict(os.environ, {"MAINTENANCE_PENDING_GRACE_SECONDS": "900"}):
            self.assertEqual(self.get().json()["recent_accounts"][0]["display_status"], "pending")

    def test_processing_delay_configurable(self):
        self.account("a", None, received_age=20)
        with patch.dict(os.environ, {"MAINTENANCE_PROCESSING_GRACE_SECONDS": "1800"}):
            result = self.get().json()["recent_accounts"][0]
        self.assertEqual(result["display_status"], "processing")
        self.assertFalse(result["needs_attention"])

    def test_stale_discovery_does_not_conclude_missing_delivery(self):
        self.account("a", None, history=False)
        with database.get_database_connection() as connection:
            connection.execute("UPDATE maintenance_sync_state SET watermark = ? WHERE sync_key = 'discovery'", (NOW - timedelta(minutes=10),))
        result = self.get().json()
        self.assertEqual(result["recent_accounts"][0]["display_status"], "history_unavailable")
        self.assertEqual(result["freshness"]["discovery"]["lag_seconds"], 600)

    def test_expired_cursor_and_late_observation(self):
        for account_id in ("a", "b", "c"):
            self.account(account_id, "updated")
        first = self.get("/maintenance/home?limit=1").json()
        self.account("bb", "updated")
        with database.get_database_connection() as connection:
            connection.execute("UPDATE maintenance_account_observations SET first_observed_at = ? WHERE dynamics_account_id = 'bb'", (NOW + timedelta(seconds=1),))
        second = self.get("/maintenance/home?limit=1&cursor=" + first["next_cursor"]).json()
        self.assertEqual(second["recent_accounts"][0]["account_id"], "b")
        with patch.object(home, "utc_now", return_value=NOW + timedelta(days=2)):
            self.assertEqual(self.get("/maintenance/home?limit=1&cursor=" + first["next_cursor"]).status_code, 400)

    def test_join_database_failure_sanitized(self):
        with patch.object(home, "_db", side_effect=RuntimeError("SECRET database credentials")):
            response = self.get()
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("SECRET", response.text)

    def test_short_retention_does_not_claim_complete_week_coverage(self):
        self.account("a", "updated")
        with patch.dict(os.environ, {"MAINTENANCE_BOOTSTRAP_DAYS": "1", "MAINTENANCE_RETENTION_DAYS": "1"}):
            result = self.get().json()
        self.assertTrue(result["reporting"]["coverage_complete"])
        self.assertFalse(result["metrics"]["enrichment_success_rate"]["coverage_complete"])
        self.assertIn("The observed Account window does not cover the entire reporting week.", result["warnings"])

    def test_committed_worker_refresh_invalidates_cached_home_across_processes(self):
        with patch.object(maintenance, "read_home", wraps=home.read_home) as loader:
            self.assertEqual(self.get().json()["metrics"]["total_dynamics_accounts"]["value"], 3124821)
            # Represents a separate worker's durable commit; no local cache call.
            with database.get_database_connection() as connection:
                observations._save_total(connection, 3124822, NOW + timedelta(seconds=1))
                observations._finish(connection, "total", NOW + timedelta(seconds=1), "idle", 1)
            self.assertEqual(self.get().json()["metrics"]["total_dynamics_accounts"]["value"], 3124822)
            self.assertEqual(loader.call_count, 2)
            self.get()
            self.assertEqual(loader.call_count, 2)

    def test_refresh_version_read_failure_does_not_serve_healthy_cached_response(self):
        self.assertEqual(self.get().status_code, 200)
        with patch.object(maintenance, "read_home_refresh_version", side_effect=RuntimeError("SECRET")):
            response = self.get()
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("SECRET", response.text)

    def test_new_observation_refresh_invalidates_cached_table(self):
        self.assertEqual(self.get().json()["recent_accounts"], [])
        self.account("new", "updated")
        with database.get_database_connection() as connection:
            observations._finish(connection, "discovery", NOW + timedelta(seconds=1), "idle", 1, 1)
        self.assertEqual(self.get().json()["recent_accounts"][0]["account_id"], "new")
