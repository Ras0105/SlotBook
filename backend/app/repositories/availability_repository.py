# backend/app/repositories/availability_repository.py
# Purpose: database queries for weekly availability rules and blocked slots.

from datetime import datetime, time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Availability, BlockedSlot


def get_by_id(db: Session, availability_id: int) -> Availability | None:
    return db.get(Availability, availability_id, populate_existing=True)


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


def list_for_provider_weekday(db: Session, provider_id: int, weekday: int) -> list[Availability]:
    stmt = (
        select(Availability)
        .where(Availability.provider_id == provider_id, Availability.weekday == weekday)
        .order_by(Availability.start_time)
    )
    return list(db.scalars(stmt))


def list_blocked_between(
    db: Session, provider_id: int, start: datetime, end: datetime
) -> list[BlockedSlot]:
    """Blocked periods that overlap [start, end)."""
    stmt = select(BlockedSlot).where(
        BlockedSlot.provider_id == provider_id,
        BlockedSlot.start_at < end,
        BlockedSlot.end_at > start,
    )
    return list(db.scalars(stmt))


def list_blocked_for_provider(
    db: Session, provider_id: int, ends_after: datetime | None = None
) -> list[BlockedSlot]:
    """A provider's blocked periods, soonest first. With `ends_after`, periods already over are left out."""
    stmt = select(BlockedSlot).where(BlockedSlot.provider_id == provider_id)
    if ends_after is not None:
        stmt = stmt.where(BlockedSlot.end_at > ends_after)
    return list(db.scalars(stmt.order_by(BlockedSlot.start_at, BlockedSlot.id)))


def get_blocked_by_id(db: Session, blocked_slot_id: int) -> BlockedSlot | None:
    return db.get(BlockedSlot, blocked_slot_id, populate_existing=True)


def delete_blocked_slot(db: Session, slot: BlockedSlot) -> None:
    """Mark the blocked period for deletion. The caller commits."""
    db.delete(slot)
