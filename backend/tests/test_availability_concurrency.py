# backend/tests/test_availability_concurrency.py
# Purpose: availability writes (working hours, blocked periods) are safe against races with bookings
# and with each other, and the database itself rejects invalid / overlapping working-hour rules.

from datetime import time

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.models import Availability, BlockedSlot, User
from app.repositories import appointment_repository
from app.schemas.appointment import AppointmentCreate
from app.schemas.availability import AvailabilityCreate, AvailabilityUpdate, BlockedSlotCreate
from app.services import appointment_service, availability_service
from tests.helpers import run_parallel, seed_provider, utc

ROUNDS = 6


@pytest.fixture()
def seed(session_factory):
    return seed_provider(session_factory, n_customers=4)


def block_job(seed, start_hour, end_hour):
    def job(s):
        availability_service.create_blocked_slot(
            s,
            s.get(User, seed["owner_id"]),
            BlockedSlotCreate(start_at=utc(seed["day"], start_hour), end_at=utc(seed["day"], end_hour)),
        )

    return job


def book_job(seed, customer_id, hour):
    def job(s):
        appointment_service.create_appointment(
            s,
            s.get(User, customer_id),
            AppointmentCreate(provider_id=seed["provider_id"], start_at=utc(seed["day"], hour)),
        )

    return job


# ------------------------------------------------------------ blocked slot vs booking

@pytest.mark.parametrize("round_", range(ROUNDS))
def test_booking_and_blocked_slot_race_never_both_succeed(session_factory, round_):
    """A booking inside a period being blocked: exactly one wins, the other gets 409 (never both)."""
    seed = seed_provider(session_factory, n_customers=1, suffix=str(round_))
    results = run_parallel(
        session_factory,
        [book_job(seed, seed["customer_ids"][0], 10), block_job(seed, 9, 11)],
    )
    assert sorted(map(str, results)) == ["409", "ok"], results

    with session_factory() as s:
        blocked = s.scalar(select(func.count()).select_from(BlockedSlot).where(BlockedSlot.provider_id == seed["provider_id"]))
        booked = s.scalar(
            select(func.count())
            .select_from(appointment_service.Appointment)
            .where(appointment_service.Appointment.provider_id == seed["provider_id"])
        )
    assert blocked + booked == 1  # the invariant: a block and a booking never coexist


def test_blocked_slot_waits_for_the_provider_lock(session_factory, seed, monkeypatch):
    """Deterministic proof the blocked-slot path takes the provider lock: it cannot proceed while a booking holds it."""
    monkeypatch.setattr(settings, "lock_timeout_ms", 300)
    holder = session_factory()
    try:
        appointment_repository.lock_provider(holder, seed["provider_id"])  # an in-flight booking
        with session_factory() as s:
            with pytest.raises(HTTPException) as exc:
                block_job(seed, 9, 10)(s)
            assert exc.value.status_code == 503
    finally:
        holder.rollback()
        holder.close()
    with session_factory() as s:
        assert s.scalar(select(func.count()).select_from(BlockedSlot)) == 0  # nothing half-saved
    with session_factory() as s:
        block_job(seed, 9, 10)(s)  # works once the lock is free


def test_availability_writes_wait_for_the_provider_lock(session_factory, seed, monkeypatch):
    monkeypatch.setattr(settings, "lock_timeout_ms", 300)
    with session_factory() as s:
        rule_id = s.scalar(select(Availability.id))
    holder = session_factory()
    try:
        appointment_repository.lock_provider(holder, seed["provider_id"])
        for write in (
            lambda s, u: availability_service.create_availability(
                s, u, AvailabilityCreate(weekday=0, start_time=time(8), end_time=time(9))
            ),
            lambda s, u: availability_service.update_availability(s, u, rule_id, AvailabilityUpdate(end_time=time(11))),
            lambda s, u: availability_service.delete_availability(s, u, rule_id),
        ):
            with session_factory() as s:
                with pytest.raises(HTTPException) as exc:
                    write(s, s.get(User, seed["owner_id"]))
                assert exc.value.status_code == 503
    finally:
        holder.rollback()
        holder.close()


