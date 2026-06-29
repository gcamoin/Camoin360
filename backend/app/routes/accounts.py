import hmac
import os
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi import Query
from pydantic import BaseModel, Field

from .auth import require_user
from ..services.cache import AsyncStaleCache
from ..services.duplicate_accounts import find_duplicate_account_groups
from ..services.dynamics import (
    get_account_sector_counts,
    get_accounts_missing_data,
    get_accounts_data_quality,
    get_accounts_needing_enrichment,
    get_duplicate_account_records,
    delete_account,
    get_marketing_lists,
    get_marketing_list_members,
    get_leadfeeder_visits,
    invalidate_account_read_caches,
    enrich_one_account,
    enrich_account,
    enrich_accounts,
    enrich_selected_accounts,
    revert_account_fields,
)

router = APIRouter()
read_cache = AsyncStaleCache()
DATA_QUALITY_TTL_SECONDS = 300
DUPLICATE_TTL_SECONDS = 300
MARKETING_LIST_TTL_SECONDS = 300
LEADFEEDER_TTL_SECONDS = 180
SUMMARY_TTL_SECONDS = 900
STALE_GRACE_SECONDS = 1800


def invalidate_account_endpoint_caches():
    invalidate_account_read_caches()
    read_cache.invalidate("data-quality:")
    read_cache.invalidate("duplicates:")
    read_cache.invalidate("summary")


class EnrichmentPreviewRequest(BaseModel):
    account_ids: list[str] = Field(default_factory=list)
    fields_to_update: list[str] = Field(default_factory=list)


class EnrichmentPreviewResponse(BaseModel):
    status: str
    message: str
    selected_account_count: int
    fields_to_update: list[str]
    preview: list[dict[str, str]]


class EnrichmentRunResponse(BaseModel):
    processed: int
    updated: int
    skipped: int = 0
    results: list[dict]


@router.get("/accounts/missing-data")
async def fetch_accounts():
    accounts = await get_accounts_missing_data()
    return {
        "count": len(accounts),
        "data": accounts
    }


@router.get("/accounts/data-quality")
async def fetch_accounts_data_quality(
    limit: int = Query(default=1000, ge=100, le=5000),
    _user=Depends(require_user),
):
    try:
        accounts = await read_cache.get(
            f"data-quality:{limit}",
            lambda: get_accounts_data_quality(limit),
            ttl_seconds=DATA_QUALITY_TTL_SECONDS,
            stale_seconds=STALE_GRACE_SECONDS,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load Dynamics account data: {exc}",
        ) from exc

    return {
        "count": len(accounts),
        "limit": limit,
        "has_more": len(accounts) >= limit,
        "data": accounts
    }


async def get_duplicate_account_response(limit: int):
    async def load_response():
        accounts = await get_duplicate_account_records(limit)
        duplicate_groups = find_duplicate_account_groups(accounts)

        return {
            "account_count": len(accounts),
            "duplicate_group_count": len(duplicate_groups),
            "limit": limit,
            "groups": duplicate_groups,
        }

    return await read_cache.get(
        f"duplicates:{limit}",
        load_response,
        ttl_seconds=DUPLICATE_TTL_SECONDS,
        stale_seconds=STALE_GRACE_SECONDS,
    )


@router.get("/accounts/duplicates")
async def fetch_duplicate_accounts(
    limit: int = Query(default=1000, ge=500, le=1000),
    _user=Depends(require_user),
):
    try:
        return await get_duplicate_account_response(limit)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load Dynamics duplicate account records: {exc}",
        ) from exc


@router.get("/accounts/duplicate-accounts")
async def fetch_duplicate_account_records_alias(
    limit: int = Query(default=1000, ge=500, le=1000),
    _user=Depends(require_user),
):
    try:
        return await get_duplicate_account_response(limit)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load Dynamics duplicate account records: {exc}",
        ) from exc


async def get_leadfeeder_visits_response(limit: int):
    async def load_response():
        visits = await get_leadfeeder_visits(limit)
        return {
            "count": len(visits),
            "limit": limit,
            "data": visits,
        }

    return await read_cache.get(
        f"leadfeeder:{limit}",
        load_response,
        ttl_seconds=LEADFEEDER_TTL_SECONDS,
        stale_seconds=STALE_GRACE_SECONDS,
    )


@router.get("/leadfeeder-visits")
async def fetch_leadfeeder_visits(
    limit: int = Query(default=200, ge=1, le=1000),
    _user=Depends(require_user),
):
    try:
        return await get_leadfeeder_visits_response(limit)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load Leadfeeder visits: {exc}",
        ) from exc


