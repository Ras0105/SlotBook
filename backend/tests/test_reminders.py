# backend/tests/test_reminders.py
# Purpose: 24-hour reminders by email and WhatsApp: who gets one, only once, retries, opt-out, the cron endpoint,
# phone numbers on the profile, and the Twilio request.

from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import settings
from app.models import Appointment, AppointmentStatus, User
from app.services import email_service, reminder_service, whatsapp_service
from tests.helpers import auth_headers

NOW = datetime(2030, 3, 4, 12, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _whatsapp_in_memory(monkeypatch):
    monkeypatch.setattr(settings, "whatsapp_backend", "memory")
    whatsapp_service.outbox.clear()
    yield
    whatsapp_service.outbox.clear()


@pytest.fixture()
def world(client, session_factory):
    doc = auth_headers(client, "doc@test.com", "Dr Who")
    pid = client.post("/providers", json={"service_name": "Checkup", "timezone": "Asia/Kolkata"}, headers=doc).json()["id"]
    alice = auth_headers(client, "alice@test.com", "Alice")

    def add(hours_ahead=10, booked_days_before=3, status=AppointmentStatus.booked, notes=None, customer="alice@test.com"):
        start = NOW + timedelta(hours=hours_ahead)
        with session_factory() as s:
            a = Appointment(
                customer_id=s.query(User).filter_by(email=customer).one().id,
                provider_id=pid,
                start_at=start,
                end_at=start + timedelta(minutes=30),
                status=status,
                notes=notes,
                created_at=start - timedelta(days=booked_days_before),
            )
            s.add(a)
            s.commit()
            return a.id

    def run():
        email_service.outbox.clear()
        with session_factory() as s:
            return reminder_service.send_due_reminders(s, NOW)

    def get(appt_id):
        with session_factory() as s:
            return s.get(Appointment, appt_id)

    return {"doc": doc, "alice": alice, "pid": pid, "add": add, "run": run, "get": get, "client": client, "sf": session_factory}


def test_reminds_customer_and_provider_by_email(world):
    world["add"](notes="Bring X-rays")
    result = world["run"]()
    assert (result.due, result.sent, result.emails, result.retry_later) == (1, 1, 2, 0)
    to = {e.to: e for e in email_service.outbox}
    assert set(to) == {"alice@test.com", "doc@test.com"}
    assert "Reminder: Checkup" in to["alice@test.com"].subject
    assert "10:00-10:30" not in to["alice@test.com"].body  # 12:00 UTC + 10h = 22:00 UTC = 03:30 next day in Kolkata
    assert "(Asia/Kolkata)" in to["alice@test.com"].body  # always the provider's clock, like every other email
    assert "Reason for visit: Bring X-rays" in to["doc@test.com"].body
    assert "Reason for visit" not in to["alice@test.com"].body


def test_each_appointment_is_reminded_only_once(world):
    world["add"]()
    assert world["run"]().sent == 1
    again = world["run"]()
    assert (again.due, again.sent) == (0, 0) and email_service.outbox == []


def test_only_appointments_inside_the_window(world):
    world["add"](hours_ahead=30)  # more than 24 h away: not yet
    world["add"](hours_ahead=-2)  # already started
    world["add"](hours_ahead=23, status=AppointmentStatus.cancelled)
    world["add"](hours_ahead=23, status=AppointmentStatus.completed)
    assert world["run"]().due == 0
    inside = world["add"](hours_ahead=23.5)
    assert world["run"]().due == 1 and world["get"](inside).reminder_sent_at is not None


def test_a_booking_made_less_than_24h_ahead_gets_no_extra_reminder(world):
    short = world["add"](hours_ahead=10, booked_days_before=0)  # booked just now for later today
    assert world["run"]().due == 0 and world["get"](short).reminder_sent_at is None


def test_rescheduling_earns_a_new_reminder(world):
    a = world["add"](hours_ahead=10)
    world["run"]()
    assert world["get"](a).reminder_sent_at is not None
    with world["sf"]() as s:  # what appointment_service.reschedule does
        s.get(Appointment, a).reminder_sent_at = None
        s.commit()
    assert world["run"]().sent == 1


def test_real_reschedule_clears_the_reminder_mark(world):
    from tests.helpers import future_day, iso

    day = future_day(7)
    world["client"].post("/availability", json={"weekday": day.weekday(), "start_time": "09:00:00", "end_time": "12:00:00"}, headers=world["doc"])
    appt = world["client"].post("/appointments", json={"provider_id": world["pid"], "start_at": iso(day, 3, 30)}, headers=world["alice"]).json()
    with world["sf"]() as s:
        s.get(Appointment, appt["id"]).reminder_sent_at = datetime.now(timezone.utc)
        s.commit()
    r = world["client"].patch(f"/appointments/{appt['id']}/reschedule", json={"new_start_at": iso(day, 4, 0)}, headers=world["alice"])
    assert r.status_code == 200
    assert world["get"](appt["id"]).reminder_sent_at is None


def test_opting_out_stops_your_reminders_only(world):
    world["client"].patch("/auth/me", json={"reminders_enabled": False}, headers=world["alice"])
    world["add"]()
    result = world["run"]()
    assert [e.to for e in email_service.outbox] == ["doc@test.com"]
    assert result.sent == 1


def test_everyone_opted_out_is_not_a_failure(world):
    for h in (world["alice"], world["doc"]):
        world["client"].patch("/auth/me", json={"reminders_enabled": False}, headers=h)
    a = world["add"]()
    result = world["run"]()
    assert (result.sent, result.retry_later) == (1, 0) and world["get"](a).reminder_sent_at is not None


def test_failed_delivery_is_retried_on_the_next_run(world, monkeypatch):
    a = world["add"]()
    monkeypatch.setattr(settings, "email_backend", "disabled")  # every email fails
    failed = world["run"]()
    assert (failed.sent, failed.retry_later) == (0, 1)
    assert world["get"](a).reminder_sent_at is None  # released
    monkeypatch.setattr(settings, "email_backend", "memory")
    assert world["run"]().sent == 1


def test_one_working_channel_is_enough(world, monkeypatch):
    world["client"].patch("/auth/me", json={"phone": "+91 98765 43210"}, headers=world["alice"])
    a = world["add"]()
    monkeypatch.setattr(settings, "email_backend", "disabled")
    result = world["run"]()
    assert result.sent == 1 and result.whatsapp == 1 and world["get"](a).reminder_sent_at is not None


# ---------------------------------------------------------------- WhatsApp
def test_whatsapp_goes_only_to_people_with_a_phone_number(world):
    world["client"].patch("/auth/me", json={"phone": "+919876543210"}, headers=world["alice"])
    world["add"](notes="Cough")
    result = world["run"]()
    assert result.whatsapp == 1
    (message,) = whatsapp_service.outbox
    assert message.to == "+919876543210" and "Checkup" in message.body and "Asia/Kolkata" in message.body
    assert "Cough" not in message.body  # only the provider's message carries the reason


def test_provider_whatsapp_includes_the_reason(world):
    world["client"].patch("/auth/me", json={"phone": "+14155550123"}, headers=world["doc"])
    world["add"](notes="Cough")
    world["run"]()
    (message,) = whatsapp_service.outbox
    assert message.to == "+14155550123" and "Reason: Cough" in message.body and "Alice" in message.body


def test_whatsapp_off_by_default_sends_nothing_and_does_not_block_email(world, monkeypatch):
    monkeypatch.setattr(settings, "whatsapp_backend", "disabled")
    world["client"].patch("/auth/me", json={"phone": "+919876543210"}, headers=world["alice"])
    world["add"]()
    result = world["run"]()
    assert result.whatsapp == 0 and result.emails == 2 and result.sent == 1


class FakeResponse:
    def __init__(self, ok=True):
        self.ok = ok

    def raise_for_status(self):
        if not self.ok:
            raise RuntimeError("401 Unauthorized")


def test_twilio_request_is_built_correctly(monkeypatch):
    calls = []
    monkeypatch.setattr(whatsapp_service.httpx, "post", lambda url, **kw: calls.append((url, kw)) or FakeResponse())
    for key, value in dict(whatsapp_backend="twilio", twilio_account_sid="AC123", twilio_auth_token="tok", twilio_whatsapp_from="+14155238886", twilio_content_sid="").items():
        monkeypatch.setattr(settings, key, value)
    message = whatsapp_service.WhatsAppMessage("+919876543210", "Hello there", {"1": "Alice", "2": "Checkup", "3": "Mon"})
    assert whatsapp_service.send_whatsapp(message) is True
    url, kw = calls[0]
    assert url == "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json"
    assert kw["auth"] == ("AC123", "tok")
    assert kw["data"] == {"From": "whatsapp:+14155238886", "To": "whatsapp:+919876543210", "Body": "Hello there"}

    monkeypatch.setattr(settings, "twilio_content_sid", "HX999")  # an approved template: variables instead of a body
    assert whatsapp_service.send_whatsapp(message) is True
    data = calls[1][1]["data"]
    assert data["ContentSid"] == "HX999" and "Body" not in data
    assert data["ContentVariables"] == '{"1": "Alice", "2": "Checkup", "3": "Mon"}'


def test_twilio_errors_are_swallowed(monkeypatch, caplog):
    monkeypatch.setattr(whatsapp_service.httpx, "post", lambda *a, **k: FakeResponse(ok=False))
    monkeypatch.setattr(settings, "whatsapp_backend", "twilio")
    assert whatsapp_service.send_whatsapp(whatsapp_service.WhatsAppMessage("+1", "x")) is False
    assert "Failed to send WhatsApp" in caplog.text


# ---------------------------------------------------------------- phone number on the profile
@pytest.mark.parametrize("typed,stored", [("+91 98765-43210", "+919876543210"), ("+1 (415) 555-0123", "+14155550123")])
def test_phone_is_cleaned_and_stored(client, typed, stored):
    h = auth_headers(client, "a@test.com", "A")
    r = client.patch("/auth/me", json={"phone": typed}, headers=h)
    assert r.status_code == 200 and r.json()["phone"] == stored
    assert client.get("/auth/me", headers=h).json()["phone"] == stored


@pytest.mark.parametrize("bad", ["9876543210", "+0123456789", "+91abc", "+12", "+" + "1" * 20])
def test_bad_phone_numbers_are_rejected(client, bad):
    h = auth_headers(client, "a@test.com", "A")
    assert client.patch("/auth/me", json={"phone": bad}, headers=h).status_code == 422


def test_phone_can_be_removed_and_reminders_toggled(client):
    h = auth_headers(client, "a@test.com", "A")
    client.patch("/auth/me", json={"phone": "+919876543210"}, headers=h)
    r = client.patch("/auth/me", json={"phone": ""}, headers=h)
    assert r.json()["phone"] is None and r.json()["reminders_enabled"] is True
    assert client.patch("/auth/me", json={"reminders_enabled": False}, headers=h).json()["reminders_enabled"] is False
    assert client.patch("/auth/me", json={"name": "B"}, headers=h).json()["reminders_enabled"] is False  # untouched


# ---------------------------------------------------------------- the scheduler endpoint
@pytest.fixture()
def cron(monkeypatch):
    monkeypatch.setattr(settings, "cron_secret", "s" * 24)
    return {"Authorization": "Bearer " + "s" * 24}


def test_endpoint_is_off_without_a_secret(client, monkeypatch):
    monkeypatch.setattr(settings, "cron_secret", "")
    assert client.get("/internal/send-reminders", headers={"Authorization": "Bearer "}).status_code == 404


def test_endpoint_rejects_missing_or_wrong_secret(client, cron):
    assert client.get("/internal/send-reminders").status_code == 401
    assert client.get("/internal/send-reminders", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert client.get("/internal/send-reminders", headers={"Authorization": "s" * 24}).status_code == 401  # no "Bearer"


def test_endpoint_runs_the_job_for_get_and_post(client, cron, session_factory):
    doc = auth_headers(client, "doc@test.com", "Dr Who")
    pid = client.post("/providers", json={"service_name": "Checkup"}, headers=doc).json()["id"]
    auth_headers(client, "alice@test.com", "Alice")
    soon = datetime.now(timezone.utc) + timedelta(hours=5)
    with session_factory() as s:
        s.add(Appointment(customer_id=s.query(User).filter_by(email="alice@test.com").one().id, provider_id=pid, start_at=soon,
                          end_at=soon + timedelta(minutes=30), created_at=soon - timedelta(days=2)))
        s.commit()
    r = client.get("/internal/send-reminders", headers=cron)
    assert r.status_code == 200 and r.json() == {"due": 1, "sent": 1, "retry_later": 0, "emails": 2, "whatsapp": 0}
    assert client.post("/internal/send-reminders", headers=cron).json()["due"] == 0  # already done


def test_two_runs_at_once_remind_once(world):
    from tests.helpers import run_parallel

    world["add"]()
    email_service.outbox.clear()
    results = []

    def job(session):
        results.append(reminder_service.send_due_reminders(session, NOW).sent)

    run_parallel(world["sf"], [job, job])
    assert sum(results) == 1 and len(email_service.outbox) == 2  # one reminder pair, not two
