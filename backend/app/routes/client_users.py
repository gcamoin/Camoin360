from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from .auth import require_user
from ..schemas.client_user import (
    ClientUserCreate,
    ClientUserListResponse,
    ClientUserPasswordReset,
    ClientUserResponse,
    ClientUserUpdate,
)
from ..services.client_users import (
    create_client_user,
    delete_client_user,
    get_client_user,
    list_client_users,
    reset_client_user_password,
    update_client_user,
)


router = APIRouter(prefix="/users", tags=["client users"])


def _not_found_error(exc: LookupError):
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


def _conflict_error(exc: ValueError):
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


@router.get("", response_model=ClientUserListResponse)
async def fetch_client_users(
    organization_id: int | None = Query(default=None, gt=0),
    _user=Depends(require_user),
):
    users = list_client_users(organization_id)
    return {"count": len(users), "data": users}


@router.post("", response_model=ClientUserResponse, status_code=status.HTTP_201_CREATED)
async def add_client_user(request: ClientUserCreate, _user=Depends(require_user)):
    try:
        return create_client_user(request.model_dump())
    except LookupError as exc:
        raise _not_found_error(exc) from exc
    except ValueError as exc:
        raise _conflict_error(exc) from exc


@router.get("/{user_id}", response_model=ClientUserResponse)
async def fetch_client_user(user_id: int, _user=Depends(require_user)):
    try:
        return get_client_user(user_id)
    except LookupError as exc:
        raise _not_found_error(exc) from exc


@router.patch("/{user_id}", response_model=ClientUserResponse)
async def edit_client_user(user_id: int, request: ClientUserUpdate, _user=Depends(require_user)):
    try:
        return update_client_user(
            user_id,
            request.model_dump(exclude_unset=True),
        )
    except LookupError as exc:
        raise _not_found_error(exc) from exc
    except ValueError as exc:
        raise _conflict_error(exc) from exc


@router.put("/{user_id}", response_model=ClientUserResponse)
async def replace_client_user(user_id: int, request: ClientUserUpdate, _user=Depends(require_user)):
    return await edit_client_user(user_id, request, _user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_client_user(user_id: int, _user=Depends(require_user)):
    try:
        delete_client_user(user_id)
    except LookupError as exc:
        raise _not_found_error(exc) from exc

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{user_id}/reset-password", response_model=ClientUserResponse)
async def reset_client_user_password_route(
    user_id: int,
    request: ClientUserPasswordReset,
    _user=Depends(require_user),
):
    try:
        return reset_client_user_password(user_id, request.password)
    except LookupError as exc:
        raise _not_found_error(exc) from exc
