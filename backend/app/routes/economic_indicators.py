import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query, status
from httpx import HTTPError

from .auth import require_user
from ..services.economic_indicators import get_economic_indicators

router = APIRouter()


@router.get("/economic-indicators")
async def fetch_economic_indicators(
    refresh: bool = Query(False),
    _user=Depends(require_user),
):
    try:
        return await get_economic_indicators(force_refresh=refresh)
    except (HTTPError, asyncio.TimeoutError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load live economic indicators: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to prepare economic indicators: {exc}",
        ) from exc
