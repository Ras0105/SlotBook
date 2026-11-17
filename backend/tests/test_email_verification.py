# backend/tests/test_email_verification.py
# Purpose: email verification on sign-up: the emailed link, resending, gating of booking, address changes.

import re
from datetime import datetime, timedelta, timezone

import pytest
from jose import jwt

from app.core.config import settings
from app.core.security import create_access_token, create_email_verification_token
from app.models import User
from app.services import email_service
from tests.helpers import future_day, iso


@pytest.fixture(autouse=True)
def verification_on(monkeypatch):
    monkeypatch.setattr(settings, "email_verification_enabled", True)
    monkeypatch.setattr(settings, "frontend_url", "https://app.test")


def register(client, email="new@test.com", name="Nina", password="password123"):
    r = client.post("/auth/register", json={"name": name, "email": email, "password": password})
    assert r.status_code == 201, r.text
    login = client.post("/auth/login", data={"username": email, "password": password})
    return r.json(), {"Authorization": f"Bearer {login.json()['access_token']}"}


def link_token(to="new@test.com"):
    """The token in the newest verification email sent to `to`."""
    mails = [e for e in email_service.outbox if e.to == to and "Confirm your email" in e.subject]
    assert mails, f"no verification email for {to}: {[(e.to, e.subject) for e in email_service.outbox]}"
    match = re.search(r"https://app\.test/verify-email\?token=([\w.\-]+)", mails[-1].body)
    assert match, mails[-1].body
    return match.group(1)


def verify(client, token):
    return client.post("/auth/verify-email", json={"token": token})


# ---------------------------------------------------------------- sign-up
def test_registering_sends_a_verification_link_and_starts_unverified(client):
    user, headers = register(client)
    assert user["email_verified"] is False
    assert client.get("/auth/me", headers=headers).json()["email_verified"] is False
    (mail,) = [e for e in email_service.outbox if e.to == "new@test.com"]
    assert mail.subject == "Confirm your email for SlotBook"
    assert "Hi Nina" in mail.body and "48 hours" in mail.body and "https://app.test/verify-email?token=" in mail.body


def test_clicking_the_link_verifies(client):
    _, headers = register(client)
    r = verify(client, link_token())
    assert r.status_code == 200 and "verified" in r.json()["message"]
    assert client.get("/auth/me", headers=headers).json()["email_verified"] is True


def test_the_link_works_without_being_logged_in_and_twice(client):
    _, headers = register(client)
    token = link_token()
    assert verify(client, token).status_code == 200  # no Authorization header: any device works
    assert verify(client, token).status_code == 200  # opening it again is harmless
    assert client.get("/auth/me", headers=headers).json()["email_verified"] is True


def test_a_failed_registration_sends_no_email(client):
    register(client)
    email_service.outbox.clear()
    r = client.post("/auth/register", json={"name": "X", "email": "new@test.com", "password": "password123"})
    assert r.status_code == 409 and email_service.outbox == []


# ---------------------------------------------------------------- bad links
def _forge(**claims):
    payload = {"sub": "1", "email": "new@test.com", "typ": "verify_email", "exp": datetime.now(timezone.utc) + timedelta(hours=1)}
    payload.update(claims)
    return jwt.encode({k: v for k, v in payload.items() if v is not None}, settings.secret_key, algorithm=settings.algorithm)


def test_bad_links_are_refused(client):
    register(client)
    good = link_token()
    cases = {
        "garbage": "x" * 40,
        "tampered": good[:-3] + ("AAA" if not good.endswith("AAA") else "BBB"),
        "expired": create_email_verification_token(1, "new@test.com", hours=-1),
        "wrong secret": jwt.encode({"sub": "1", "email": "new@test.com", "typ": "verify_email"}, "another-secret-another-secret-12345", algorithm=settings.algorithm),
        "a session token": create_access_token("1"),
        "no email claim": _forge(email=None),
        "unknown user": _forge(sub="9999"),
        "non-numeric user": _forge(sub="abc"),
        "someone else's address": _forge(email="other@test.com"),
    }
    for name, token in cases.items():
        r = verify(client, token)
        assert r.status_code == 400, f"{name}: {r.status_code} {r.text}"
        assert "invalid or has expired" in r.json()["detail"], name


def test_a_short_or_missing_token_is_a_422(client):
    assert client.post("/auth/verify-email", json={"token": "abc"}).status_code == 422
    assert client.post("/auth/verify-email", json={}).status_code == 422


def test_a_verification_link_cannot_be_used_as_a_login_token(client):
    register(client)
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {link_token()}"})
    assert r.status_code == 401


# ---------------------------------------------------------------- what unverified users may do
def make_provider_with_hours(client, session_factory):
    from tests.helpers import auth_headers

    # A provider created while verification is off in the helper's world: go through the API as a verified user.
    day = future_day(7)
    _, h = register(client, "doc@test.com", "Doc")
    verify(client, link_token("doc@test.com"))
    pid = client.post("/providers", json={"service_name": "Checkup"}, headers=h).json()["id"]
    client.post("/availability", json={"weekday": day.weekday(), "start_time": "09:00:00", "end_time": "12:00:00"}, headers=h)
    return pid, day


