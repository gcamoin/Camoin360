"""PostgreSQL-only Home read model. No refreshes or enrichment side effects."""
import base64
import json
import hashlib
import os
from datetime import timedelta

from .maintenance_observations import (
    MaintenanceConfig, REPORTING_ZONE, _db, read_count_snapshots, reporting_week_bounds, utc_now,
)

FIELD_LABELS = {
    "websiteurl": "Website", "telephone1": "Phone", "description": "Description",
    "numberofemployees": "Employees", "address1_city": "City",
    "address1_stateorprovince": "State", "address1_country": "Country",
    "address1_postalcode": "Postal Code", "cr73c_naicscode": "NAICS",
}
STATUS_LABELS = {
    "enriched": "Enriched", "no_paid_enrichment_needed": "No paid enrichment needed",
    "completed_no_fields_added": "Completed — no fields added", "no_usable_match": "No usable match",
    "missing_company_name": "Needs attention — missing company name", "failed": "Failed",
    "update_unconfirmed": "Failed — update unconfirmed", "credit_limit": "Credit limit",
    "processing": "Processing", "processing_delayed": "Processing — delayed",
    "pending": "Pending", "no_sophie_request": "Needs attention — no Sophie request observed",
    "history_unavailable": "History unavailable",
}
ATTENTION = ("no_usable_match", "missing_company_name", "failed", "update_unconfirmed",
             "credit_limit", "processing_delayed", "no_sophie_request")
SUCCESSFUL = ("enriched", "no_paid_enrichment_needed")
TERMINAL = SUCCESSFUL + ("completed_no_fields_added", "no_usable_match", "missing_company_name",
                         "failed", "update_unconfirmed", "credit_limit")

# One mapping is shared by the table, attention filter, and unique-account aggregates.
STATUS_SQL = """CASE
 WHEN h.id IS NOT NULL AND h.completed_at IS NULL THEN
   CASE WHEN h.received_at <= %(processing_before)s THEN 'processing_delayed' ELSE 'processing' END
 WHEN h.status = 'updated' THEN 'enriched'
 WHEN h.status = 'no_updates_needed' THEN
   CASE WHEN h.provider_called THEN 'completed_no_fields_added' ELSE 'no_paid_enrichment_needed' END
 WHEN h.status = 'no_match' THEN CASE
   WHEN h.provider_called THEN 'no_usable_match'
   WHEN h.reason_code = 'missing_company_name' THEN 'missing_company_name'
   ELSE 'history_unavailable' END
 WHEN h.status = 'failed' THEN CASE WHEN h.completion_uncertain THEN 'update_unconfirmed' ELSE 'failed' END
 WHEN h.status = 'skipped_credit_limit' THEN 'credit_limit'
 WHEN receipt.first_receipt_at IS NOT NULL THEN 'history_unavailable'
 WHEN GREATEST(o.dynamics_created_on, o.first_observed_at) > %(pending_before)s THEN 'pending'
 WHEN %(coverage_fresh)s AND o.dynamics_created_on >= %(tracking_started_at)s
      AND o.dynamics_created_on < %(watermark)s THEN 'no_sophie_request'
 ELSE 'history_unavailable' END"""
JOIN_SQL = """FROM maintenance_account_observations o
 LEFT JOIN LATERAL (
   SELECT id, received_at, completed_at, status, reason_code, provider_called,
          provider_request_count, fields_updated, completion_uncertain
   FROM account_enrichment_history
   WHERE dynamics_account_id = o.dynamics_account_id
     AND status IS DISTINCT FROM 'skipped_already_attempted'
   ORDER BY received_at DESC, id DESC LIMIT 1
 ) h ON TRUE
 LEFT JOIN LATERAL (
   SELECT MIN(received_at) AS first_receipt_at FROM account_enrichment_history
   WHERE dynamics_account_id = o.dynamics_account_id
 ) receipt ON TRUE"""


class InvalidHomeCursor(ValueError):
    pass


def read_home_refresh_version():
    """Cheap cross-process cache signal from durable refresh commits; no Dynamics I/O."""
    def read(connection):
        states = connection.execute("""SELECT sync_key, status, coverage_complete, watermark,
            last_started_at, last_finished_at, last_succeeded_at, last_error_at
            FROM maintenance_sync_state ORDER BY sync_key""").fetchall()
        total = connection.execute("SELECT fetched_at FROM maintenance_total_account_snapshot WHERE id = 1").fetchone()
        counts = connection.execute("SELECT MAX(fetched_at) AS fetched_at, COUNT(*) AS days FROM maintenance_account_creation_counts").fetchone()
        return hashlib.sha256(repr(([dict(row) for row in states], dict(total) if total else None, dict(counts))).encode()).hexdigest()
    return _db(read)


