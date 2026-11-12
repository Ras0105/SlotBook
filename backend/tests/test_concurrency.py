# backend/tests/test_concurrency.py
# Purpose: prove simultaneous requests cannot corrupt bookings (real threads, separate DB connections).

import pytest
from sqlalchemy import func, select

from app.models import Appointment, AppointmentHistory, AppointmentStatus, Provider, User
from app.repositories import appointment_repository
from app.schemas.appointment import AppointmentCreate, AppointmentReschedule
from app.services import appointment_service
from tests.helpers import book_via_service, run_parallel, seed_provider, utc

CLIENTS = 8


@pytest.fixture()
def seed(session_factory):
    return seed_provider(session_factory, n_customers=CLIENTS)


def booker(seed, customer_id, hour, minute=0):
    def job(s):
        appointment_service.create_appointment(
            s,
            s.get(User, customer_id),
            AppointmentCreate(provider_id=seed["provider_id"], start_at=utc(seed["day"], hour, minute)),
        )

    return job


def booked_count(session_factory, provider_id, start):
    with session_factory() as s:
        return s.scalar(
            select(func.count())
            .select_from(Appointment)
            .where(
                Appointment.provider_id == provider_id,
                Appointment.start_at == start,
                Appointment.status == AppointmentStatus.booked,
            )
        )


def test_same_slot_only_one_succeeds(session_factory, seed):
    results = run_parallel(session_factory, [booker(seed, c, 9) for c in seed["customer_ids"]])
    assert results.count("ok") == 1
    assert results.count(409) == CLIENTS - 1
    assert booked_count(session_factory, seed["provider_id"], utc(seed["day"], 9)) == 1


def test_different_slots_all_succeed(session_factory, seed):
    """The lock must serialise bookings, not reject unrelated ones."""
    hours = [(9, 0), (9, 30), (10, 0), (10, 30), (11, 0), (11, 30)]
    jobs = [booker(seed, c, h, m) for c, (h, m) in zip(seed["customer_ids"], hours)]
    assert run_parallel(session_factory, jobs) == ["ok"] * len(hours)


def test_database_constraint_is_a_safety_net_when_the_lock_is_bypassed(session_factory, seed, monkeypatch):
    """Remove the application lock: the PostgreSQL exclusion constraint alone must still stop double booking."""
    monkeypatch.setattr(appointment_repository, "lock_provider", lambda db, pid: db.get(Provider, pid))
    results = run_parallel(session_factory, [booker(seed, c, 9) for c in seed["customer_ids"]])
    assert results.count("ok") == 1
    assert results.count(409) == CLIENTS - 1
    assert booked_count(session_factory, seed["provider_id"], utc(seed["day"], 9)) == 1


def test_concurrent_cancels_succeed_only_once(session_factory, seed):
    appt_id = book_via_service(session_factory, seed["customer_ids"][0], seed["provider_id"], utc(seed["day"], 9))

    def cancel(s):
        appointment_service.cancel_appointment(s, s.get(User, seed["customer_ids"][0]), appt_id)

    results = run_parallel(session_factory, [cancel] * 4)
    assert results.count("ok") == 1
    assert results.count(409) == 3
    with session_factory() as s:
        cancelled_entries = s.scalar(
            select(func.count())
            .select_from(AppointmentHistory)
            .where(AppointmentHistory.appointment_id == appt_id, AppointmentHistory.new_status == AppointmentStatus.cancelled)
        )
        assert cancelled_entries == 1  # history is not duplicated by the race


def test_two_reschedules_into_the_same_slot_only_one_wins(session_factory, seed):
    day, pid = seed["day"], seed["provider_id"]
    a = book_via_service(session_factory, seed["customer_ids"][0], pid, utc(day, 9))
    b = book_via_service(session_factory, seed["customer_ids"][1], pid, utc(day, 9, 30))

    def mover(customer_id, appt_id):
        def job(s):
            appointment_service.reschedule_appointment(
                s, s.get(User, customer_id), appt_id, AppointmentReschedule(new_start_at=utc(day, 11))
            )

        return job

    results = run_parallel(
        session_factory, [mover(seed["customer_ids"][0], a), mover(seed["customer_ids"][1], b)]
    )
    assert results.count("ok") == 1 and results.count(409) == 1
    assert booked_count(session_factory, pid, utc(day, 11)) == 1


def test_booking_and_reschedule_race_for_the_same_slot(session_factory, seed):
    day, pid = seed["day"], seed["provider_id"]
    a = book_via_service(session_factory, seed["customer_ids"][0], pid, utc(day, 9))

    def mover(s):
        appointment_service.reschedule_appointment(
            s, s.get(User, seed["customer_ids"][0]), a, AppointmentReschedule(new_start_at=utc(day, 11))
        )

    results = run_parallel(session_factory, [mover, booker(seed, seed["customer_ids"][1], 11)])
    assert results.count("ok") == 1 and results.count(409) == 1
    assert booked_count(session_factory, pid, utc(day, 11)) == 1
