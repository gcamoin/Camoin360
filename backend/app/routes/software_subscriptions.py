import logging
from uuid import UUID
import httpx
from pydantic import BaseModel, ConfigDict

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


@router.get("/inventory")
async def fetch_dynamics_software_inventory(
    limit: int = Query(default=1000, ge=1, le=5000),
    _user=Depends(require_user),
):
    from ..services.software_inventory import list_dynamics_services

    try:
        records = await list_dynamics_services(limit)
    except Exception as exc:
        import logging
        logging.getLogger(__name__).exception("Unable to load Dynamics software inventory")
        raise HTTPException(status_code=502, detail="Unable to load software inventory from Dynamics.") from exc
    return {"count": len(records), "data": records}


class InventoryWriteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    values: dict
    etag: str | None = None


async def _inventory_action(operation):
    try:
        return await operation
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        detail = {
            403: "Dynamics denied this operation. Check the application's Dynamics permissions.",
            404: "This service or related record no longer exists in Dynamics. Refresh and try again.",
            412: "This service changed in Dynamics. Refresh the inventory before editing again.",
            400: "Dynamics rejected these values. Check required fields and related records.",
        }.get(code, "Unable to complete this operation in Dynamics.")
        raise HTTPException(status_code=code if code in {400, 403, 404, 412} else 502, detail=detail) from exc
    except Exception as exc:
        logging.getLogger(__name__).exception("Dynamics inventory operation failed")
        raise HTTPException(status_code=502, detail="Unable to complete this operation in Dynamics.") from exc


@router.get("/inventory/editor")
async def fetch_inventory_editor(_user=Depends(require_user)):
    from ..services.software_inventory import inventory_editor
    return await _inventory_action(inventory_editor())


@router.get("/inventory/lookups/{field}")
async def fetch_inventory_lookup(field: str, q: str = Query(default="", max_length=200), _user=Depends(require_user)):
    from ..services.software_inventory import lookup_options
    return await _inventory_action(lookup_options(field, q))


@router.post("/inventory", status_code=201)
async def create_inventory_service(request: InventoryWriteRequest, _user=Depends(require_user)):
    from ..services.software_inventory import write_service
    return await _inventory_action(write_service(values=request.values))


@router.patch("/inventory/{record_id}")
async def update_inventory_service(record_id: UUID, request: InventoryWriteRequest, _user=Depends(require_user)):
    from ..services.software_inventory import write_service
    return await _inventory_action(write_service(values=request.values, record_id=str(record_id), etag=request.etag))


@router.delete("/inventory/{record_id}", status_code=204)
async def delete_inventory_service(record_id: UUID, etag: str | None = Query(default=None), _user=Depends(require_user)):
    from ..services.software_inventory import write_service
    await _inventory_action(write_service(record_id=str(record_id), deleting=True, etag=etag))
    return Response(status_code=204)


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
