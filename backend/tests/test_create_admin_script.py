# backend/tests/test_create_admin_script.py
# Purpose: the CLI that bootstraps admin users (there is no API for it by design).

from sqlalchemy import select

from app.models import Role, User
from app.scripts import create_admin
from tests.helpers import auth_headers


def run(monkeypatch, session_factory, email, password="password123"):
    monkeypatch.setattr(create_admin, "SessionLocal", session_factory)
    monkeypatch.setenv("ADMIN_PASSWORD", password)
    return create_admin.main(["--email", email, "--name", "Root"])


def test_creates_admin_who_can_log_in_and_use_admin_api(client, session_factory, monkeypatch):
    assert run(monkeypatch, session_factory, "root@test.com") == 0
    token = client.post("/auth/login", data={"username": "root@test.com", "password": "password123"}).json()["access_token"]
    assert client.get("/admin/appointments", headers={"Authorization": f"Bearer {token}"}).status_code == 200


def test_promotes_existing_user_without_changing_password(client, session_factory, monkeypatch):
    auth_headers(client, "bob@test.com")
    assert run(monkeypatch, session_factory, "bob@test.com", password="different-pass") == 0
    with session_factory() as s:
        assert s.scalar(select(User.role).where(User.email == "bob@test.com")) == Role.admin
    ok = client.post("/auth/login", data={"username": "bob@test.com", "password": "password123"})
    assert ok.status_code == 200  # original password still works


def test_rejects_short_password(session_factory, monkeypatch):
    assert run(monkeypatch, session_factory, "x@test.com", password="short") == 1
