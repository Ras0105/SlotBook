# backend/app/routes/providers.py
# Purpose: HTTP endpoints for provider profiles (create, list, view, update own), photo and calendar.

from datetime import date

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile, status
from pydantic import AwareDatetime
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.dependencies.auth import require_role, require_verified_role
from app.models import Role, User
from app.schemas.provider import CalendarEntryOut, ProviderCreate, ProviderOut, ProviderUpdate
from app.schemas.slot import SlotsResponse
from app.services import provider_service, slot_service
from app.services.provider_service import MAX_PHOTO_BYTES

router = APIRouter(prefix="/providers", tags=["providers"])


@router.post("", response_model=ProviderOut, status_code=status.HTTP_201_CREATED)
def create_provider(
    data: ProviderCreate,
    user: User = Depends(require_verified_role(Role.customer, Role.provider)),
    db: Session = Depends(get_db),
):
    return provider_service.create_provider(db, user, data)


@router.get("", response_model=list[ProviderOut])
def list_providers(
    search: str | None = Query(default=None, max_length=100),
    category: str | None = Query(default=None, max_length=32, description="e.g. dentist, tutor"),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    return provider_service.list_providers(db, search=search, category=category, skip=skip, limit=limit)


# Declared before "/{provider_id}" so "me" is never parsed as an id.
@router.get("/me", response_model=ProviderOut)
def get_my_profile(
    user: User = Depends(require_role(Role.provider)),
    db: Session = Depends(get_db),
):
    return provider_service.get_my_profile(db, user)


@router.patch("/me", response_model=ProviderOut)
def update_my_profile(
    data: ProviderUpdate,
    user: User = Depends(require_role(Role.provider)),
    db: Session = Depends(get_db),
):
    return provider_service.update_my_profile(db, user, data)


@router.get("/me/calendar", response_model=list[CalendarEntryOut])
def get_my_calendar(
    start: AwareDatetime = Query(description="Start of the range (inclusive), e.g. 2026-11-16T00:00:00Z"),
    end: AwareDatetime = Query(description="End of the range (exclusive); at most 62 days after start"),
    user: User = Depends(require_role(Role.provider)),
    db: Session = Depends(get_db),
):
    """The logged-in provider's booked and completed appointments in a date range, with customer names."""
    appointments = provider_service.get_my_calendar(db, user, start, end)
    return [
        CalendarEntryOut(
            id=a.id,
            customer_id=a.customer_id,
            customer_name=a.customer.name,
            start_at=a.start_at,
            end_at=a.end_at,
            status=a.status,
            notes=a.notes,
        )
        for a in appointments
    ]


@router.post("/me/photo", response_model=ProviderOut)
async def upload_my_photo(
    file: UploadFile = File(description="JPEG, PNG or WebP, 512 KB at most"),
    user: User = Depends(require_role(Role.provider)),
    db: Session = Depends(get_db),
):
    # Read one byte more than allowed, so an oversized file is noticed without loading all of it.
    data = await file.read(MAX_PHOTO_BYTES + 1)
    return provider_service.set_my_photo(db, user, data)


@router.delete("/me/photo", response_model=ProviderOut)
def delete_my_photo(
    user: User = Depends(require_role(Role.provider)),
    db: Session = Depends(get_db),
):
    return provider_service.remove_my_photo(db, user)


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


@router.get("/{provider_id}/photo", response_class=Response, responses={200: {"content": {"image/*": {}}}})
def get_provider_photo(provider_id: int, db: Session = Depends(get_db)):
    data, content_type = provider_service.get_photo(db, provider_id)
    # The URL in ProviderOut carries ?v=<timestamp>, so a long cache is safe: a new photo means a new URL.
    return Response(content=data, media_type=content_type, headers={"Cache-Control": "public, max-age=86400"})
