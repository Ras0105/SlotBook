# backend/app/services/notification_service.py
# Purpose: build the emails for booking events. Pure functions: no sending, no database writes.
# Call them only AFTER the transaction has committed.

from zoneinfo import ZoneInfo

from app.core.config import settings
from app.models import Appointment
from app.services.email_service import Email
from app.services.whatsapp_service import WhatsAppMessage


def _when(appointment: Appointment) -> str:
    """Human-friendly time in the provider's own timezone, e.g. 'Sat 14 Nov 2026, 09:00-09:30 (Asia/Kolkata)'."""
    tz_name = appointment.provider.timezone
    tz = ZoneInfo(tz_name)
    start, end = appointment.start_at.astimezone(tz), appointment.end_at.astimezone(tz)
    return f"{start:%a %d %b %Y}, {start:%H:%M}-{end:%H:%M} ({tz_name})"


def _reason(appointment: Appointment) -> str:
    """A line for the customer's reason for visit, or nothing."""
    return f"Reason for visit: {appointment.notes}\n" if appointment.notes else ""


def _both(appointment: Appointment, customer_subject: str, customer_body: str, provider_subject: str, provider_body: str) -> list[Email]:
    customer, owner = appointment.customer, appointment.provider.user
    return [
        Email(customer.email, customer_subject, customer_body),
        Email(owner.email, provider_subject, provider_body),
    ]


def booking_confirmed(appointment: Appointment) -> list[Email]:
    service, when, ref = appointment.provider.service_name, _when(appointment), appointment.id
    customer, owner = appointment.customer, appointment.provider.user
    return _both(
        appointment,
        f"Booking confirmed: {service}",
        f"Hi {customer.name},\n\nYour appointment for {service} is confirmed.\nWhen: {when}\nReference: #{ref}\n",
        f"New booking: {service}",
        f"Hi {owner.name},\n\n{customer.name} booked {service}.\nWhen: {when}\n{_reason(appointment)}Reference: #{ref}\n",
    )


def booking_cancelled(appointment: Appointment, cancelled_by_name: str) -> list[Email]:
    service, when, ref = appointment.provider.service_name, _when(appointment), appointment.id
    customer, owner = appointment.customer, appointment.provider.user
    return _both(
        appointment,
        f"Booking cancelled: {service}",
        f"Hi {customer.name},\n\nYour appointment for {service} on {when} was cancelled by {cancelled_by_name}.\nReference: #{ref}\n",
        f"Booking cancelled: {service}",
        f"Hi {owner.name},\n\nThe appointment for {service} on {when} was cancelled by {cancelled_by_name}.\nReference: #{ref}\n",
    )


def booking_rescheduled(appointment: Appointment) -> list[Email]:
    service, when, ref = appointment.provider.service_name, _when(appointment), appointment.id
    customer, owner = appointment.customer, appointment.provider.user
    return _both(
        appointment,
        f"Booking rescheduled: {service}",
        f"Hi {customer.name},\n\nYour appointment for {service} has moved.\nNew time: {when}\nReference: #{ref}\n",
        f"Booking rescheduled: {service}",
        f"Hi {owner.name},\n\n{customer.name}'s appointment for {service} has moved.\nNew time: {when}\nReference: #{ref}\n",
    )


# ---- account emails

def password_reset(user, link: str, valid_minutes: int) -> Email:
    return Email(
        user.email,
        "Reset your SlotBook password",
        f"Hi {user.name},\n\n"
        "Someone asked to reset the password for your SlotBook account. "
        f"Use this link within {valid_minutes} minutes to choose a new one:\n\n{link}\n\n"
        "If this was not you, you can ignore this email: your password stays the same.\n",
    )


def password_changed(user) -> Email:
    return Email(
        user.email,
        "Your SlotBook password was changed",
        f"Hi {user.name},\n\nThe password for your SlotBook account was just changed.\n"
        "If this was not you, reset your password right away using \"Forgot password\" on the log in page.\n",
    )


# ---- reminders

def reminder_emails(appointment: Appointment) -> list[Email]:
    """The 24-hour reminder, to the customer and (with the reason for visit) to the provider."""
    service, when, ref = appointment.provider.service_name, _when(appointment), appointment.id
    customer, owner = appointment.customer, appointment.provider.user
    manage = f"{settings.frontend_url.rstrip('/')}/appointments"
    emails = []
    if customer.reminders_enabled:
        emails.append(
            Email(
                customer.email,
                f"Reminder: {service} is coming up",
                f"Hi {customer.name},\n\nA reminder of your appointment for {service}.\nWhen: {when}\n"
                f"Reference: #{ref}\n\nNeed to change it? {manage}\n",
            )
        )
    if owner.reminders_enabled:
        emails.append(
            Email(
                owner.email,
                f"Reminder: {customer.name} is booked for {service}",
                f"Hi {owner.name},\n\n{customer.name} is booked for {service}.\nWhen: {when}\n"
                f"{_reason(appointment)}Reference: #{ref}\n\nYour calendar: {settings.frontend_url.rstrip('/')}/dashboard?tab=calendar\n",
            )
        )
    return emails


def reminder_whatsapp(appointment: Appointment) -> list[WhatsAppMessage]:
    """The same reminder as short WhatsApp messages, for people who added a phone number and have reminders on."""
    service, when = appointment.provider.service_name, _when(appointment)
    customer, owner = appointment.customer, appointment.provider.user
    messages = []
    if customer.phone and customer.reminders_enabled:
        messages.append(
            WhatsAppMessage(
                customer.phone,
                f"Hi {customer.name}, reminder: {service} on {when}. Ref #{appointment.id}.",
                {"1": customer.name, "2": service, "3": when},
            )
        )
    if owner.phone and owner.reminders_enabled:
        reason = f" Reason: {appointment.notes}." if appointment.notes else ""
        messages.append(
            WhatsAppMessage(
                owner.phone,
                f"Hi {owner.name}, reminder: {customer.name} is booked for {service} on {when}.{reason}",
                {"1": owner.name, "2": f"{customer.name} / {service}", "3": when},
            )
        )
    return messages


def email_verification(user, link: str, valid_hours: int) -> Email:
    return Email(
        user.email,
        "Confirm your email for SlotBook",
        f"Hi {user.name},\n\nWelcome to SlotBook! Please confirm that this is your email address:\n\n{link}\n\n"
        f"The link works for {valid_hours} hours. Until you confirm, you can look around but not book.\n\n"
        "If you did not create a SlotBook account, you can ignore this email.\n",
    )
