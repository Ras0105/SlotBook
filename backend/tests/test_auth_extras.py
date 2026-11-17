# backend/tests/test_auth_extras.py
# Purpose: GET /auth/me, login rate limiting and CORS behaviour.

import pytest

from app.core.config import settings
from tests.helpers import auth_headers


def test_me_returns_current_user(client):
    headers = auth_headers(client, "me@test.com", "Mia")
    r = client.get("/auth/me", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body.pop("created_at")  # an ISO timestamp, used for "member since" on the profile page
    assert body == {"id": 1, "name": "Mia", "email": "me@test.com", "role": "customer", "phone": None, "reminders_enabled": True, "email_verified": True}


def test_me_reflects_role_change_after_creating_provider_profile(client):
    headers = auth_headers(client, "p@test.com")
    client.post("/providers", json={"service_name": "S"}, headers=headers)
    assert client.get("/auth/me", headers=headers).json()["role"] == "provider"


def test_me_requires_a_token(client):
    assert client.get("/auth/me").status_code == 401
    assert client.get("/auth/me", headers={"Authorization": "Bearer nope"}).status_code == 401


def login(client, email, password):
    return client.post("/auth/login", data={"username": email, "password": password})


def test_login_is_locked_after_too_many_failures(client, monkeypatch):
    monkeypatch.setattr(settings, "login_max_failed_attempts", 3)
    auth_headers(client, "a@test.com", password="password123")
    assert [login(client, "a@test.com", "bad").status_code for _ in range(3)] == [401, 401, 401]
    blocked = login(client, "a@test.com", "bad")
    assert blocked.status_code == 429 and int(blocked.headers["Retry-After"]) >= 1
    # even the correct password is refused while locked, otherwise guessing could continue
    assert login(client, "a@test.com", "password123").status_code == 429


def test_successful_login_resets_the_counter(client, monkeypatch):
    monkeypatch.setattr(settings, "login_max_failed_attempts", 3)
    auth_headers(client, "a@test.com", password="password123")
    for _ in range(2):
        login(client, "a@test.com", "bad")
    assert login(client, "a@test.com", "password123").status_code == 200
    for _ in range(2):  # counter restarted, so two more failures are still allowed
        assert login(client, "a@test.com", "bad").status_code == 401


def test_lockout_is_per_email(client, monkeypatch):
    monkeypatch.setattr(settings, "login_max_failed_attempts", 2)
    auth_headers(client, "a@test.com", password="password123")
    auth_headers(client, "b@test.com", password="password123")
    for _ in range(2):
        login(client, "a@test.com", "bad")
    assert login(client, "a@test.com", "bad").status_code == 429
    assert login(client, "b@test.com", "password123").status_code == 200


def test_lockout_expires_after_the_window(client, monkeypatch):
    import time as time_module

    monkeypatch.setattr(settings, "login_max_failed_attempts", 1)
    monkeypatch.setattr(settings, "login_window_seconds", 10)
    auth_headers(client, "a@test.com", password="password123")
    login(client, "a@test.com", "bad")
    assert login(client, "a@test.com", "password123").status_code == 429
    real = time_module.monotonic
    monkeypatch.setattr(time_module, "monotonic", lambda: real() + 11)
    assert login(client, "a@test.com", "password123").status_code == 200


def test_cors_allows_the_configured_frontend_only(client):
    ok = client.options(
        "/providers",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
    )
    assert ok.status_code == 200
    assert ok.headers["access-control-allow-origin"] == "http://localhost:5173"
    bad = client.options(
        "/providers",
        headers={"Origin": "http://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in bad.headers


def test_cors_preflight_allows_authorization_header(client):
    r = client.options(
        "/appointments",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert r.status_code == 200
    assert "authorization" in r.headers["access-control-allow-headers"].lower()


def test_production_rejects_wildcard_cors():
    from pydantic import ValidationError

    from app.core.config import Settings

    with pytest.raises(ValidationError, match="CORS_ORIGINS"):
        Settings(_env_file=None, environment="production", secret_key="k" * 40, cors_origins="*")
