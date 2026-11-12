# backend/tests/test_concurrency.py
# Purpose: prove that simultaneous bookings for one slot cannot both succeed (separate DB connections).

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, time, timezone
from threading import Barrier

from fastapi import HTTPException
from sqlalchemy import func, select

from app.models import Appointment, Availability, Provider, Role, User
from app.schemas.appointment import AppointmentCreate
from app.services import appointment_service
from tests.helpers import future_day

CLIENTS = 8


def test_concurrent_bookings_of_same_slot_only_one_succeeds(session_factory):
    day = future_day(7)
    start = datetime(day.year, day.month, day.day, 9, 0, tzinfo=timezone.utc)

    with session_factory() as s:
        owner = User(name="Owner", email="owner@t.com", password_hash="x", role=Role.provider)
        customers = [
            User(name=f"C{i}", email=f"c{i}@t.com", password_hash="x", role=Role.customer)
            for i in range(CLIENTS)
        ]
        s.add_all([owner, *customers])
        s.flush()
        provider = Provider(user_id=owner.id, service_name="Cut", appointment_duration_minutes=30, timezone="UTC")
        s.add(provider)
        s.flush()
        s.add(Availability(provider_id=provider.id, weekday=day.weekday(), start_time=time(9), end_time=time(12)))
        s.commit()
        provider_id = provider.id
        customer_ids = [c.id for c in customers]

    barrier = Barrier(CLIENTS)

    def attempt(customer_id: int):
        barrier.wait()  # fire all requests at the same moment
        with session_factory() as s:
            user = s.get(User, customer_id)
            try:
                appointment_service.create_appointment(
                    s, user, AppointmentCreate(provider_id=provider_id, start_at=start)
                )
                return "ok"
            except HTTPException as exc:
                return exc.status_code

    with ThreadPoolExecutor(max_workers=CLIENTS) as pool:
        results = list(pool.map(attempt, customer_ids))

    assert results.count("ok") == 1
    assert results.count(409) == CLIENTS - 1

    with session_factory() as s:
        booked = s.scalar(select(func.count()).select_from(Appointment).where(Appointment.start_at == start))
        assert booked == 1
