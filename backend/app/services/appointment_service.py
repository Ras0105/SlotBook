# backend/app/services/appointment_service.py
# Purpose: booking lifecycle rules: book, view, list, cancel, reschedule (transactions + double-booking protection).

from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Appointment, AppointmentStatus, Provider, Role, User
from app.repositories import appointment_repository, availability_repository, provider_repository
from app.schemas.appointment import AppointmentCreate, AppointmentReschedule
from app.services.slot_service import compute_slots

_NEVER = datetime.min.replace(tzinfo=timezone.utc)  # "now" that never filters anything out


# ---------------------------------------------------------------- helpers

def _can_access(user: User, appointment: Appointment) -> bool:
    """The customer, the provider who owns the appointment, or an admin."""
    return (
        user.role == Role.admin
        or user.id == appointment.customer_id
        or user.id == appointment.provider.user_id
    )


def _get_accessible(db: Session, user: User, appointment_id: int) -> Appointment:
    appointment = appointment_repository.get_by_id(db, appointment_id)
    if not appointment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Appointment not found")
    if not _can_access(user, appointment):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this appointment")
    return appointment


def _validate_slot(
    db: Session,
    provider: Provider,
    start_at: datetime,
    now: datetime,
    exclude_appointment_id: int | None = None,
) -> datetime:
    """Check that [start_at, start_at + duration) is a real, free slot. Returns the end time.

    422: the request itself is not a valid slot (past, off the slot grid, outside working hours).
    409: it is a valid slot but already taken or blocked.

    Must be called while holding lock_provider(), otherwise the "free" result can be stale.
    """
    if start_at <= now:
        raise HTTPException(422, "Cannot book a time in the past")

    tz = ZoneInfo(provider.timezone)
    duration = provider.appointment_duration_minutes
    end_at = start_at + timedelta(minutes=duration)
    day = start_at.astimezone(tz).date()  # the provider's local day

    rules = availability_repository.list_for_provider_weekday(db, provider.id, day.weekday())

    # Slots the provider offers at all (ignoring bookings and blocks).
    offered = compute_slots(day, tz, duration, rules, [], [], _NEVER)
    if (start_at, end_at) not in offered:
        raise HTTPException(422, "Not a valid slot: outside working hours or not aligned to a slot start")

    # Slots that are actually free right now.
    day_start = datetime.combine(day, time.min, tzinfo=tz).astimezone(timezone.utc)
    day_end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=tz).astimezone(timezone.utc)
    blocked = availability_repository.list_blocked_between(db, provider.id, day_start, day_end)
    appointments = [
        a
        for a in appointment_repository.list_for_provider_between(db, provider.id, day_start, day_end)
        if a.id != exclude_appointment_id
    ]
    free = compute_slots(day, tz, duration, rules, blocked, appointments, now)
    if (start_at, end_at) not in free:
        raise HTTPException(status.HTTP_409_CONFLICT, "This slot is no longer available")

    return end_at


# ---------------------------------------------------------------- queries

def get_appointment(db: Session, user: User, appointment_id: int) -> Appointment:
    return _get_accessible(db, user, appointment_id)


def list_my_appointments(
    db: Session,
    user: User,
    status_filter: AppointmentStatus | None = None,
    skip: int = 0,
    limit: int = 50,
) -> list[Appointment]:
    provider = provider_repository.get_by_user_id(db, user.id)
    return appointment_repository.list_for_user(
        db,
        user.id,
        provider_id=provider.id if provider else None,
        status=status_filter,
        skip=skip,
        limit=limit,
    )


# ---------------------------------------------------------------- commands

def create_appointment(
    db: Session, user: User, data: AppointmentCreate, now: datetime | None = None
) -> Appointment:
    now = now or datetime.now(timezone.utc)
    try:
        # 1. Serialise bookings per provider (lock held until commit/rollback).
        provider = appointment_repository.lock_provider(db, data.provider_id)
        if not provider:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Provider not found")
        if provider.user_id == user.id:
            raise HTTPException(422, "You cannot book your own services")

        # 2. Validate and check availability while holding the lock.
        end_at = _validate_slot(db, provider, data.start_at, now)

        # 3. Insert appointment + initial history in the same transaction.
        appointment = Appointment(
            customer_id=user.id,
            provider_id=provider.id,
            start_at=data.start_at,
            end_at=end_at,
            status=AppointmentStatus.booked,
        )
        appointment_repository.create(db, appointment)
        appointment_repository.add_history(
            db, appointment.id, None, AppointmentStatus.booked, user.id, note="Appointment booked"
        )
        db.commit()
    except HTTPException:
        db.rollback()  # release the lock right away
        raise
    except IntegrityError:
        # Safety net: a database constraint (e.g. an exclusion constraint) rejected the insert.
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "This slot is no longer available")

    db.refresh(appointment)
    return appointment


def cancel_appointment(
    db: Session, user: User, appointment_id: int, now: datetime | None = None
) -> Appointment:
    now = now or datetime.now(timezone.utc)
    try:
        _get_accessible(db, user, appointment_id)  # 404 / 403
        appointment = appointment_repository.get_by_id_for_update(db, appointment_id)

        if appointment.status != AppointmentStatus.booked:
            raise HTTPException(
                status.HTTP_409_CONFLICT, f"Only booked appointments can be cancelled (this one is {appointment.status.value})"
            )
        if appointment.start_at <= now:
            raise HTTPException(status.HTTP_409_CONFLICT, "This appointment has already started")

        appointment.status = AppointmentStatus.cancelled  # a cancelled appointment no longer blocks the slot
        appointment_repository.add_history(
            db, appointment.id, AppointmentStatus.booked, AppointmentStatus.cancelled, user.id, note="Cancelled"
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise

    db.refresh(appointment)
    return appointment


def reschedule_appointment(
    db: Session,
    user: User,
    appointment_id: int,
    data: AppointmentReschedule,
    now: datetime | None = None,
) -> Appointment:
    """Move a booked appointment to another free slot of the same provider.

    Only the customer who booked it (or an admin) may reschedule; a provider can cancel instead.
    """
    now = now or datetime.now(timezone.utc)
    try:
        appointment = appointment_repository.get_by_id(db, appointment_id)
        if not appointment:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Appointment not found")
        if user.role != Role.admin and user.id != appointment.customer_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the customer who booked can reschedule")

        # Same lock order as booking (provider first, then appointment) to avoid deadlocks.
        provider = appointment_repository.lock_provider(db, appointment.provider_id)
        appointment = appointment_repository.get_by_id_for_update(db, appointment_id)  # re-check under lock

        if appointment.status != AppointmentStatus.booked:
            raise HTTPException(
                status.HTTP_409_CONFLICT, f"Only booked appointments can be rescheduled (this one is {appointment.status.value})"
            )
        if appointment.start_at <= now:
            raise HTTPException(status.HTTP_409_CONFLICT, "This appointment has already started")
        if data.new_start_at == appointment.start_at:
            raise HTTPException(422, "The appointment is already at that time")

        new_end = _validate_slot(
            db, provider, data.new_start_at, now, exclude_appointment_id=appointment.id
        )

        old_start = appointment.start_at
        appointment.start_at = data.new_start_at
        appointment.end_at = new_end
        appointment_repository.add_history(
            db,
            appointment.id,
            AppointmentStatus.booked,
            AppointmentStatus.booked,
            user.id,
            note=f"Rescheduled from {old_start.isoformat()} to {data.new_start_at.isoformat()}",
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "This slot is no longer available")

    db.refresh(appointment)
    return appointment
