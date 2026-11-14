# backend/tests/conftest.py
# Purpose: shared fixtures: PostgreSQL test database, clean tables per test, FastAPI test client.
#
# Needs a reachable PostgreSQL database. Override with TEST_DATABASE_URL; tests are skipped if it is unreachable.

import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

from app.database.base import Base
from app.database.session import get_db
from app.main import app
from app import models as _models  # noqa: F401  (registers all tables on Base.metadata)

TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL", "postgresql+psycopg2://slotbook:slotbook@localhost:5432/slotbook_test"
)


@pytest.fixture(scope="session")
def engine():
    eng = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
    try:
        eng.connect().close()
    except OperationalError:
        pytest.skip("PostgreSQL test database is not reachable (set TEST_DATABASE_URL)")
    Base.metadata.drop_all(eng)
    Base.metadata.create_all(eng)
    yield eng
    Base.metadata.drop_all(eng)
    eng.dispose()


@pytest.fixture()
def clean_db(engine):
    with engine.begin() as conn:
        conn.execute(
            text(
                "TRUNCATE appointment_history, appointments, blocked_slots, availability, "
                "providers, password_reset_tokens, users RESTART IDENTITY CASCADE"
            )
        )
    return engine


@pytest.fixture()
def session_factory(clean_db):
    return sessionmaker(bind=clean_db, autoflush=False)


@pytest.fixture()
def client(session_factory):
    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _isolate_global_state(monkeypatch):
    """Keep tests independent: fresh login counters, and emails collected in memory instead of logged."""
    from app.core.config import settings
    from app.core.rate_limit import login_limiter, password_reset_limiter

    login_limiter.reset_all()
    password_reset_limiter.reset_all()
    monkeypatch.setattr(settings, "email_backend", "memory")
    try:
        from app.services import email_service

        email_service.outbox.clear()
    except ImportError:  # email service not created yet
        pass
    yield
    login_limiter.reset_all()
    password_reset_limiter.reset_all()
