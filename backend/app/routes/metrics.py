from datetime import datetime

from fastapi import APIRouter, Depends

from .auth import require_user
from ..services.dynamics import get_accounts_data_quality
from ..services.metrics import load_metrics
from ..services.usage import load_usage, WEEKLY_LIMIT

router = APIRouter()

OUTCOME_STATUSES = [
    "Updated",
    "No Match Found",
    "Skipped",
    "Failed",
    "Pending",
]

FIELD_IMPACT_CATEGORIES = [
    "Website",
    "Phone",
    "Employee Count",
    "Description",
    "State",
    "Country",
    "Location",
    "Other Fields",
]

FIELD_CATEGORY_BY_KEY = {
    "websiteurl": "Website",
    "website": "Website",
    "telephone1": "Phone",
    "phone": "Phone",
    "numberofemployees": "Employee Count",
    "new_employees": "Employee Count",
    "employees": "Employee Count",
    "description": "Description",
    "address1_stateorprovince": "State",
    "state": "State",
    "address1_country": "Country",
    "country": "Country",
    "address1_city": "Location",
    "city": "Location",
    "address1_line1": "Location",
    "address1_postalcode": "Location",
}

PIPELINE_CATEGORIES = [
    "Ready for Enrichment",
    "Already Enriched",
    "Missing Company Name",
    "Missing Website",
    "Missing Location",
    "Requires Manual Review",
]


def is_missing(value):
    return value is None or str(value).strip() == ""


def normalize_changes(changes):
    if isinstance(changes, dict):
        return [
            {
                "field": field,
                "old": None,
                "new": value,
            }
            for field, value in changes.items()
        ]

    if isinstance(changes, list):
        return [
            change
            for change in changes
            if isinstance(change, dict)
        ]

    return []


def build_recent_activity(updates_log):
    activity = []

    for entry in reversed(updates_log[-10:]):
        changes = normalize_changes(entry.get("changes"))
        fields_updated = [
            change.get("field")
            for change in changes
            if change.get("field")
        ]

        activity.append({
            "account_name": entry.get("account_name") or entry.get("company") or "Unknown Account",
            "result_status": entry.get("result_status") or entry.get("status") or "Updated",
            "fields_updated": fields_updated,
            "credits_used": entry.get("credits_used", 1 if changes else 0),
            "timestamp": entry.get("timestamp"),
        })

    return activity


def build_outcome_breakdown(recent_activity):
    counts = {status: 0 for status in OUTCOME_STATUSES}

    for activity in recent_activity:
        status = activity.get("result_status") or "Pending"
        if status not in counts:
            status = "Pending"
        counts[status] += 1

    total = sum(counts.values())

    return [
        {
            "result_status": status,
            "count": count,
            "percentage": round((count / total) * 100, 1) if total else 0,
        }
        for status, count in counts.items()
    ]


def build_field_impact(updates_log):
    counts = {category: 0 for category in FIELD_IMPACT_CATEGORIES}

    for entry in updates_log:
        for change in normalize_changes(entry.get("changes")):
            field_key = str(change.get("field") or "").strip().lower()
            category = FIELD_CATEGORY_BY_KEY.get(field_key, "Other Fields")
            counts[category] += 1

    total = sum(counts.values())

    return [
        {
            "field": category,
            "total_updates": count,
            "percentage": round((count / total) * 100, 1) if total else 0,
        }
        for category, count in counts.items()
    ]


def get_pipeline_category(account):
    has_name = not is_missing(account.get("name"))
    has_website = not is_missing(account.get("websiteurl"))
    has_location = all(
        not is_missing(account.get(field))
        for field in ["address1_city", "address1_stateorprovince", "address1_country"]
    )
    has_phone = not is_missing(account.get("telephone1"))
    has_employees = not is_missing(account.get("new_employees"))
    has_description = not is_missing(account.get("description"))

    if not has_name:
        return "Missing Company Name"

    if not has_website:
        return "Missing Website"

    if not has_location:
        return "Missing Location"

    if has_phone and has_employees and has_description:
        return "Already Enriched"

    missing_enrichment_fields = [
        not has_phone,
        not has_employees,
        not has_description,
    ]
    if any(missing_enrichment_fields):
        return "Ready for Enrichment"

    return "Requires Manual Review"


def get_pipeline_record(account):
    missing_fields = []
    field_labels = {
        "name": "Company Name",
        "websiteurl": "Website",
        "address1_city": "City",
        "address1_stateorprovince": "State",
        "address1_country": "Country",
        "telephone1": "Phone",
        "new_employees": "Employee Count",
        "description": "Description",
    }

    for field_key, label in field_labels.items():
        if is_missing(account.get(field_key)):
            missing_fields.append(label)

    return {
        "account_id": account.get("accountid"),
        "account_name": account.get("name") or "Missing",
        "website": account.get("websiteurl"),
        "location": ", ".join(
            str(account.get(field)).strip()
            for field in ["address1_city", "address1_stateorprovince", "address1_country"]
            if not is_missing(account.get(field))
        ) or "Missing",
        "missing_fields": missing_fields,
    }


