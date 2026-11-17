# backend/app/core/config.py
# Purpose: load app settings (database URL, JWT secret, token expiry) from environment variables / .env.
# In production (ENVIRONMENT=production) the app refuses to start with an insecure configuration.

import logging
from email.utils import parseaddr

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

# Values that must never be used to sign tokens outside local development.
INSECURE_SECRET_KEYS = {"change-me", "replace-with-a-long-random-string", "secret", "changeme", ""}
MIN_SECRET_KEY_LENGTH = 32


class Settings(BaseSettings):
    environment: str = "development"  # "development" | "test" | "production"
    database_url: str = "postgresql+psycopg2://slotbook:slotbook@db:5432/slotbook"
    secret_key: str = "change-me"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    lock_timeout_ms: int = 5000  # max time a booking waits for a row lock before returning 503

    # CORS: comma-separated list of frontend origins allowed to call the API from a browser.
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # Login brute-force protection: after this many FAILED logins for one email+IP within the window -> 429.
    login_max_failed_attempts: int = 5
    login_window_seconds: int = 300

    # Forgot password: the emailed link points at the frontend ({FRONTEND_URL}/reset-password?token=...).
    # A link works once and expires. Requests are limited per email+IP so the form cannot be used to spam an inbox.
    frontend_url: str = "http://localhost:5173"
    password_reset_expire_minutes: int = 30
    password_reset_max_requests: int = 5
    password_reset_window_seconds: int = 900

    # Email: "console" (log it, default for development), "smtp" (really send), "disabled".
    # (tests use "memory", which collects messages in a list)
    email_backend: str = "console"
    email_from: str = "SlotBook <no-reply@slotbook.local>"
    smtp_host: str = "localhost"
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = True  # STARTTLS: connect in plain text, then upgrade (port 587)
    smtp_ssl: bool = False  # implicit TLS from the first byte (port 465). Takes the place of smtp_use_tls.
    smtp_timeout_seconds: int = 10

    # Reminders: a scheduler (Vercel Cron, cron-job.org, a server cron) calls GET /internal/send-reminders with
    # "Authorization: Bearer <CRON_SECRET>". Empty CRON_SECRET switches that endpoint off.
    # Email verification: new accounts must confirm their address (link in an email) before they can book or
    # become a provider. Existing accounts were marked verified by the migration. Turn off with
    # EMAIL_VERIFICATION_ENABLED=false (e.g. when no real email server is set up yet).
    email_verification_enabled: bool = True
    email_verification_hours: int = 48
    verification_resend_max: int = 3  # "send me a new link" requests ...
    verification_resend_window_seconds: int = 3600  # ... per this many seconds

    reminder_hours_before: int = 24
    cron_secret: str = ""

    # WhatsApp reminders: "disabled" (default), "console" (log), "twilio" (really send), "memory" (tests).
    whatsapp_backend: str = "disabled"
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_whatsapp_from: str = ""  # e.g. +14155238886 (the Twilio sandbox number) or your approved sender
    twilio_content_sid: str = ""  # optional: an approved WhatsApp template (needed to message people first)

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @field_validator("database_url")
    @classmethod
    def normalise_database_url(cls, value: str) -> str:
        """Hosting platforms hand out 'postgres://...' or 'postgresql://...'; SQLAlchemy needs the driver named."""
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+psycopg2://" + value[len(prefix):]
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"production", "prod"}

    @model_validator(mode="after")
    def validate_for_environment(self):
        """Fail fast at startup instead of silently running with a guessable JWT secret."""
        insecure = self.secret_key.strip().lower() in INSECURE_SECRET_KEYS or len(self.secret_key) < MIN_SECRET_KEY_LENGTH
        if self.is_production:
            problems = []
            if insecure:
                problems.append(
                    f"SECRET_KEY must be a random string of at least {MIN_SECRET_KEY_LENGTH} characters "
                    "(generate one with: python -c \"import secrets; print(secrets.token_urlsafe(48))\")"
                )
            if self.algorithm.lower() == "none":
                problems.append("ALGORITHM must not be 'none'")
            if self.access_token_expire_minutes <= 0:
                problems.append("ACCESS_TOKEN_EXPIRE_MINUTES must be positive")
            if "*" in self.cors_origin_list:
                problems.append("CORS_ORIGINS must list your frontend's exact origin(s), not '*'")
            if self.email_backend.lower() == "smtp" and not self.smtp_host:
                problems.append("SMTP_HOST is required when EMAIL_BACKEND=smtp")
            if self.whatsapp_backend.lower() == "twilio" and not (
                self.twilio_account_sid and self.twilio_auth_token and self.twilio_whatsapp_from
            ):
                problems.append("TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM are required when WHATSAPP_BACKEND=twilio")
            if self.email_backend.lower() == "smtp" and "@" not in parseaddr(self.email_from)[1]:
                problems.append("EMAIL_FROM must contain an email address, e.g. 'SlotBook <no-reply@yourdomain.com>'")
            if self.cron_secret and len(self.cron_secret) < 16:
                problems.append("CRON_SECRET must be at least 16 characters (or empty to switch the reminder endpoint off)")
            if problems:
                raise ValueError("Insecure production configuration: " + "; ".join(problems))
        elif insecure:
            logger.warning("Using a weak/default SECRET_KEY. This is only acceptable for local development.")
        if self.is_production and self.email_verification_enabled and self.email_backend.lower() != "smtp":
            logger.warning(
                "EMAIL_VERIFICATION_ENABLED is on but EMAIL_BACKEND=%s does not really send email: new users "
                "would never receive their verification link and could not book. Set up SMTP or set "
                "EMAIL_VERIFICATION_ENABLED=false.",
                self.email_backend,
            )
        return self


settings = Settings()
