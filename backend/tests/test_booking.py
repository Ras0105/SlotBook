# backend/tests/test_booking.py
# Purpose: integration tests for the booking lifecycle (provider -> slots -> book -> cancel/reschedule).

import pytest

from tests.helpers import auth_headers, future_day, iso


@pytest.fixture()
def setup(client):
    """A provider working 09:00-12:00 (UTC, 30-minute slots) on a day one week ahead."""
    day = future_day(7)
    provider_h = auth_headers(client, "provider@test.com", "Dr Provider")
    provider = client.post(
        "/providers", json={"service_name": "Checkup", "appointment_duration_minutes": 30}, headers=provider_h
    ).json()
    client.post(
        "/availability",
        json={"weekday": day.weekday(), "start_time": "09:00:00", "end_time": "12:00:00"},
        headers=provider_h,
    )
    return {
        "day": day,
        "provider_id": provider["id"],
        "provider_h": provider_h,
        "alice": auth_headers(client, "alice@test.com", "Alice"),
        "bob": auth_headers(client, "bob@test.com", "Bob"),
    }


def book(client, setup, who, hour, minute=0):
    return client.post(
        "/appointments",
        json={"provider_id": setup["provider_id"], "start_at": iso(setup["day"], hour, minute)},
        headers=setup[who],
    )


def slot_starts(client, setup):
    r = client.get(f"/providers/{setup['provider_id']}/slots", params={"date": setup["day"].isoformat()})
    assert r.status_code == 200
    return [s["start_at"] for s in r.json()["slots"]]


def test_slots_listed(client, setup):
    assert len(slot_starts(client, setup)) == 6


def test_book_success_removes_slot(client, setup):
    r = book(client, setup, "alice", 9)
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "booked"
    assert body["end_at"].startswith(setup["day"].isoformat() + "T09:30")
    assert len(slot_starts(client, setup)) == 5


def test_double_booking_same_slot_returns_409(client, setup):
    assert book(client, setup, "alice", 9).status_code == 201
    assert book(client, setup, "bob", 9).status_code == 409


def test_invalid_slots_return_422(client, setup):
    assert book(client, setup, "alice", 9, 15).status_code == 422  # not aligned to the slot grid
    assert book(client, setup, "alice", 13).status_code == 422  # outside working hours
    past = client.post(
        "/appointments",
        json={"provider_id": setup["provider_id"], "start_at": "2020-01-06T09:00:00Z"},
        headers=setup["alice"],
    )
    assert past.status_code == 422


def test_naive_datetime_rejected(client, setup):
    r = client.post(
        "/appointments",
        json={"provider_id": setup["provider_id"], "start_at": f"{setup['day']}T09:00:00"},
        headers=setup["alice"],
    )
    assert r.status_code == 422


def test_cannot_book_own_services(client, setup):
    assert book(client, setup, "provider_h", 9).status_code == 422


def test_unknown_provider_404_and_no_token_401(client, setup):
    r = client.post(
        "/appointments", json={"provider_id": 999, "start_at": iso(setup["day"], 9)}, headers=setup["alice"]
    )
    assert r.status_code == 404
    assert client.post("/appointments", json={"provider_id": 1, "start_at": iso(setup["day"], 9)}).status_code == 401


def test_blocked_period_makes_slot_unavailable(client, setup):
    r = client.post(
        "/availability/blocked-slots",
        json={"start_at": iso(setup["day"], 9), "end_at": iso(setup["day"], 10), "reason": "lunch"},
        headers=setup["provider_h"],
    )
    assert r.status_code == 201
    assert book(client, setup, "alice", 9).status_code == 409
    assert book(client, setup, "alice", 10).status_code == 201


def test_cannot_block_time_with_existing_booking(client, setup):
    assert book(client, setup, "alice", 9).status_code == 201
    r = client.post(
        "/availability/blocked-slots",
        json={"start_at": iso(setup["day"], 9), "end_at": iso(setup["day"], 10)},
        headers=setup["provider_h"],
    )
    assert r.status_code == 409


def test_my_appointments_for_customer_and_provider(client, setup):
    book(client, setup, "alice", 9)
    book(client, setup, "bob", 10)
    assert len(client.get("/appointments/me", headers=setup["alice"]).json()) == 1
    assert len(client.get("/appointments/me", headers=setup["provider_h"]).json()) == 2
    cancelled = client.get("/appointments/me", params={"status": "cancelled"}, headers=setup["alice"])
    assert cancelled.json() == []


def test_get_appointment_access_rules(client, setup):
    appt_id = book(client, setup, "alice", 9).json()["id"]
    assert client.get(f"/appointments/{appt_id}", headers=setup["alice"]).status_code == 200
    assert client.get(f"/appointments/{appt_id}", headers=setup["provider_h"]).status_code == 200
    assert client.get(f"/appointments/{appt_id}", headers=setup["bob"]).status_code == 403
    assert client.get("/appointments/9999", headers=setup["alice"]).status_code == 404
    detail = client.get(f"/appointments/{appt_id}", headers=setup["alice"]).json()
    assert [h["new_status"] for h in detail["history"]] == ["booked"]


def test_cancel_frees_slot_and_records_history(client, setup):
    appt_id = book(client, setup, "alice", 9).json()["id"]
    assert client.patch(f"/appointments/{appt_id}/cancel", headers=setup["bob"]).status_code == 403
    r = client.patch(f"/appointments/{appt_id}/cancel", headers=setup["alice"])
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert client.patch(f"/appointments/{appt_id}/cancel", headers=setup["alice"]).status_code == 409
    assert len(slot_starts(client, setup)) == 6  # slot is free again
    assert book(client, setup, "bob", 9).status_code == 201
    history = client.get(f"/appointments/{appt_id}", headers=setup["alice"]).json()["history"]
    assert [(h["old_status"], h["new_status"]) for h in history] == [(None, "booked"), ("booked", "cancelled")]


def test_provider_can_cancel(client, setup):
    appt_id = book(client, setup, "alice", 9).json()["id"]
    r = client.patch(f"/appointments/{appt_id}/cancel", headers=setup["provider_h"])
    assert r.status_code == 200


def test_reschedule(client, setup):
    appt_id = book(client, setup, "alice", 9).json()["id"]
    book(client, setup, "bob", 10)

    def resched(hour, who="alice", minute=0):
        return client.patch(
            f"/appointments/{appt_id}/reschedule",
            json={"new_start_at": iso(setup["day"], hour, minute)},
            headers=setup[who],
        )

    assert resched(10).status_code == 409  # taken by Bob
    assert resched(9).status_code == 422  # same time
    assert resched(9, minute=15).status_code == 422  # off grid
    assert resched(11, who="bob").status_code == 403  # not the owner
    assert resched(11, who="provider_h").status_code == 403  # providers cancel instead

    r = resched(11)
    assert r.status_code == 200
    assert r.json()["start_at"].startswith(setup["day"].isoformat() + "T11:00")
    assert book(client, setup, "bob", 9).status_code == 201  # old slot is free again
    history = client.get(f"/appointments/{appt_id}", headers=setup["alice"]).json()["history"]
    assert history[-1]["note"].startswith("Rescheduled from")


def test_cannot_reschedule_cancelled_appointment(client, setup):
    appt_id = book(client, setup, "alice", 9).json()["id"]
    client.patch(f"/appointments/{appt_id}/cancel", headers=setup["alice"])
    r = client.patch(
        f"/appointments/{appt_id}/reschedule",
        json={"new_start_at": iso(setup["day"], 11)},
        headers=setup["alice"],
    )
    assert r.status_code == 409
