# backend/app/schemas/provider.py
# Purpose: Pydantic request/response models for provider profiles.

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator


def _validate_timezone(value: str | None) -> str | None:
    """Accept only real IANA timezone names such as 'UTC' or 'Asia/Kolkata'."""
    if value is None:
        return value
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        raise ValueError("unknown IANA timezone, e.g. 'UTC' or 'Asia/Kolkata'")
    return value


class ProviderCreate(BaseModel):
    service_name: str = Field(min_length=1, max_length=150)
    appointment_duration_minutes: int = Field(default=30, ge=5, le=480)
    timezone: str = Field(default="UTC", max_length=64)  # timezone of the provider's working hours

    _check_tz = field_validator("timezone")(_validate_timezone)


class ProviderUpdate(BaseModel):
    """All fields optional: only the fields sent are changed."""

    service_name: str | None = Field(default=None, min_length=1, max_length=150)
    appointment_duration_minutes: int | None = Field(default=None, ge=5, le=480)
    timezone: str | None = Field(default=None, max_length=64)

    _check_tz = field_validator("timezone")(_validate_timezone)


class ProviderOut(BaseModel):
    id: int
    user_id: int
    service_name: str
    appointment_duration_minutes: int
    timezone: str

    model_config = {"from_attributes": True}
