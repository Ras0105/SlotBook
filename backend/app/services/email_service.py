# backend/app/services/email_service.py
# Purpose: send email without ever letting a delivery problem break a booking.
#
# Emails are sent AFTER the database transaction has committed (see routes/appointments.py: they run as
# background tasks once the response is ready). If delivery fails the error is logged and swallowed:
# the appointment is already saved, and email can fail independently of the database.
# Future upgrade: an "outbox" table + worker that retries failed sends.
#
# Backends (EMAIL_BACKEND): "console" logs the email (development), "smtp" really sends it,
# "disabled" does nothing, "memory" stores it in `outbox` (used by tests).

import logging
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage

from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    body: str


outbox: list[Email] = []  # only used by the "memory" backend


def _send_smtp(email: Email) -> None:
    message = EmailMessage()
    message["From"] = settings.email_from
    message["To"] = email.to
    message["Subject"] = email.subject
    message.set_content(email.body)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as server:
        if settings.smtp_use_tls:
            server.starttls()
        if settings.smtp_username:
            server.login(settings.smtp_username, settings.smtp_password)
        server.send_message(message)


def send_email(email: Email) -> bool:
    """Deliver one email. Returns True on success; never raises."""
    backend = settings.email_backend.lower()
    try:
        if backend == "smtp":
            _send_smtp(email)
        elif backend == "memory":
            outbox.append(email)
        elif backend == "console":
            logger.info("EMAIL to=%s subject=%r\n%s", email.to, email.subject, email.body)
        elif backend != "disabled":
            logger.error("Unknown EMAIL_BACKEND %r; email not sent", settings.email_backend)
            return False
        return backend != "disabled"
    except Exception:  # delivery problems must never surface to the API caller
        logger.exception("Failed to send email to %s (subject %r)", email.to, email.subject)
        return False


def send_all(emails: list[Email]) -> None:
    """Background-task entry point: one failing recipient does not stop the others."""
    for email in emails:
        send_email(email)
