# backend/app/services/notification_service.py
# Purpose: build the emails for booking events. Pure functions: no sending, no database writes.
# Call them only AFTER the transaction has committed.

from zoneinfo import ZoneInfo

from app.models import Appointment
from app.services.email_service import Email


def _when(appointment: Appointment) -> str:
    """Human-friendly time in the provider's own timezone, e.g. 'Sat 14 Nov 2026, 09:00-09:30 (Asia/Kolkata)'."""
    tz_name = appointment.provider.timezone
    tz = ZoneInfo(tz_name)
    start, end = appointment.start_at.astimezone(tz), appointment.end_at.astimezone(tz)
    return f"{start:%a %d %b %Y}, {start:%H:%M}-{end:%H:%M} ({tz_name})"


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
        f"Hi {owner.name},\n\n{customer.name} booked {service}.\nWhen: {when}\nReference: #{ref}\n",
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