# ------------------------------------------------------------ availability vs availability

def test_concurrent_overlapping_availability_only_one_succeeds(session_factory, seed):
    weekday = (seed["day"].weekday() + 1) % 7  # a weekday that has no rule yet

    def create(start, end):
        def job(s):
            availability_service.create_availability(
                s, s.get(User, seed["owner_id"]), AvailabilityCreate(weekday=weekday, start_time=start, end_time=end)
            )

        return job

    results = run_parallel(
        session_factory,
        [create(time(9), time(12)), create(time(11), time(14)), create(time(10), time(13)), create(time(8), time(10))],
    )
    assert results.count("ok") >= 1
    with session_factory() as s:
        rules = s.scalars(
            select(Availability).where(Availability.weekday == weekday).order_by(Availability.start_time)
        ).all()
    for a, b in zip(rules, rules[1:]):  # whatever won, the stored rules never overlap
        assert a.end_time <= b.start_time
    assert results.count(409) == len(results) - results.count("ok")


def test_concurrent_updates_cannot_create_an_overlap(session_factory, seed):
    weekday = seed["day"].weekday()
    with session_factory() as s:
        first = s.scalar(select(Availability.id))  # 09:00-12:00
        second = Availability(provider_id=seed["provider_id"], weekday=weekday, start_time=time(13), end_time=time(15))
        s.add(second)
        s.commit()
        second_id = second.id

    def update(rule_id, **changes):
        def job(s):
            availability_service.update_availability(
                s, s.get(User, seed["owner_id"]), rule_id, AvailabilityUpdate(**changes)
            )

        return job

    # Rules are 09-12 and 13-15. Alone, extending the first to 13:00 or pulling the second back to 12:00 is fine
    # (the ranges only touch); together they would be 09-13 and 12-15, which overlap.
    results = run_parallel(
        session_factory, [update(first, end_time=time(13)), update(second_id, start_time=time(12))]
    )
    assert results.count("ok") == 1 and results.count(409) == 1


# ------------------------------------------------------------ database-level safeguards

def test_db_rejects_overlapping_working_hours_even_without_the_app_check(session_factory, seed):
    with session_factory() as s:
        s.add(Availability(provider_id=seed["provider_id"], weekday=seed["day"].weekday(), start_time=time(11), end_time=time(13)))
        with pytest.raises(IntegrityError):
            s.flush()


def test_db_allows_touching_working_hours_and_other_weekdays(session_factory, seed):
    wd = seed["day"].weekday()
    with session_factory() as s:
        s.add(Availability(provider_id=seed["provider_id"], weekday=wd, start_time=time(12), end_time=time(15)))  # touches 09-12
        s.add(Availability(provider_id=seed["provider_id"], weekday=(wd + 1) % 7, start_time=time(9), end_time=time(12)))
        s.commit()


@pytest.mark.parametrize("weekday", [-1, 7, 99])
def test_db_rejects_invalid_weekday(session_factory, seed, weekday):
    with session_factory() as s:
        s.add(Availability(provider_id=seed["provider_id"], weekday=weekday, start_time=time(1), end_time=time(2)))
        with pytest.raises(IntegrityError, match="ck_availability_weekday_range"):
            s.flush()


@pytest.mark.parametrize("minutes", [0, -15])
def test_db_rejects_non_positive_appointment_duration(session_factory, minutes):
    from app.models import Provider

    seed = seed_provider(session_factory, suffix="d")
    with session_factory() as s:
        provider = s.get(Provider, seed["provider_id"])
        provider.appointment_duration_minutes = minutes
        with pytest.raises(IntegrityError, match="ck_providers_duration_positive"):
            s.flush()
