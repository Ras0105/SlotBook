# backend/tests/test_pagination.py
# Purpose: pagination bounds, ordering and filters on the public / per-user list endpoints.

import pytest

from tests.helpers import auth_headers, book_via_service, seed_provider, utc


@pytest.fixture()
def providers(client):
    for i in range(5):
        h = auth_headers(client, f"p{i}@test.com", f"P{i}")
        client.post("/providers", json={"service_name": f"{'Dental' if i % 2 else 'Massage'} {i}"}, headers=h)


def test_providers_pagination(client, providers):
    all_ids = [p["id"] for p in client.get("/providers").json()]
    assert len(all_ids) == 5 and all_ids == sorted(all_ids)  # stable order
    first = [p["id"] for p in client.get("/providers", params={"limit": 2}).json()]
    second = [p["id"] for p in client.get("/providers", params={"limit": 2, "skip": 2}).json()]
    assert first + second == all_ids[:4]
    assert client.get("/providers", params={"skip": 50}).json() == []


def test_providers_search_is_case_insensitive_and_literal(client, providers):
    assert len(client.get("/providers", params={"search": "dental"}).json()) == 2
    assert len(client.get("/providers", params={"search": "MASSAGE"}).json()) == 3
    assert client.get("/providers", params={"search": "nothing-like-this"}).json() == []


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 101}, {"skip": -1}, {"search": "x" * 101}])
def test_providers_invalid_pagination_is_422(client, params):
    assert client.get("/providers", params=params).status_code == 422


def test_my_appointments_pagination_and_status_filter(client, session_factory):
    seed = seed_provider(session_factory, n_customers=1)
    cid = seed["customer_ids"][0]
    for hour, minute in [(9, 0), (9, 30), (10, 0)]:
        book_via_service(session_factory, cid, seed["provider_id"], utc(seed["day"], hour, minute))

    from app.core.security import create_access_token

    headers = {"Authorization": f"Bearer {create_access_token(str(cid))}"}
    everything = client.get("/appointments/me", headers=headers).json()
    assert len(everything) == 3
    starts = [a["start_at"] for a in everything]
    assert starts == sorted(starts, reverse=True)

    paged = client.get("/appointments/me", params={"limit": 2}, headers=headers).json()
    rest = client.get("/appointments/me", params={"limit": 2, "skip": 2}, headers=headers).json()
    assert [a["id"] for a in paged + rest] == [a["id"] for a in everything]

    assert client.get("/appointments/me", params={"status": "cancelled"}, headers=headers).json() == []
    assert len(client.get("/appointments/me", params={"status": "booked"}, headers=headers).json()) == 3
    for bad in ({"limit": 0}, {"limit": 101}, {"skip": -1}, {"status": "bogus"}):
        assert client.get("/appointments/me", params=bad, headers=headers).status_code == 422
