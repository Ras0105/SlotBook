# backend/app/schemas/appointment.py
# Purpose: Pydantic request/response models for booking, viewing, cancelling and rescheduling.

from datetime import datetime, timezone

from pydantic import AwareDatetime, BaseModel, field_validator

from app.models import AppointmentStatus
from app.schemas.review import ReviewOut


def _to_utc(value: datetime) -> datetime:
    """Clients must send timezone-aware datetimes; everything is stored and compared in UTC."""
    return value.astimezone(timezone.utc)


class AppointmentCreate(BaseModel):
    provider_id: int
    start_at: AwareDatetime  # e.g. 2026-11-14T09:00:00Z; end time is derived from the provider's duration

    _utc = field_validator("start_at")(_to_utc)


class AppointmentReschedule(BaseModel):
    new_start_at: AwareDatetime

    _utc = field_validator("new_start_at")(_to_utc)


class AppointmentOut(BaseModel):
    id: int
    customer_id: int
    provider_id: int
    start_at: datetime
    end_at: datetime
    status: AppointmentStatus
    created_at: datetime
    review: ReviewOut | None = None  # set once the customer has reviewed this appointment

    model_config = {"from_attributes": True}


class AppointmentHistoryOut(BaseModel):
    old_status: AppointmentStatus | None
    new_status: AppointmentStatus
    changed_at: datetime
    changed_by: int
    note: str | None

    model_config = {"from_attributes": True}


class AppointmentDetailOut(AppointmentOut):
    history: list[AppointmentHistoryOut]
