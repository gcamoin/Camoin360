from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from starlette.concurrency import run_in_threadpool

from .auth import require_user
from ..services.dynamics import (
    get_contract_backlog_metrics,
    get_project_creation_metrics,
    get_rfp_success_rate_metrics,
    get_sales_outlook_metrics,
    get_sales_outlook_rfp_metrics,
    get_service_line_financial_metrics,
    get_website_visit_metrics,
    refresh_website_visit_metrics_cache,
)
from ..services.harvest import get_employee_weekly_hours, run_employee_weekly_hours_refresh
from ..services.service_line_metrics import (
    get_service_line_marketing_metrics,
    refresh_service_line_marketing_metrics_cache,
)
from ..services.search_console import (
    get_search_console_metrics,
    refresh_search_console_metrics_cache,
)

router = APIRouter()


def _sync_is_ready_to_retry(sync: dict) -> bool:
    if sync.get("status") not in {"error", "syncing"} or not sync.get("last_started_at"):
        return False
    try:
        started_at = datetime.fromisoformat(str(sync["last_started_at"]).replace("Z", "+00:00"))
        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - started_at).total_seconds() >= 300
    except ValueError:
        return True


@router.get("/marketing/seo-results")
async def fetch_search_console_metrics(
    background_tasks: BackgroundTasks,
    range: str = Query("since_2022"),
    refresh: bool = Query(False),
    _user=Depends(require_user),
):
    try:
        result = get_search_console_metrics(range)
        sync = result["sync"]
        should_refresh = (
            refresh and sync["status"] != "syncing"
        ) or (
            sync["is_stale"]
            and (sync["status"] == "idle" or _sync_is_ready_to_retry(sync))
        )
        if should_refresh:
            background_tasks.add_task(refresh_search_console_metrics_cache)
            result["sync"] = {**sync, "status": "syncing"}
        return result
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load Search Console metrics: {exc}",
        ) from exc


@router.get("/marketing/website-visits")
async def fetch_website_visit_metrics(
    background_tasks: BackgroundTasks,
    range: str = Query("since_2022"),
    refresh: bool = Query(False),
    _user=Depends(require_user),
):
    try:
        result = get_website_visit_metrics(range)
        if refresh or (
            result["sync"]["is_stale"]
            and (result["sync"]["status"] == "idle" or _sync_is_ready_to_retry(result["sync"]))
        ):
            background_tasks.add_task(refresh_website_visit_metrics_cache, range)
            result["sync"] = {**result["sync"], "status": "syncing"}
        return result
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load website visit metrics from Dynamics: {exc}",
        ) from exc


@router.get("/marketing/service-line-metrics")
async def fetch_service_line_marketing_metrics(
    background_tasks: BackgroundTasks,
    refresh: bool = Query(False),
    _user=Depends(require_user),
):
    try:
        result = get_service_line_marketing_metrics()
        if result["sync"]["status"] != "syncing" and (refresh or result["sync"]["is_stale"]):
            background_tasks.add_task(refresh_service_line_marketing_metrics_cache)
            result["sync"] = {**result["sync"], "status": "syncing"}
        return result
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load service line marketing metrics: {exc}",
        ) from exc


@router.get("/productivity/projects")
async def fetch_project_creation_metrics(_user=Depends(require_user)):
    try:
        return await get_project_creation_metrics()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load project metrics from Dynamics: {exc}",
        ) from exc


@router.get("/management/rfp-success-rate")
async def fetch_rfp_success_rate(_user=Depends(require_user)):
    try:
        return await get_rfp_success_rate_metrics()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load RFP success rates from Dynamics: {exc}",
        ) from exc


@router.get("/management/service-line-financials")
async def fetch_service_line_financials(_user=Depends(require_user)):
    try:
        return await get_service_line_financial_metrics()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load service-line financials from Dynamics: {exc}",
        ) from exc


@router.get("/management/sales-outlook")
async def fetch_sales_outlook(_user=Depends(require_user)):
    try:
        return await get_sales_outlook_metrics()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load sales outlook from Dynamics: {exc}",
        ) from exc


@router.get("/management/sales-outlook-rfp")
async def fetch_sales_outlook_rfp(_user=Depends(require_user)):
    try:
        return await get_sales_outlook_rfp_metrics()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load RFP sales outlook from Dynamics: {exc}",
        ) from exc


@router.get("/management/contract-backlog")
async def fetch_contract_backlog(_user=Depends(require_user)):
    try:
        return await get_contract_backlog_metrics()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load contract backlog from Dynamics: {exc}",
        ) from exc


@router.get("/productivity/employee-hours")
async def fetch_employee_weekly_hours(
    background_tasks: BackgroundTasks,
    year: Optional[int] = Query(None, ge=2000, le=2100),
    month: Optional[int] = Query(None, ge=1, le=12),
    refresh: bool = Query(False),
    _user=Depends(require_user),
):
    try:
        result = await run_in_threadpool(get_employee_weekly_hours, year=year, month=month)
        sync_status = result["sync"]["status"]
        if sync_status != "syncing" and (refresh or (sync_status == "idle" and result["sync"]["is_stale"])):
            background_tasks.add_task(run_employee_weekly_hours_refresh, year, month)
            result["sync"] = {**result["sync"], "status": "syncing", "last_error": ""}
        return result
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load employee hours from Harvest: {exc}",
        ) from exc
