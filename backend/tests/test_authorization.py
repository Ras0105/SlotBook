# backend/tests/test_authorization.py
# Purpose: role-based access and ownership checks on protected endpoints.

import pytest

from tests.helpers import admin_headers, auth_headers, future_day, iso


@pytest.fixture()
def world(client):
    day = future_day(7)
    provider_h = auth_headers(client, "prov@test.com", "Prov")
    other_provider_h = auth_headers(client, "prov2@test.com", "Prov2")
    for h in (provider_h, other_provider_h):
        client.post("/providers", json={"service_name": "S"}, headers=h)
    rule = client.post(
        "/availability",
        json={"weekday": day.weekday(), "start_time": "09:00:00", "end_time": "12:00:00"},
        headers=provider_h,
    ).json()
    alice, bob = auth_headers(client, "alice@test.com"), auth_headers(client, "bob@test.com")
    provider_id = client.get("/providers").json()[0]["id"]
    appt = client.post(
        "/appointments", json={"provider_id": provider_id, "start_at": iso(day, 9)}, headers=alice
    ).json()
    return {"day": day, "rule": rule, "appt": appt, "provider_h": provider_h, "other_h": other_provider_h,
            "alice": alice, "bob": bob}


def test_customer_cannot_manage_availability(client, world):
    body = {"weekday": 1, "start_time": "09:00:00", "end_time": "10:00:00"}
    assert client.post("/availability", json=body, headers=world["alice"]).status_code == 403
    assert client.patch(f"/availability/{world['rule']['id']}", json={"weekday": 2}, headers=world["alice"]).status_code == 403
    assert client.delete(f"/availability/{world['rule']['id']}", headers=world["alice"]).status_code == 403
    blocked = {"start_at": iso(world["day"], 9), "end_at": iso(world["day"], 10)}
    assert client.post("/availability/blocked-slots", json=blocked, headers=world["alice"]).status_code == 403


def test_provider_cannot_touch_another_providers_rule(client, world):
    rid = world["rule"]["id"]
    assert client.patch(f"/availability/{rid}", json={"weekday": 2}, headers=world["other_h"]).status_code == 403
    assert client.delete(f"/availability/{rid}", headers=world["other_h"]).status_code == 403


def test_customer_cannot_view_or_cancel_or_reschedule_another_customers_appointment(client, world):
    aid = world["appt"]["id"]
    assert client.get(f"/appointments/{aid}", headers=world["bob"]).status_code == 403
    assert client.patch(f"/appointments/{aid}/cancel", headers=world["bob"]).status_code == 403
    r = client.patch(f"/appointments/{aid}/reschedule", json={"new_start_at": iso(world["day"], 10)}, headers=world["bob"])
    assert r.status_code == 403
    assert client.get(f"/appointments/{aid}", headers=world["alice"]).status_code == 200


def test_unrelated_provider_cannot_see_the_appointment(client, world):
    assert client.get(f"/appointments/{world['appt']['id']}", headers=world["other_h"]).status_code == 403
    assert client.get(f"/appointments/{world['appt']['id']}", headers=world["provider_h"]).status_code == 200


def test_admin_routes_reject_non_admins_and_anonymous(client, world):
    assert client.get("/admin/appointments").status_code == 401
    for who in ("alice", "provider_h"):
        assert client.get("/admin/appointments", headers=world[who]).status_code == 403


def test_admin_can_view_any_appointment(client, world, session_factory):
    admin = admin_headers(client, session_factory)
    assert client.get(f"/appointments/{world['appt']['id']}", headers=admin).status_code == 200


def test_admin_cannot_book_appointments(client, world, session_factory):
    admin = admin_headers(client, session_factory)
    r = client.post("/appointments", json={"provider_id": 1, "start_at": iso(world["day"], 10)}, headers=admin)
    assert r.status_code == 403
