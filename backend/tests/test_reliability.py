# backend/tests/test_reliability.py
# Purpose: transaction atomicity, history, cancellation/rescheduling edge cases, lock timeout.

from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.core.config import settings
from app.models import Appointment, AppointmentHistory, AppointmentStatus, Provider, User
from app.repositories import appointment_repository
from app.schemas.appointment import AppointmentCreate, AppointmentReschedule
from app.services import appointment_service
from tests.helpers import auth_headers, book_via_service, future_day, iso, seed_provider, utc


@pytest.fixture()
def seed(session_factory):
    return seed_provider(session_factory, n_customers=3)


def count(session_factory, model):
    with session_factory() as s:
        return s.scalar(select(func.count()).select_from(model))


# ------------------------------------------------------------ transactions

def test_failure_mid_booking_rolls_back_everything(session_factory, seed, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("simulated crash while writing history")

    monkeypatch.setattr(appointment_repository, "add_history", boom)
    with session_factory() as s:
        user = s.get(User, seed["customer_ids"][0])
        with pytest.raises(RuntimeError):
            appointment_service.create_appointment(
                s, user, AppointmentCreate(provider_id=seed["provider_id"], start_at=utc(seed["day"], 9))
            )
    assert count(session_factory, Appointment) == 0  # no orphan appointment without its history
    assert count(session_factory, AppointmentHistory) == 0


def test_failed_reschedule_changes_nothing(session_factory, seed):
    day, pid = seed["day"], seed["provider_id"]
    appt_id = book_via_service(session_factory, seed["customer_ids"][0], pid, utc(day, 9))
    book_via_service(session_factory, seed["customer_ids"][1], pid, utc(day, 10))

    with session_factory() as s:
        user = s.get(User, seed["customer_ids"][0])
        with pytest.raises(HTTPException) as exc:
            appointment_service.reschedule_appointment(
                s, user, appt_id, AppointmentReschedule(new_start_at=utc(day, 10))  # taken
            )
        assert exc.value.status_code == 409

    with session_factory() as s:
        appt = s.get(Appointment, appt_id)
        assert appt.start_at == utc(day, 9) and appt.status == AppointmentStatus.booked
        assert len(appt.history) == 1  # only the original "booked" entry


def test_lock_timeout_returns_503_instead_of_hanging(session_factory, seed, monkeypatch):
    monkeypatch.setattr(settings, "lock_timeout_ms", 300)
    holder = session_factory()
    try:
        appointment_repository.lock_provider(holder, seed["provider_id"])  # another request holds the lock
        with session_factory() as s:
            user = s.get(User, seed["customer_ids"][0])
            with pytest.raises(HTTPException) as exc:
                appointment_service.create_appointment(
                    s, user, AppointmentCreate(provider_id=seed["provider_id"], start_at=utc(seed["day"], 9))
                )
            assert exc.value.status_code == 503
            assert exc.value.headers == {"Retry-After": "1"}
    finally:
        holder.rollback()
        holder.close()
    # once the lock is released, booking works again
    book_via_service(session_factory, seed["customer_ids"][0], seed["provider_id"], utc(seed["day"], 9))


# ------------------------------------------------------------ overlap rules

def test_partial_overlap_after_duration_change_is_rejected(session_factory, seed):
    """Provider switches 30 -> 45 minute slots; a new slot partly overlapping an old booking must be refused."""
    day, pid = seed["day"], seed["provider_id"]
    book_via_service(session_factory, seed["customer_ids"][0], pid, utc(day, 10))  # 10:00-10:30
    with session_factory() as s:
        s.get(Provider, pid).appointment_duration_minutes = 45
        s.commit()
    with session_factory() as s:
        user = s.get(User, seed["customer_ids"][1])
        with pytest.raises(HTTPException) as exc:  # 09:45-10:30 overlaps 10:00-10:30
            appointment_service.create_appointment(
                s, user, AppointmentCreate(provider_id=pid, start_at=utc(day, 9, 45))
            )
        assert exc.value.status_code == 409


# ------------------------------------------------------------ cancel / reschedule edge cases

def test_cannot_cancel_or_reschedule_after_start(session_factory, seed):
    day, pid = seed["day"], seed["provider_id"]
    start = utc(day, 9)
    appt_id = book_via_service(session_factory, seed["customer_ids"][0], pid, start)
    later = start + timedelta(minutes=1)  # the appointment has begun
    with session_factory() as s:
        user = s.get(User, seed["customer_ids"][0])
        with pytest.raises(HTTPException) as exc:
            appointment_service.cancel_appointment(s, user, appt_id, now=later)
        assert exc.value.status_code == 409
        with pytest.raises(HTTPException) as exc:
            appointment_service.reschedule_appointment(
                s, user, appt_id, AppointmentReschedule(new_start_at=utc(day, 11)), now=later
            )
        assert exc.value.status_code == 409


def test_reschedule_into_blocked_period_or_outside_hours_is_rejected(client, session_factory):
    day = future_day(7)
    provider_h = auth_headers(client, "p@t.com", "P")
    client.post("/providers", json={"service_name": "S"}, headers=provider_h)
    client.post(
        "/availability",
        json={"weekday": day.weekday(), "start_time": "09:00:00", "end_time": "12:00:00"},
        headers=provider_h,
    )
    client.post(
        "/availability/blocked-slots",
        json={"start_at": iso(day, 10), "end_at": iso(day, 11)},
        headers=provider_h,
    )
    alice = auth_headers(client, "a@t.com", "A")
    appt_id = client.post(
        "/appointments", json={"provider_id": 1, "start_at": iso(day, 9)}, headers=alice
    ).json()["id"]

    def resched(hour):
        return client.patch(
            f"/appointments/{appt_id}/reschedule", json={"new_start_at": iso(day, hour)}, headers=alice
        ).status_code

    assert resched(10) == 409  # blocked
    assert resched(14) == 422  # outside working hours
    assert resched(11) == 200  # free slot


# ------------------------------------------------------------ history

def test_full_lifecycle_history(client):
    day = future_day(7)
    provider_h = auth_headers(client, "p@t.com", "P")
    client.post("/providers", json={"service_name": "S"}, headers=provider_h)
    client.post(
        "/availability",
        json={"weekday": day.weekday(), "start_time": "09:00:00", "end_time": "12:00:00"},
        headers=provider_h,
    )
    alice = auth_headers(client, "a@t.com", "A")
    appt_id = client.post(
        "/appointments", json={"provider_id": 1, "start_at": iso(day, 9)}, headers=alice
    ).json()["id"]
    client.patch(f"/appointments/{appt_id}/reschedule", json={"new_start_at": iso(day, 10)}, headers=alice)
    client.patch(f"/appointments/{appt_id}/cancel", headers=provider_h)  # provider cancels

    detail = client.get(f"/appointments/{appt_id}", headers=alice).json()
    history = detail["history"]
    assert [(h["old_status"], h["new_status"]) for h in history] == [
        (None, "booked"),
        ("booked", "booked"),  # reschedule keeps the status, the note records the move
        ("booked", "cancelled"),
    ]
    assert history[1]["note"].startswith("Rescheduled from")
    assert history[2]["changed_by"] != history[0]["changed_by"]  # cancelled by the provider, booked by Alice
    assert detail["status"] == "cancelled"
