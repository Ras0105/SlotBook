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
#
# SMTP details that matter in practice:
#   - SMTP_USE_TLS=true (default) = STARTTLS, normally port 587. SMTP_SSL=true = implicit TLS, normally port 465.
#     Certificates are VERIFIED (the connection is refused if the server's certificate is not trusted).
#   - All emails of one batch (e.g. confirmation to customer + provider) share ONE connection.
#   - Header values are cleaned of line breaks, so text a user typed (a service name) cannot inject headers.
#   - Every message gets a Date and a Message-ID, which spam filters expect.

import logging
import smtplib
import ssl
from contextlib import contextmanager
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formatdate, make_msgid, parseaddr

from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    body: str


outbox: list[Email] = []  # only used by the "memory" backend


def clean_header(value: str) -> str:
    """One line only: line breaks and tabs become spaces (stops header injection), then trim."""
    return " ".join(str(value).split())


def build_message(email: Email) -> EmailMessage:
    sender = clean_header(settings.email_from)
    domain = parseaddr(sender)[1].rpartition("@")[2] or None
    message = EmailMessage()
    message["From"] = sender
    message["To"] = clean_header(email.to)
    message["Subject"] = clean_header(email.subject)
    message["Date"] = formatdate(localtime=False)
    message["Message-ID"] = make_msgid(domain=domain)
    message.set_content(email.body)
    return message


@contextmanager
def _smtp_connection():
    """An open, logged-in SMTP connection, closed on exit."""
    host, port, timeout = settings.smtp_host, settings.smtp_port, settings.smtp_timeout_seconds
    context = ssl.create_default_context()  # verifies the server certificate and host name
    if settings.smtp_ssl:
        server = smtplib.SMTP_SSL(host, port, timeout=timeout, context=context)
    else:
        server = smtplib.SMTP(host, port, timeout=timeout)
    with server:
        if settings.smtp_use_tls and not settings.smtp_ssl:
            server.starttls(context=context)
        if settings.smtp_username:
            server.login(settings.smtp_username, settings.smtp_password)
        yield server


def _send_smtp_batch(emails: list[Email]) -> list[bool]:
    """Send every email over one connection. One bad recipient does not stop the rest."""
    results: list[bool] = []
    try:
        with _smtp_connection() as server:
            for email in emails:
                try:
                    server.send_message(build_message(email))
                    results.append(True)
                except Exception:
                    logger.exception("Failed to send email to %s (subject %r)", email.to, email.subject)
                    results.append(False)
    except Exception:
        # Could not connect / start TLS / log in: nothing (more) can be sent.
        logger.exception("Failed to send email: could not use the SMTP server %s:%s", settings.smtp_host, settings.smtp_port)
        results.extend([False] * (len(emails) - len(results)))
    return results


def send_many(emails: list[Email]) -> list[bool]:
    """Deliver emails. Returns one True/False per email; never raises."""
    if not emails:
        return []
    backend = settings.email_backend.lower()
    if backend == "smtp":
        return _send_smtp_batch(emails)
    results = []
    for email in emails:
        try:
            if backend == "memory":
                outbox.append(email)
                results.append(True)
            elif backend == "console":
                logger.info("EMAIL to=%s subject=%r\n%s", email.to, email.subject, email.body)
                results.append(True)
            elif backend == "disabled":
                results.append(False)
            else:
                logger.error("Unknown EMAIL_BACKEND %r; email not sent", settings.email_backend)
                results.append(False)
        except Exception:
            logger.exception("Failed to send email to %s (subject %r)", email.to, email.subject)
            results.append(False)
    return results


def send_email(email: Email) -> bool:
    """Deliver one email. Returns True on success; never raises."""
    return send_many([email])[0]


def send_all(emails: list[Email]) -> None:
    """Background-task entry point: one failing recipient does not stop the others."""
    send_many(emails)
