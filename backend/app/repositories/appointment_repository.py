# backend/app/repositories/appointment_repository.py
# Purpose: database queries for appointments, overlap checks and status history.

from datetime import datetime

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from app.models import Appointment, AppointmentHistory, AppointmentStatus


def get_by_id(db: Session, appointment_id: int) -> Appointment | None:
    return db.get(Appointment, appointment_id)


def list_for_customer(db: Session, customer_id: int, skip: int = 0, limit: int = 50) -> list[Appointment]:
    stmt = (
        select(Appointment)
        .where(Appointment.customer_id == customer_id)
        .order_by(Appointment.start_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return list(db.scalars(stmt))


def list_for_provider_between(
    db: Session, provider_id: int, start: datetime, end: datetime
) -> list[Appointment]:
    """Active (booked) appointments of a provider that overlap [start, end). Used for slot generation."""
    stmt = select(Appointment).where(
        Appointment.provider_id == provider_id,
        Appointment.status == AppointmentStatus.booked,
        Appointment.start_at < end,
        Appointment.end_at > start,
    )
    return list(db.scalars(stmt))


def has_overlap(
    db: Session,
    provider_id: int,
    start_at: datetime,
    end_at: datetime,
    exclude_appointment_id: int | None = None,
) -> bool:
    """True if an active appointment overlaps the range. Cancelled ones are ignored.

    Two ranges overlap when: existing.start < new.end AND existing.end > new.start.
    This check alone is NOT safe under concurrency; the booking service must also
    lock the provider row or rely on a database exclusion constraint.
    """
    conditions = [
        Appointment.provider_id == provider_id,
        Appointment.status == AppointmentStatus.booked,
        and_(Appointment.start_at < end_at, Appointment.end_at > start_at),
    ]
    if exclude_appointment_id is not None:
        conditions.append(Appointment.id != exclude_appointment_id)
    return db.scalar(select(Appointment.id).where(*conditions).limit(1)) is not None


def create(db: Session, appointment: Appointment) -> Appointment:
    """Add the appointment and flush to get its id. The caller commits."""
    db.add(appointment)
    db.flush()
    return appointment


def add_history(
    db: Session,
    appointment_id: int,
    old_status: AppointmentStatus | None,
    new_status: AppointmentStatus,
    changed_by: int,
) -> AppointmentHistory:
    entry = AppointmentHistory(
        appointment_id=appointment_id,
        old_status=old_status,
        new_status=new_status,
        changed_by=changed_by,
    )
    db.add(entry)
    db.flush()
    return entry


def list_all(
    db: Session,
    provider_id: int | None = None,
    customer_id: int | None = None,
    status: AppointmentStatus | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    skip: int = 0,
    limit: int = 50,
) -> list[Appointment]:
    """Admin listing with optional filters."""
    stmt = select(Appointment)
    if provider_id is not None:
        stmt = stmt.where(Appointment.provider_id == provider_id)
    if customer_id is not None:
        stmt = stmt.where(Appointment.customer_id == customer_id)
    if status is not None:
        stmt = stmt.where(Appointment.status == status)
    if date_from is not None:
        stmt = stmt.where(Appointment.start_at >= date_from)
    if date_to is not None:
        stmt = stmt.where(Appointment.start_at < date_to)
    stmt = stmt.order_by(Appointment.start_at.desc()).offset(skip).limit(limit)
    return list(db.scalars(stmt))
