import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token, hash_password, verify_password
from app.models import PasswordResetToken, Role, User
from app.repositories import password_reset_repository, user_repository
from app.schemas.auth import ProfileUpdate, RegisterRequest
from app.services import notification_service
from app.services.email_service import Email

INVALID_RESET_LINK = "This reset link is invalid or has expired. Request a new one."


class CurrentPasswordError(HTTPException):
    """The 'current password' typed by a logged-in user was wrong.

    Deliberately a 400, not a 401: the frontend treats a 401 on an authenticated request as "session over"
    and logs the person out, which would be the wrong reaction to a typo.
    """

    def __init__(self, detail: str = "Current password is incorrect") -> None:
        super().__init__(status.HTTP_400_BAD_REQUEST, detail)


def register(db: Session, data: RegisterRequest) -> User:
    if user_repository.get_by_email(db, data.email):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    user = User(name=data.name, email=data.email, password_hash=hash_password(data.password), role=Role.customer)
    user_repository.create(db, user)
    db.commit()
    return user


def login(db: Session, email: str, password: str) -> str:
    user = user_repository.get_by_email(db, email)
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    return create_access_token(str(user.id))


# ---- profile

def update_profile(db: Session, user: User, data: ProfileUpdate) -> User:
    """Change name and/or email. Changing the email needs the current password (it is the login name)."""
    if data.email is not None and data.email != user.email:
        if not data.current_password:
            raise CurrentPasswordError("Enter your current password to change your email address.")
        if not verify_password(data.current_password, user.password_hash):
            raise CurrentPasswordError()
        taken = user_repository.get_by_email(db, data.email)
        if taken and taken.id != user.id:
            raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
        user.email = data.email
    if data.name is not None:
        user.name = data.name
    if data.phone is not None:
        user.phone = data.phone or None  # "" removes it
    if data.reminders_enabled is not None:
        user.reminders_enabled = data.reminders_enabled
    try:
        db.commit()
    except IntegrityError:  # someone registered this email between our check and the commit
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    db.refresh(user)
    return user


def change_password(db: Session, user: User, current_password: str, new_password: str) -> Email:
    if not verify_password(current_password, user.password_hash):
        raise CurrentPasswordError()
    if verify_password(new_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a password different from your current one.")
    user.password_hash = hash_password(new_password)
    db.commit()
    return notification_service.password_changed(user)


# ---- forgot / reset password

def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def request_password_reset(db: Session, email: str) -> list[Email]:
    """Create a reset link for this email and return the email to send (empty list if no such account).

    The caller answers every request the same way, so nobody can use this to find out who has an account.
    Send the returned emails only AFTER this returns (the token is already committed).
    """
    user = user_repository.get_by_email(db, email)
    if not user:
        return []
    now = datetime.now(timezone.utc)
    raw = secrets.token_urlsafe(32)
    password_reset_repository.expire_open_tokens(db, user.id, now)  # a new link replaces older ones
    password_reset_repository.create(
        db,
        PasswordResetToken(
            user_id=user.id,
            token_hash=_hash_token(raw),
            expires_at=now + timedelta(minutes=settings.password_reset_expire_minutes),
        ),
    )
    db.commit()
    link = f"{settings.frontend_url.rstrip('/')}/reset-password?token={raw}"
    return [notification_service.password_reset(user, link, settings.password_reset_expire_minutes)]


def reset_password(db: Session, token: str, new_password: str) -> Email:
    now = datetime.now(timezone.utc)
    row = password_reset_repository.get_by_hash_for_update(db, _hash_token(token))
    if row is None or row.used_at is not None or row.expires_at <= now:
        db.rollback()  # release the row lock
        raise HTTPException(status.HTTP_400_BAD_REQUEST, INVALID_RESET_LINK)
    user = user_repository.get_by_id(db, row.user_id)
    user.password_hash = hash_password(new_password)
    password_reset_repository.expire_open_tokens(db, user.id, now)  # this link and any other open ones
    db.commit()
    return notification_service.password_changed(user)
