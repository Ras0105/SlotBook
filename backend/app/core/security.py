# backend/app/core/security.py
# Purpose: password hashing (Argon2) and JWT access-token creation/decoding.

from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")


def hash_password(password: str) -> str:
    """Return a secure hash of the plaintext password."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Check a plaintext password against its stored hash."""
    return pwd_context.verify(plain_password, hashed_password)


ACCESS = "access"
VERIFY_EMAIL = "verify_email"


def create_access_token(subject: str, token_version: int = 0, expires_minutes: int | None = None) -> str:
    """Create a signed session JWT. 'sub' is the user id, 'tv' the user's token version at login time.

    Raising users.token_version (e.g. after a password reset) makes every older token stop working.
    """
    minutes = expires_minutes or settings.access_token_expire_minutes
    expire = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    payload = {"sub": subject, "exp": expire, "typ": ACCESS, "tv": token_version}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_access_claims(token: str) -> dict | None:
    """The claims of a valid SESSION token, or None. Tokens made for other purposes (typ != access) are refused,
    so an emailed verification link can never be used as a login token. Tokens issued before 'typ' and 'tv'
    existed have neither claim; they count as access tokens with version 0."""
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        return None
    if payload.get("typ", ACCESS) != ACCESS:
        return None
    return payload


def decode_access_token(token: str) -> str | None:
    """Return the user id (sub) from a valid session token, or None if invalid/expired."""
    claims = decode_access_claims(token)
    return claims.get("sub") if claims else None


def create_email_verification_token(user_id: int, email: str, hours: int | None = None) -> str:
    """A signed link token that proves 'the owner of this inbox clicked'. Bound to the address it was sent to,
    so after an email change the old link no longer verifies the new address."""
    expire = datetime.now(timezone.utc) + timedelta(hours=hours or settings.email_verification_hours)
    payload = {"sub": str(user_id), "email": email, "typ": VERIFY_EMAIL, "exp": expire}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def decode_email_verification_token(token: str) -> tuple[int, str] | None:
    """(user id, email) from a valid verification token, or None."""
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        return None
    if payload.get("typ") != VERIFY_EMAIL or not str(payload.get("sub", "")).isdigit() or not payload.get("email"):
        return None
    return int(payload["sub"]), payload["email"]
