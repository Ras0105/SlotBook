# backend/app/services/stats_service.py
# Purpose: admin statistics (bookings per day, cancellation rate, busiest providers).

from datetime import datetime, time, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import AppointmentStatus
from app.repositories import appointment_repository
from app.schemas.admin import DayCount, ProviderCount, StatsOut

DEFAULT_WINDOW_DAYS = 30
MAX_WINDOW_DAYS = 366


def get_stats(
    db: Session, date_from: datetime | None = None, date_to: datetime | None = None, now: datetime | None = None
) -> StatsOut:
    """Statistics for appointments STARTING in [date_from, date_to).

    Defaults to the last 30 UTC days including today. The window is capped so one request cannot scan everything.
    """
    now = now or datetime.now(timezone.utc)
    if date_to is None:
        date_to = datetime.combine(now.date() + timedelta(days=1), time.min, tzinfo=timezone.utc)
    if date_from is None:
        date_from = date_to - timedelta(days=DEFAULT_WINDOW_DAYS)
    if date_from >= date_to:
        raise HTTPException(422, "date_from must be before date_to")
    if date_to - date_from > timedelta(days=MAX_WINDOW_DAYS):
        raise HTTPException(422, f"The date range may not be longer than {MAX_WINDOW_DAYS} days")

    counts = appointment_repository.count_by_status(db, date_from, date_to)
    by_status = {status.value: counts.get(status, 0) for status in AppointmentStatus}
    total = sum(by_status.values())
    cancelled = by_status[AppointmentStatus.cancelled.value]

    return StatsOut(
        date_from=date_from,
        date_to=date_to,
        total_appointments=total,
        by_status=by_status,
        cancellation_rate=round(cancelled / total, 4) if total else 0.0,
        bookings_per_day=[DayCount(date=d, count=c) for d, c in appointment_repository.count_per_day(db, date_from, date_to)],
        top_providers=[
            ProviderCount(provider_id=pid, service_name=name, bookings=c)
            for pid, name, c in appointment_repository.top_providers(db, date_from, date_to)
        ],
    )
