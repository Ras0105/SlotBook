# backend/tests/helpers.py
# Purpose: helpers shared by API, reliability and concurrency tests (login, seeding, parallel runner).

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta, timezone
from threading import Barrier

from fastapi import HTTPException

from app.models import Availability, Provider, Role, User
from app.schemas.appointment import AppointmentCreate
from app.services import appointment_service


def auth_headers(client, email: str, name: str = "Test User", password: str = "password123") -> dict:
    client.post("/auth/register", json={"name": name, "email": email, "password": password})
    response = client.post("/auth/login", data={"username": email, "password": password})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def future_day(days_ahead: int = 7) -> date:
    return datetime.now(timezone.utc).date() + timedelta(days=days_ahead)


def utc(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=timezone.utc)


def iso(day: date, hour: int, minute: int = 0) -> str:
    return utc(day, hour, minute).isoformat()


def seed_provider(session_factory, n_customers: int = 0, suffix: str = "", duration: int = 30) -> dict:
    """Provider working 09:00-12:00 UTC on a day one week ahead, plus `n_customers` customers."""
    day = future_day(7)
    with session_factory() as s:
        owner = User(name="Owner", email=f"owner{suffix}@t.com", password_hash="x", role=Role.provider)
        customers = [
            User(name=f"C{i}", email=f"c{i}{suffix}@t.com", password_hash="x", role=Role.customer)
            for i in range(n_customers)
        ]
        s.add_all([owner, *customers])
        s.flush()
        provider = Provider(
            user_id=owner.id, service_name="Service", appointment_duration_minutes=duration, timezone="UTC"
        )
        s.add(provider)
        s.flush()
        s.add(Availability(provider_id=provider.id, weekday=day.weekday(), start_time=time(9), end_time=time(12)))
        s.commit()
        return {
            "day": day,
            "provider_id": provider.id,
            "owner_id": owner.id,
            "customer_ids": [c.id for c in customers],
        }


def book_via_service(session_factory, customer_id: int, provider_id: int, start: datetime) -> int:
    """Book a slot through the service layer; returns the appointment id."""
    with session_factory() as s:
        user = s.get(User, customer_id)
        appt = appointment_service.create_appointment(s, user, AppointmentCreate(provider_id=provider_id, start_at=start))
        return appt.id


def run_parallel(session_factory, jobs) -> list:
    """Run each job(session, ) in its own thread + DB connection, all released at the same instant.

    Each job receives a fresh Session. Returns "ok" or the HTTP status code of the HTTPException raised.
    """
    barrier = Barrier(len(jobs))

    def runner(job):
        barrier.wait()
        with session_factory() as s:
            try:
                job(s)
                return "ok"
            except HTTPException as exc:
                return exc.status_code

    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        return list(pool.map(runner, jobs))
