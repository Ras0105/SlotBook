# backend/app/dependencies/auth.py
# Purpose: resolve the current user from the JWT and enforce role-based access.

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import decode_access_claims
from app.database.session import get_db
from app.models import Role, User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    claims = decode_access_claims(token)
    subject = claims.get("sub") if claims else None
    if subject is None or not subject.isdigit():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = db.get(User, int(subject))
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    # A password reset raises the user's token version: every session started before it is over.
    if claims.get("tv", 0) != user.token_version:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session has ended. Log in again.")
    return user


def require_verified_email(user: User = Depends(get_current_user)) -> User:
    """For actions that need a confirmed email address (booking, becoming a provider)."""
    if not user.email_verified:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Please verify your email address first. We sent you a link; you can ask for a new one on your profile.",
        )
    return user


def require_role(*roles: Role):
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")
        return user

    return checker


def require_verified_role(*roles: Role):
    """Like require_role, and the email address must be verified too."""

    def checker(user: User = Depends(require_verified_email)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")
        return user

    return checker
