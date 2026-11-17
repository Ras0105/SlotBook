# backend/tests/test_password_reset.py
# Purpose: forgot-password / reset-password flow, and changing the password while logged in.

import re
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models import PasswordResetToken
from app.services import email_service
from tests.helpers import auth_headers


def login(client, email, password):
    return client.post("/auth/login", data={"username": email, "password": password})


def forgot(client, email):
    return client.post("/auth/forgot-password", json={"email": email})


def token_from_outbox() -> str:
    link = email_service.outbox[-1].body
    return re.search(r"reset-password\?token=([\w-]+)", link).group(1)


@pytest.fixture()
def user(client):
    auth_headers(client, "mia@test.com", "Mia", password="old-password-1")
    email_service.outbox.clear()
    return "mia@test.com"


def test_forgot_password_emails_a_reset_link(client, user):
    r = forgot(client, user)
    assert r.status_code == 202
    assert len(email_service.outbox) == 1
    mail = email_service.outbox[0]
    assert mail.to == user and "Reset your SlotBook password" in mail.subject
    assert f"{settings.frontend_url.rstrip('/')}/reset-password?token=" in mail.body


def test_answer_is_the_same_for_unknown_emails_and_sends_nothing(client, user):
    known, unknown = forgot(client, user), forgot(client, "nobody@test.com")
    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()
    assert [m.to for m in email_service.outbox] == [user]


def test_token_is_stored_hashed_not_in_plain_text(client, user, session_factory):
    forgot(client, user)
    raw = token_from_outbox()
    with session_factory() as s:
        row = s.scalar(select(PasswordResetToken))
        assert row.token_hash != raw and raw not in row.token_hash and len(row.token_hash) == 64


def test_reset_sets_new_password_and_old_one_stops_working(client, user):
    forgot(client, user)
    r = client.post("/auth/reset-password", json={"token": token_from_outbox(), "new_password": "brand-new-pass"})
    assert r.status_code == 200
    assert login(client, user, "brand-new-pass").status_code == 200
    assert login(client, user, "old-password-1").status_code == 401
    assert email_service.outbox[-1].subject == "Your SlotBook password was changed"  # security notice


def test_a_link_works_only_once(client, user):
    forgot(client, user)
    token = token_from_outbox()
    assert client.post("/auth/reset-password", json={"token": token, "new_password": "brand-new-pass"}).status_code == 200
    again = client.post("/auth/reset-password", json={"token": token, "new_password": "another-pass-9"})
    assert again.status_code == 400 and "invalid or has expired" in again.json()["detail"]
    assert login(client, user, "brand-new-pass").status_code == 200


def test_expired_link_is_refused(client, user, session_factory):
    forgot(client, user)
    token = token_from_outbox()
    with session_factory() as s:
        row = s.scalar(select(PasswordResetToken))
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        s.commit()
    r = client.post("/auth/reset-password", json={"token": token, "new_password": "brand-new-pass"})
    assert r.status_code == 400
    assert login(client, user, "old-password-1").status_code == 200  # nothing changed


def test_made_up_token_is_refused(client, user):
    r = client.post("/auth/reset-password", json={"token": "x" * 43, "new_password": "brand-new-pass"})
    assert r.status_code == 400


def test_a_newer_link_replaces_the_older_one(client, user):
    forgot(client, user)
    first = token_from_outbox()
    forgot(client, user)
    second = token_from_outbox()
    assert first != second
    assert client.post("/auth/reset-password", json={"token": first, "new_password": "brand-new-pass"}).status_code == 400
    assert client.post("/auth/reset-password", json={"token": second, "new_password": "brand-new-pass"}).status_code == 200


def test_new_password_must_be_at_least_8_characters(client, user):
    forgot(client, user)
    r = client.post("/auth/reset-password", json={"token": token_from_outbox(), "new_password": "short"})
    assert r.status_code == 422


def test_forgot_password_is_rate_limited_per_email(client, user, monkeypatch):
    monkeypatch.setattr(settings, "password_reset_max_requests", 2)
    assert [forgot(client, user).status_code for _ in range(2)] == [202, 202]
    blocked = forgot(client, user)
    assert blocked.status_code == 429 and int(blocked.headers["Retry-After"]) >= 1
    assert forgot(client, "other@test.com").status_code == 202  # other emails are unaffected


def test_forgot_password_rejects_a_malformed_email(client):
    assert forgot(client, "not-an-email").status_code == 422


# ---- change password while logged in

def test_change_password_needs_the_correct_current_password(client, user):
    headers = {"Authorization": f"Bearer {login(client, user, 'old-password-1').json()['access_token']}"}
    bad = client.post("/auth/change-password", json={"current_password": "wrong", "new_password": "brand-new-pass"}, headers=headers)
    assert bad.status_code == 400  # a 400, not a 401, so the frontend does not log the person out
    ok = client.post("/auth/change-password", json={"current_password": "old-password-1", "new_password": "brand-new-pass"}, headers=headers)
    assert ok.status_code == 200
    assert login(client, user, "brand-new-pass").status_code == 200
    assert login(client, user, "old-password-1").status_code == 401
    assert email_service.outbox[-1].subject == "Your SlotBook password was changed"


def test_change_password_refuses_the_same_password(client, user):
    headers = {"Authorization": f"Bearer {login(client, user, 'old-password-1').json()['access_token']}"}
    r = client.post("/auth/change-password", json={"current_password": "old-password-1", "new_password": "old-password-1"}, headers=headers)
    assert r.status_code == 400


def test_change_password_requires_login(client):
    r = client.post("/auth/change-password", json={"current_password": "a", "new_password": "brand-new-pass"})
    assert r.status_code == 401


def test_wrong_current_passwords_are_rate_limited(client, user, monkeypatch):
    monkeypatch.setattr(settings, "login_max_failed_attempts", 2)
    headers = {"Authorization": f"Bearer {login(client, user, 'old-password-1').json()['access_token']}"}
    body = {"current_password": "wrong", "new_password": "brand-new-pass"}
    assert [client.post("/auth/change-password", json=body, headers=headers).status_code for _ in range(2)] == [400, 400]
    blocked = client.post("/auth/change-password", json={**body, "current_password": "old-password-1"}, headers=headers)
    assert blocked.status_code == 429
