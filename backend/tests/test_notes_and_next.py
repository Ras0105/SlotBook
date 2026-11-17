# backend/tests/test_notes_and_next.py
# Purpose: the booking "reason for visit" note, GET /appointments/next, and time off in a date range.

from datetime import datetime, timedelta, timezone

import pytest

from app.models import Appointment, AppointmentStatus, User
from app.services import email_service
from tests.helpers import auth_headers, future_day, iso


@pytest.fixture()
def setup(client):
    day = future_day(7)
    doc = auth_headers(client, "doc@test.com", "Dr Who")
    pid = client.post("/providers", json={"service_name": "Checkup", "appointment_duration_minutes": 30}, headers=doc).json()["id"]
    client.post("/availability", json={"weekday": day.weekday(), "start_time": "09:00:00", "end_time": "12:00:00"}, headers=doc)
    return {
        "day": day, "pid": pid, "doc": doc,
        "alice": auth_headers(client, "alice@test.com", "Alice"),
        "bob": auth_headers(client, "bob@test.com", "Bob"),
    }


def book(client, setup, who="alice", hour=9, notes=None, **extra):
    body = {"provider_id": setup["pid"], "start_at": iso(setup["day"], hour), **extra}
    if notes is not None:
        body["notes"] = notes
    return client.post("/appointments", json=body, headers=setup[who])


# ---------------------------------------------------------------- notes
def test_note_is_saved_trimmed_and_returned(client, setup):
    r = book(client, setup, notes="  Toothache on the left  ")
    assert r.status_code == 201 and r.json()["notes"] == "Toothache on the left"
    assert client.get(f"/appointments/{r.json()['id']}", headers=setup["alice"]).json()["notes"] == "Toothache on the left"


def test_note_is_optional(client, setup):
    assert book(client, setup).json()["notes"] is None
    assert book(client, setup, hour=10, notes="   ").json()["notes"] is None


def test_note_length_is_limited(client, setup):
    assert book(client, setup, notes="x" * 501).status_code == 422
    assert book(client, setup, notes="x" * 500).status_code == 201


def test_provider_sees_the_note_in_their_appointments_and_email(client, setup):
    a = book(client, setup, notes="First visit, nervous").json()
    assert client.get("/appointments/me", headers=setup["doc"]).json()[0]["notes"] == "First visit, nervous"
    assert client.get(f"/appointments/{a['id']}", headers=setup["doc"]).json()["notes"] == "First visit, nervous"
    to = {e.to: e for e in email_service.outbox}
    assert "Reason for visit: First visit, nervous" in to["doc@test.com"].body
    assert "First visit" not in to["alice@test.com"].body  # the customer already knows what they wrote


def test_no_reason_line_when_there_is_no_note(client, setup):
    book(client, setup)
    assert all("Reason for visit" not in e.body for e in email_service.outbox)


def test_other_customers_cannot_read_the_note(client, setup):
    a = book(client, setup, notes="private").json()
    assert client.get(f"/appointments/{a['id']}", headers=setup["bob"]).status_code == 403


def test_note_shows_in_the_provider_calendar_and_survives_a_reschedule(client, setup):
    a = book(client, setup, notes="Bring X-rays").json()
    r = client.patch(f"/appointments/{a['id']}/reschedule", json={"new_start_at": iso(setup["day"], 10)}, headers=setup["alice"])
    assert r.status_code == 200 and r.json()["notes"] == "Bring X-rays"
    cal = client.get(
        "/providers/me/calendar",
        params={"start": iso(setup["day"], 0), "end": iso(setup["day"] + timedelta(days=1), 0)},
        headers=setup["doc"],
    ).json()
    assert cal[0]["notes"] == "Bring X-rays"


# ---------------------------------------------------------------- next appointment
def add_appt(session_factory, customer_email, provider_id, start, status=AppointmentStatus.booked):
    with session_factory() as s:
        cid = s.query(User).filter_by(email=customer_email).one().id
        a = Appointment(customer_id=cid, provider_id=provider_id, start_at=start, end_at=start + timedelta(minutes=30), status=status)
        s.add(a)
        s.commit()
        return a.id


def test_next_is_null_when_nothing_is_coming_up(client, setup):
    r = client.get("/appointments/next", headers=setup["alice"])
    assert r.status_code == 200 and r.json() is None


def test_next_is_the_soonest_upcoming_booked_one(client, setup, session_factory):
    now = datetime.now(timezone.utc)
    add_appt(session_factory, "alice@test.com", setup["pid"], now - timedelta(days=1))  # past
    add_appt(session_factory, "alice@test.com", setup["pid"], now + timedelta(days=1), AppointmentStatus.cancelled)
    add_appt(session_factory, "bob@test.com", setup["pid"], now + timedelta(hours=1))  # someone else's
    later = add_appt(session_factory, "alice@test.com", setup["pid"], now + timedelta(days=5))
    sooner = add_appt(session_factory, "alice@test.com", setup["pid"], now + timedelta(days=2))
    r = client.get("/appointments/next", headers=setup["alice"]).json()
    assert r["id"] == sooner and r["id"] != later


def test_next_is_not_confused_with_an_id_and_needs_login(client, setup):
    assert client.get("/appointments/next").status_code == 401


def test_a_provider_gets_their_own_bookings_as_a_customer_only(client, setup, session_factory):
    add_appt(session_factory, "alice@test.com", setup["pid"], datetime.now(timezone.utc) + timedelta(days=1))
    assert client.get("/appointments/next", headers=setup["doc"]).json() is None  # a booking WITH them is not theirs


# ---------------------------------------------------------------- time off in a range
def block(client, who, start, end, reason=None):
    body = {"start_at": start, "end_at": end, **({"reason": reason} if reason else {})}
    r = client.post("/availability/blocked-slots", json=body, headers=who)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_blocked_slots_can_be_listed_for_a_date_range_including_past_ones(client, setup):
    # the provider fixture only allows blocks in the future, so use two future weeks
    d = setup["day"]
    inside = block(client, setup["doc"], iso(d, 8), iso(d, 9), "Dentist")
    block(client, setup["doc"], iso(d + timedelta(days=10), 8), iso(d + timedelta(days=10), 9))  # outside the range
    spans = block(client, setup["doc"], iso(d - timedelta(days=1), 22), iso(d, 1))  # starts before, overlaps the range
    r = client.get(
        "/availability/blocked-slots",
        params={"start": iso(d, 0), "end": iso(d + timedelta(days=7), 0)},
        headers=setup["doc"],
    )
    assert r.status_code == 200
    assert [x["id"] for x in r.json()] == [spans, inside]  # soonest first, both overlapping the week
    assert r.json()[1]["reason"] == "Dentist"


def test_blocked_slot_range_validation(client, setup):
    d = setup["day"]
    h = setup["doc"]
    assert client.get("/availability/blocked-slots", params={"start": iso(d, 0)}, headers=h).status_code == 422
    assert client.get("/availability/blocked-slots", params={"start": iso(d, 5), "end": iso(d, 5)}, headers=h).status_code == 422
    assert client.get("/availability/blocked-slots", params={"start": iso(d, 0), "end": iso(d + timedelta(days=63), 0)}, headers=h).status_code == 422
    assert client.get("/availability/blocked-slots", headers=h).status_code == 200  # no range: unchanged behaviour