def decode_cursor(cursor, *, now, days, view):
    if not cursor:
        return None
    try:
        if len(cursor) > 1024:
            raise ValueError
        raw = base64.b64decode(cursor.encode("ascii"), altchars=b"-_", validate=True)
        data = json.loads(raw)
        if set(data) != {"as_of", "created", "id", "days", "view"} or data["days"] != days or data["view"] != view:
            raise ValueError
        from .maintenance_observations import aware_timestamp
        data["as_of"] = aware_timestamp(data["as_of"])
        data["created"] = aware_timestamp(data["created"])
        if not now - timedelta(hours=24) <= data["as_of"] <= now or not data["created"] <= data["as_of"]:
            raise ValueError
        if not isinstance(data["id"], str) or not 1 <= len(data["id"]) <= 128:
            raise ValueError
        return data
    except Exception:
        raise InvalidHomeCursor("Invalid or expired Home cursor") from None


def encode_cursor(row, as_of, days, view):
    data = {"as_of": as_of.isoformat(), "created": row["dynamics_created_on"].isoformat(),
            "id": row["dynamics_account_id"], "days": days, "view": view}
    return base64.urlsafe_b64encode(json.dumps(data, separators=(",", ":")).encode()).decode()


def _account(row):
    status = row["display_status"]
    fields = [field for field in dict.fromkeys(row["fields_updated"] or []) if field in FIELD_LABELS] if status == "enriched" else []
    labels = [FIELD_LABELS[field] for field in fields]
    return {
        "account_id": row["dynamics_account_id"], "account_name": row["account_name"],
        "created_at": row["dynamics_created_on"], "display_status": status,
        "display_status_label": STATUS_LABELS[status], "backend_status": row["status"],
        "provider_called": row["provider_called"], "provider_request_count": row["provider_request_count"],
        "fields_updated": fields, "field_labels": labels,
        "result_summary": ", ".join(labels) + " added" if labels else STATUS_LABELS[status],
        "needs_attention": status in ATTENTION,
    }


