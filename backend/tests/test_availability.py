# backend/tests/test_availability.py
# Purpose: working-hours and blocked-period API behaviour (validation, overlaps, ownership).

import pytest

from tests.helpers import auth_headers, future_day, iso


@pytest.fixture()
def prov(client):
    h = auth_headers(client, "prov@test.com", "Prov")
    p = client.post("/providers", json={"service_name": "S", "appointment_duration_minutes": 30}, headers=h).json()
    return {"h": h, "id": p["id"], "day": future_day(7)}


def add_rule(client, prov, weekday=0, start="09:00:00", end="12:00:00"):
    return client.post("/availability", json={"weekday": weekday, "start_time": start, "end_time": end}, headers=prov["h"])


def test_create_and_list_rules(client, prov):
    r = add_rule(client, prov)
    assert r.status_code == 201 and r.json()["provider_id"] == prov["id"]
    listed = client.get(f"/providers/{prov['id']}/availability")  # public
    assert listed.status_code == 200 and len(listed.json()) == 1


def test_list_rules_for_unknown_provider_is_404(client):
    assert client.get("/providers/999/availability").status_code == 404


@pytest.mark.parametrize(
    "body",
    [
        {"weekday": 7, "start_time": "09:00:00", "end_time": "10:00:00"},
        {"weekday": -1, "start_time": "09:00:00", "end_time": "10:00:00"},
        {"weekday": 0, "start_time": "10:00:00", "end_time": "09:00:00"},
        {"weekday": 0, "start_time": "09:00:00", "end_time": "09:00:00"},
        {"weekday": 0, "start_time": "09:00:00+05:30", "end_time": "10:00:00"},
        {"weekday": 0, "start_time": "nine", "end_time": "10:00:00"},
    ],
)
def test_invalid_rule_is_422(client, prov, body):
    assert client.post("/availability", json=body, headers=prov["h"]).status_code == 422


def test_overlapping_rule_same_weekday_is_409_but_touching_or_other_day_is_fine(client, prov):
    assert add_rule(client, prov).status_code == 201                       # 09-12 Monday
    assert add_rule(client, prov, start="11:00:00", end="13:00:00").status_code == 409
    assert add_rule(client, prov, start="12:00:00", end="14:00:00").status_code == 201  # touches
    assert add_rule(client, prov, weekday=1).status_code == 201            # another weekday


def test_update_rule(client, prov):
    rid = add_rule(client, prov).json()["id"]
    r = client.patch(f"/availability/{rid}", json={"end_time": "13:00:00"}, headers=prov["h"])
    assert r.status_code == 200 and r.json()["end_time"] == "13:00:00"


def test_update_must_keep_range_valid_and_non_overlapping(client, prov):
    a = add_rule(client, prov).json()["id"]
    add_rule(client, prov, start="13:00:00", end="15:00:00")
    assert client.patch(f"/availability/{a}", json={"end_time": "08:00:00"}, headers=prov["h"]).status_code == 422
    assert client.patch(f"/availability/{a}", json={"end_time": "14:00:00"}, headers=prov["h"]).status_code == 409
    assert client.patch("/availability/9999", json={"weekday": 1}, headers=prov["h"]).status_code == 404


def test_update_does_not_conflict_with_itself(client, prov):
    rid = add_rule(client, prov).json()["id"]
    assert client.patch(f"/availability/{rid}", json={"start_time": "09:30:00"}, headers=prov["h"]).status_code == 200


def test_delete_rule(client, prov):
    rid = add_rule(client, prov).json()["id"]
    assert client.delete(f"/availability/{rid}", headers=prov["h"]).status_code == 204
    assert client.delete(f"/availability/{rid}", headers=prov["h"]).status_code == 404
    assert client.get(f"/providers/{prov['id']}/availability").json() == []


def test_customer_without_profile_gets_403_on_availability(client):
    h = auth_headers(client, "c@test.com")
    assert client.post("/availability", json={"weekday": 0, "start_time": "09:00:00", "end_time": "10:00:00"}, headers=h).status_code == 403


def test_blocked_slot_create_and_validation(client, prov):
    day = prov["day"]
    ok = client.post("/availability/blocked-slots", json={"start_at": iso(day, 9), "end_at": iso(day, 10), "reason": "Lunch"}, headers=prov["h"])
    assert ok.status_code == 201 and ok.json()["reason"] == "Lunch"
    backwards = {"start_at": iso(day, 10), "end_at": iso(day, 9)}
    assert client.post("/availability/blocked-slots", json=backwards, headers=prov["h"]).status_code == 422
    naive = {"start_at": "2030-01-01T09:00:00", "end_at": "2030-01-01T10:00:00"}
    assert client.post("/availability/blocked-slots", json=naive, headers=prov["h"]).status_code == 422
    too_long = {"start_at": iso(day, 9), "end_at": iso(day, 10), "reason": "x" * 256}
    assert client.post("/availability/blocked-slots", json=too_long, headers=prov["h"]).status_code == 422
