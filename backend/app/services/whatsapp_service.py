# backend/app/services/whatsapp_service.py
# Purpose: send short WhatsApp messages (reminders) without ever letting a delivery problem break anything.
#
# Backends (WHATSAPP_BACKEND): "disabled" (default), "console" (log it), "memory" (tests), "twilio" (really send,
# through Twilio's WhatsApp API: https://www.twilio.com/docs/whatsapp).
# WhatsApp only lets a business start a conversation with an approved TEMPLATE. Set TWILIO_CONTENT_SID to one
# (its variables are {{1}} = name, {{2}} = service, {{3}} = when); without it the message is plain text, which
# works in the Twilio sandbox and inside a 24-hour customer-initiated session.

import json
import logging
from dataclasses import dataclass, field

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class WhatsAppMessage:
    to: str  # E.164, e.g. +14155550123
    body: str
    template_variables: dict[str, str] = field(default_factory=dict)  # used only with TWILIO_CONTENT_SID


outbox: list[WhatsAppMessage] = []  # only used by the "memory" backend


def enabled() -> bool:
    return settings.whatsapp_backend.lower() != "disabled"


def _send_twilio(message: WhatsAppMessage) -> None:
    data = {"From": f"whatsapp:{settings.twilio_whatsapp_from}", "To": f"whatsapp:{message.to}"}
    if settings.twilio_content_sid:
        data["ContentSid"] = settings.twilio_content_sid
        data["ContentVariables"] = json.dumps(message.template_variables)
    else:
        data["Body"] = message.body
    response = httpx.post(
        f"https://api.twilio.com/2010-04-01/Accounts/{settings.twilio_account_sid}/Messages.json",
        data=data,
        auth=(settings.twilio_account_sid, settings.twilio_auth_token),
        timeout=settings.smtp_timeout_seconds,
    )
    response.raise_for_status()


def send_whatsapp(message: WhatsAppMessage) -> bool:
    """Deliver one message. Returns True on success; never raises."""
    backend = settings.whatsapp_backend.lower()
    try:
        if backend == "twilio":
            _send_twilio(message)
        elif backend == "memory":
            outbox.append(message)
        elif backend == "console":
            logger.info("WHATSAPP to=%s\n%s", message.to, message.body)
        elif backend == "disabled":
            return False
        else:
            logger.error("Unknown WHATSAPP_BACKEND %r; message not sent", settings.whatsapp_backend)
            return False
        return True
    except Exception:
        logger.exception("Failed to send WhatsApp message to %s", message.to)
        return False
