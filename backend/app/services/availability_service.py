# backend/app/services/availability_service.py
# Purpose: business rules for working hours and blocked periods (ownership, overlaps, validation).
#
# Concurrency: every write here is ONE transaction that first takes the provider row lock
# (appointment_repository.lock_provider), the same lock that booking/rescheduling take. So
#   - "check for overlap, then insert" cannot interleave with another availability change, and
#   - a blocked slot cannot be created while a booking for that provider is half-way through.
# Lock order is always: provider row first, then anything else. That prevents deadlocks.

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.database.errors import translate_db_errors
from app.database.transaction import transaction
from app.models import Availability, BlockedSlot, Provider, User
from app.repositories import appointment_repository, availability_repository, provider_repository
from app.schemas.availability import AvailabilityCreate, AvailabilityUpdate, BlockedSlotCreate

_OVERLAP_MESSAGE = "Working hours overlap an existing rule on that weekday"


def _get_my_locked_provider(db: Session, user: User) -> Provider:
    """The caller's provider profile, with its row locked until the transaction ends."""
    provider = provider_repository.get_by_user_id(db, user.id)
    if not provider:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "You do not have a provider profile")
    locked = appointment_repository.lock_provider(db, provider.id)
    if not locked:  # deleted between the two statements
        raise HTTPException(status.HTTP_404_NOT_FOUND, "You do not have a provider profile")
    return locked


def _get_owned_rule(db: Session, provider: Provider, availability_id: int) -> Availability:
    # Called after the lock is held, so this is a fresh read, not a stale cached row.
    rule = availability_repository.get_by_id(db, availability_id)
    if not rule:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Availability rule not found")
    if rule.provider_id != provider.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This availability rule belongs to another provider")
    return rule


def _ensure_no_overlap(db: Session, provider_id, weekday, start_time, end_time, exclude_id=None) -> None:
    if availability_repository.find_overlapping(db, provider_id, weekday, start_time, end_time, exclude_id):
        raise HTTPException(status.HTTP_409_CONFLICT, _OVERLAP_MESSAGE)


def create_availability(db: Session, user: User, data: AvailabilityCreate) -> Availability:
    with translate_db_errors(_OVERLAP_MESSAGE), transaction(db):
        provider = _get_my_locked_provider(db, user)
        _ensure_no_overlap(db, provider.id, data.weekday, data.start_time, data.end_time)

        rule = Availability(
            provider_id=provider.id,
            weekday=data.weekday,
            start_time=data.start_time,
            end_time=data.end_time,
        )
        availability_repository.create(db, rule)
    db.refresh(rule)
    return rule


def list_provider_availability(db: Session, provider_id: int) -> list[Availability]:
    if not provider_repository.get_by_id(db, provider_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Provider not found")
    return availability_repository.list_for_provider(db, provider_id)


def update_availability(
    db: Session, user: User, availability_id: int, data: AvailabilityUpdate
) -> Availability:
    with translate_db_errors(_OVERLAP_MESSAGE), transaction(db):
        provider = _get_my_locked_provider(db, user)
        rule = _get_owned_rule(db, provider, availability_id)

        # Explicit nulls are ignored (columns are NOT NULL).
        changes = data.model_dump(exclude_unset=True, exclude_none=True)
        weekday = changes.get("weekday", rule.weekday)
        start_time = changes.get("start_time", rule.start_time)
        end_time = changes.get("end_time", rule.end_time)

        # The merged result must still be valid, even if each field was valid on its own.
        if start_time >= end_time:
            raise HTTPException(422, "start_time must be before end_time")
        _ensure_no_overlap(db, provider.id, weekday, start_time, end_time, exclude_id=rule.id)

        for field, value in changes.items():
            setattr(rule, field, value)
        db.flush()  # run the UPDATE now so a database constraint error surfaces inside the transaction
    db.refresh(rule)
    return rule


def delete_availability(db: Session, user: User, availability_id: int) -> None:
    with translate_db_errors(), transaction(db):
        provider = _get_my_locked_provider(db, user)
        rule = _get_owned_rule(db, provider, availability_id)
        availability_repository.delete(db, rule)


def create_blocked_slot(db: Session, user: User, data: BlockedSlotCreate) -> BlockedSlot:
    with translate_db_errors("Existing appointments overlap this period"), transaction(db):
        provider = _get_my_locked_provider(db, user)

        # Booking holds the same provider lock, so no appointment can slip in between this check and the insert.
        # Do not silently block time that already has booked customers.
        if appointment_repository.has_overlap(db, provider.id, data.start_at, data.end_at):
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Existing appointments overlap this period; cancel or reschedule them first",
            )

        slot = BlockedSlot(
            provider_id=provider.id,
            start_at=data.start_at,
            end_at=data.end_at,
            reason=data.reason,
        )
        availability_repository.create_blocked_slot(db, slot)
    db.refresh(slot)
    return slot


def list_my_blocked_slots(db: Session, user: User, include_past: bool = False) -> list[BlockedSlot]:
    """The caller's blocked periods, soonest first. Periods already over are hidden unless asked for."""
    provider = provider_repository.get_by_user_id(db, user.id)
    if not provider:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "You do not have a provider profile")
    ends_after = None if include_past else datetime.now(timezone.utc)
    return availability_repository.list_blocked_for_provider(db, provider.id, ends_after)


def delete_blocked_slot(db: Session, user: User, blocked_slot_id: int) -> None:
    """Remove one of the caller's blocked periods (the time becomes bookable again)."""
    with translate_db_errors(), transaction(db):
        provider = _get_my_locked_provider(db, user)
        slot = availability_repository.get_blocked_by_id(db, blocked_slot_id)
        if not slot:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Blocked period not found")
        if slot.provider_id != provider.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "This blocked period belongs to another provider")
        availability_repository.delete_blocked_slot(db, slot)
