# backend/tests/test_profile.py
# Purpose: PATCH /auth/me (view and update your own profile).

from tests.helpers import auth_headers


def me(client, headers):
    return client.get("/auth/me", headers=headers).json()


def test_update_name_only(client):
    headers = auth_headers(client, "a@test.com", "Alice")
    r = client.patch("/auth/me", json={"name": "  Alice Rao  "}, headers=headers)
    assert r.status_code == 200
    assert r.json()["name"] == "Alice Rao"  # trimmed
    assert me(client, headers)["name"] == "Alice Rao"


def test_blank_name_is_refused(client):
    headers = auth_headers(client, "a@test.com", "Alice")
    assert client.patch("/auth/me", json={"name": "   "}, headers=headers).status_code == 422
    assert me(client, headers)["name"] == "Alice"


def test_changing_email_requires_the_current_password(client):
    headers = auth_headers(client, "a@test.com", "Alice", password="password123")
    missing = client.patch("/auth/me", json={"email": "new@test.com"}, headers=headers)
    wrong = client.patch("/auth/me", json={"email": "new@test.com", "current_password": "nope-nope"}, headers=headers)
    assert missing.status_code == 400 and wrong.status_code == 400  # 400, never 401 (that would log the user out)
    assert me(client, headers)["email"] == "a@test.com"


def test_change_email_then_log_in_with_the_new_one(client):
    headers = auth_headers(client, "a@test.com", "Alice", password="password123")
    r = client.patch("/auth/me", json={"email": "new@test.com", "current_password": "password123"}, headers=headers)
    assert r.status_code == 200 and r.json()["email"] == "new@test.com"
    assert client.post("/auth/login", data={"username": "new@test.com", "password": "password123"}).status_code == 200
    assert client.post("/auth/login", data={"username": "a@test.com", "password": "password123"}).status_code == 401
    assert client.get("/auth/me", headers=headers).status_code == 200  # the existing session keeps working


def test_cannot_take_someone_elses_email(client):
    auth_headers(client, "taken@test.com", "Bob")
    headers = auth_headers(client, "a@test.com", "Alice", password="password123")
    r = client.patch("/auth/me", json={"email": "taken@test.com", "current_password": "password123"}, headers=headers)
    assert r.status_code == 409


def test_sending_your_own_email_again_needs_no_password(client):
    headers = auth_headers(client, "a@test.com", "Alice")
    r = client.patch("/auth/me", json={"name": "Alice B", "email": "a@test.com"}, headers=headers)
    assert r.status_code == 200 and r.json()["name"] == "Alice B"


def test_role_cannot_be_changed_through_the_profile(client):
    headers = auth_headers(client, "a@test.com", "Alice")
    client.patch("/auth/me", json={"role": "admin", "id": 99}, headers=headers)  # unknown fields are ignored
    body = me(client, headers)
    assert body["role"] == "customer" and body["id"] == 1


def test_profile_update_requires_login(client):
    assert client.patch("/auth/me", json={"name": "X"}).status_code == 401
