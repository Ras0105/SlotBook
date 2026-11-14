# backend/tests/test_admin.py
# Purpose: GET /admin/appointments: access control, filters, ordering, pagination bounds.

from datetime import timedelta

import pytest
from sqlalchemy import select

from app.models import Appointment, AppointmentStatus
from tests.helpers import admin_headers, book_via_service, seed_provider, utc


@pytest.fixture()
def data(client, session_factory):
    """Two providers, two customers, 7 appointments across 2 days, one cancelled."""
    a = seed_provider(session_factory, n_customers=2, suffix="a")
    b = seed_provider(session_factory, n_customers=0, suffix="b")
    day, c1, c2 = a["day"], a["customer_ids"][0], a["customer_ids"][1]
    ids = {}
    ids["a9"] = book_via_service(session_factory, c1, a["provider_id"], utc(day, 9))
    ids["a10"] = book_via_service(session_factory, c2, a["provider_id"], utc(day, 10))
    ids["a11"] = book_via_service(session_factory, c1, a["provider_id"], utc(day, 11))
    ids["b9"] = book_via_service(session_factory, c1, b["provider_id"], utc(day, 9))
    ids["b10"] = book_via_service(session_factory, c2, b["provider_id"], utc(day, 10))
    with session_factory() as s:  # cancel one directly
        s.get(Appointment, ids["a10"]).status = AppointmentStatus.cancelled
        s.commit()
    return {"a": a, "b": b, "ids": ids, "c1": c1, "c2": c2, "admin": admin_headers(client, session_factory)}


def listing(client, data, **params):
    r = client.get("/admin/appointments", params=params, headers=data["admin"])
    assert r.status_code == 200, r.text
    return r.json()


def ids_of(rows):
    return {r["id"] for r in rows}


def test_lists_everything_newest_first(client, data):
    rows = listing(client, data)
    assert ids_of(rows) == set(data["ids"].values())
    starts = [r["start_at"] for r in rows]
    assert starts == sorted(starts, reverse=True)


def test_response_has_no_internal_fields(client, data):
    row = listing(client, data)[0]
    assert set(row) == {"id", "customer_id", "provider_id", "start_at", "end_at", "status", "created_at", "review"}


def test_filter_by_provider(client, data):
    rows = listing(client, data, provider_id=data["b"]["provider_id"])
    assert ids_of(rows) == {data["ids"]["b9"], data["ids"]["b10"]}


def test_filter_by_customer(client, data):
    rows = listing(client, data, customer_id=data["c2"])
    assert ids_of(rows) == {data["ids"]["a10"], data["ids"]["b10"]}


def test_filter_by_status(client, data):
    assert ids_of(listing(client, data, status="cancelled")) == {data["ids"]["a10"]}
    assert len(listing(client, data, status="booked")) == 4


def test_filter_by_date_range_is_half_open(client, data):
    day = data["a"]["day"]
    rows = listing(client, data, date_from=utc(day, 10).isoformat(), date_to=utc(day, 11).isoformat())
    assert ids_of(rows) == {data["ids"]["a10"], data["ids"]["b10"]}  # 10:00 included, 11:00 excluded


def test_date_filter_accepts_other_utc_offsets(client, data):
    day = data["a"]["day"]
    # 15:30+05:30 == 10:00 UTC
    rows = listing(client, data, date_from=f"{day}T15:30:00+05:30", date_to=f"{day}T16:00:00+05:30")
    assert ids_of(rows) == {data["ids"]["a10"], data["ids"]["b10"]}


def test_filters_combine_with_and(client, data):
    rows = listing(client, data, provider_id=data["a"]["provider_id"], customer_id=data["c1"], status="booked")
    assert ids_of(rows) == {data["ids"]["a9"], data["ids"]["a11"]}


def test_no_match_returns_empty_list(client, data):
    assert listing(client, data, provider_id=99999) == []


def test_pagination_pages_do_not_overlap_and_cover_everything(client, data):
    page1 = listing(client, data, limit=2, skip=0)
    page2 = listing(client, data, limit=2, skip=2)
    page3 = listing(client, data, limit=2, skip=4)
    assert [len(p) for p in (page1, page2, page3)] == [2, 2, 1]
    assert ids_of(page1) | ids_of(page2) | ids_of(page3) == set(data["ids"].values())
    assert listing(client, data, skip=100) == []


@pytest.mark.parametrize(
    "params",
    [
        {"limit": 0}, {"limit": 101}, {"skip": -1}, {"status": "nonsense"}, {"provider_id": 0},
        {"date_from": "2030-01-01T00:00:00"},  # naive datetime
        {"date_from": "not-a-date"},
    ],
)
def test_invalid_query_parameters_are_422(client, data, params):
    assert client.get("/admin/appointments", params=params, headers=data["admin"]).status_code == 422


def test_reversed_date_range_is_422(client, data):
    day = data["a"]["day"]
    r = client.get(
        "/admin/appointments",
        params={"date_from": utc(day, 12).isoformat(), "date_to": utc(day, 9).isoformat()},
        headers=data["admin"],
    )
    assert r.status_code == 422