def read_home(*, days=14, view="recent", limit=25, cursor=None, now=None):
    now = now or utc_now()
    config = MaintenanceConfig.from_env()
    processing_seconds = int(os.getenv("MAINTENANCE_PROCESSING_GRACE_SECONDS", "900"))
    if not 60 <= processing_seconds <= 86400:
        raise ValueError("Invalid processing grace configuration")
    page = decode_cursor(cursor, now=now, days=days, view=view)
    as_of = page["as_of"] if page else now
    today = now.astimezone(REPORTING_ZONE).date()
    snapshots = read_count_snapshots(now=now, days=days, config=config)
    discovery = snapshots["sync"].get("discovery", {})
    watermark = discovery.get("watermark")
    lag = max(0, (now - watermark).total_seconds()) if watermark else None
    fresh = bool(discovery.get("coverage_complete") and watermark and lag < config.discovery_seconds)
    tracking = discovery.get("tracking_started_at")
    week_start = reporting_week_bounds(now)[0]
    coverage_start = discovery.get("coverage_started_at")
    week_covered = bool(fresh and tracking and coverage_start and
                        tracking <= week_start and coverage_start <= week_start and
                        now - timedelta(days=config.retention_days) <= week_start)
    params = {
        "pending_before": now - timedelta(seconds=config.pending_grace_seconds),
        "processing_before": now - timedelta(seconds=processing_seconds),
        "coverage_fresh": fresh, "tracking_started_at": tracking, "watermark": watermark,
        "cutoff": as_of - timedelta(days=config.retention_days), "as_of": as_of,
        "week_start": week_start, "now": now,
        "attention": list(ATTENTION), "successful": list(SUCCESSFUL), "terminal": list(TERMINAL),
        "limit": limit + 1,
    }
    predicate = "o.dynamics_created_on >= %(cutoff)s AND o.dynamics_created_on <= %(as_of)s AND o.first_observed_at <= %(as_of)s"
    if page:
        params.update(last_created=page["created"], last_id=page["id"])
        predicate += " AND (o.dynamics_created_on, o.dynamics_account_id) < (%(last_created)s, %(last_id)s)"
    def read(connection):
        connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        rows = connection.execute(f"""WITH accounts AS (
            SELECT o.*, h.status, h.provider_called, h.provider_request_count, h.fields_updated,
                   {STATUS_SQL} AS display_status {JOIN_SQL} WHERE {predicate}
        ) SELECT * FROM accounts
          WHERE {'display_status = ANY(%(attention)s)' if view == 'attention' else 'TRUE'}
          ORDER BY dynamics_created_on DESC, dynamics_account_id DESC LIMIT %(limit)s""", params).fetchall()
        counts = connection.execute(f"""WITH accounts AS (
            SELECT {STATUS_SQL} AS display_status {JOIN_SQL}
            WHERE o.dynamics_created_on >= %(week_start)s AND o.dynamics_created_on < %(now)s
        ) SELECT COUNT(*) FILTER (WHERE display_status = ANY(%(successful)s)) AS successful,
                 COUNT(*) FILTER (WHERE display_status = ANY(%(terminal)s)) AS terminal,
                 COUNT(*) AS observed FROM accounts""", params).fetchone()
        return [dict(row) for row in rows], dict(counts)
    rows, counts = _db(read)
    known = counts["terminal"]
    warnings = []
    if not snapshots["total"]:
        warnings.append("Total Account snapshot is unavailable.")
    elif snapshots["total"]["is_stale"]:
        warnings.append("Total Account snapshot is stale; showing the last valid value.")
    if snapshots["this_week"]["is_stale"]:
        warnings.append("Creation counts are missing, incomplete, or stale.")
    if any(day["value"] is None or day["is_stale"] for day in snapshots["daily"]):
        warnings.append("Some daily creation counts are unknown, incomplete, or stale.")
    if not fresh:
        warnings.append("Account discovery coverage is incomplete or stale; missing-request conclusions are limited.")
    if not tracking or tracking > params["week_start"]:
        warnings.append("Tracking began after the reporting week started; enrichment results cover observed Accounts only.")
    if not coverage_start or coverage_start > week_start or now - timedelta(days=config.retention_days) > week_start:
        warnings.append("The observed Account window does not cover the entire reporting week.")
    warnings.append("Snapshot freshness depends on the separately deployed maintenance refresh worker.")
    warnings.append("Enrichment history is best-effort; unrecorded requests or completions cannot be ruled out.")
    def refresh_info(key):
        state = snapshots["sync"].get(key, {})
        return {"last_successful_refresh_at": state.get("last_succeeded_at"),
                "last_attempted_refresh_at": state.get("last_started_at"),
                "refresh_incomplete": state.get("status") != "idle"}
    return {
        "reporting": {"timezone": "America/New_York", "week_starts_on": "monday",
                      "tracking_started_at": tracking, "coverage_started_at": discovery.get("coverage_started_at"),
                      "coverage_complete": fresh},
        "metrics": {
            "total_dynamics_accounts": snapshots["total"] or {"value": None, "source": None, "fetched_at": None, "maximum_source_age_hours": 24, "is_stale": True},
            "new_accounts_today": snapshots["today"]["value"] if snapshots["today"] else None,
            "new_accounts_this_week": snapshots["this_week"]["value"],
            "enrichment_success_rate": {"value": round(counts["successful"] * 100 / known, 1) if known else None,
                "successful_accounts": counts["successful"], "known_terminal_accounts": known,
                "observed_accounts": counts["observed"], "period": "this_week",
                "coverage_complete": week_covered,
                "scope": "observed_new_accounts", "paid_no_fields_added_is_success": False},
        },
        "account_creation_by_day": [{"date": day["date"], "count": day["value"] if day["is_complete"] or day["date"] == today else None,
            "complete": day["is_complete"], "stale": day["is_stale"], "fetched_at": day["fetched_at"]} for day in snapshots["daily"]],
        "recent_accounts": [_account(row) for row in rows[:limit]],
        "next_cursor": encode_cursor(rows[limit - 1], as_of, days, view) if len(rows) > limit else None,
        "freshness": {"generated_at": now, "cache_ttl_seconds": 45,
            "total_snapshot_age_seconds": max(0, (now - snapshots["total"]["fetched_at"]).total_seconds()) if snapshots["total"] else None,
            "discovery": {**refresh_info("discovery"), "observed_through": watermark, "lag_seconds": lag, "coverage_complete": fresh},
            "creation_counts": {**refresh_info("counts"), "today_stale": snapshots["today"]["is_stale"] if snapshots["today"] else True,
                                "week_stale": snapshots["this_week"]["is_stale"]},
            "history": {"persistence": "best_effort", "tracking_gaps_known": None},
        },
        "warnings": warnings,
    }
