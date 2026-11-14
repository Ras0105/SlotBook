# backend/tests/test_reviews.py
# Purpose: ratings and reviews: who can review, when, once only, and the provider's rating summary.

from datetime import datetime, timedelta, timezone

import pytest

from app.models import Appointment, AppointmentStatus, Provider, Role, User
from tests.helpers import auth_headers


@pytest.fixture()
def world(client, session_factory):
    """One provider and two customers; helper to insert appointments at any time (including the past)."""
    owner = auth_headers(client, "owner@test.com", "Owner")
    pid = client.post("/providers", json={"service_name": "Dentist visit"}, headers=owner).json()["id"]
    alice = auth_headers(client, "alice@test.com", "Alice Smith")
    bob = auth_headers(client, "bob@test.com", "Bob")
    with session_factory() as s:
        ids = {u.email: u.id for u in s.query(User).all()}

    def appointment(customer_email, hours_from_now, status=AppointmentStatus.booked):
        start = datetime.now(timezone.utc) + timedelta(hours=hours_from_now)
        with session_factory() as s:
            a = Appointment(
                customer_id=ids[customer_email],
                provider_id=pid,
                start_at=start,
                end_at=start + timedelta(minutes=30),
                status=status,
            )
            s.add(a)
            s.commit()
            return a.id

    return {"owner": owner, "alice": alice, "bob": bob, "pid": pid, "appointment": appointment}


def review(client, who, appointment_id, rating=5, comment=None):
    body = {"rating": rating}
    if comment is not None:
        body["comment"] = comment
    return client.post(f"/appointments/{appointment_id}/review", json=body, headers=who)


def test_review_a_finished_appointment(client, world):
    a = world["appointment"]("alice@test.com", -3)  # booked, ended hours ago
    r = review(client, world["alice"], a, 4, "  Quick and painless  ")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["rating"] == 4 and body["comment"] == "Quick and painless"
    assert body["reviewer_name"] == "Alice S."  # surname shortened: reviews are public
    assert body["provider_id"] == world["pid"] and body["appointment_id"] == a


def test_reviewing_moves_a_past_booked_appointment_to_completed(client, world):
    a = world["appointment"]("alice@test.com", -3)
    review(client, world["alice"], a)
    detail = client.get(f"/appointments/{a}", headers=world["alice"]).json()
    assert detail["status"] == "completed"
    assert detail["review"]["rating"] == 5
    assert detail["history"][-1]["new_status"] == "completed"


def test_review_a_completed_appointment(client, world):
    a = world["appointment"]("alice@test.com", -3, AppointmentStatus.completed)
    assert review(client, world["alice"], a).status_code == 201


def test_cannot_review_before_it_is_over(client, world):
    future = world["appointment"]("alice@test.com", 5)
    assert review(client, world["alice"], future).status_code == 409
    in_progress = world["appointment"]("alice@test.com", -0.25)  # started 15 min ago, lasts 30
    assert review(client, world["alice"], in_progress).status_code == 409


def test_cannot_review_a_cancelled_appointment(client, world):
    a = world["appointment"]("alice@test.com", -3, AppointmentStatus.cancelled)
    r = review(client, world["alice"], a)
    assert r.status_code == 409 and "cancelled" in r.json()["detail"]


def test_one_review_per_appointment(client, world):
    a = world["appointment"]("alice@test.com", -3)
    assert review(client, world["alice"], a, 5).status_code == 201
    r = review(client, world["alice"], a, 1)
    assert r.status_code == 409 and "already reviewed" in r.json()["detail"]
    assert client.get(f"/providers/{world['pid']}").json()["review_count"] == 1


def test_only_the_customer_can_review(client, world):
    a = world["appointment"]("alice@test.com", -3)
    assert review(client, world["bob"], a).status_code == 403
    assert review(client, world["owner"], a).status_code == 403  # a provider cannot rate themselves
    assert review(client, {}, a).status_code == 401


def test_unknown_appointment_is_404(client, world):
    assert review(client, world["alice"], 9999).status_code == 404


@pytest.mark.parametrize("rating", [0, 6, -1])
def test_rating_must_be_1_to_5(client, world, rating):
    a = world["appointment"]("alice@test.com", -3)
    assert review(client, world["alice"], a, rating).status_code == 422


def test_comment_is_optional_and_limited(client, world):
    a = world["appointment"]("alice@test.com", -3)
    assert review(client, world["alice"], a, 5, "x" * 1001).status_code == 422
    r = review(client, world["alice"], a, 5, "   ")
    assert r.status_code == 201 and r.json()["comment"] is None


def test_provider_rating_summary(client, world):
    prov = lambda: client.get(f"/providers/{world['pid']}").json()  # noqa: E731
    assert prov()["rating_avg"] is None and prov()["review_count"] == 0

    review(client, world["alice"], world["appointment"]("alice@test.com", -3), 5)
    assert prov()["rating_avg"] == 5.0 and prov()["review_count"] == 1

    review(client, world["bob"], world["appointment"]("bob@test.com", -4), 2)
    assert prov()["rating_avg"] == 3.5 and prov()["review_count"] == 2

    review(client, world["alice"], world["appointment"]("alice@test.com", -5), 2)
    assert prov()["rating_avg"] == 3.0 and prov()["review_count"] == 3
    # and in the list
    assert client.get("/providers").json()[0]["rating_avg"] == 3.0


def test_list_provider_reviews_is_public_newest_first(client, world):
    first = world["appointment"]("alice@test.com", -5)
    second = world["appointment"]("bob@test.com", -4)
    review(client, world["alice"], first, 5, "Great")
    review(client, world["bob"], second, 3)

    r = client.get(f"/providers/{world['pid']}/reviews")  # no login needed
    assert r.status_code == 200
    rows = r.json()
    assert [x["reviewer_name"] for x in rows] == ["Bob", "Alice S."]
    assert set(rows[0]) == {"id", "appointment_id", "provider_id", "rating", "comment", "reviewer_name", "created_at"}  # no emails / ids of people

    assert len(client.get(f"/providers/{world['pid']}/reviews?limit=1").json()) == 1
    assert len(client.get(f"/providers/{world['pid']}/reviews?skip=1").json()) == 1
    assert client.get("/providers/9999/reviews").status_code == 404


def test_my_appointments_show_the_review(client, world):
    a = world["appointment"]("alice@test.com", -3)
    b = world["appointment"]("alice@test.com", -6)
    review(client, world["alice"], a, 4)
    rows = {x["id"]: x for x in client.get("/appointments/me", headers=world["alice"]).json()}
    assert rows[a]["review"]["rating"] == 4
    assert rows[b]["review"] is None


def test_database_rejects_a_second_review_even_without_the_service(client, world, session_factory):
    from sqlalchemy.exc import IntegrityError

    from app.models import Review

    a = world["appointment"]("alice@test.com", -3)
    review(client, world["alice"], a)
    with session_factory() as s, pytest.raises(IntegrityError):
        appt = s.get(Appointment, a)
        s.add(Review(appointment_id=a, provider_id=appt.provider_id, customer_id=appt.customer_id, rating=1))
        s.commit()
