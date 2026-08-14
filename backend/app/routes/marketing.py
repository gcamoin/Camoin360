from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status

from .auth import require_user
from ..services.dynamics import (
    get_project_creation_metrics,
    get_rfp_success_rate_metrics,
    get_sales_outlook_metrics,
    get_sales_outlook_rfp_metrics,
    get_service_line_financial_metrics,
    get_website_visit_metrics,
    refresh_website_visit_metrics_cache,
)
from ..services.harvest import get_employee_weekly_hours, refresh_employee_weekly_hours_cache
from ..services.service_line_metrics import (
    get_service_line_marketing_metrics,
    refresh_service_line_marketing_metrics_cache,
)

router = APIRouter()


@router.get("/marketing/website-visits")
async def fetch_website_visit_metrics(
    background_tasks: BackgroundTasks,
    range: str = Query("since_2022"),
    refresh: bool = Query(False),
    _user=Depends(require_user),
):
    try:
        result = get_website_visit_metrics(range)
        if result["sync"]["status"] != "syncing" and (refresh or result["sync"]["is_stale"]):
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


@router.get("/productivity/employee-hours")
async def fetch_employee_weekly_hours(
    background_tasks: BackgroundTasks,
    year: Optional[int] = Query(None, ge=2000, le=2100),
    month: Optional[int] = Query(None, ge=1, le=12),
    refresh: bool = Query(False),
    _user=Depends(require_user),
):
    try:
        result = get_employee_weekly_hours(year=year, month=month)
        if result["sync"]["status"] != "syncing" and (refresh or result["sync"]["is_stale"]):
            background_tasks.add_task(refresh_employee_weekly_hours_cache, year, month)
            result["sync"] = {**result["sync"], "status": "syncing"}
        return result
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load employee hours from Harvest: {exc}",
        ) from exc
