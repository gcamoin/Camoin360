from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from app.services.dynamics import (
    get_available_sectors,
    get_available_states,
    get_accounts_missing_data,
    get_accounts_needing_enrichment,
    enrich_account,
    enrich_accounts,
    revert_account_fields,
)

router = APIRouter()


class EnrichmentRequest(BaseModel):
    sectors: list[str] = Field(default_factory=list)
    states: list[str] = Field(default_factory=list)


@router.get("/accounts/missing-data")
async def fetch_accounts():
    accounts = await get_accounts_missing_data()
    return {
        "count": len(accounts),
        "data": accounts
    }


@router.get("/accounts/sectors")
async def fetch_account_sectors():
    sectors = await get_available_sectors()
    return {
        "count": len(sectors),
        "data": sectors
    }


@router.get("/accounts/states")
async def fetch_account_states(
    sectors: list[str] | None = Query(default=None)
):
    states = await get_available_states(sectors)
    return {
        "count": len(states),
        "data": states
    }


@router.get("/accounts/missing-website")
async def fetch_accounts_missing_website():
    accounts = await get_accounts_needing_enrichment()
    return {
        "count": len(accounts),
        "data": accounts
    }


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
async def enrich_all_accounts_route(payload: EnrichmentRequest):
    return await enrich_accounts(
        payload.sectors,
        payload.states
    )
