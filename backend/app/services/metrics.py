import json
import os
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

METRICS_FILE = os.path.join(
    BASE_DIR,
    "metrics_tracker.json"
)


# -----------------------------------
# SAVE METRICS
# -----------------------------------
def save_metrics(data):

    os.makedirs(
        os.path.dirname(METRICS_FILE),
        exist_ok=True
    )

    with open(
        METRICS_FILE,
        "w",
        encoding="utf-8"
    ) as f:

        json.dump(
            data,
            f,
            indent=2
        )

        f.flush()


# -----------------------------------
# LOAD METRICS
# -----------------------------------
def load_metrics():

    default_data = {
        "accounts_processed": 0,
        "accounts_updated": 0,
        "updates_log": []
    }

    # -------------------------------
    # CREATE FILE IF MISSING
    # -------------------------------
    if not os.path.exists(METRICS_FILE):

        save_metrics(default_data)

        return default_data

    # -------------------------------
    # LOAD FILE
    # -------------------------------
    with open(
        METRICS_FILE,
        "r",
        encoding="utf-8"
    ) as f:

        try:

            data = json.load(f)

            # -------------------------------
            # ENSURE REQUIRED KEYS EXIST
            # -------------------------------
            data.setdefault(
                "accounts_processed",
                0
            )

            data.setdefault(
                "accounts_updated",
                0
            )

            data.setdefault(
                "updates_log",
                []
            )

            # -------------------------------
            # REMOVE OLD LEGACY KEY
            # -------------------------------
            if "updated_companies" in data:
                del data["updated_companies"]

            return data

        except (
            json.JSONDecodeError,
            OSError
        ):

            save_metrics(default_data)

            return default_data


# -----------------------------------
# INCREMENT PROCESSED
# -----------------------------------
def increment_processed():

    data = load_metrics()

    data["accounts_processed"] += 1

    print(
        f"📊 Accounts processed: "
        f"{data['accounts_processed']}"
    )

    save_metrics(data)

    return data


# -----------------------------------
# LOG ACCOUNT UPDATE
# -----------------------------------
def log_update(company_name, changes):

    data = load_metrics()

    # -------------------------------
    # SAFETY CHECK
    # -------------------------------
    if not changes:

        print(
            f"⚠️ No changes supplied "
            f"for {company_name}"
        )

        return data

    # -------------------------------
    # INCREMENT UPDATED COUNT
    # -------------------------------
    data["accounts_updated"] += 1

    print(
        f"✅ Accounts updated: "
        f"{data['accounts_updated']}"
    )

    # -------------------------------
    # CREATE AUDIT ENTRY
    # -------------------------------
    entry = {
        "company": company_name,
        "timestamp": datetime.utcnow().isoformat(),
        "changes": changes
    }

    # -------------------------------
    # APPEND TO AUDIT LOG
    # -------------------------------
    data["updates_log"].append(entry)

    # -------------------------------
    # KEEP ONLY LAST 50 ENTRIES
    # -------------------------------
    data["updates_log"] = (
        data["updates_log"][-50:]
    )

    print(
        f"📝 Audit log entries: "
        f"{len(data['updates_log'])}"
    )

    # -------------------------------
    # SAVE METRICS
    # -------------------------------
    save_metrics(data)

    print("💾 Metrics saved")

    return data


# -----------------------------------
# RESET METRICS
# -----------------------------------
def reset_metrics():

    default_data = {
        "accounts_processed": 0,
        "accounts_updated": 0,
        "updates_log": []
    }

    save_metrics(default_data)

    print("♻️ Metrics reset")

    return default_data