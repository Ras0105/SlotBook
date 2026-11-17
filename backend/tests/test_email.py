# backend/tests/test_email.py
# Purpose: confirmation emails are sent only after a successful commit, and email failures never break a booking.

import logging
import smtplib
from contextlib import contextmanager

import pytest

from app.core.config import settings
from app.services import email_service
from tests.helpers import auth_headers, future_day, iso


@pytest.fixture()
def setup(client):
    day = future_day(7)
    provider_h = auth_headers(client, "doc@test.com", "Dr Who")
    provider = client.post(
        "/providers",
        json={"service_name": "Checkup", "appointment_duration_minutes": 30, "timezone": "Asia/Kolkata"},
        headers=provider_h,
    ).json()
    # 03:30-06:30 UTC == 09:00-12:00 in Kolkata, on the provider's local weekday
    from datetime import datetime, timedelta, timezone as tz
    local_weekday = (datetime(day.year, day.month, day.day, 3, 30, tzinfo=tz.utc) + timedelta(hours=5, minutes=30)).weekday()
    client.post("/availability", json={"weekday": local_weekday, "start_time": "09:00:00", "end_time": "12:00:00"}, headers=provider_h)
    return {
        "day": day, "pid": provider["id"], "provider_h": provider_h,
        "alice": auth_headers(client, "alice@test.com", "Alice"),
        "bob": auth_headers(client, "bob@test.com", "Bob"),
    }


def book(client, setup, who="alice", hour=3, minute=30):
    return client.post("/appointments", json={"provider_id": setup["pid"], "start_at": iso(setup["day"], hour, minute)}, headers=setup[who])


def test_booking_sends_confirmation_to_customer_and_provider(client, setup):
    assert book(client, setup).status_code == 201
    to = {e.to: e for e in email_service.outbox}
    assert set(to) == {"alice@test.com", "doc@test.com"}
    assert "Booking confirmed" in to["alice@test.com"].subject and "Hi Alice" in to["alice@test.com"].body
    assert "New booking" in to["doc@test.com"].subject and "Alice booked" in to["doc@test.com"].body
    assert "09:00-09:30 (Asia/Kolkata)" in to["alice@test.com"].body  # shown in the provider's timezone
    assert "password" not in to["alice@test.com"].body.lower()


def test_conflicting_booking_sends_no_email(client, setup):
    assert book(client, setup).status_code == 201
    email_service.outbox.clear()
    assert book(client, setup, who="bob").status_code == 409
    assert email_service.outbox == []


def test_invalid_request_sends_no_email(client, setup):
    assert book(client, setup, hour=3, minute=45).status_code == 422
    assert email_service.outbox == []


def test_cancel_and_reschedule_send_emails(client, setup):
    appt = book(client, setup).json()
    email_service.outbox.clear()
    r = client.patch(f"/appointments/{appt['id']}/reschedule", json={"new_start_at": iso(setup["day"], 4, 0)}, headers=setup["alice"])
    assert r.status_code == 200
    assert {e.to for e in email_service.outbox} == {"alice@test.com", "doc@test.com"}
    assert all("rescheduled" in e.subject for e in email_service.outbox)
    email_service.outbox.clear()
    assert client.patch(f"/appointments/{appt['id']}/cancel", headers=setup["provider_h"]).status_code == 200
    assert all("cancelled" in e.subject for e in email_service.outbox)
    assert "cancelled by Dr Who" in email_service.outbox[0].body


def test_failed_cancel_sends_no_email(client, setup):
    appt = book(client, setup).json()
    email_service.outbox.clear()
    assert client.patch(f"/appointments/{appt['id']}/cancel", headers=setup["bob"]).status_code == 403
    assert email_service.outbox == []


def test_smtp_failure_never_breaks_the_booking(client, setup, monkeypatch, caplog):
    class BrokenSMTP:
        def __init__(self, *a, **k):
            raise smtplib.SMTPConnectError(421, "service not available")

    monkeypatch.setattr(settings, "email_backend", "smtp")
    monkeypatch.setattr(smtplib, "SMTP", BrokenSMTP)
    with caplog.at_level(logging.ERROR):
        r = book(client, setup)
    assert r.status_code == 201  # the appointment is saved even though email delivery failed
    assert "Failed to send email" in caplog.text
    assert client.get(f"/appointments/{r.json()['id']}", headers=setup["alice"]).status_code == 200


def test_one_failing_recipient_does_not_stop_the_other(monkeypatch):
    sent = []

    class FakeServer:
        def send_message(self, message):
            if message["To"] == "bad@test.com":
                raise smtplib.SMTPRecipientsRefused({"bad@test.com": (550, b"mailbox full")})
            sent.append(message["To"])

    @contextmanager
    def fake_connection():
        yield FakeServer()

    monkeypatch.setattr(email_service, "_smtp_connection", fake_connection)
    monkeypatch.setattr(settings, "email_backend", "smtp")
    results = email_service.send_many(
        [email_service.Email("bad@test.com", "s", "b"), email_service.Email("ok@test.com", "s", "b")]
    )
    assert results == [False, True]
    assert sent == ["ok@test.com"]


def test_disabled_backend_sends_nothing(monkeypatch):
    monkeypatch.setattr(settings, "email_backend", "disabled")
    assert email_service.send_email(email_service.Email("a@test.com", "s", "b")) is False
    assert email_service.outbox == []