def build_data_quality_pipeline(accounts):
    grouped_records = {category: [] for category in PIPELINE_CATEGORIES}

    for account in accounts:
        category = get_pipeline_category(account)
        grouped_records[category].append(get_pipeline_record(account))

    total = len(accounts)

    return [
        {
            "category": category,
            "count": len(records),
            "percentage": round((len(records) / total) * 100, 1) if total else 0,
            "records": records[:25],
        }
        for category, records in grouped_records.items()
    ]


def parse_timestamp(value):
    if not value:
        return None

    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def get_day_key(value):
    parsed_timestamp = parse_timestamp(value)
    return parsed_timestamp.date().isoformat() if parsed_timestamp else None


def get_week_key(value):
    parsed_timestamp = parse_timestamp(value)
    if not parsed_timestamp:
        return None

    iso_year, iso_week, _weekday = parsed_timestamp.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def sort_series(series):
    return sorted(series.values(), key=lambda item: item["period"])


def build_trend_tracking(metrics, updates_log):
    processed_by_day = {}
    updated_by_day = {}
    credits_by_day = {}
    credits_by_week = {}

    for entry in metrics.get("processed_log", []):
        day = get_day_key(entry.get("timestamp"))
        if not day:
            continue

        processed_by_day.setdefault(day, {"period": day, "accounts_processed": 0})
        processed_by_day[day]["accounts_processed"] += 1

    for entry in updates_log:
        day = get_day_key(entry.get("timestamp"))
        week = get_week_key(entry.get("timestamp"))
        if not day:
            continue

        changes = normalize_changes(entry.get("changes"))
        credits_used = entry.get("credits_used", 1 if changes else 0)

        updated_by_day.setdefault(day, {"period": day, "accounts_updated": 0})
        updated_by_day[day]["accounts_updated"] += 1

        credits_by_day.setdefault(day, {"period": day, "credits_used": 0})
        credits_by_day[day]["credits_used"] += credits_used

        if week:
            credits_by_week.setdefault(week, {"period": week, "credits_used": 0})
            credits_by_week[week]["credits_used"] += credits_used

    success_days = set(processed_by_day) | set(updated_by_day)
    success_rate_over_time = {}
    for day in success_days:
        processed = processed_by_day.get(day, {}).get("accounts_processed", 0)
        updated = updated_by_day.get(day, {}).get("accounts_updated", 0)
        denominator = processed or updated
        success_rate_over_time[day] = {
            "period": day,
            "success_rate": round((updated / denominator) * 100, 1) if denominator else 0,
        }

    return {
        "daily_credits_used": sort_series(credits_by_day),
        "weekly_credits_used": sort_series(credits_by_week),
        "accounts_processed_per_day": sort_series(processed_by_day),
        "accounts_updated_per_day": sort_series(updated_by_day),
        "success_rate_over_time": sort_series(success_rate_over_time),
    }


def build_alert_center(usage_percent, outcome_breakdown, data_quality_pipeline):
    alerts = []
    outcome_counts = {
        outcome["result_status"]: outcome["count"]
        for outcome in outcome_breakdown
    }
    total_outcomes = sum(outcome_counts.values())
    failed_count = outcome_counts.get("Failed", 0)
    skipped_count = outcome_counts.get("Skipped", 0)
    updated_count = outcome_counts.get("Updated", 0)
    no_match_count = outcome_counts.get("No Match Found", 0)
    known_match_outcomes = updated_count + no_match_count
    match_rate = (updated_count / known_match_outcomes) * 100 if known_match_outcomes else 100
    skipped_rate = (skipped_count / total_outcomes) * 100 if total_outcomes else 0
    backlog_count = next(
        (
            pipeline_item["count"]
            for pipeline_item in data_quality_pipeline
            if pipeline_item["category"] == "Ready for Enrichment"
        ),
        0,
    )

    if usage_percent >= 100:
        alerts.append({
            "severity": "critical",
            "description": "Credit limit reached.",
            "recommended_action": "Pause enrichment runs until the weekly credit reset or increase the Seamless credit limit.",
        })
    elif usage_percent >= 90:
        alerts.append({
            "severity": "warning",
            "description": "Credits are above 90% of the weekly limit.",
            "recommended_action": "Prioritize only high-value accounts until the credit reset.",
        })

    if failed_count:
        alerts.append({
            "severity": "critical" if failed_count >= 5 else "warning",
            "description": f"{failed_count} failed enrichment run{'' if failed_count == 1 else 's'} detected recently.",
            "recommended_action": "Review failure details, API configuration, and Dynamics update permissions.",
        })

    if match_rate < 60:
        alerts.append({
            "severity": "warning",
            "description": f"Match rate is low at {round(match_rate, 1)}%.",
            "recommended_action": "Review account names and location fields before running more enrichment.",
        })

    if backlog_count >= 100:
        alerts.append({
            "severity": "warning",
            "description": f"{backlog_count} accounts are ready for enrichment.",
            "recommended_action": "Run enrichment in batches and monitor remaining credits.",
        })

    if skipped_rate >= 30:
        alerts.append({
            "severity": "warning",
            "description": f"Skipped records are high at {round(skipped_rate, 1)}% of recent outcomes.",
            "recommended_action": "Check confidence thresholds and source data completeness.",
        })

    return alerts


