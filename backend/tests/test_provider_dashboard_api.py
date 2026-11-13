# backend/tests/test_provider_dashboard_api.py
# Purpose: the endpoints the provider dashboard relies on: GET /providers/me, and listing / deleting
# the caller's own blocked periods (ownership, ordering, hiding past periods, freeing the time).

import pytest

from tests.helpers import auth_headers, future_day, iso

BLOCKS = "/availability/blocked-slots"


def make_provider(client, email, service="S"):
    h = auth_headers(client, email, email.split("@")[0])
    p = client.post("/providers", json={"service_name": service, "appointment_duration_minutes": 30}, headers=h).json()
    return {"h": h, "id": p["id"]}


@pytest.fixture()
def prov(client):
    return make_provider(client, "prov@test.com")


def block(client, who, start, end, reason=None):
    body = {"start_at": start, "end_at": end}
    if reason:
        body["reason"] = reason
    r = client.post(BLOCKS, json=body, headers=who["h"])
    assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------- GET /providers/me
def test_get_my_profile(client, prov):
    r = client.get("/providers/me", headers=prov["h"])
    assert r.status_code == 200
    assert r.json()["id"] == prov["id"] and r.json()["service_name"] == "S"


def test_get_my_profile_is_not_confused_with_a_provider_id(client, prov):
    # "me" must be routed to the profile endpoint, not parsed as /providers/{provider_id} (which would be 422).
    assert client.get("/providers/me", headers=prov["h"]).status_code == 200


def test_get_my_profile_needs_a_provider_role(client):
    customer = auth_headers(client, "cust@test.com", "Cust")
    assert client.get("/providers/me", headers=customer).status_code == 403
    assert client.get("/providers/me").status_code == 401


# ---------------------------------------------------------------- GET blocked slots
def test_list_is_empty_at_first(client, prov):
    r = client.get(BLOCKS, headers=prov["h"])
    assert r.status_code == 200 and r.json() == []


def test_list_is_soonest_first_and_only_mine(client, prov):
    other = make_provider(client, "other@test.com", "Other")
    d = future_day(10)
    later = block(client, prov, iso(d, 14), iso(d, 15), "Dentist")
    sooner = block(client, prov, iso(d, 9), iso(d, 10))
    block(client, other, iso(d, 11), iso(d, 12))  # someone else's block must never show up

    r = client.get(BLOCKS, headers=prov["h"])
    assert r.status_code == 200
    assert [b["id"] for b in r.json()] == [sooner["id"], later["id"]]
    assert all(b["provider_id"] == prov["id"] for b in r.json())
    assert r.json()[1]["reason"] == "Dentist"


def test_past_blocks_are_hidden_unless_asked_for(client, prov):
    past_day, next_week = future_day(-5), future_day(7)
    old = block(client, prov, iso(past_day, 9), iso(past_day, 10))
    new = block(client, prov, iso(next_week, 9), iso(next_week, 10))

    assert [b["id"] for b in client.get(BLOCKS, headers=prov["h"]).json()] == [new["id"]]
    everything = client.get(BLOCKS, params={"include_past": "true"}, headers=prov["h"]).json()
    assert [b["id"] for b in everything] == [old["id"], new["id"]]


def test_list_needs_a_provider_role(client):
    customer = auth_headers(client, "cust@test.com", "Cust")
    assert client.get(BLOCKS, headers=customer).status_code == 403
    assert client.get(BLOCKS).status_code == 401


# ---------------------------------------------------------------- DELETE blocked slot
def test_delete_removes_the_block(client, prov):
    d = future_day(7)
    b = block(client, prov, iso(d, 9), iso(d, 10))
    assert client.delete(f"{BLOCKS}/{b['id']}", headers=prov["h"]).status_code == 204
    assert client.get(BLOCKS, headers=prov["h"]).json() == []


def test_deleting_a_block_makes_the_time_bookable_again(client, prov):
    d = future_day(7)
    rule = {"weekday": d.weekday(), "start_time": "09:00:00", "end_time": "12:00:00"}
    assert client.post("/availability", json=rule, headers=prov["h"]).status_code == 201
    b = block(client, prov, iso(d, 9), iso(d, 12))

    def slots():
        return client.get(f"/providers/{prov['id']}/slots", params={"date": d.isoformat()}).json()["slots"]

    assert slots() == []
    assert client.delete(f"{BLOCKS}/{b['id']}", headers=prov["h"]).status_code == 204
    assert len(slots()) == 6  # 09:00-12:00 in 30 minute slots


def test_cannot_delete_someone_elses_or_a_missing_block(client, prov):
    other = make_provider(client, "other@test.com", "Other")
    d = future_day(7)
    theirs = block(client, other, iso(d, 9), iso(d, 10))

    assert client.delete(f"{BLOCKS}/{theirs['id']}", headers=prov["h"]).status_code == 403
    assert client.delete(f"{BLOCKS}/99999", headers=prov["h"]).status_code == 404
    # still there for its owner
    assert [b["id"] for b in client.get(BLOCKS, headers=other["h"]).json()] == [theirs["id"]]


def test_delete_needs_a_provider_role(client, prov):
    d = future_day(7)
    b = block(client, prov, iso(d, 9), iso(d, 10))
    customer = auth_headers(client, "cust@test.com", "Cust")
    assert client.delete(f"{BLOCKS}/{b['id']}", headers=customer).status_code == 403
    assert client.delete(f"{BLOCKS}/{b['id']}").status_code == 401
    assert len(client.get(BLOCKS, headers=prov["h"]).json()) == 1
