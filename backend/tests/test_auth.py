# backend/tests/test_auth.py
# Purpose: registration, login, password hashing and token validation.

from datetime import timedelta

from sqlalchemy import select

from app.core.security import create_access_token
from app.models import User

CREDS = {"name": "Ann", "email": "ann@test.com", "password": "password123"}


def register(client, **overrides):
    return client.post("/auth/register", json={**CREDS, **overrides})


def login(client, email=CREDS["email"], password=CREDS["password"]):
    return client.post("/auth/login", data={"username": email, "password": password})


def test_register_returns_user_without_password_hash(client):
    r = register(client)
    assert r.status_code == 201
    body = r.json()
    assert body["email"] == CREDS["email"] and body["role"] == "customer"
    assert "password" not in body and "password_hash" not in body


def test_duplicate_email_is_409(client):
    assert register(client).status_code == 201
    assert register(client).status_code == 409


def test_cannot_self_register_as_admin_or_provider(client, session_factory):
    r = register(client, role="admin")  # extra field must be ignored, not honoured
    assert r.status_code == 201 and r.json()["role"] == "customer"


def test_password_is_stored_hashed(client, session_factory):
    register(client)
    with session_factory() as s:
        user = s.scalar(select(User).where(User.email == CREDS["email"]))
    assert user.password_hash != CREDS["password"]
    assert user.password_hash.startswith("$argon2")


def test_invalid_registration_data_is_422(client):
    assert register(client, email="not-an-email").status_code == 422
    assert register(client, password="short").status_code == 422
    assert register(client, name="").status_code == 422


def test_login_success_returns_bearer_token(client):
    register(client)
    r = login(client)
    assert r.status_code == 200
    assert r.json()["token_type"] == "bearer" and r.json()["access_token"]


def test_login_wrong_password_and_unknown_user_are_401_with_same_message(client):
    register(client)
    wrong = login(client, password="wrong-password")
    unknown = login(client, email="nobody@test.com")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()  # does not reveal which emails exist


def test_protected_route_requires_a_valid_token(client):
    assert client.get("/appointments/me").status_code == 401
    assert client.get("/appointments/me", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_expired_token_is_rejected(client):
    register(client)
    expired = create_access_token("1", expires_minutes=-5)
    assert client.get("/appointments/me", headers={"Authorization": f"Bearer {expired}"}).status_code == 401


def test_token_for_deleted_user_is_rejected(client):
    token = create_access_token("999999")
    assert client.get("/appointments/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_token_signed_with_another_secret_is_rejected(client):
    from jose import jwt

    forged = jwt.encode({"sub": "1"}, "some-other-secret", algorithm="HS256")
    assert client.get("/appointments/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
