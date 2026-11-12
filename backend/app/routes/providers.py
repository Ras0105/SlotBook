# backend/app/routes/providers.py
# Purpose: HTTP endpoints for provider profiles (create, list, view, update own).

from datetime import date

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.dependencies.auth import require_role
from app.models import Role, User
from app.schemas.provider import ProviderCreate, ProviderOut, ProviderUpdate
from app.schemas.slot import SlotsResponse
from app.services import provider_service, slot_service

router = APIRouter(prefix="/providers", tags=["providers"])


@router.post("", response_model=ProviderOut, status_code=status.HTTP_201_CREATED)
def create_provider(
    data: ProviderCreate,
    user: User = Depends(require_role(Role.customer, Role.provider)),
    db: Session = Depends(get_db),
):
    return provider_service.create_provider(db, user, data)


@router.get("", response_model=list[ProviderOut])
def list_providers(
    search: str | None = Query(default=None, max_length=100),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return provider_service.list_providers(db, search=search, skip=skip, limit=limit)


# Declared before "/{provider_id}" so "me" is never parsed as an id.
@router.patch("/me", response_model=ProviderOut)
def update_my_profile(
    data: ProviderUpdate,
    user: User = Depends(require_role(Role.provider)),
    db: Session = Depends(get_db),
):
    return provider_service.update_my_profile(db, user, data)


@router.get("/{provider_id}", response_model=ProviderOut)
def get_provider(provider_id: int, db: Session = Depends(get_db)):
    return provider_service.get_provider(db, provider_id)


@router.get("/{provider_id}/slots", response_model=SlotsResponse)
def get_provider_slots(
    provider_id: int,
    day: date = Query(alias="date", description="YYYY-MM-DD, in the provider's timezone"),
    db: Session = Depends(get_db),
):
    return slot_service.get_available_slots(db, provider_id, day)
