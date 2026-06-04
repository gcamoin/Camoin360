from fastapi import APIRouter, Depends, HTTPException, status

from .auth import require_user
from ..services.dynamics import (
    get_account_sector_counts,
    get_accounts_missing_data,
    get_accounts_data_quality,
    get_accounts_needing_enrichment,
    enrich_single_account_test,
    enrich_account,
    enrich_accounts,
    revert_account_fields,
)

router = APIRouter()


@router.get("/accounts/missing-data")
async def fetch_accounts():
    accounts = await get_accounts_missing_data()
    return {
        "count": len(accounts),
        "data": accounts
    }


@router.get("/accounts/data-quality")
async def fetch_accounts_data_quality(_user=Depends(require_user)):
    try:
        accounts = await get_accounts_data_quality()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load Dynamics account data: {exc}",
        ) from exc

    return {
        "count": len(accounts),
        "data": accounts
    }


@router.get("/accounts/summary-analytics")
async def fetch_account_summary_analytics(_user=Depends(require_user)):
    try:
        return await get_account_sector_counts()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load Dynamics sector summary: {exc}",
        ) from exc


@router.get("/accounts/missing-website")
async def fetch_accounts_missing_website():
    accounts = await get_accounts_needing_enrichment()
    return {
        "count": len(accounts),
        "data": accounts
    }


@router.post("/accounts/enrich-one/{account_id}")
async def enrich_one(account_id: str):
    return await enrich_single_account_test(account_id)


@router.post("/accounts/revert/{account_id}")
async def revert_account(account_id: str):
    return await revert_account_fields(account_id)


@router.post("/accounts/revert-email/{account_id}")
async def revert_email(account_id: str):
    return await revert_account_fields(account_id, {
        "emailaddress1": None
    })


@router.post("/accounts/revert-phone/{account_id}")
async def revert_phone(account_id: str):
    return await revert_account_fields(account_id, {
        "telephone1": None
    })


@router.post("/accounts/enrich/{account_id}")
async def enrich_account_route(account_id: str):
    return await enrich_account(account_id)


@router.post("/accounts/enrich-all")
async def enrich_all_accounts_route():
    return await enrich_accounts()
