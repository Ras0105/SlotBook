# backend/app/routes/admin.py
# Purpose: admin-only endpoints (oversight of every booking in the system).

from datetime import timezone

from fastapi import APIRouter, Depends, Query
from pydantic import AwareDatetime
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.dependencies.auth import require_role
from app.models import AppointmentStatus, Role, User
from app.schemas.admin import StatsOut
from app.schemas.appointment import AppointmentOut
from app.services import appointment_service, stats_service

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/appointments", response_model=list[AppointmentOut])
def list_all_appointments(
    provider_id: int | None = Query(default=None, ge=1),
    customer_id: int | None = Query(default=None, ge=1),
    status_filter: AppointmentStatus | None = Query(default=None, alias="status"),
    date_from: AwareDatetime | None = Query(default=None, description="Appointments starting at or after this instant"),
    date_to: AwareDatetime | None = Query(default=None, description="Appointments starting before this instant"),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    _admin: User = Depends(require_role(Role.admin)),
    db: Session = Depends(get_db),
):
    """All appointments, newest first. Every filter is optional and filters combine with AND."""
    return appointment_service.list_all_appointments(
        db,
        provider_id=provider_id,
        customer_id=customer_id,
        status_filter=status_filter,
        date_from=date_from.astimezone(timezone.utc) if date_from else None,
        date_to=date_to.astimezone(timezone.utc) if date_to else None,
        skip=skip,
        limit=limit,
    )


# Declared as a separate path, so it never clashes with /admin/appointments.
@router.get("/stats", response_model=StatsOut)
def get_stats(
    date_from: AwareDatetime | None = Query(default=None, description="Window start (default: 30 days back)"),
    date_to: AwareDatetime | None = Query(default=None, description="Window end, exclusive (default: end of today UTC)"),
    _admin: User = Depends(require_role(Role.admin)),
    db: Session = Depends(get_db),
):
    """Totals by status, cancellation rate, bookings per day and busiest providers for appointments starting in the window."""
    return stats_service.get_stats(
        db,
        date_from=date_from.astimezone(timezone.utc) if date_from else None,
        date_to=date_to.astimezone(timezone.utc) if date_to else None,
    )
