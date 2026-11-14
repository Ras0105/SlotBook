# backend/app/repositories/password_reset_repository.py
# Purpose: database queries for password reset tokens (no business logic here).

from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import PasswordResetToken


def create(db: Session, token: PasswordResetToken) -> PasswordResetToken:
    db.add(token)
    db.flush()
    return token


def get_by_hash_for_update(db: Session, token_hash: str) -> PasswordResetToken | None:
    """Lock the row so two requests using the same link at the same instant cannot both succeed."""
    return db.scalar(
        select(PasswordResetToken).where(PasswordResetToken.token_hash == token_hash).with_for_update()
    )


def expire_open_tokens(db: Session, user_id: int, now: datetime) -> None:
    """Mark every still-unused token of this user as used (a newer link replaces older ones)."""
    db.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.user_id == user_id, PasswordResetToken.used_at.is_(None))
        .values(used_at=now)
    )
