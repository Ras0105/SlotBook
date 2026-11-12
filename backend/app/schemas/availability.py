# backend/app/schemas/availability.py
# Purpose: Pydantic request/response models for weekly working hours and blocked periods.

from datetime import datetime, time, timezone

from pydantic import AwareDatetime, BaseModel, Field, field_validator, model_validator


def _reject_timezone(value: time | None) -> time | None:
    """Working hours are plain wall-clock times, not timezone-aware."""
    if value is not None and value.tzinfo is not None:
        raise ValueError("time must not include a timezone offset")
    return value


class AvailabilityCreate(BaseModel):
    weekday: int = Field(ge=0, le=6)  # 0 = Monday
    start_time: time
    end_time: time

    _check_tz = field_validator("start_time", "end_time")(_reject_timezone)

    @model_validator(mode="after")
    def check_time_range(self):
        if self.start_time >= self.end_time:
            raise ValueError("start_time must be before end_time")
        return self


class AvailabilityUpdate(BaseModel):
    """All fields optional: only the fields sent are changed."""

    weekday: int | None = Field(default=None, ge=0, le=6)
    start_time: time | None = None
    end_time: time | None = None

    _check_tz = field_validator("start_time", "end_time")(_reject_timezone)


class AvailabilityOut(BaseModel):
    id: int
    provider_id: int
    weekday: int
    start_time: time
    end_time: time

    model_config = {"from_attributes": True}


class BlockedSlotCreate(BaseModel):
    start_at: AwareDatetime  # must include a timezone offset; stored as UTC
    end_at: AwareDatetime
    reason: str | None = Field(default=None, max_length=255)

    @field_validator("start_at", "end_at")
    @classmethod
    def to_utc(cls, value: datetime) -> datetime:
        return value.astimezone(timezone.utc)

    @model_validator(mode="after")
    def check_range(self):
        if self.start_at >= self.end_at:
            raise ValueError("start_at must be before end_at")
        return self


class BlockedSlotOut(BaseModel):
    id: int
    provider_id: int
    start_at: datetime
    end_at: datetime
    reason: str | None

    model_config = {"from_attributes": True}
