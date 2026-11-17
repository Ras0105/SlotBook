# backend/app/scripts/send_reminders.py
# Purpose: send the due appointment reminders once (run it from cron, a scheduled task or a worker).
#
#   python -m app.scripts.send_reminders
#   # crontab, every hour:  0 * * * *  cd /code && python -m app.scripts.send_reminders
#   # Docker:               docker compose exec backend python -m app.scripts.send_reminders

import logging

from app.database.session import SessionLocal
from app.services import reminder_service


def main() -> int:
    logging.basicConfig(level=logging.INFO)
    with SessionLocal() as db:
        result = reminder_service.send_due_reminders(db)
    print(f"due={result.due} sent={result.sent} retry_later={result.retry_later} emails={result.emails} whatsapp={result.whatsapp}")
    return 1 if result.retry_later else 0


if __name__ == "__main__":
    raise SystemExit(main())
