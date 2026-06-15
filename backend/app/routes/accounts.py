from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

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


class EnrichmentPreviewRequest(BaseModel):
    account_ids: list[str] = Field(default_factory=list)
    fields_to_update: list[str] = Field(default_factory=list)


class EnrichmentPreviewResponse(BaseModel):
    status: str
    message: str
    selected_account_count: int
    fields_to_update: list[str]
    preview: list[dict[str, str]]


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


@router.post("/accounts/enrichment-preview", response_model=EnrichmentPreviewResponse)
async def create_enrichment_preview(request: EnrichmentPreviewRequest, _user=Depends(require_user)):
    preview_rows = [
        {
            "account_id": account_id,
            "status": "ready",
            "source": "mock",
            "message": "Mock enrichment preview generated. No external enrichment service was called.",
        }
        for account_id in request.account_ids
    ]

    return EnrichmentPreviewResponse(
        status="preview_ready",
        message="Mock enrichment preview generated successfully.",
        selected_account_count=len(request.account_ids),
        fields_to_update=request.fields_to_update,
        preview=preview_rows,
    )


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
