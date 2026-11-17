# backend/app/repositories/provider_repository.py
# Purpose: database queries for providers (no business logic here).

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, undefer

from app.models import Provider


def get_by_id(db: Session, provider_id: int) -> Provider | None:
    return db.get(Provider, provider_id)


def get_by_user_id(db: Session, user_id: int) -> Provider | None:
    return db.scalar(select(Provider).where(Provider.user_id == user_id))


def get_with_photo(db: Session, provider_id: int) -> Provider | None:
    """Like get_by_id, but also loads the (normally deferred) photo bytes."""
    return db.scalar(
        select(Provider).where(Provider.id == provider_id).options(undefer(Provider.photo_data))
    )


def list_providers(
    db: Session,
    search: str | None = None,
    category: str | None = None,
    skip: int = 0,
    limit: int = 50,
) -> list[Provider]:
    stmt = select(Provider)
    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(or_(Provider.service_name.ilike(pattern), Provider.description.ilike(pattern)))
    if category:
        stmt = stmt.where(Provider.category == category)
    stmt = stmt.order_by(Provider.id).offset(skip).limit(limit)
    return list(db.scalars(stmt))


def create(db: Session, provider: Provider) -> Provider:
    """Add the provider and flush to get its id. The caller commits."""
    db.add(provider)
    db.flush()
    return provider
