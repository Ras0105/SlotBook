# backend/app/scripts/send_test_email.py
# Purpose: check your email settings. Sends one test message with the current EMAIL_* / SMTP_* settings and
# prints exactly what went wrong if it fails (unlike the app, which only logs delivery errors).
#
#   python -m app.scripts.send_test_email --to you@example.com
#   docker compose exec backend python -m app.scripts.send_test_email --to you@example.com

import argparse
import smtplib
import ssl
import sys

from app.core.config import settings
from app.services import email_service


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Send a test email with the current settings.")
    parser.add_argument("--to", required=True, help="recipient address")
    args = parser.parse_args(argv)

    backend = settings.email_backend.lower()
    print(f"EMAIL_BACKEND={backend}", end="")
    if backend == "smtp":
        mode = "SSL (implicit TLS)" if settings.smtp_ssl else "STARTTLS" if settings.smtp_use_tls else "NO ENCRYPTION"
        print(f", server {settings.smtp_host}:{settings.smtp_port}, {mode}, login {'yes' if settings.smtp_username else 'no'}")
        print(f"From: {settings.email_from}")
        try:  # same steps as the app, but with the real error shown
            with email_service._smtp_connection() as server:
                server.send_message(
                    email_service.build_message(
                        email_service.Email(args.to, "SlotBook test email", "If you can read this, your SMTP settings work.\n")
                    )
                )
        except smtplib.SMTPAuthenticationError as exc:
            print(f"FAILED: the server rejected the username or password ({exc.smtp_code}). For Gmail use an app password.")
            return 1
        except ssl.SSLCertVerificationError as exc:
            print(f"FAILED: the server's TLS certificate is not trusted ({exc.verify_message}). Check SMTP_HOST is the exact host name.")
            return 1
        except smtplib.SMTPRecipientsRefused as exc:
            print(f"FAILED: the recipient was refused: {exc.recipients}")
            return 1
        except (OSError, smtplib.SMTPException) as exc:
            print(f"FAILED: {type(exc).__name__}: {exc}")
            print("Hints: wrong SMTP_HOST/SMTP_PORT? port 587 needs SMTP_USE_TLS=true, port 465 needs SMTP_SSL=true.")
            return 1
        print(f"OK: test email handed to the server for {args.to}")
        return 0

    sent = email_service.send_email(email_service.Email(args.to, "SlotBook test email", "Test.\n"))
    print(" (nothing is really sent with this backend)" if backend != "disabled" else " (emails are switched off)")
    return 0 if sent else 1


if __name__ == "__main__":
    sys.exit(main())
