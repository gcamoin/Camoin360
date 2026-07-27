import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query, status
from httpx import HTTPError

from .auth import require_user
from ..services.quickbooks import QuickBooksConfigurationError, get_company_financials

router = APIRouter()


@router.get("/company-financials")
async def fetch_company_financials(
    refresh: bool = Query(False),
    _user=Depends(require_user),
):
    try:
        return await get_company_financials(force_refresh=refresh)
    except QuickBooksConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except (HTTPError, asyncio.TimeoutError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load QuickBooks company financials: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unable to prepare company financials: {exc}",
        ) from exc