def serialize_audit_value(value):
    if value is None:
        return None

    if isinstance(value, (str, int, float, bool)):
        return value

    return str(value)


def build_audit_history(metrics, updates_log):
    runs_by_day = {}

    for entry in metrics.get("processed_log", []):
        day = get_day_key(entry.get("timestamp"))
        if not day:
            continue

        runs_by_day.setdefault(day, {
            "run_date": day,
            "accounts_processed": 0,
            "accounts_updated": 0,
            "credits_used": 0,
            "run_status": "Completed",
            "details": [],
        })
        runs_by_day[day]["accounts_processed"] += 1

    for entry in updates_log:
        day = get_day_key(entry.get("timestamp"))
        if not day:
            continue

        run = runs_by_day.setdefault(day, {
            "run_date": day,
            "accounts_processed": 0,
            "accounts_updated": 0,
            "credits_used": 0,
            "run_status": "Completed",
            "details": [],
        })
        changes = normalize_changes(entry.get("changes"))
        run["accounts_updated"] += 1 if changes else 0
        run["credits_used"] += entry.get("credits_used", 1 if changes else 0)

        for change in changes:
            run["details"].append({
                "account_name": entry.get("account_name") or entry.get("company") or "Unknown Account",
                "field_updated": change.get("field") or "Unknown Field",
                "old_value": serialize_audit_value(change.get("old")),
                "new_value": serialize_audit_value(change.get("new")),
                "result": entry.get("result_status") or entry.get("status") or "Updated",
                "timestamp": entry.get("timestamp"),
            })

    for run in runs_by_day.values():
        denominator = run["accounts_processed"] or run["accounts_updated"]
        run["success_rate"] = round((run["accounts_updated"] / denominator) * 100, 1) if denominator else 0
        if any(detail["result"] == "Failed" for detail in run["details"]):
            run["run_status"] = "Failed"
        elif run["accounts_processed"] == 0 and run["accounts_updated"] > 0:
            run["run_status"] = "Historical"

    return sorted(runs_by_day.values(), key=lambda run: run["run_date"], reverse=True)[:30]


@router.get("/metrics")
async def get_metrics(_user=Depends(require_user)):
    usage = load_usage()
    metrics = load_metrics()
    updates_log = metrics.get("updates_log", [])
    recent_activity = build_recent_activity(updates_log)
    try:
        data_quality_pipeline = build_data_quality_pipeline(await get_accounts_data_quality())
    except Exception:
        data_quality_pipeline = build_data_quality_pipeline([])

    credits_used = usage.get("credits_used", 0)
    remaining_credits = max(WEEKLY_LIMIT - credits_used, 0)
    usage_percent = (credits_used / WEEKLY_LIMIT) * 100 if WEEKLY_LIMIT else 0
    outcome_breakdown = build_outcome_breakdown(recent_activity)

    return {
        "credits_used": credits_used,
        "weekly_limit": WEEKLY_LIMIT,
        "remaining_credits": remaining_credits,
        "usage_percent": round(usage_percent, 2),
        "accounts_processed": metrics.get("accounts_processed", 0),
        "accounts_updated": metrics.get("accounts_updated", 0),
        "updated_companies": metrics.get("updated_companies", []),
        "updates_log": updates_log,
        "recent_activity": recent_activity,
        "outcome_breakdown": outcome_breakdown,
        "field_impact": build_field_impact(updates_log),
        "data_quality_pipeline": data_quality_pipeline,
        "trend_tracking": build_trend_tracking(metrics, updates_log),
        "alert_center": build_alert_center(usage_percent, outcome_breakdown, data_quality_pipeline),
        "audit_history": build_audit_history(metrics, updates_log),
    }
