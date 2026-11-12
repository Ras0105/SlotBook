# backend/app/services/provider_service.py
# Purpose: business rules for provider profiles (create, read, update own profile).

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Provider, Role, User
from app.repositories import provider_repository
from app.schemas.provider import ProviderCreate, ProviderUpdate


def create_provider(db: Session, user: User, data: ProviderCreate) -> Provider:
    """Create the user's provider profile. A customer becomes a provider on creation."""
    if provider_repository.get_by_user_id(db, user.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Provider profile already exists")

    provider = Provider(
        user_id=user.id,
        service_name=data.service_name,
        appointment_duration_minutes=data.appointment_duration_minutes,
        timezone=data.timezone,
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
    db: Session, search: str | None = None, skip: int = 0, limit: int = 50
) -> list[Provider]:
    return provider_repository.list_providers(db, search=search, skip=skip, limit=limit)


def update_my_profile(db: Session, user: User, data: ProviderUpdate) -> Provider:
    provider = provider_repository.get_by_user_id(db, user.id)
    if not provider:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "You do not have a provider profile")

    # Only apply fields the client actually sent; explicit nulls are ignored (columns are NOT NULL).
    changes = data.model_dump(exclude_unset=True, exclude_none=True)
    for field, value in changes.items():
        setattr(provider, field, value)

    db.commit()
    db.refresh(provider)
    return provider