def test_unverified_users_cannot_book_but_verified_ones_can(client, session_factory):
    pid, day = make_provider_with_hours(client, session_factory)
    _, headers = register(client)
    body = {"provider_id": pid, "start_at": iso(day, 9)}

    r = client.post("/appointments", json=body, headers=headers)
    assert r.status_code == 403 and "verify your email" in r.json()["detail"].lower()

    verify(client, link_token())
    assert client.post("/appointments", json=body, headers=headers).status_code == 201


def test_unverified_users_cannot_become_providers_until_verified(client):
    _, headers = register(client)
    r = client.post("/providers", json={"service_name": "Tutoring"}, headers=headers)
    assert r.status_code == 403
    verify(client, link_token())
    assert client.post("/providers", json={"service_name": "Tutoring"}, headers=headers).status_code == 201


def test_unverified_users_can_still_log_in_browse_and_read_their_own_things(client, session_factory):
    pid, _ = make_provider_with_hours(client, session_factory)
    _, headers = register(client)
    assert client.get("/providers").status_code == 200
    assert client.get(f"/providers/{pid}").status_code == 200
    assert client.get("/appointments/me", headers=headers).status_code == 200
    assert client.get("/appointments/next", headers=headers).status_code == 200
    assert client.patch("/auth/me", json={"name": "Nina B"}, headers=headers).status_code == 200


def test_with_verification_off_nobody_is_held_back_and_no_email_is_sent(client, monkeypatch):
    monkeypatch.setattr(settings, "email_verification_enabled", False)
    user, headers = register(client)
    assert user["email_verified"] is True
    assert not [e for e in email_service.outbox if "Confirm your email" in e.subject]
    assert client.post("/providers", json={"service_name": "Tutoring"}, headers=headers).status_code == 201


# ---------------------------------------------------------------- resend
def test_resend_sends_a_fresh_working_link(client):
    _, headers = register(client)
    email_service.outbox.clear()
    r = client.post("/auth/resend-verification", headers=headers)
    assert r.status_code == 200 and "new verification link" in r.json()["message"]
    assert verify(client, link_token()).status_code == 200


def test_resend_is_limited_and_says_when_to_retry(client):
    _, headers = register(client)
    for _ in range(settings.verification_resend_max):
        assert client.post("/auth/resend-verification", headers=headers).status_code == 200
    r = client.post("/auth/resend-verification", headers=headers)
    assert r.status_code == 429 and int(r.headers["Retry-After"]) > 0


def test_resend_limit_is_per_user(client):
    _, a = register(client, "a@test.com", "A")
    _, b = register(client, "b@test.com", "B")
    for _ in range(settings.verification_resend_max):
        client.post("/auth/resend-verification", headers=a)
    assert client.post("/auth/resend-verification", headers=a).status_code == 429
    assert client.post("/auth/resend-verification", headers=b).status_code == 200


def test_resend_when_already_verified_sends_nothing(client):
    _, headers = register(client)
    verify(client, link_token())
    email_service.outbox.clear()
    r = client.post("/auth/resend-verification", headers=headers)
    assert r.status_code == 200 and "already verified" in r.json()["message"]
    assert email_service.outbox == []


def test_resend_needs_a_login(client):
    assert client.post("/auth/resend-verification").status_code == 401


# ---------------------------------------------------------------- changing the address
def test_changing_email_needs_verifying_the_new_address(client):
    _, headers = register(client)
    old_token = link_token()
    verify(client, old_token)
    email_service.outbox.clear()

    r = client.patch("/auth/me", json={"email": "new2@test.com", "current_password": "password123"}, headers=headers)
    assert r.status_code == 200 and r.json()["email"] == "new2@test.com" and r.json()["email_verified"] is False
    assert [e.to for e in email_service.outbox if "Confirm your email" in e.subject] == ["new2@test.com"]

    assert verify(client, old_token).status_code == 400  # the link for the OLD address cannot verify the new one
    assert verify(client, link_token("new2@test.com")).status_code == 200
    assert client.get("/auth/me", headers=headers).json()["email_verified"] is True


def test_changing_only_the_name_keeps_the_address_verified(client):
    _, headers = register(client)
    verify(client, link_token())
    email_service.outbox.clear()
    r = client.patch("/auth/me", json={"name": "Nina B"}, headers=headers)
    assert r.json()["email_verified"] is True and email_service.outbox == []


# ---------------------------------------------------------------- password reset proves the inbox
def test_resetting_the_password_also_verifies_the_address(client):
    _, headers = register(client)
    client.post("/auth/forgot-password", json={"email": "new@test.com"})
    match = re.search(r"reset-password\?token=([\w\-]+)", [e for e in email_service.outbox if "Reset your" in e.subject][-1].body)
    assert client.post("/auth/reset-password", json={"token": match.group(1), "new_password": "brandnewpass1"}).status_code == 200
    login = client.post("/auth/login", data={"username": "new@test.com", "password": "brandnewpass1"})
    fresh = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert client.get("/auth/me", headers=fresh).json()["email_verified"] is True


# ---------------------------------------------------------------- existing users and admin
def test_a_user_row_without_a_verification_date_reports_unverified(session_factory):
    with session_factory() as s:
        u = User(name="Old", email="old@test.com", password_hash="x")
        s.add(u)
        s.commit()
        assert u.email_verified is False
        u.email_verified_at = datetime.now(timezone.utc)
        assert u.email_verified is True
