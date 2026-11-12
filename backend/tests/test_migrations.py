# backend/tests/test_migrations.py
# Purpose: Alembic migrations build the same schema as the models, run both ways, and enforce the constraints.

import os
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError, OperationalError

from app.database.base import Base
from app import models as _models  # noqa: F401
from tests.conftest import TEST_DATABASE_URL

BACKEND_DIR = Path(__file__).resolve().parents[1]
MIGRATION_DB = "slotbook_migration_test"


@pytest.fixture()
def migration_url():
    """A scratch database, so migrations never touch the schema the other tests use."""
    base = make_url(TEST_DATABASE_URL)
    admin = create_engine(base.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as c:
            c.execute(text(f"DROP DATABASE IF EXISTS {MIGRATION_DB}"))
            c.execute(text(f"CREATE DATABASE {MIGRATION_DB}"))
    except OperationalError:
        pytest.skip("cannot create a scratch database (needs CREATEDB permission)")
    url = base.set(database=MIGRATION_DB).render_as_string(hide_password=False)
    yield url
    with admin.connect() as c:
        c.execute(text(f"DROP DATABASE IF EXISTS {MIGRATION_DB} WITH (FORCE)"))
    admin.dispose()


def alembic_config(url: str) -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    return cfg


def test_upgrade_matches_models_and_downgrade_is_clean(migration_url):
    cfg = alembic_config(migration_url)
    command.upgrade(cfg, "head")

    engine = create_engine(migration_url)
    with engine.connect() as conn:
        drift = compare_metadata(MigrationContext.configure(conn, opts={"compare_type": True}), Base.metadata)
        assert drift == [], f"models and migrations disagree: {drift}"
        extensions = {r[0] for r in conn.execute(text("SELECT extname FROM pg_extension"))}
        assert "btree_gist" in extensions

    command.downgrade(cfg, "base")
    with engine.connect() as conn:
        assert set(inspect(conn).get_table_names()) == {"alembic_version"}
        types = {r[0] for r in conn.execute(text("SELECT typname FROM pg_type WHERE typname IN ('role','appointmentstatus')"))}
        assert types == set()  # enum types are removed too, so upgrade can run again
    command.upgrade(cfg, "head")  # and again
    engine.dispose()


def test_migrated_schema_enforces_the_constraints(migration_url):
    command.upgrade(alembic_config(migration_url), "head")
    engine = create_engine(migration_url)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO users (name,email,password_hash,role,created_at) VALUES ('o','o@t.com','x','provider',now()), ('c','c@t.com','x','customer',now())"))
        conn.execute(text("INSERT INTO providers (user_id,service_name,appointment_duration_minutes,timezone) VALUES (1,'S',30,'UTC')"))

    def fails(sql, constraint):
        with pytest.raises(IntegrityError, match=constraint):
            with engine.begin() as conn:
                conn.execute(text(sql))

    fails("INSERT INTO providers (user_id,service_name,appointment_duration_minutes,timezone) VALUES (2,'S',0,'UTC')", "ck_providers_duration_positive")
    fails("INSERT INTO availability (provider_id,weekday,start_time,end_time) VALUES (1,7,'09:00','10:00')", "ck_availability_weekday_range")
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO availability (provider_id,weekday,start_time,end_time) VALUES (1,1,'09:00','12:00')"))
    fails("INSERT INTO availability (provider_id,weekday,start_time,end_time) VALUES (1,1,'11:00','13:00')", "ex_availability_no_overlap")
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO appointments (customer_id,provider_id,start_at,end_at,status,created_at) VALUES (2,1,'2030-01-01 10:00+00','2030-01-01 10:30+00','booked',now())"))
    fails("INSERT INTO appointments (customer_id,provider_id,start_at,end_at,status,created_at) VALUES (2,1,'2030-01-01 10:15+00','2030-01-01 10:45+00','booked',now())", "ex_appointments_no_overlap")
    engine.dispose()
