import json
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
METRICS_FILE = os.path.join(BASE_DIR, "metrics_tracker.json")


def save_metrics(data):
    os.makedirs(os.path.dirname(METRICS_FILE), exist_ok=True)

    with open(METRICS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.flush()


def load_metrics():
    if not os.path.exists(METRICS_FILE):
        data = {
            "accounts_processed": 0,
            "accounts_updated": 0,
        }
        save_metrics(data)
        return data

    with open(METRICS_FILE, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except (json.JSONDecodeError, OSError):
            data = {
                "accounts_processed": 0,
                "accounts_updated": 0,
            }
            save_metrics(data)
            return data


def increment_processed():
    data = load_metrics()
    data["accounts_processed"] = data.get("accounts_processed", 0) + 1
    save_metrics(data)
    return data


def increment_updated():
    data = load_metrics()
    data["accounts_updated"] = data.get("accounts_updated", 0) + 1
    save_metrics(data)
    return data
