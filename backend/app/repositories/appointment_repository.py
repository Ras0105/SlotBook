# backend/app/repositories/appointment_repository.py
# Purpose: database queries for appointments, row locks, overlap checks and status history.

from datetime import datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.models import Appointment, AppointmentHistory, AppointmentStatus, Provider


def get_by_id(db: Session, appointment_id: int) -> Appointment | None:
    return db.get(Appointment, appointment_id)


def get_by_id_for_update(db: Session, appointment_id: int) -> Appointment | None:
    """Re-read the appointment and lock its row until the transaction ends.

    populate_existing makes sure we see the latest committed values, not a stale cached copy.
    """
    stmt = (
        select(Appointment)
        .where(Appointment.id == appointment_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return db.scalar(stmt)


def lock_provider(db: Session, provider_id: int) -> Provider | None:
    """SELECT ... FOR UPDATE on the provider row.

    Every booking/rescheduling for one provider takes this lock first, so those
    operations run one after another. That makes "check availability, then insert"
    safe: a second request waits, then sees the first request's committed appointment.
    The lock is released on commit or rollback.
    """
    return db.scalar(select(Provider).where(Provider.id == provider_id).with_for_update())


def list_for_user(
    db: Session,
    user_id: int,
    provider_id: int | None = None,
    status: AppointmentStatus | None = None,
    skip: int = 0,
    limit: int = 50,
) -> list[Appointment]:
    """Appointments where the user is the customer, or (if they have a provider profile) the provider."""
    if provider_id is not None:
        ownership = or_(Appointment.customer_id == user_id, Appointment.provider_id == provider_id)
    else:
        ownership = Appointment.customer_id == user_id
    stmt = select(Appointment).where(ownership)
    if status is not None:
        stmt = stmt.where(Appointment.status == status)
    stmt = stmt.order_by(Appointment.start_at.desc(), Appointment.id.desc()).offset(skip).limit(limit)
    return list(db.scalars(stmt))


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


def list_calendar(db: Session, provider_id: int, start: datetime, end: datetime) -> list[Appointment]:
    """Booked and completed appointments of a provider that overlap [start, end), earliest first.

    Cancelled ones are left out: the calendar shows who is actually coming.
    """
    stmt = (
        select(Appointment)
        .where(
            Appointment.provider_id == provider_id,
            Appointment.status != AppointmentStatus.cancelled,
            Appointment.start_at < end,
            Appointment.end_at > start,
        )
        .options(joinedload(Appointment.customer))
        .order_by(Appointment.start_at, Appointment.id)
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
    This check alone is NOT safe under concurrency; callers must hold lock_provider().
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
    note: str | None = None,
) -> AppointmentHistory:
    entry = AppointmentHistory(
        appointment_id=appointment_id,
        old_status=old_status,
        new_status=new_status,
        changed_by=changed_by,
        note=note,
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


def count_by_status(db: Session, start: datetime, end: datetime) -> dict[AppointmentStatus, int]:
    """Appointments starting in [start, end), grouped by status."""
    stmt = (
        select(Appointment.status, func.count())
        .where(Appointment.start_at >= start, Appointment.start_at < end)
        .group_by(Appointment.status)
    )
    return {status: count for status, count in db.execute(stmt)}


def count_per_day(db: Session, start: datetime, end: datetime) -> list[tuple]:
    """(UTC day, number of non-cancelled appointments) for appointments starting in [start, end)."""
    day = func.date(func.timezone("UTC", Appointment.start_at))
    stmt = (
        select(day, func.count())
        .where(
            Appointment.start_at >= start,
            Appointment.start_at < end,
            Appointment.status != AppointmentStatus.cancelled,
        )
        .group_by(day)
        .order_by(day)
    )
    return [(d, c) for d, c in db.execute(stmt)]


def top_providers(db: Session, start: datetime, end: datetime, limit: int = 5) -> list[tuple]:
    """(provider_id, service_name, non-cancelled appointment count), busiest first."""
    count = func.count(Appointment.id)
    stmt = (
        select(Provider.id, Provider.service_name, count)
        .join(Appointment, Appointment.provider_id == Provider.id)
        .where(
            Appointment.start_at >= start,
            Appointment.start_at < end,
            Appointment.status != AppointmentStatus.cancelled,
        )
        .group_by(Provider.id, Provider.service_name)
        .order_by(count.desc(), Provider.id)
        .limit(limit)
    )
    return [(pid, name, c) for pid, name, c in db.execute(stmt)]
