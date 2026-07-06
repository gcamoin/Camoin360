from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from .auth import require_user
from ..schemas.software_subscription import (
    SoftwareSubscriptionCreate,
    SoftwareSubscriptionListResponse,
    SoftwareSubscriptionResponse,
    SoftwareSubscriptionUpdate,
)
from ..services.software_subscriptions import (
    create_software_subscription,
    delete_software_subscription,
    get_software_subscription,
    list_software_subscriptions,
    update_software_subscription,
)


router = APIRouter(prefix="/software-subscriptions", tags=["software-subscriptions"])


def _not_found_error(exc: LookupError):
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.get("", response_model=SoftwareSubscriptionListResponse)
async def fetch_software_subscriptions(
    limit: int = Query(default=1000, ge=1, le=5000),
    _user=Depends(require_user),
):
    subscriptions = list_software_subscriptions()[:limit]

    return {"count": len(subscriptions), "data": subscriptions}


@router.post(
    "",
    response_model=SoftwareSubscriptionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_software_subscription(
    request: SoftwareSubscriptionCreate,
    _user=Depends(require_user),
):
    return create_software_subscription(request.model_dump())


@router.get("/{subscription_id}", response_model=SoftwareSubscriptionResponse)
async def fetch_software_subscription(subscription_id: int, _user=Depends(require_user)):
    try:
        return get_software_subscription(subscription_id)
    except LookupError as exc:
        raise _not_found_error(exc) from exc


@router.patch("/{subscription_id}", response_model=SoftwareSubscriptionResponse)
async def edit_software_subscription(
    subscription_id: int,
    request: SoftwareSubscriptionUpdate,
    _user=Depends(require_user),
):
    try:
        return update_software_subscription(
            subscription_id,
            request.model_dump(exclude_unset=True),
        )
    except LookupError as exc:
        raise _not_found_error(exc) from exc


@router.put("/{subscription_id}", response_model=SoftwareSubscriptionResponse)
async def replace_software_subscription(
    subscription_id: int,
    request: SoftwareSubscriptionCreate,
    _user=Depends(require_user),
):
    try:
        return update_software_subscription(subscription_id, request.model_dump())
    except LookupError as exc:
        raise _not_found_error(exc) from exc


@router.delete("/{subscription_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_software_subscription(subscription_id: int, _user=Depends(require_user)):
    try:
        delete_software_subscription(subscription_id)
    except LookupError as exc:
        raise _not_found_error(exc) from exc

    return Response(status_code=status.HTTP_204_NO_CONTENT)
