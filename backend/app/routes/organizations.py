from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from .auth import require_user
from ..schemas.client_user import (
    ClientUserListResponse,
    ClientUserResponse,
    OrganizationClientUserCreate,
)
from ..schemas.organization import (
    OrganizationCreate,
    OrganizationListResponse,
    OrganizationResponse,
    OrganizationUpdate,
)
from ..services.client_users import create_client_user, list_client_users
from ..services.organizations import (
    create_organization,
    delete_organization,
    get_organization,
    list_manual_organizations,
    update_organization,
)


router = APIRouter(prefix="/organizations", tags=["organizations"])


def _not_found_error(exc: LookupError):
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


def _conflict_error(exc: ValueError):
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


@router.get("", response_model=OrganizationListResponse)
async def fetch_organizations(
    limit: int = Query(default=1000, ge=1, le=5000),
    _user=Depends(require_user),
):
    organizations = list_manual_organizations()[:limit]

    return {"count": len(organizations), "data": organizations}


@router.post("", response_model=OrganizationResponse, status_code=status.HTTP_201_CREATED)
async def add_organization(request: OrganizationCreate, _user=Depends(require_user)):
    try:
        return create_organization(
            {
                "organization_name": request.organization_name,
                "city": request.city,
                "state": request.state,
                "contract_expiration": request.contract_expiration.isoformat()
                if request.contract_expiration
                else None,
            }
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Unable to create organization: {exc}",
        ) from exc


@router.get("/{organization_id}", response_model=OrganizationResponse)
async def fetch_organization(organization_id: int, _user=Depends(require_user)):
    try:
        return get_organization(organization_id)
    except LookupError as exc:
        raise _not_found_error(exc) from exc


@router.patch("/{organization_id}", response_model=OrganizationResponse)
async def edit_organization(
    organization_id: int,
    request: OrganizationUpdate,
    _user=Depends(require_user),
):
    try:
        return update_organization(
            organization_id,
            request.model_dump(exclude_unset=True, mode="json"),
        )
    except LookupError as exc:
        raise _not_found_error(exc) from exc


@router.put("/{organization_id}", response_model=OrganizationResponse)
async def replace_organization(
    organization_id: int,
    request: OrganizationUpdate,
    _user=Depends(require_user),
):
    return await edit_organization(organization_id, request, _user)


@router.delete("/{organization_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_organization(organization_id: int, _user=Depends(require_user)):
    try:
        delete_organization(organization_id)
    except LookupError as exc:
        raise _not_found_error(exc) from exc

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{organization_id}/users", response_model=ClientUserListResponse)
async def fetch_organization_users(organization_id: int, _user=Depends(require_user)):
    try:
        get_organization(organization_id)
    except LookupError as exc:
        raise _not_found_error(exc) from exc

    users = list_client_users(organization_id)
    return {"count": len(users), "data": users}


@router.post(
    "/{organization_id}/users",
    response_model=ClientUserResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_organization_user(
    organization_id: int,
    request: OrganizationClientUserCreate,
    _user=Depends(require_user),
):
    try:
        return create_client_user(
            {
                **request.model_dump(),
                "organization_id": organization_id,
            }
        )
    except LookupError as exc:
        raise _not_found_error(exc) from exc
    except ValueError as exc:
        raise _conflict_error(exc) from exc
