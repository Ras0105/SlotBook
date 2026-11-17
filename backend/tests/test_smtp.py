# backend/tests/test_smtp.py
# Purpose: the email code against a real SMTP server: plain, STARTTLS, implicit TLS, login, certificate checks,
# batching, header safety and the "check my settings" script.

import ssl

import pytest

from app.core.config import settings
from app.scripts import send_test_email
from app.services import email_service
from app.services.email_service import Email
from tests.smtp_server import PASSWORD, USERNAME, smtp_server


@pytest.fixture()
def smtp_settings(monkeypatch):
    def configure(port, **overrides):
        values = dict(
            email_backend="smtp",
            smtp_host="127.0.0.1",
            smtp_port=port,
            smtp_use_tls=False,
            smtp_ssl=False,
            smtp_username="",
            smtp_password="",
            smtp_timeout_seconds=5,
            email_from="SlotBook <no-reply@slotbook.test>",
        )
        values.update(overrides)
        for key, value in values.items():
            monkeypatch.setattr(settings, key, value)

    return configure


@pytest.fixture()
def trust(monkeypatch):
    """Make the test server's self-signed certificate trusted, like a real CA-signed one would be."""
    original = ssl.create_default_context

    def install(cert_file):
        def patched(*args, **kwargs):
            context = original(*args, **kwargs)
            context.load_verify_locations(cafile=str(cert_file))
            return context

        monkeypatch.setattr(email_service.ssl, "create_default_context", patched)

    return install


def test_plain_smtp_delivers_a_well_formed_message(tmp_path, smtp_settings):
    with smtp_server(tmp_path) as (port, inbox, _):
        smtp_settings(port)
        assert email_service.send_email(Email("alice@test.com", "Booking confirmed: Checkup", "Hello Alice\n")) is True
    (message,) = inbox.messages
    assert message["From"] == "SlotBook <no-reply@slotbook.test>"
    assert message["To"] == "alice@test.com"
    assert message["Subject"] == "Booking confirmed: Checkup"
    assert message["Date"] and message["Message-ID"].endswith("@slotbook.test>")  # spam filters expect both
    assert message.get_content().strip() == "Hello Alice"
    assert message.get_content_type() == "text/plain"


def test_starttls_with_login(tmp_path, smtp_settings, trust):
    with smtp_server(tmp_path, "starttls", auth=True) as (port, inbox, cert):
        trust(cert)
        smtp_settings(port, smtp_use_tls=True, smtp_host="localhost", smtp_username=USERNAME, smtp_password=PASSWORD)
        assert email_service.send_email(Email("a@test.com", "Secure", "Body")) is True
    assert inbox.logins == [USERNAME] and len(inbox.messages) == 1


def test_implicit_ssl_with_login(tmp_path, smtp_settings, trust):
    with smtp_server(tmp_path, "ssl", auth=True) as (port, inbox, cert):
        trust(cert)
        smtp_settings(port, smtp_ssl=True, smtp_use_tls=True, smtp_host="localhost", smtp_username=USERNAME, smtp_password=PASSWORD)
        assert email_service.send_email(Email("a@test.com", "Over 465", "Body")) is True
    assert len(inbox.messages) == 1


def test_an_untrusted_certificate_is_refused_so_mail_is_never_sent_to_an_impostor(tmp_path, smtp_settings, caplog):
    with smtp_server(tmp_path, "starttls") as (port, inbox, _cert):
        smtp_settings(port, smtp_use_tls=True, smtp_host="localhost")  # NOT trusted
        assert email_service.send_email(Email("a@test.com", "s", "b")) is False
    assert inbox.messages == []
    assert "could not use the SMTP server" in caplog.text


def test_wrong_password_fails_cleanly(tmp_path, smtp_settings, trust, caplog):
    with smtp_server(tmp_path, "starttls", auth=True) as (port, inbox, cert):
        trust(cert)
        smtp_settings(port, smtp_use_tls=True, smtp_host="localhost", smtp_username=USERNAME, smtp_password="wrong")
        assert email_service.send_email(Email("a@test.com", "s", "b")) is False
    assert inbox.messages == []


def test_a_server_that_requires_tls_is_not_used_without_it(tmp_path, smtp_settings):
    with smtp_server(tmp_path, "starttls") as (port, inbox, _):
        smtp_settings(port, smtp_use_tls=False)  # misconfigured: no STARTTLS
        assert email_service.send_email(Email("a@test.com", "s", "b")) is False
    assert inbox.messages == []


