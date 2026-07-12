from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from .auth import require_user
from ..services.dynamics import get_project_creation_metrics, get_website_visit_metrics
from ..services.harvest import get_employee_weekly_hours

router = APIRouter()


@router.get("/marketing/website-visits")
async def fetch_website_visit_metrics(
    range: str = Query("since_2022"),
    _user=Depends(require_user),
):
    try:
        return await get_website_visit_metrics(range)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load website visit metrics from Dynamics: {exc}",
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


@router.get("/productivity/employee-hours")
async def fetch_employee_weekly_hours(
    year: Optional[int] = Query(None, ge=2000, le=2100),
    month: Optional[int] = Query(None, ge=1, le=12),
    _user=Depends(require_user),
):
    try:
        return await get_employee_weekly_hours(year=year, month=month)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load employee hours from Harvest: {exc}",
        ) from exc
