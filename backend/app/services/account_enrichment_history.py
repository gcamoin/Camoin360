"""Best-effort, request-scoped telemetry for automatic enrichment only.

Only selected metadata is persisted; no raw payloads, exception strings, or credentials.
A missing/unfinished row is a tracking gap, never evidence of success.
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import UUID, uuid4

from ..database import get_database_connection

logger = logging.getLogger(__name__)
_active_attempt = ContextVar("automatic_enrichment_history", default=None)

STATUSES = frozenset({
    "updated", "no_match", "no_updates_needed", "skipped_already_attempted",
    "skipped_credit_limit", "failed",
})
FIELD_NAMES = frozenset({
    "websiteurl", "telephone1", "description", "numberofemployees",
    "address1_city", "address1_stateorprovince", "address1_country",
    "address1_postalcode", "cr73c_naicscode",
})
FAILURES = {
    "dynamics_read": ("dynamics_read_failed", "Unable to read the Dynamics Account."),
    "dynamics_write": ("dynamics_write_failed", "Dynamics did not confirm the Account update."),
    "configuration": ("provider_not_configured", "Seamless enrichment is not configured."),
    "credit_check": ("credit_check_failed", "Unable to check the Seamless credit budget."),
    "provider": ("provider_request_failed", "The Seamless search failed."),
    "internal": ("internal_failure", "Automatic enrichment did not complete successfully."),
}


def utc_now():
    return datetime.now(timezone.utc)


def _created_on(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        # Do not silently assign a timezone to an ambiguous timestamp.
        return parsed.astimezone(timezone.utc) if parsed.tzinfo is not None else None
    except (TypeError, ValueError, OverflowError):
        return None


@dataclass
class AutomaticAttempt:
    dynamics_account_id: str
    id: UUID = field(default_factory=uuid4)
    received_at: datetime = field(default_factory=utc_now)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    account_name: str | None = None
    account_created_on: datetime | None = None
    status: str | None = None
    reason_code: str | None = None
    error_category: str | None = None
    error_message: str | None = None
    provider_request_count: int = 0
    fields_updated: list[str] = field(default_factory=list)
    completion_uncertain: bool = False
    phase: str = "dynamics_read"

    def finish(self, result):
        status = result.get("status")
        if status not in STATUSES:
            # This must not invent an outcome from an unrecognized response.
            raise ValueError("Unrecognized automatic enrichment status")
        self.status = status
        self.completed_at = utc_now()
        if status == "failed":
            self.fields_updated = []
            self.error_category = self.phase if self.phase in FAILURES else "internal"
            self.reason_code, self.error_message = FAILURES[self.error_category]
            if self.completion_uncertain:
                self.reason_code = "dynamics_write_unconfirmed"
        else:
            # Keep only fields both confirmed by PATCH and returned by the service.
            returned_fields = result.get("fields_updated") or []
            self.fields_updated = [name for name in self.fields_updated if name in returned_fields] if status == "updated" else []
            self.reason_code = {
                "updated": "fields_updated",
                "skipped_already_attempted": "duplicate_delivery",
                "skipped_credit_limit": "credit_limit",
                "no_updates_needed": "provider_no_fields_added" if self.provider_request_count else "no_credit_worthy_fields_missing",
                "no_match": "provider_no_usable_match" if self.provider_request_count else "missing_company_name",
            }[status]
            self.error_category = {
                "skipped_credit_limit": "credit_limit",
                "no_match": "validation" if not self.provider_request_count else None,
            }.get(status)

    def _write(self):
        # Bound connection, statement, and lock waits without blocking the event loop.
        with get_database_connection(connect_timeout=2) as connection:
            connection.execute("SET LOCAL statement_timeout = '2000ms'")
            connection.execute("SET LOCAL lock_timeout = '1000ms'")
            connection.execute(
                """INSERT INTO account_enrichment_history (
                    id, dynamics_account_id, account_name, account_created_on,
                    received_at, started_at, completed_at, status, reason_code,
                    error_category, error_message, provider_called, provider_request_count,
                    fields_updated, completion_uncertain
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (id) DO UPDATE SET
                    account_name = EXCLUDED.account_name,
                    account_created_on = EXCLUDED.account_created_on,
                    started_at = EXCLUDED.started_at,
                    completed_at = EXCLUDED.completed_at,
                    status = EXCLUDED.status,
                    reason_code = EXCLUDED.reason_code,
                    error_category = EXCLUDED.error_category,
                    error_message = EXCLUDED.error_message,
                    provider_called = EXCLUDED.provider_called,
                    provider_request_count = EXCLUDED.provider_request_count,
                    fields_updated = EXCLUDED.fields_updated,
                    completion_uncertain = EXCLUDED.completion_uncertain
                """,
                (self.id, self.dynamics_account_id, self.account_name, self.account_created_on,
                 self.received_at, self.started_at, self.completed_at, self.status, self.reason_code,
                 self.error_category, self.error_message, self.provider_request_count > 0,
                 self.provider_request_count, self.fields_updated, self.completion_uncertain),
            )

    async def persist(self, operation):
        try:
            await asyncio.to_thread(self._write)
        except Exception:
            # Neither exception text nor a traceback is safe for history-write failures.
            logger.warning("Automatic enrichment history persistence failed during %s; tracking gap possible", operation)


@asynccontextmanager
async def automatic_enrichment_request(account_id):
    attempt = AutomaticAttempt(dynamics_account_id=account_id)
    token = _active_attempt.set(attempt)
    try:
        await attempt.persist("receipt")
        attempt.started_at = utc_now()
        await attempt.persist("start")
        try:
            yield attempt
        except asyncio.CancelledError:
            # Preserve an open attempt and observed counters; do not invent a terminal result.
            await asyncio.shield(attempt.persist("interruption"))
            raise
        except Exception:
            attempt.finish({"status": "failed", "fields_updated": []})
            await attempt.persist("completion")
            raise
        else:
            await attempt.persist("completion")
    finally:
        _active_attempt.reset(token)


def note_account(account):
    attempt = _active_attempt.get()
    if attempt is not None:
        name = account.get("name")
        attempt.account_name = name if isinstance(name, str) else None
        attempt.account_created_on = _created_on(account.get("createdon"))


def note_phase(phase):
    attempt = _active_attempt.get()
    if attempt is not None:
        attempt.phase = phase


def note_provider_request():
    """Called immediately before each HTTP search dispatch, including fallback."""
    attempt = _active_attempt.get()
    if attempt is not None:
        attempt.provider_request_count += 1


async def persist_provider_activity():
    """Checkpoint observed HTTP attempts even if the subsequent PATCH never finishes."""
    attempt = _active_attempt.get()
    if attempt is not None:
        await attempt.persist("provider activity")


def note_confirmed_fields(updates):
    attempt = _active_attempt.get()
    if attempt is not None:
        attempt.fields_updated = [name for name in updates if name in FIELD_NAMES]


def note_uncertain_write():
    attempt = _active_attempt.get()
    if attempt is not None:
        attempt.completion_uncertain = True
