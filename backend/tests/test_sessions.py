# backend/tests/test_sessions.py
# Purpose: a password reset signs the user out on every device (token version), and token handling edge cases.

import re
from datetime import datetime, timedelta, timezone

from jose import jwt

from app.core.config import settings
from app.core.security import create_access_token
from app.models import User
from app.services import email_service


def login(client, email="u@test.com", password="password123"):
    r = client.post("/auth/login", data={"username": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def register(client, email="u@test.com", password="password123"):
    client.post("/auth/register", json={"name": "U", "email": email, "password": password})
    return login(client, email, password)


def reset(client, email="u@test.com", new_password="brandnewpass1"):
    email_service.outbox.clear()
    client.post("/auth/forgot-password", json={"email": email})
    body = [e for e in email_service.outbox if "Reset your" in e.subject][-1].body
    token = re.search(r"reset-password\?token=([\w\-]+)", body).group(1)
    return client.post("/auth/reset-password", json={"token": token, "new_password": new_password})


def version(session_factory, email="u@test.com"):
    with session_factory() as s:
        return s.query(User).filter_by(email=email).one().token_version


def test_new_tokens_carry_the_version_and_a_type(client):
    token = register(client)["Authorization"].split()[1]
    claims = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    assert claims["tv"] == 0 and claims["typ"] == "access" and claims["sub"] == "1"


def test_a_password_reset_signs_out_every_device(client, session_factory):
    laptop = register(client)
    phone = login(client)
    tablet = login(client)
    assert all(client.get("/auth/me", headers=h).status_code == 200 for h in (laptop, phone, tablet))

    assert reset(client).status_code == 200
    assert version(session_factory) == 1
    for device in (laptop, phone, tablet):
        r = client.get("/auth/me", headers=device)
        assert r.status_code == 401 and "session has ended" in r.json()["detail"]


def test_logging_in_again_after_a_reset_works(client):
    old = register(client)
    reset(client)
    assert client.post("/auth/login", data={"username": "u@test.com", "password": "password123"}).status_code == 401  # old password gone
    fresh = login(client, password="brandnewpass1")
    assert client.get("/auth/me", headers=fresh).status_code == 200
    assert client.get("/auth/me", headers=old).status_code == 401  # the old session stays dead


def test_two_resets_keep_counting(client, session_factory):
    register(client)
    reset(client, new_password="brandnewpass1")
    reset(client, new_password="brandnewpass2")
    assert version(session_factory) == 2
    assert client.get("/auth/me", headers=login(client, password="brandnewpass2")).status_code == 200


def test_a_failed_reset_signs_nobody_out(client, session_factory):
    headers = register(client)
    r = client.post("/auth/reset-password", json={"token": "x" * 30, "new_password": "brandnewpass1"})
    assert r.status_code == 400
    assert version(session_factory) == 0 and client.get("/auth/me", headers=headers).status_code == 200


def test_a_used_reset_link_cannot_sign_you_out_again(client, session_factory):
    register(client)
    email_service.outbox.clear()
    client.post("/auth/forgot-password", json={"email": "u@test.com"})
    token = re.search(r"reset-password\?token=([\w\-]+)", email_service.outbox[-1].body).group(1)
    assert client.post("/auth/reset-password", json={"token": token, "new_password": "brandnewpass1"}).status_code == 200
    assert client.post("/auth/reset-password", json={"token": token, "new_password": "brandnewpass2"}).status_code == 400
    assert version(session_factory) == 1


def test_other_users_sessions_are_not_affected(client):
    mine = register(client, "u@test.com")
    theirs = register(client, "v@test.com")
    reset(client, "u@test.com")
    assert client.get("/auth/me", headers=mine).status_code == 401
    assert client.get("/auth/me", headers=theirs).status_code == 200


def test_tokens_from_before_this_feature_still_work_until_the_first_reset(client, session_factory):
    register(client)
    legacy = jwt.encode(
        {"sub": "1", "exp": datetime.now(timezone.utc) + timedelta(hours=1)}, settings.secret_key, algorithm=settings.algorithm
    )  # no "typ", no "tv"
    headers = {"Authorization": f"Bearer {legacy}"}
    assert client.get("/auth/me", headers=headers).status_code == 200
    reset(client)
    assert client.get("/auth/me", headers=headers).status_code == 401


def test_a_token_for_another_purpose_is_not_a_session(client):
    register(client)
    other = jwt.encode(
        {"sub": "1", "typ": "something_else", "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        settings.secret_key,
        algorithm=settings.algorithm,
    )
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {other}"}).status_code == 401


def test_a_token_with_a_future_version_is_refused(client):
    register(client)
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {create_access_token('1', token_version=5)}"}).status_code == 401


def test_password_change_does_not_sign_you_out(client):
    """Changing the password while logged in keeps your current session (a reset is for 'I lost control')."""
    headers = register(client)
    r = client.post("/auth/change-password", json={"current_password": "password123", "new_password": "brandnewpass1"}, headers=headers)
    assert r.status_code == 200 and client.get("/auth/me", headers=headers).status_code == 200
