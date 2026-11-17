# backend/app/routes/auth.py
# Purpose: HTTP endpoints for registration, login, "who am I", profile, and password reset/change.

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.rate_limit import login_limiter, password_reset_limiter, verification_resend_limiter
from app.database.session import get_db
from app.dependencies.auth import get_current_user
from app.models import User
from app.schemas.auth import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    MessageOut,
    ProfileUpdate,
    RegisterRequest,
    ResetPasswordRequest,
    Token,
    UserOut,
    VerifyEmailRequest,
)
from app.services import auth_service, email_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _too_many(wait: int, message: str) -> HTTPException:
    return HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, message, headers={"Retry-After": str(wait)})


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(data: RegisterRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user = auth_service.register(db, data)
    if (email := auth_service.verification_email(user)) is not None:
        background_tasks.add_task(email_service.send_all, [email])
    return user


@router.post("/login", response_model=Token)
def login(request: Request, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    # OAuth2 form uses the field name "username"; we treat it as the email.
    # Failed attempts are counted per (client IP, email), so one attacker cannot lock out everyone,
    # and a successful login clears the counter.
    key = f"{request.client.host if request.client else 'unknown'}|{form.username.strip().lower()}"
    wait = login_limiter.retry_after(key, settings.login_max_failed_attempts, settings.login_window_seconds)
    if wait:
        raise _too_many(wait, "Too many failed login attempts. Please try again later.")
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


# ---- "current password" checks for a logged-in user (profile email change, change password).
# A wrong current password counts as a failed attempt, with the same limits as the login form,
# so a stolen session cannot be used to guess the password.

def _password_check_key(user: User) -> str:
    return f"password-check|{user.id}"


def _guard_password_checks(user: User) -> None:
    wait = login_limiter.retry_after(
        _password_check_key(user), settings.login_max_failed_attempts, settings.login_window_seconds
    )
    if wait:
        raise _too_many(wait, "Too many wrong passwords. Please try again later.")


@router.patch("/me", response_model=UserOut)
def update_me(
    data: ProfileUpdate,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update your name and/or email. Changing the email requires `current_password` and re-verifies the address."""
    _guard_password_checks(user)
    old_email = user.email
    try:
        updated = auth_service.update_profile(db, user, data)
        if updated.email != old_email and (email := auth_service.verification_email(updated)) is not None:
            background_tasks.add_task(email_service.send_all, [email])
        return updated
    except auth_service.CurrentPasswordError:
        if data.current_password:  # only a typed-but-wrong password counts as a guess
            login_limiter.record_failure(_password_check_key(user), settings.login_window_seconds)
        raise


@router.post("/change-password", response_model=MessageOut)
def change_password(
    data: ChangePasswordRequest,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _guard_password_checks(user)
    try:
        notice = auth_service.change_password(db, user, data.current_password, data.new_password)
    except auth_service.CurrentPasswordError:
        login_limiter.record_failure(_password_check_key(user), settings.login_window_seconds)
        raise
    login_limiter.reset(_password_check_key(user))
    background_tasks.add_task(email_service.send_all, [notice])
    return MessageOut(message="Password changed.")


# ---- forgot / reset password (no login needed)

@router.post("/forgot-password", response_model=MessageOut, status_code=status.HTTP_202_ACCEPTED)
def forgot_password(
    data: ForgotPasswordRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Email a reset link if the account exists. The answer is identical either way (no account probing)."""
    key = f"{request.client.host if request.client else 'unknown'}|{data.email.strip().lower()}"
    wait = password_reset_limiter.retry_after(
        key, settings.password_reset_max_requests, settings.password_reset_window_seconds
    )
    if wait:
        raise _too_many(wait, "Too many reset requests. Please try again later.")
    password_reset_limiter.record_failure(key, settings.password_reset_window_seconds)  # counts every request
    emails = auth_service.request_password_reset(db, data.email)
    if emails:
        background_tasks.add_task(email_service.send_all, emails)
    return MessageOut(message="If an account exists for that email, a reset link is on its way.")


@router.post("/reset-password", response_model=MessageOut)
def reset_password(data: ResetPasswordRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    notice = auth_service.reset_password(db, data.token, data.new_password)
    background_tasks.add_task(email_service.send_all, [notice])
    return MessageOut(message="Your password has been reset. You can log in now.")


# ---- email verification

@router.post("/verify-email", response_model=MessageOut)
def verify_email(data: VerifyEmailRequest, db: Session = Depends(get_db)):
    """Open from the emailed link (no login needed, so it works on any device). Safe to repeat."""
    auth_service.verify_email(db, data.token)
    return MessageOut(message="Your email address is verified.")


@router.post("/resend-verification", response_model=MessageOut)
def resend_verification(
    background_tasks: BackgroundTasks, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Send a fresh verification link to the logged-in user. Limited per user, so it cannot be used to spam an inbox."""
    if user.email_verified:
        return MessageOut(message="Your email address is already verified.")
    key = f"verify|{user.id}"
    wait = verification_resend_limiter.retry_after(
        key, settings.verification_resend_max, settings.verification_resend_window_seconds
    )
    if wait:
        raise _too_many(wait, "Too many requests for a new link. Please try again later.")
    verification_resend_limiter.record_failure(key, settings.verification_resend_window_seconds)
    background_tasks.add_task(email_service.send_all, [auth_service.verification_email(user)])
    return MessageOut(message="We sent you a new verification link.")
