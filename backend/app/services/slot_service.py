# backend/app/services/slot_service.py
# Purpose: generate genuinely available slots for a provider on a given day.

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.repositories import appointment_repository, availability_repository, provider_repository
from app.schemas.slot import SlotOut, SlotsResponse


def compute_slots(
    day: date,
    tz: ZoneInfo,
    duration_minutes: int,
    rules,
    blocked,
    appointments,
    now: datetime,
) -> list[tuple[datetime, datetime]]:
    """Pure slot algorithm (no database), so it is easy to unit test.

    1. Turn each working-hours rule for that weekday into a UTC window.
    2. Cut the window into back-to-back slots of `duration_minutes`
       (a slot that would run past the end of the window is dropped).
    3. Drop slots overlapping a blocked period or an active appointment.
    4. Drop slots that have already started.

    Two ranges overlap when: a.start < b.end AND a.end > b.start,
    so a slot that merely touches a busy period is still available.
    """
    step = timedelta(minutes=duration_minutes)
    busy = [(b.start_at, b.end_at) for b in blocked] + [(a.start_at, a.end_at) for a in appointments]

    slots: list[tuple[datetime, datetime]] = []
    for rule in sorted(rules, key=lambda r: r.start_time):
        # Working hours are wall-clock times in the provider's timezone; step in UTC afterwards.
        window_start = datetime.combine(day, rule.start_time, tzinfo=tz).astimezone(timezone.utc)
        window_end = datetime.combine(day, rule.end_time, tzinfo=tz).astimezone(timezone.utc)

        cursor = window_start
        while cursor + step <= window_end:
            slot_end = cursor + step
            is_future = cursor > now
            is_free = not any(b_start < slot_end and b_end > cursor for b_start, b_end in busy)
            if is_future and is_free:
                slots.append((cursor, slot_end))
            cursor = slot_end
    return slots


def get_available_slots(
    db: Session, provider_id: int, day: date, now: datetime | None = None
) -> SlotsResponse:
    provider = provider_repository.get_by_id(db, provider_id)
    if not provider:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Provider not found")

    tz = ZoneInfo(provider.timezone)
    now = now or datetime.now(timezone.utc)

    slots: list[tuple[datetime, datetime]] = []
    rules = availability_repository.list_for_provider_weekday(db, provider.id, day.weekday())
    if rules:
        # Whole local day expressed in UTC, used to fetch only the relevant busy periods.
        day_start = datetime.combine(day, time.min, tzinfo=tz).astimezone(timezone.utc)
        day_end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=tz).astimezone(timezone.utc)
        blocked = availability_repository.list_blocked_between(db, provider.id, day_start, day_end)
        appointments = appointment_repository.list_for_provider_between(db, provider.id, day_start, day_end)
        slots = compute_slots(
            day, tz, provider.appointment_duration_minutes, rules, blocked, appointments, now
        )

    return SlotsResponse(
        provider_id=provider.id,
        date=day,
        timezone=provider.timezone,
        appointment_duration_minutes=provider.appointment_duration_minutes,
        slots=[SlotOut(start_at=s, end_at=e) for s, e in slots],
    )
