from fastapi import APIRouter, Depends

from .auth import require_user
from ..services.metrics import load_metrics
from ..services.usage import load_usage, WEEKLY_LIMIT

router = APIRouter()


@router.get("/metrics")
async def get_metrics(_user=Depends(require_user)):
    usage = load_usage()
    metrics = load_metrics()

    credits_used = usage.get("credits_used", 0)
    remaining_credits = max(WEEKLY_LIMIT - credits_used, 0)
    usage_percent = (credits_used / WEEKLY_LIMIT) * 100 if WEEKLY_LIMIT else 0

    return {
        "credits_used": credits_used,
        "weekly_limit": WEEKLY_LIMIT,
        "remaining_credits": remaining_credits,
        "usage_percent": round(usage_percent, 2),
        "accounts_processed": metrics.get("accounts_processed", 0),
        "accounts_updated": metrics.get("accounts_updated", 0),
        "updated_companies": metrics.get("updated_companies", []),
        "updates_log": metrics.get("updates_log", [])
    }
