"""Authenticated Home snapshots with a total-count-only cache-aside safety net."""
import asyncio
import logging
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from .auth import require_module
from ..services.cache import AsyncStaleCache
from ..services.maintenance_home import InvalidHomeCursor, read_home, read_home_refresh_version
from ..services.maintenance_total import missing_total_snapshot
from ..services.maintenance_observations import utc_now
from ..services.usage import load_usage, WEEKLY_LIMIT

router = APIRouter(prefix="/maintenance", tags=["maintenance"], dependencies=[Depends(require_module("main"))])
home_cache = AsyncStaleCache()
logger = logging.getLogger(__name__)
_home_refresh_version = None


@router.get("/enrichment/credits")
async def enrichment_credits(response: Response):
    """Read the existing provider balance/allowance without dashboard refreshes."""
    response.headers["Cache-Control"] = "private, no-store"
    try:
        usage = await asyncio.to_thread(load_usage)
        value = usage.get("total_credits_remaining")
        value = value if type(value) is int and value >= 0 else None
        used = usage.get("credits_used")
        weekly_remaining = max(0, WEEKLY_LIMIT - used) if type(used) is int and used >= 0 else None
        reported = usage.get("total_credits_updated_at")
        try:
            reported = datetime.fromisoformat(reported.replace("Z", "+00:00"))
            if reported.tzinfo is None:
                reported = None
        except (AttributeError, TypeError, ValueError):
            reported = None
        return {"remaining": value, "weekly_limit": WEEKLY_LIMIT, "weekly_remaining": weekly_remaining,
                "reported_at": reported, "is_stale": reported is None or (utc_now() - reported).total_seconds() >= 86400}
    except Exception:
        logger.warning("Enrichment credit information unavailable")
        raise HTTPException(503, "Enrichment credit information is temporarily unavailable") from None


@router.get("/home")
async def home(response: Response, days: int = Query(14, ge=7, le=30),
               view: Literal["recent", "attention"] = "recent",
               limit: int = Query(25, ge=1, le=100), cursor: str | None = Query(None, max_length=1024)):
    response.headers["Cache-Control"] = "private, no-store"
    async def load():
        result = await asyncio.to_thread(read_home, days=days, view=view, limit=limit, cursor=cursor)
        if result["metrics"]["total_dynamics_accounts"]["value"] is None:
            fallback = await missing_total_snapshot()
            snapshot = fallback["snapshot"]
            if snapshot is not None:
                result["metrics"]["total_dynamics_accounts"] = snapshot
                result["freshness"]["total_snapshot_age_seconds"] = max(0, (utc_now() - snapshot["fetched_at"]).total_seconds())
                result["warnings"] = [warning for warning in result["warnings"] if warning != "Total Account snapshot is unavailable."]
                if snapshot["is_stale"]:
                    result["warnings"].append("Total Account snapshot is stale; showing the last valid value.")
                if not fallback["persisted"]:
                    result["warnings"].append("Total Account count is available from Dynamics, but its snapshot could not be saved.")
            else:
                result["warnings"].append("Dynamics total Account count is temporarily unavailable.")
        return result
    try:
        global _home_refresh_version
        version = await asyncio.to_thread(read_home_refresh_version)
        if version != _home_refresh_version:
            home_cache.invalidate()
            _home_refresh_version = version
        # Cache the standard table size only (48 keys); other sizes/cursors read PostgreSQL.
        if cursor or limit != 25:
            return await load()
        return await home_cache.get(f"home:{version}:{days}:{view}:{limit}", load, ttl_seconds=45, stale_seconds=0)
    except InvalidHomeCursor:
        raise HTTPException(status_code=400, detail="Invalid or expired Home cursor") from None
    except Exception:
        logger.warning("Maintenance Home data unavailable; request failed safely")
        raise HTTPException(status_code=503, detail="Maintenance Home data is temporarily unavailable") from None
