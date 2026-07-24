import hmac
import json
import os
from uuid import UUID

from datetime import date

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field, SecretStr, field_validator

from .auth import require_user
from ..services.cache import AsyncStaleCache
from ..services.duplicate_accounts import find_duplicate_account_groups
from ..services.organizations import increment_organization_user_count
from ..services.dynamics import (
    get_account_sector_counts,
    get_accounts_missing_data,
    get_accounts_data_quality,
    get_accounts_data_quality_page,
    get_accounts_needing_enrichment,
    get_duplicate_account_records,
    delete_account,
    delete_marketing_list,
    get_marketing_list_conversion_analysis,
    get_marketing_lists,
    get_marketing_list_members,
    get_leadfeeder_visits,
    get_pe_clients,
    get_pe_qualified_leads,
    create_pe_client,
    create_pe_client_user,
    refresh_accounts_data_quality_cache,
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


class PEClientCreateRequest(BaseModel):
    client_name: str = Field(min_length=1, max_length=160)
    city: str = Field(default="", max_length=80)
    state: str = Field(default="", max_length=50)
    contract_expiration: date | None = None

    @field_validator("client_name", "city", "state", mode="before")
    @classmethod
    def strip_text_fields(cls, value):
        return value.strip() if isinstance(value, str) else value


class PEClientUserCreateRequest(BaseModel):
    account_id: UUID
    first_name: str = Field(min_length=1, max_length=50)
    last_name: str = Field(min_length=1, max_length=50)
    email: str = Field(min_length=3, max_length=100)
    phone: str = Field(default="", max_length=50)
    username: str = Field(default="", max_length=100)
    password: SecretStr = Field(min_length=8, max_length=128)

    @field_validator("first_name", "last_name", "email", "phone", "username", mode="before")
    @classmethod
    def strip_user_text_fields(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("email")
    @classmethod
    def validate_email(cls, value):
        if "@" not in value:
            raise ValueError("Enter a valid email address")
        return value.lower()


@router.get("/accounts/missing-data")
async def fetch_accounts():
    accounts = await get_accounts_missing_data()
    return {
        "count": len(accounts),
        "data": accounts
    }


@router.get("/accounts/data-quality")
async def fetch_accounts_data_quality(
    background_tasks: BackgroundTasks,
    page: int = Query(default=0, ge=0),
    page_size: int = Query(default=25, ge=1, le=250),
    search: str = Query(default=""),
    sector: str = Query(default="all"),
    missing_field: str = Query(default="all"),
    states: str = Query(default=""),
    country: str = Query(default="all"),
    cities: str = Query(default=""),
    needs_attention: bool = Query(default=False),
    column_filters: str = Query(default="{}"),
    sort_key: str = Query(default=""),
    sort_direction: str = Query(default="asc", pattern="^(asc|desc)$"),
    refresh: bool = Query(default=False),
    limit: int = Query(default=100000, ge=100, le=100000),
    _user=Depends(require_user),
):
    try:
        try:
            parsed_column_filters = json.loads(column_filters or "{}")
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="column_filters must be valid JSON",
            ) from exc

        result = get_accounts_data_quality_page(
            page=page,
            page_size=page_size,
            search=search,
            sector=sector,
            missing_field=missing_field,
            states=[value for value in states.split("|") if value],
            country=country,
            cities=[value for value in cities.split("|") if value],
            needs_attention=needs_attention,
            column_filters=parsed_column_filters if isinstance(parsed_column_filters, dict) else {},
            sort_key=sort_key,
            sort_direction=sort_direction,
        )
        if result["sync"]["status"] != "syncing" and (refresh or result["sync"]["is_stale"] or result["total_count"] == 0):
            background_tasks.add_task(refresh_accounts_data_quality_cache, limit)
    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load Dynamics account data: {exc}",
        ) from exc

    return result


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


@router.get("/pe-clients")
async def fetch_pe_clients(
    limit: int = Query(default=1000, ge=1, le=5000),
    _user=Depends(require_user),
):
    try:
        clients = await get_pe_clients(limit)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load Dynamics PE clients: {exc}",
        ) from exc

    return {"count": len(clients), "limit": limit, "data": clients}


