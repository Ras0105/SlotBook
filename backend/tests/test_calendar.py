# backend/tests/test_calendar.py
# Purpose: GET /providers/me/calendar, the provider's week view data.

from datetime import datetime, timedelta, timezone

import pytest

from app.models import Appointment, AppointmentStatus, User
from tests.helpers import auth_headers

NOW = datetime(2030, 1, 7, 0, 0, tzinfo=timezone.utc)  # a Monday


@pytest.fixture()
def cal(client, session_factory):
    owner = auth_headers(client, "owner@test.com", "Owner")
    pid = client.post("/providers", json={"service_name": "S"}, headers=owner).json()["id"]
    other_owner = auth_headers(client, "other@test.com", "Other")
    other_pid = client.post("/providers", json={"service_name": "O"}, headers=other_owner).json()["id"]
    auth_headers(client, "cust@test.com", "Casey Customer")
    with session_factory() as s:
        cust_id = s.query(User).filter_by(email="cust@test.com").one().id

    def add(provider_id, day_offset, hour, status=AppointmentStatus.booked):
        start = NOW + timedelta(days=day_offset, hours=hour)
        with session_factory() as s:
            a = Appointment(
                customer_id=cust_id, provider_id=provider_id, start_at=start, end_at=start + timedelta(minutes=30), status=status
            )
            s.add(a)
            s.commit()
            return a.id

    return {"h": owner, "pid": pid, "other_pid": other_pid, "add": add, "cust_id": cust_id}


def get(client, who, start=NOW, days=7):
    return client.get(
        "/providers/me/calendar",
        params={"start": start.isoformat(), "end": (start + timedelta(days=days)).isoformat()},
        headers=who,
    )


def test_lists_my_appointments_with_customer_names(client, cal):
    a = cal["add"](cal["pid"], 0, 9)
    r = get(client, cal["h"])
    assert r.status_code == 200
    assert r.json() == [
        {
            "id": a,
            "customer_id": cal["cust_id"],
            "customer_name": "Casey Customer",
            "start_at": "2030-01-07T09:00:00Z",
            "end_at": "2030-01-07T09:30:00Z",
            "status": "booked",
        }
    ]


def test_only_the_requested_range_in_order(client, cal):
    late = cal["add"](cal["pid"], 2, 15)
    early = cal["add"](cal["pid"], 2, 9)
    cal["add"](cal["pid"], 9, 9)  # next week
    cal["add"](cal["pid"], -1, 9)  # last week
    assert [x["id"] for x in get(client, cal["h"]).json()] == [early, late]


def test_range_includes_start_excludes_end(client, cal):
    at_start = cal["add"](cal["pid"], 0, 0)
    cal["add"](cal["pid"], 7, 0)  # exactly at `end`
    assert [x["id"] for x in get(client, cal["h"]).json()] == [at_start]


def test_cancelled_are_hidden_completed_are_shown(client, cal):
    cal["add"](cal["pid"], 1, 9, AppointmentStatus.cancelled)
    done = cal["add"](cal["pid"], 1, 10, AppointmentStatus.completed)
    r = get(client, cal["h"]).json()
    assert [(x["id"], x["status"]) for x in r] == [(done, "completed")]


def test_never_shows_another_providers_bookings(client, cal):
    cal["add"](cal["other_pid"], 0, 9)
    assert get(client, cal["h"]).json() == []


def test_validation(client, cal):
    assert get(client, cal["h"], days=63).status_code == 422
    assert get(client, cal["h"], days=62).status_code == 200
    r = client.get(
        "/providers/me/calendar",
        params={"start": NOW.isoformat(), "end": NOW.isoformat()},
        headers=cal["h"],
    )
    assert r.status_code == 422
    assert client.get("/providers/me/calendar", headers=cal["h"]).status_code == 422  # missing params


def test_needs_a_provider_login(client, cal):
    customer = auth_headers(client, "c2@test.com", "Cust")
    assert get(client, customer).status_code == 403
    assert get(client, {}).status_code == 401
