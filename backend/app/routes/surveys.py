from fastapi import APIRouter, Depends, HTTPException, status

from .auth import require_user
from ..services.surveys import get_completed_surveys

router = APIRouter(prefix="/surveys", tags=["surveys"])


@router.get("/completed")
async def fetch_completed_surveys(_user=Depends(require_user)):
    try:
        return await get_completed_surveys()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to load completed surveys from Dynamics: {exc}",
        ) from exc
