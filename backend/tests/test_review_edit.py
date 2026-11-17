# backend/tests/test_review_edit.py
# Purpose: editing and deleting a review keeps the provider's rating summary right.

from datetime import datetime, timedelta, timezone

import pytest

from app.models import Appointment, AppointmentStatus, User
from tests.helpers import admin_headers, auth_headers


@pytest.fixture()
def world(client, session_factory):
    owner = auth_headers(client, "owner@test.com", "Owner")
    pid = client.post("/providers", json={"service_name": "S"}, headers=owner).json()["id"]
    alice = auth_headers(client, "alice@test.com", "Alice Smith")
    bob = auth_headers(client, "bob@test.com", "Bob")

    def appt(email):
        start = datetime.now(timezone.utc) - timedelta(hours=3)
        with session_factory() as s:
            a = Appointment(customer_id=s.query(User).filter_by(email=email).one().id, provider_id=pid, start_at=start,
                            end_at=start + timedelta(minutes=30), status=AppointmentStatus.completed)
            s.add(a)
            s.commit()
            return a.id

    def review(who, email, rating, comment=None):
        r = client.post(f"/appointments/{appt(email)}/review", json={"rating": rating, "comment": comment}, headers=who)
        assert r.status_code == 201, r.text
        return r.json()

    prov = lambda: client.get(f"/providers/{pid}").json()  # noqa: E731
    return {"alice": alice, "bob": bob, "owner": owner, "pid": pid, "review": review, "prov": prov, "appt": appt}


def test_edit_changes_rating_comment_and_summary(client, world):
    r1 = world["review"](world["alice"], "alice@test.com", 5, "Great")
    world["review"](world["bob"], "bob@test.com", 3)
    assert world["prov"]()["rating_avg"] == 4.0
    assert r1["updated_at"] is None

    r = client.patch(f"/reviews/{r1['id']}", json={"rating": 1, "comment": "Changed my mind"}, headers=world["alice"])
    assert r.status_code == 200
    assert r.json()["rating"] == 1 and r.json()["comment"] == "Changed my mind" and r.json()["updated_at"] is not None
    assert world["prov"]()["rating_avg"] == 2.0 and world["prov"]()["review_count"] == 2
    assert client.get(f"/providers/{world['pid']}/reviews").json()[-1]["rating"] in (1, 3)


def test_edit_replaces_the_comment_so_leaving_it_out_clears_it(client, world):
    r1 = world["review"](world["alice"], "alice@test.com", 5, "Great")
    r = client.patch(f"/reviews/{r1['id']}", json={"rating": 5}, headers=world["alice"])
    assert r.json()["comment"] is None


def test_only_the_author_can_edit(client, world):
    r1 = world["review"](world["alice"], "alice@test.com", 5)
    for who in (world["bob"], world["owner"]):
        assert client.patch(f"/reviews/{r1['id']}", json={"rating": 1}, headers=who).status_code == 403
    assert client.patch(f"/reviews/{r1['id']}", json={"rating": 1}).status_code == 401
    assert client.patch("/reviews/9999", json={"rating": 1}, headers=world["alice"]).status_code == 404
    assert world["prov"]()["rating_avg"] == 5.0


def test_edit_validates_the_rating(client, world):
    r1 = world["review"](world["alice"], "alice@test.com", 5)
    assert client.patch(f"/reviews/{r1['id']}", json={"rating": 6}, headers=world["alice"]).status_code == 422
    assert client.patch(f"/reviews/{r1['id']}", json={"rating": 0}, headers=world["alice"]).status_code == 422


def test_delete_updates_the_summary_and_allows_a_new_review(client, world):
    r1 = world["review"](world["alice"], "alice@test.com", 5)
    world["review"](world["bob"], "bob@test.com", 1)
    assert client.delete(f"/reviews/{r1['id']}", headers=world["alice"]).status_code == 204
    assert world["prov"]()["rating_avg"] == 1.0 and world["prov"]()["review_count"] == 1
    assert client.get(f"/appointments/{r1['appointment_id']}", headers=world["alice"]).json()["review"] is None
    again = client.post(f"/appointments/{r1['appointment_id']}/review", json={"rating": 4}, headers=world["alice"])
    assert again.status_code == 201  # the same visit can be reviewed again after deleting
    assert world["prov"]()["review_count"] == 2


def test_deleting_the_last_review_clears_the_rating(client, world):
    r1 = world["review"](world["alice"], "alice@test.com", 4)
    client.delete(f"/reviews/{r1['id']}", headers=world["alice"])
    assert world["prov"]()["rating_avg"] is None and world["prov"]()["review_count"] == 0


def test_delete_permissions(client, world, session_factory):
    r1 = world["review"](world["alice"], "alice@test.com", 5)
    assert client.delete(f"/reviews/{r1['id']}", headers=world["bob"]).status_code == 403
    assert client.delete(f"/reviews/{r1['id']}", headers=world["owner"]).status_code == 403  # providers cannot remove criticism
    assert client.delete(f"/reviews/{r1['id']}").status_code == 401
    assert client.delete("/reviews/9999", headers=world["alice"]).status_code == 404
    admin = admin_headers(client, session_factory)
    assert client.delete(f"/reviews/{r1['id']}", headers=admin).status_code == 204  # an admin can moderate
    assert client.delete(f"/reviews/{r1['id']}", headers=admin).status_code == 404  # and it is really gone
    assert world["prov"]()["review_count"] == 0


def test_admin_cannot_edit_someone_elses_words(client, world, session_factory):
    r1 = world["review"](world["alice"], "alice@test.com", 5, "Mine")
    admin = admin_headers(client, session_factory)
    assert client.patch(f"/reviews/{r1['id']}", json={"rating": 1}, headers=admin).status_code == 403
