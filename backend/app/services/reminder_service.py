# backend/app/services/reminder_service.py
# Purpose: send the "your appointment is tomorrow" reminders (email, and WhatsApp when set up).
#
# Run it on a schedule (hourly is ideal): GET /internal/send-reminders (see routes/internal.py) or
# `python -m app.scripts.send_reminders`. It is safe to run as often as you like: each appointment is
# marked as reminded in the database BEFORE anything is sent, so it is reminded once, even if two runs overlap.
# If every channel fails for an appointment, the mark is removed so the next run tries again.

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.config import settings
from app.database.transaction import transaction
from app.models import Appointment
from app.repositories import appointment_repository
from app.services import email_service, notification_service, whatsapp_service

logger = logging.getLogger(__name__)


@dataclass
class ReminderResult:
    due: int = 0  # appointments that needed a reminder in this run
    sent: int = 0  # reminded through at least one channel
    retry_later: int = 0  # every channel failed; will be tried again next run
    emails: int = 0
    whatsapp: int = 0


def _release(db: Session, appointment_ids: list[int]) -> None:
    with transaction(db):
        for appointment in db.query(Appointment).filter(Appointment.id.in_(appointment_ids)):
            appointment.reminder_sent_at = None


def send_due_reminders(db: Session, now: datetime | None = None) -> ReminderResult:
    now = now or datetime.now(timezone.utc)
    result = ReminderResult()

    with transaction(db):
        appointments = appointment_repository.claim_due_reminders(db, now, settings.reminder_hours_before)
        # Build every message while the data is loaded, then let go of the locks before the slow network calls.
        plans = [
            (a.id, notification_service.reminder_emails(a), notification_service.reminder_whatsapp(a))
            for a in appointments
        ]
    result.due = len(plans)

    failed: list[int] = []
    for appointment_id, emails, texts in plans:
        email_ok = email_service.send_many(emails)
        whatsapp_ok = [whatsapp_service.send_whatsapp(m) for m in texts]
        result.emails += sum(email_ok)
        result.whatsapp += sum(whatsapp_ok)
        if any(email_ok) or any(whatsapp_ok):
            result.sent += 1
        elif emails or texts:
            failed.append(appointment_id)  # something to send, but nothing got through
        else:
            result.sent += 1  # nobody wants a reminder (all opted out): nothing to retry

    if failed:
        _release(db, failed)
        result.retry_later = len(failed)
        logger.warning("Reminders for appointments %s failed; they will be retried on the next run", failed)
    logger.info("Reminders: %s", result)
    return result
