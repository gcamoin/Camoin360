from fastapi import APIRouter, Depends, HTTPException, status

from .auth import require_user
from ..services.dynamics import get_project_creation_metrics, get_website_visit_metrics

router = APIRouter()


@router.get("/marketing/website-visits")
async def fetch_website_visit_metrics(_user=Depends(require_user)):
    try:
        return await get_website_visit_metrics()
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
