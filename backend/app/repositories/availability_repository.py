# backend/app/repositories/availability_repository.py
# Purpose: database queries for weekly availability rules and blocked slots.

from datetime import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Availability, BlockedSlot


def get_by_id(db: Session, availability_id: int) -> Availability | None:
    return db.get(Availability, availability_id)


def list_for_provider(db: Session, provider_id: int) -> list[Availability]:
    stmt = (
        select(Availability)
        .where(Availability.provider_id == provider_id)
        .order_by(Availability.weekday, Availability.start_time)
    )
    return list(db.scalars(stmt))


def find_overlapping(
    db: Session,
    provider_id: int,
    weekday: int,
    start_time: time,
    end_time: time,
    exclude_id: int | None = None,
) -> Availability | None:
    """Return a rule on the same weekday whose hours overlap [start_time, end_time), if any."""
    conditions = [
        Availability.provider_id == provider_id,
        Availability.weekday == weekday,
        Availability.start_time < end_time,
        Availability.end_time > start_time,
    ]
    if exclude_id is not None:
        conditions.append(Availability.id != exclude_id)
    return db.scalar(select(Availability).where(*conditions).limit(1))


def create(db: Session, rule: Availability) -> Availability:
    """Add the rule and flush to get its id. The caller commits."""
    db.add(rule)
    db.flush()
    return rule


def delete(db: Session, rule: Availability) -> None:
    """Mark the rule for deletion. The caller commits."""
    db.delete(rule)


def create_blocked_slot(db: Session, slot: BlockedSlot) -> BlockedSlot:
    """Add the blocked period and flush to get its id. The caller commits."""
    db.add(slot)
    db.flush()
    return slot
