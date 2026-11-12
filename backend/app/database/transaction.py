# backend/app/database/transaction.py
# Purpose: one place for transaction handling: commit on success, roll back on any error, bounded lock waits.

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings


@contextmanager
def transaction(db: Session) -> Iterator[Session]:
    """Run a block of work as ONE atomic unit.

        with transaction(db):
            ...several reads / writes / row locks...

    - Finishes normally  -> commit (row locks are released).
    - Any exception      -> rollback (nothing is half-saved, locks are released), then re-raise.
    - On PostgreSQL, waiting for a row lock is capped at settings.lock_timeout_ms (SET LOCAL lasts
      only for this transaction), so a stuck request fails fast instead of piling up.
    """
    try:
        if db.get_bind().dialect.name == "postgresql":
            db.execute(text(f"SET LOCAL lock_timeout = {int(settings.lock_timeout_ms)}"))
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
