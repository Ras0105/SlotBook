# backend/app/routes/internal.py
# Purpose: endpoints for schedulers, not for people. Protected by a shared secret (CRON_SECRET).

import hmac

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.database.session import get_db
from app.services import reminder_service

router = APIRouter(prefix="/internal", tags=["internal"], include_in_schema=False)


def require_cron_secret(authorization: str | None = Header(default=None)) -> None:
    """`Authorization: Bearer <CRON_SECRET>`. This is exactly what Vercel Cron sends when CRON_SECRET is set."""
    if not settings.cron_secret:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")  # feature switched off: pretend it does not exist
    expected = f"Bearer {settings.cron_secret}"
    if not authorization or not hmac.compare_digest(authorization.encode(), expected.encode()):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or missing secret")


# GET because Vercel Cron (and most pingers) can only send GET; POST for everything else.
@router.get("/send-reminders", dependencies=[Depends(require_cron_secret)])
@router.post("/send-reminders", dependencies=[Depends(require_cron_secret)])
def send_reminders(db: Session = Depends(get_db)):
    result = reminder_service.send_due_reminders(db)
    return {
        "due": result.due,
        "sent": result.sent,
        "retry_later": result.retry_later,
        "emails": result.emails,
        "whatsapp": result.whatsapp,
    }
