from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from httpx import HTTPError

from .auth import require_module
from ..services.quickbooks import (
    QuickBooksConfigurationError,
    QuickBooksOAuthStateError,
    build_authorization_url,
    create_oauth_state,
    disconnect_quickbooks,
    exchange_authorization_code,
    get_connection_status,
    get_user_organization_id,
    _get_frontend_base_url,
)


router = APIRouter(prefix="/quickbooks", tags=["quickbooks"])


def _settings_redirect(**params):
    base_url = f"{_get_frontend_base_url()}/settings/integrations/quickbooks"
    if not params:
        return RedirectResponse(base_url)

    query = "&".join(f"{key}={value}" for key, value in params.items())
    return RedirectResponse(f"{base_url}?{query}")


@router.get("/status")
async def fetch_quickbooks_status(user=Depends(require_module("management"))):
    return get_connection_status(get_user_organization_id(user))


@router.post("/oauth-state")
async def prepare_quickbooks_connect(user=Depends(require_module("admin"))):
    try:
        return create_oauth_state(user)
    except QuickBooksConfigurationError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except QuickBooksOAuthStateError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/connect")
async def connect_quickbooks(state: str = Query(...)):
    try:
        return RedirectResponse(build_authorization_url(state))
    except QuickBooksConfigurationError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except QuickBooksOAuthStateError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/callback")
async def quickbooks_callback(
    code: str | None = Query(default=None),
    realmId: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
):
    if error:
        return _settings_redirect(error="authorization_failed")

    if not code or not realmId or not state:
        return _settings_redirect(error="missing_oauth_response")

    try:
        await exchange_authorization_code(code, realmId, state)
    except (QuickBooksConfigurationError, QuickBooksOAuthStateError, HTTPError):
        return _settings_redirect(error="connection_failed")

    return _settings_redirect(connected="true")


@router.post("/disconnect")
async def disconnect_quickbooks_connection(user=Depends(require_module("admin"))):
    try:
        return await disconnect_quickbooks(get_user_organization_id(user))
    except QuickBooksConfigurationError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to revoke the QuickBooks connection.",
        ) from exc
