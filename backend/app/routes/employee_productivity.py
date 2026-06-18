from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from .auth import require_user
from ..services.harvest import get_billable_breakdown

router = APIRouter()


@router.get("/employee-productivity/billable-breakdown")
async def fetch_billable_breakdown(
    year: int = Query(..., ge=2000, le=2100),
    month: Optional[int] = Query(None, ge=1, le=12),
    _user=Depends(require_user),
):
    try:
        return await get_billable_breakdown(year=year, month=month)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load billable breakdown from Harvest: {exc}",
        ) from exc
