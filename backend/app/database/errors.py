# backend/app/database/errors.py
# Purpose: turn database-level failures into clean HTTP errors (instead of a 500) for every service.

from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError, OperationalError

# PostgreSQL error codes that mean "try again": lock timeout, deadlock, serialization failure.
RETRYABLE_PGCODES = {"55P03", "40P01", "40001"}


@contextmanager
def translate_db_errors(conflict_detail: str = "This slot is no longer available") -> Iterator[None]:
    """Use around a `transaction(db)` block.

    - IntegrityError (an exclusion/unique constraint fired) -> 409 Conflict: someone else got there first.
    - Lock timeout / deadlock / serialization failure       -> 503 with Retry-After: the client may retry.
    """
    try:
        yield
    except IntegrityError:
        raise HTTPException(status.HTTP_409_CONFLICT, conflict_detail)
    except OperationalError as exc:
        if getattr(exc.orig, "pgcode", None) in RETRYABLE_PGCODES:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "The booking system is busy, please retry",
                headers={"Retry-After": "1"},
            )
        raise
