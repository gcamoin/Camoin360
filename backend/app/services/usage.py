import json
import os
from datetime import date, datetime, timedelta, timezone

WEEKLY_LIMIT = 2000

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
USAGE_FILE = os.path.join(BASE_DIR, "usage_tracker.json")


def get_week_start():
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    return week_start.isoformat()


def save_usage(data):
    os.makedirs(os.path.dirname(USAGE_FILE), exist_ok=True)

    with open(USAGE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.flush()


def load_usage():
    current_week = get_week_start()

    if not os.path.exists(USAGE_FILE):
        data = {
            "week_start": current_week,
            "credits_used": 0,
        }
        save_usage(data)
        return data

    with open(USAGE_FILE, "r", encoding="utf-8") as f:
        try:
            data = json.load(f)
        except (json.JSONDecodeError, OSError):
            data = {
                "week_start": current_week,
                "credits_used": 0,
            }
            save_usage(data)
            return data

    if data.get("week_start") != current_week:
        total_credits_remaining = data.get("total_credits_remaining")
        total_credits_updated_at = data.get("total_credits_updated_at")
        data = {
            "week_start": current_week,
            "credits_used": 0,
            "total_credits_remaining": total_credits_remaining,
            "total_credits_updated_at": total_credits_updated_at,
        }
        save_usage(data)

    return data


def can_make_request():
    data = load_usage()
    return data.get("credits_used", 0) < WEEKLY_LIMIT


def increment_usage():
    data = load_usage()
    data["credits_used"] = data.get("credits_used", 0) + 1
    save_usage(data)
    return data


def update_total_credits_remaining(value):
    """Store the account-wide balance reported by Seamless response headers."""
    try:
        remaining = int(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return load_usage()

    data = load_usage()
    data["total_credits_remaining"] = max(remaining, 0)
    data["total_credits_updated_at"] = datetime.now(timezone.utc).isoformat()
    save_usage(data)
    return data
