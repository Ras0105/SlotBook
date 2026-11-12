# backend/app/database/base.py
# Purpose: declarative base class that all SQLAlchemy models inherit from (also used by Alembic).

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
