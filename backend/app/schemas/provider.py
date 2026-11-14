# backend/app/schemas/provider.py
# Purpose: Pydantic request/response models for provider profiles.

from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator

from app.models import AppointmentStatus


def _validate_timezone(value: str | None) -> str | None:
    """Accept only real IANA timezone names such as 'UTC' or 'Asia/Kolkata'."""
    if value is None:
        return value
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        raise ValueError("unknown IANA timezone, e.g. 'UTC' or 'Asia/Kolkata'")
    return value


# Keep in step with frontend/src/lib/categories.js
CATEGORIES = ("dentist", "doctor", "therapist", "tutor", "fitness", "salon", "legal", "consultant", "other")


def _validate_category(value: str | None) -> str | None:
    if value is None:
        return value
    value = value.strip().lower()
    if value not in CATEGORIES:
        raise ValueError(f"category must be one of: {', '.join(CATEGORIES)}")
    return value


def _clean_description(value: str | None) -> str | None:
    """Trim; an empty description means 'none'."""
    if value is None:
        return value
    value = value.strip()
    return value or None


class ProviderCreate(BaseModel):
    service_name: str = Field(min_length=1, max_length=150)
    appointment_duration_minutes: int = Field(default=30, ge=5, le=480)
    timezone: str = Field(default="UTC", max_length=64)  # timezone of the provider's working hours
    description: str | None = Field(default=None, max_length=500)
    category: str = Field(default="other", max_length=32)

    _check_tz = field_validator("timezone")(_validate_timezone)
    _check_category = field_validator("category")(_validate_category)
    _check_description = field_validator("description")(_clean_description)


class ProviderUpdate(BaseModel):
    """All fields optional: only the fields sent are changed."""

    service_name: str | None = Field(default=None, min_length=1, max_length=150)
    appointment_duration_minutes: int | None = Field(default=None, ge=5, le=480)
    timezone: str | None = Field(default=None, max_length=64)
    description: str | None = Field(default=None, max_length=500)  # "" clears it
    category: str | None = Field(default=None, max_length=32)

    _check_tz = field_validator("timezone")(_validate_timezone)
    _check_category = field_validator("category")(_validate_category)
    _check_description = field_validator("description")(_clean_description)


class ProviderOut(BaseModel):
    id: int
    user_id: int
    service_name: str
    appointment_duration_minutes: int
    timezone: str
    description: str | None = None
    category: str = "other"
    photo_url: str | None = None  # relative to the API, e.g. /providers/3/photo?v=1760000000000
    rating_avg: float | None = None  # None until the first review
    review_count: int = 0

    model_config = {"from_attributes": True}


class CalendarEntryOut(BaseModel):
    """One booking in the provider's calendar, with the customer's name (the provider needs it; the public does not)."""

    id: int
    customer_id: int
    customer_name: str
    start_at: datetime
    end_at: datetime
    status: AppointmentStatus
