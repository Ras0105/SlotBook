# backend/tests/test_admin_stats.py
# Purpose: GET /admin/stats: numbers are correct, windows and access control behave.

from datetime import datetime, time, timedelta, timezone

import pytest

from app.models import Appointment, AppointmentStatus, Availability, Provider, Role, User
from app.services import stats_service
from tests.helpers import admin_headers, auth_headers, utc


@pytest.fixture()
def admin(client, session_factory):
    return admin_headers(client, session_factory)


def add_appointment(s, customer_id, provider_id, start, status=AppointmentStatus.booked):
    s.add(Appointment(customer_id=customer_id, provider_id=provider_id, start_at=start,
                      end_at=start + timedelta(minutes=30), status=status))
    s.flush()


@pytest.fixture()
def world(session_factory):
    """Two providers and a known set of appointments around 'today'."""
    today = datetime.now(timezone.utc).date()
    d = lambda n: today - timedelta(days=n)
    with session_factory() as s:
        users = [User(name=f"U{i}", email=f"u{i}@t.com", password_hash="x", role=Role.provider if i < 2 else Role.customer) for i in range(4)]
        s.add_all(users); s.flush()
        p1 = Provider(user_id=users[0].id, service_name="Dental", appointment_duration_minutes=30, timezone="UTC")
        p2 = Provider(user_id=users[1].id, service_name="Massage", appointment_duration_minutes=30, timezone="UTC")
        s.add_all([p1, p2]); s.flush()
        c = users[2].id
        B, C, D = AppointmentStatus.booked, AppointmentStatus.cancelled, AppointmentStatus.completed
        add_appointment(s, c, p1.id, utc(d(1), 9), D)
        add_appointment(s, c, p1.id, utc(d(1), 10), C)
        add_appointment(s, c, p1.id, utc(d(1), 11), D)
        add_appointment(s, c, p1.id, utc(d(0), 9), B)
        add_appointment(s, c, p2.id, utc(d(0), 9), B)
        add_appointment(s, c, p2.id, utc(d(0), 10), C)
        add_appointment(s, c, p2.id, utc(d(40), 9), D)   # outside the default 30-day window
        s.commit()
        return {"today": today, "d": d, "p1": p1.id, "p2": p2.id}


def stats(client, admin, **params):
    r = client.get("/admin/stats", params=params, headers=admin)
    assert r.status_code == 200, r.text
    return r.json()


def test_default_window_numbers(client, admin, world):
    body = stats(client, admin)
    assert body["total_appointments"] == 6  # the 40-day-old one is excluded
    assert body["by_status"] == {"booked": 2, "cancelled": 2, "completed": 2}
    assert body["cancellation_rate"] == round(2 / 6, 4)


def test_bookings_per_day_excludes_cancelled_and_is_sorted(client, admin, world):
    per_day = stats(client, admin)["bookings_per_day"]
    d = world["d"]
    assert per_day == [
        {"date": d(1).isoformat(), "count": 2},   # 3 appointments yesterday, 1 cancelled
        {"date": d(0).isoformat(), "count": 2},   # 3 today, 1 cancelled
    ]


def test_top_providers_busiest_first_without_cancelled(client, admin, world):
    top = stats(client, admin)["top_providers"]
    assert top == [
        {"provider_id": world["p1"], "service_name": "Dental", "bookings": 3},
        {"provider_id": world["p2"], "service_name": "Massage", "bookings": 1},
    ]


def test_custom_window(client, admin, world):
    d = world["d"]
    body = stats(client, admin, date_from=utc(d(41), 0).isoformat(), date_to=utc(d(39), 0).isoformat())
    assert body["total_appointments"] == 1 and body["by_status"]["completed"] == 1 and body["cancellation_rate"] == 0.0


def test_empty_window_is_all_zeros(client, admin):
    body = stats(client, admin)
    assert body["total_appointments"] == 0 and body["cancellation_rate"] == 0.0
    assert body["by_status"] == {"booked": 0, "cancelled": 0, "completed": 0}
    assert body["bookings_per_day"] == [] and body["top_providers"] == []


def test_status_window_edges_are_half_open(client, admin, world):
    d = world["d"]
    on_edge = stats(client, admin, date_from=utc(d(1), 11).isoformat(), date_to=utc(d(1), 12).isoformat())
    assert on_edge["total_appointments"] == 1
    excluded = stats(client, admin, date_from=utc(d(1), 9).isoformat(), date_to=utc(d(1), 11).isoformat())
    assert excluded["total_appointments"] == 2  # 09:00 and 10:00, not 11:00


@pytest.mark.parametrize(
    "params",
    [
        {"date_from": "2030-02-01T00:00:00Z", "date_to": "2030-01-01T00:00:00Z"},
        {"date_from": "2030-01-01T00:00:00Z", "date_to": "2031-06-01T00:00:00Z"},  # > 366 days
        {"date_from": "2030-01-01T00:00:00"},  # naive
    ],
)
def test_invalid_windows_are_422(client, admin, params):
    assert client.get("/admin/stats", params=params, headers=admin).status_code == 422


def test_stats_are_admin_only(client):
    assert client.get("/admin/stats").status_code == 401
    assert client.get("/admin/stats", headers=auth_headers(client, "c@test.com")).status_code == 403


def test_default_window_is_30_days_ending_tomorrow_midnight_utc(session_factory):
    now = datetime(2030, 5, 10, 15, 0, tzinfo=timezone.utc)
    with session_factory() as s:
        out = stats_service.get_stats(s, now=now)
    assert out.date_to == datetime(2030, 5, 11, tzinfo=timezone.utc)
    assert out.date_to - out.date_from == timedelta(days=30)
