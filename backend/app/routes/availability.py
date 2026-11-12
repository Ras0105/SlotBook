# backend/app/routes/availability.py
# Purpose: HTTP endpoints for provider working hours and blocked periods.

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.dependencies.auth import require_role
from app.models import Role, User
from app.schemas.availability import (
    AvailabilityCreate,
    AvailabilityOut,
    AvailabilityUpdate,
    BlockedSlotCreate,
    BlockedSlotOut,
)
from app.services import availability_service

router = APIRouter(tags=["availability"])


@router.post("/availability", response_model=AvailabilityOut, status_code=status.HTTP_201_CREATED)
def create_availability(
    data: AvailabilityCreate,
    user: User = Depends(require_role(Role.provider)),
    db: Session = Depends(get_db),
):
    return availability_service.create_availability(db, user, data)


@router.get("/providers/{provider_id}/availability", response_model=list[AvailabilityOut])
def list_provider_availability(provider_id: int, db: Session = Depends(get_db)):
    return availability_service.list_provider_availability(db, provider_id)


# Declared before "/availability/{availability_id}" routes; POST vs PATCH/DELETE never clash anyway.
@router.post(
    "/availability/blocked-slots",
    response_model=BlockedSlotOut,
    status_code=status.HTTP_201_CREATED,
)
def create_blocked_slot(
    data: BlockedSlotCreate,
    user: User = Depends(require_role(Role.provider)),
    db: Session = Depends(get_db),
):
    return availability_service.create_blocked_slot(db, user, data)


@router.patch("/availability/{availability_id}", response_model=AvailabilityOut)
def update_availability(
    availability_id: int,
    data: AvailabilityUpdate,
    user: User = Depends(require_role(Role.provider)),
    db: Session = Depends(get_db),
):
    return availability_service.update_availability(db, user, availability_id, data)


@router.delete("/availability/{availability_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_availability(
    availability_id: int,
    user: User = Depends(require_role(Role.provider)),
    db: Session = Depends(get_db),
):
    availability_service.delete_availability(db, user, availability_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
