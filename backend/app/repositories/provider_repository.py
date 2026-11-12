# backend/app/repositories/provider_repository.py
# Purpose: database queries for providers (no business logic here).

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Provider


def get_by_id(db: Session, provider_id: int) -> Provider | None:
    return db.get(Provider, provider_id)


def get_by_user_id(db: Session, user_id: int) -> Provider | None:
    return db.scalar(select(Provider).where(Provider.user_id == user_id))


def list_providers(
    db: Session, search: str | None = None, skip: int = 0, limit: int = 50
) -> list[Provider]:
    stmt = select(Provider)
    if search:
        stmt = stmt.where(Provider.service_name.ilike(f"%{search}%"))
    stmt = stmt.order_by(Provider.id).offset(skip).limit(limit)
    return list(db.scalars(stmt))


def create(db: Session, provider: Provider) -> Provider:
    """Add the provider and flush to get its id. The caller commits."""
    db.add(provider)
    db.flush()
    return provider
