# backend/app/database/base.py
# Purpose: declarative base class that all SQLAlchemy models inherit from (also used by Alembic).

from sqlalchemy import DDL, MetaData, event
from sqlalchemy.orm import DeclarativeBase

# Explicit constraint names make Alembic migrations deterministic and let us DROP them by name.
# Every CheckConstraint must therefore be given a name.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


# The exclusion constraints (provider_id = , time range &&) need the btree_gist extension.
# This covers Base.metadata.create_all(); the Alembic migration creates the extension explicitly.
event.listen(Base.metadata, "before_create", DDL("CREATE EXTENSION IF NOT EXISTS btree_gist"))
