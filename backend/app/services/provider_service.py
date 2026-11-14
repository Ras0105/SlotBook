# backend/app/services/provider_service.py
# Purpose: business rules for provider profiles (create, read, update own profile).

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Appointment, Provider, Role, User
from app.repositories import appointment_repository, provider_repository
from app.schemas.provider import CATEGORIES, ProviderCreate, ProviderUpdate

# Photos are resized by the browser before upload, so this is generous. They are stored in the database.
MAX_PHOTO_BYTES = 512 * 1024
MAX_CALENDAR_DAYS = 62


def create_provider(db: Session, user: User, data: ProviderCreate) -> Provider:
    """Create the user's provider profile. A customer becomes a provider on creation."""
    if provider_repository.get_by_user_id(db, user.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Provider profile already exists")

    provider = Provider(
        user_id=user.id,
        service_name=data.service_name,
        appointment_duration_minutes=data.appointment_duration_minutes,
        timezone=data.timezone,
        description=data.description,
        category=data.category,
    )
    try:
        provider_repository.create(db, provider)
        user.role = Role.provider  # same transaction as the profile insert
        db.commit()
    except IntegrityError:
        # Two simultaneous requests: the unique constraint on user_id caught the second one.
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Provider profile already exists")
    db.refresh(provider)
    return provider


def get_provider(db: Session, provider_id: int) -> Provider:
    provider = provider_repository.get_by_id(db, provider_id)
    if not provider:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Provider not found")
    return provider


def list_providers(
    db: Session,
    search: str | None = None,
    category: str | None = None,
    skip: int = 0,
    limit: int = 50,
) -> list[Provider]:
    if category is not None and category not in CATEGORIES:
        raise HTTPException(422, f"category must be one of: {', '.join(CATEGORIES)}")
    return provider_repository.list_providers(db, search=search, category=category, skip=skip, limit=limit)


def get_my_profile(db: Session, user: User) -> Provider:
    provider = provider_repository.get_by_user_id(db, user.id)
    if not provider:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "You do not have a provider profile")
    return provider


def update_my_profile(db: Session, user: User, data: ProviderUpdate) -> Provider:
    provider = provider_repository.get_by_user_id(db, user.id)
    if not provider:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "You do not have a provider profile")

    # Only apply fields the client actually sent; explicit nulls are ignored (columns are NOT NULL).
    changes = data.model_dump(exclude_unset=True, exclude_none=True)
    for field, value in changes.items():
        setattr(provider, field, value)
    # The description is the one nullable field: sending "" (which the schema turns into None) clears it.
    if "description" in data.model_fields_set and data.description is None:
        provider.description = None

    db.commit()
    db.refresh(provider)
    return provider


# ---------------------------------------------------------------- photo

# (content type, the bytes every file of that type starts with). Checking the content, not just the
# header the browser sent, stops someone from storing a non-image under an image content type.
_SIGNATURES = (
    ("image/jpeg", b"\xff\xd8\xff"),
    ("image/png", b"\x89PNG\r\n\x1a\n"),
)


def _detect_image_type(data: bytes) -> str | None:
    for content_type, signature in _SIGNATURES:
        if data.startswith(signature):
            return content_type
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def set_my_photo(db: Session, user: User, data: bytes) -> Provider:
    provider = get_my_profile(db, user)
    if not data:
        raise HTTPException(422, "The photo is empty")
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "The photo is too large (512 KB at most)")
    content_type = _detect_image_type(data)
    if content_type is None:
        raise HTTPException(422, "The photo must be a JPEG, PNG or WebP image")
    provider.photo_data = data
    provider.photo_content_type = content_type
    provider.photo_updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(provider)
    return provider


def remove_my_photo(db: Session, user: User) -> Provider:
    provider = get_my_profile(db, user)
    provider.photo_data = None
    provider.photo_content_type = None
    provider.photo_updated_at = None
    db.commit()
    db.refresh(provider)
    return provider


def get_photo(db: Session, provider_id: int) -> tuple[bytes, str]:
    provider = provider_repository.get_with_photo(db, provider_id)
    if not provider or not provider.photo_data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This provider has no photo")
    return provider.photo_data, provider.photo_content_type or "image/jpeg"


# ---------------------------------------------------------------- calendar

def get_my_calendar(db: Session, user: User, start: datetime, end: datetime) -> list[Appointment]:
    """The provider's own non-cancelled appointments in [start, end)."""
    provider = get_my_profile(db, user)
    if start >= end:
        raise HTTPException(422, "start must be before end")
    if end - start > timedelta(days=MAX_CALENDAR_DAYS):
        raise HTTPException(422, f"Ask for at most {MAX_CALENDAR_DAYS} days at a time")
    return appointment_repository.list_calendar(db, provider.id, start, end)
