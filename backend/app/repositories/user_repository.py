# backend/app/repositories/user_repository.py
# Purpose: database queries for users (no business logic here).

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User


def get_by_id(db: Session, user_id: int) -> User | None:
    return db.get(User, user_id)


def get_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email))


def list_users(db: Session, skip: int = 0, limit: int = 50) -> list[User]:
    return list(db.scalars(select(User).order_by(User.id).offset(skip).limit(limit)))


def create(db: Session, user: User) -> User:
    """Add the user and flush to get its id. The caller commits."""
    db.add(user)
    db.flush()
    return user