@router.get("/pe-qualified-leads")
async def fetch_pe_qualified_leads(
    year: int | None = Query(default=None, ge=2000, le=2100),
    month: int | None = Query(default=None, ge=1, le=12),
    limit: int = Query(default=1000, ge=1, le=5000),
    _user=Depends(require_user),
):
    try:
        return await get_pe_qualified_leads(year=year, month=month, limit=limit)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load Prospect Engage qualified leads: {exc}",
        ) from exc


@router.post("/pe-clients", status_code=status.HTTP_201_CREATED)
async def add_pe_client(request: PEClientCreateRequest, _user=Depends(require_user)):
    try:
        client = await create_pe_client(
            {
                "client_name": request.client_name,
                "city": request.city,
                "state": request.state,
                "contract_expiration": request.contract_expiration.isoformat()
                if request.contract_expiration
                else None,
            }
        )
        return {"data": client}
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to create Dynamics PE client: {exc}",
        ) from exc


@router.post("/pe-clients/users", status_code=status.HTTP_201_CREATED)
async def add_pe_client_user(request: PEClientUserCreateRequest, _user=Depends(require_user)):
    try:
        user = await create_pe_client_user(
            {
                "account_id": str(request.account_id),
                "first_name": request.first_name,
                "last_name": request.last_name,
                "email": request.email,
                "phone": request.phone,
                "username": request.username,
                "password": request.password.get_secret_value(),
            }
        )
        increment_organization_user_count(str(request.account_id))
        return {"data": user}
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to create Dynamics PE client user: {exc}",
        ) from exc


@router.get("/marketing-lists")
async def fetch_marketing_lists(
    limit: int = Query(default=500, ge=1, le=5000),
    created_from: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    created_to: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    _user=Depends(require_user),
):
    try:
        marketing_lists = await read_cache.get(
            f"marketing-lists:{limit}:{created_from or ''}:{created_to or ''}",
            lambda: get_marketing_lists(limit, created_from, created_to),
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
        "created_from": created_from,
        "created_to": created_to,
        "data": marketing_lists
    }


@router.get("/marketing-lists/conversion-analysis/summary")
async def fetch_marketing_list_conversion_analysis(
    limit: int = Query(default=100, ge=1, le=500),
    years: list[str] | None = Query(default=None),
    match_mode: str = Query(default="same_year", pattern="^(same_year|any_time|on_after_list_creation)$"),
    pe_clients: list[str] | None = Query(default=None),
    bucket_overrides: list[str] | None = Query(default=None),
    trade_show_terms: list[str] | None = Query(default=None),
    exclusion_keywords: list[str] | None = Query(default=None),
    size_threshold: int = Query(default=1500, ge=1, le=100000),
    _user=Depends(require_user),
):
    year_key = ",".join(sorted(years or [])) or "default"
    pe_client_key = ",".join(sorted(pe_clients or [])) or "auto"
    bucket_override_key = ",".join(sorted(bucket_overrides or [])) or "auto"
    trade_show_key = ",".join(sorted(trade_show_terms or [])) or "default"
    exclusion_key = ",".join(sorted(exclusion_keywords or [])) or "default"
    try:
        return await read_cache.get(
            f"marketing-list-conversion-analysis:{limit}:{year_key}:{match_mode}:{pe_client_key}:{bucket_override_key}:{trade_show_key}:{exclusion_key}:{size_threshold}",
            lambda: get_marketing_list_conversion_analysis(
                limit,
                years,
                match_mode,
                pe_clients,
                bucket_overrides,
                trade_show_terms,
                exclusion_keywords,
                size_threshold,
            ),
            ttl_seconds=MARKETING_LIST_TTL_SECONDS,
            stale_seconds=STALE_GRACE_SECONDS,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load Dynamics marketing list conversion analysis: {exc}",
        ) from exc


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


@router.delete("/marketing-lists/{list_id}")
async def remove_marketing_list(list_id: UUID, _user=Depends(require_user)):
    try:
        result = await delete_marketing_list(str(list_id))
        read_cache.invalidate("marketing-lists:")
        read_cache.invalidate(f"marketing-list-members:{list_id}")
        read_cache.invalidate("marketing-list-conversion-analysis:")
        return result
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to delete Dynamics marketing list: {exc}",
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