def test_nothing_listening_fails_without_raising(smtp_settings):
    smtp_settings(1)  # nothing listens on port 1
    assert email_service.send_email(Email("a@test.com", "s", "b")) is False
    email_service.send_all([Email("a@test.com", "s", "b")])  # the background-task entry point also never raises


def test_a_batch_uses_one_connection(tmp_path, smtp_settings):
    with smtp_server(tmp_path) as (port, inbox, _):
        smtp_settings(port)
        results = email_service.send_many([Email(f"u{i}@test.com", "s", "b") for i in range(3)])
    assert results == [True, True, True]
    assert len(inbox.messages) == 3 and len(inbox.sessions) == 1


def test_line_breaks_in_a_subject_cannot_inject_headers(tmp_path, smtp_settings):
    evil = "Booking confirmed: Checkup\r\nBcc: victim@test.com"
    with smtp_server(tmp_path) as (port, inbox, _):
        smtp_settings(port)
        assert email_service.send_email(Email("a@test.com", evil, "b")) is True
    (message,) = inbox.messages
    assert message["Bcc"] is None
    assert message["Subject"] == "Booking confirmed: Checkup Bcc: victim@test.com"  # kept on ONE line


def test_non_ascii_names_survive(tmp_path, smtp_settings):
    with smtp_server(tmp_path) as (port, inbox, _):
        smtp_settings(port)
        assert email_service.send_email(Email("a@test.com", "Réservation confirmée: Dr Müller ✓", "Bonjour José, à bientôt ☺\n")) is True
    (message,) = inbox.messages
    assert message["Subject"] == "Réservation confirmée: Dr Müller ✓"
    assert "José" in message.get_content() and "☺" in message.get_content()


# ---------------------------------------------------------------- the "check my settings" script
def test_script_reports_success(tmp_path, smtp_settings, capsys):
    with smtp_server(tmp_path) as (port, inbox, _):
        smtp_settings(port)
        assert send_test_email.main(["--to", "me@test.com"]) == 0
    assert "OK" in capsys.readouterr().out and len(inbox.messages) == 1


def test_script_explains_a_bad_login(tmp_path, smtp_settings, trust, capsys):
    with smtp_server(tmp_path, "starttls", auth=True) as (port, _inbox, cert):
        trust(cert)
        smtp_settings(port, smtp_use_tls=True, smtp_host="localhost", smtp_username=USERNAME, smtp_password="nope")
        assert send_test_email.main(["--to", "me@test.com"]) == 1
    assert "username or password" in capsys.readouterr().out


def test_script_explains_an_untrusted_certificate(tmp_path, smtp_settings, capsys):
    with smtp_server(tmp_path, "starttls") as (port, _inbox, _cert):
        smtp_settings(port, smtp_use_tls=True, smtp_host="localhost")
        assert send_test_email.main(["--to", "me@test.com"]) == 1
    assert "certificate is not trusted" in capsys.readouterr().out


def test_script_explains_an_unreachable_server(smtp_settings, capsys):
    smtp_settings(1)
    assert send_test_email.main(["--to", "me@test.com"]) == 1
    out = capsys.readouterr().out
    assert "FAILED" in out and "SMTP_SSL=true" in out


# ---------------------------------------------------------------- configuration checks
def test_production_refuses_an_email_from_without_an_address(monkeypatch):
    from app.core.config import Settings

    base = dict(environment="production", secret_key="k" * 40, cors_origins="https://app.test", email_backend="smtp", smtp_host="smtp.test")
    Settings(**base, email_from="SlotBook <no-reply@slotbook.test>")  # fine
    with pytest.raises(ValueError, match="EMAIL_FROM"):
        Settings(**base, email_from="SlotBook")


def test_production_refuses_twilio_without_credentials_and_a_short_cron_secret():
    from app.core.config import Settings

    base = dict(environment="production", secret_key="k" * 40, cors_origins="https://app.test")
    with pytest.raises(ValueError, match="TWILIO"):
        Settings(**base, whatsapp_backend="twilio")
    with pytest.raises(ValueError, match="CRON_SECRET"):
        Settings(**base, cron_secret="short")
    Settings(**base, whatsapp_backend="twilio", twilio_account_sid="AC1", twilio_auth_token="t", twilio_whatsapp_from="+14155238886", cron_secret="x" * 20)
