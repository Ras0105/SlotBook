# backend/app/routes/auth.py
# Purpose: HTTP endpoints for registration, login and "who am I".

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.rate_limit import login_limiter
from app.database.session import get_db
from app.dependencies.auth import get_current_user
from app.models import User
from app.schemas.auth import RegisterRequest, Token, UserOut
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(data: RegisterRequest, db: Session = Depends(get_db)):
    return auth_service.register(db, data)


@router.post("/login", response_model=Token)
def login(request: Request, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    # OAuth2 form uses the field name "username"; we treat it as the email.
    # Failed attempts are counted per (client IP, email), so one attacker cannot lock out everyone,
    # and a successful login clears the counter.
    key = f"{request.client.host if request.client else 'unknown'}|{form.username.strip().lower()}"
    wait = login_limiter.retry_after(key, settings.login_max_failed_attempts, settings.login_window_seconds)
    if wait:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many failed login attempts. Please try again later.",
            headers={"Retry-After": str(wait)},
        )
    try:
        token = auth_service.login(db, form.username, form.password)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_401_UNAUTHORIZED:
            login_limiter.record_failure(key, settings.login_window_seconds)
        raise
    login_limiter.reset(key)
    return Token(access_token=token)


@router.get("/me", response_model=UserOut)
def read_me(user: User = Depends(get_current_user)):
    """The logged-in user (id, name, email, role). The frontend uses this to decide which pages to show."""
    return user
