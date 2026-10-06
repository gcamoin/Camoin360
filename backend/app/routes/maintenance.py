"""Authenticated Sophie Maintenance Home snapshots."""
import asyncio
import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from .auth import require_module
from ..services.cache import AsyncStaleCache
from ..services.maintenance_home import InvalidHomeCursor, read_home, read_home_refresh_version

router = APIRouter(prefix="/maintenance", tags=["maintenance"], dependencies=[Depends(require_module("main"))])
home_cache = AsyncStaleCache()
logger = logging.getLogger(__name__)
_home_refresh_version = None


@router.get("/home")
async def home(response: Response, days: int = Query(14, ge=7, le=30),
               view: Literal["recent", "attention"] = "recent",
               limit: int = Query(25, ge=1, le=100), cursor: str | None = Query(None, max_length=1024)):
    response.headers["Cache-Control"] = "private, no-store"
    async def load():
        return await asyncio.to_thread(read_home, days=days, view=view, limit=limit, cursor=cursor)
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
