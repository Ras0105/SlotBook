# backend/tests/test_db_constraints.py
# Purpose: prove PostgreSQL itself rejects overlapping bookings, whatever the application code does.

from datetime import timedelta

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Appointment, AppointmentStatus
from tests.helpers import seed_provider, utc


def add(s, seed, customer_idx, start, minutes=30, status=AppointmentStatus.booked, provider_id=None):
    s.add(
        Appointment(
            customer_id=seed["customer_ids"][customer_idx],
            provider_id=provider_id or seed["provider_id"],
            start_at=start,
            end_at=start + timedelta(minutes=minutes),
            status=status,
        )
    )
    s.flush()


@pytest.fixture()
def seed(session_factory):
    return seed_provider(session_factory, n_customers=2)


def test_exact_duplicate_is_rejected(session_factory, seed):
    start = utc(seed["day"], 10)
    with session_factory() as s:
        add(s, seed, 0, start)
        with pytest.raises(IntegrityError):
            add(s, seed, 1, start)


def test_partial_overlap_is_rejected(session_factory, seed):
    """10:00-10:30 and 10:15-10:45 have different start times but overlap (a unique key would miss this)."""
    with session_factory() as s:
        add(s, seed, 0, utc(seed["day"], 10))
        with pytest.raises(IntegrityError):
            add(s, seed, 1, utc(seed["day"], 10, 15))


def test_back_to_back_is_allowed(session_factory, seed):
    with session_factory() as s:
        add(s, seed, 0, utc(seed["day"], 10))
        add(s, seed, 1, utc(seed["day"], 10, 30))  # starts exactly when the first ends
        s.commit()


def test_cancelled_appointment_does_not_block(session_factory, seed):
    start = utc(seed["day"], 10)
    with session_factory() as s:
        add(s, seed, 0, start, status=AppointmentStatus.cancelled)
        add(s, seed, 1, start)
        s.commit()


def test_same_time_with_different_provider_is_allowed(session_factory, seed):
    other = seed_provider(session_factory, suffix="2")
    start = utc(seed["day"], 10)
    with session_factory() as s:
        add(s, seed, 0, start)
        add(s, seed, 1, start, provider_id=other["provider_id"])
        s.commit()


def test_end_must_be_after_start(session_factory, seed):
    with session_factory() as s:
        with pytest.raises(IntegrityError):
            add(s, seed, 0, utc(seed["day"], 10), minutes=0)