@router.get("/accounts/leadfeeder-visits")
async def fetch_account_leadfeeder_visits_alias(
    limit: int = Query(default=200, ge=1, le=1000),
    _user=Depends(require_user),
):
    try:
        return await get_leadfeeder_visits_response(limit)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load Leadfeeder visits: {exc}",
        ) from exc


@router.delete("/accounts/{account_id}")
async def delete_duplicate_account(account_id: UUID, _user=Depends(require_user)):
    try:
        result = await delete_account(str(account_id))
        invalidate_account_endpoint_caches()
        return result
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to delete Dynamics account: {exc}",
        ) from exc


@router.get("/accounts/summary-analytics")
async def fetch_account_summary_analytics(_user=Depends(require_user)):
    try:
        return await read_cache.get(
            "summary",
            get_account_sector_counts,
            ttl_seconds=SUMMARY_TTL_SECONDS,
            stale_seconds=STALE_GRACE_SECONDS,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load Dynamics sector summary: {exc}",
        ) from exc


@router.get("/marketing-lists")
async def fetch_marketing_lists(
    limit: int = Query(default=500, ge=1, le=5000),
    _user=Depends(require_user),
):
    try:
        marketing_lists = await read_cache.get(
            f"marketing-lists:{limit}",
            lambda: get_marketing_lists(limit),
            ttl_seconds=MARKETING_LIST_TTL_SECONDS,
            stale_seconds=STALE_GRACE_SECONDS,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load Dynamics marketing lists: {exc}",
        ) from exc

    return {
        "count": len(marketing_lists),
        "limit": limit,
        "data": marketing_lists
    }


@router.get("/marketing-lists/{list_id}/members")
async def fetch_marketing_list_members(list_id: UUID, _user=Depends(require_user)):
    try:
        return await read_cache.get(
            f"marketing-list-members:{list_id}",
            lambda: get_marketing_list_members(str(list_id)),
            ttl_seconds=MARKETING_LIST_TTL_SECONDS,
            stale_seconds=STALE_GRACE_SECONDS,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load Dynamics marketing list members: {exc}",
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


@router.post("/accounts/enrichment-run", response_model=EnrichmentRunResponse)
async def run_enrichment(request: EnrichmentPreviewRequest, _user=Depends(require_user)):
    try:
        result = await enrich_selected_accounts(request.account_ids, request.fields_to_update)
        invalidate_account_endpoint_caches()
        return result
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to enrich selected accounts: {exc}",
        ) from exc


@router.get("/accounts/missing-website")
async def fetch_accounts_missing_website():
    accounts = await get_accounts_needing_enrichment()
    return {
        "count": len(accounts),
        "data": accounts
    }


def _require_power_automate_api_key(x_api_key: str | None = Header(default=None)) -> None:
    """Require the shared secret only when POWER_AUTOMATE_API_KEY is configured."""
    configured_key = os.getenv("POWER_AUTOMATE_API_KEY")
    if configured_key and not (x_api_key and hmac.compare_digest(x_api_key, configured_key)):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing x-api-key")


@router.post("/accounts/enrich-one/{account_id}")
async def enrich_one(
    account_id: str,
    _api_key: None = Depends(_require_power_automate_api_key),
):
    """Power Automate entry point for safe, one-account Seamless enrichment."""
    result = await enrich_one_account(account_id)
    invalidate_account_endpoint_caches()
    return result


@router.post("/accounts/revert/{account_id}")
async def revert_account(account_id: str):
    result = await revert_account_fields(account_id)
    invalidate_account_endpoint_caches()
    return result


@router.post("/accounts/revert-email/{account_id}")
async def revert_email(account_id: str):
    result = await revert_account_fields(account_id, {
        "emailaddress1": None
    })
    invalidate_account_endpoint_caches()
    return result


@router.post("/accounts/revert-phone/{account_id}")
async def revert_phone(account_id: str):
    result = await revert_account_fields(account_id, {
        "telephone1": None
    })
    invalidate_account_endpoint_caches()
    return result


@router.post("/accounts/enrich/{account_id}")
async def enrich_account_route(account_id: str):
    result = await enrich_account(account_id)
    invalidate_account_endpoint_caches()
    return result


@router.post("/accounts/enrich-all")
async def enrich_all_accounts_route():
    result = await enrich_accounts()
    invalidate_account_endpoint_caches()
    return result
