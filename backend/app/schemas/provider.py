# backend/app/schemas/provider.py
# Purpose: Pydantic request/response models for provider profiles and availability.

from datetime import time

from pydantic import BaseModel, Field, model_validator


class ProviderCreate(BaseModel):
    service_name: str = Field(min_length=1, max_length=150)
    appointment_duration_minutes: int = Field(default=30, ge=5, le=480)


class ProviderUpdate(BaseModel):
    """All fields optional: only the fields sent are changed."""

    service_name: str | None = Field(default=None, min_length=1, max_length=150)
    appointment_duration_minutes: int | None = Field(default=None, ge=5, le=480)


class ProviderOut(BaseModel):
    id: int
    user_id: int
    service_name: str
    appointment_duration_minutes: int

    model_config = {"from_attributes": True}


class AvailabilityCreate(BaseModel):
    weekday: int = Field(ge=0, le=6)  # 0 = Monday
    start_time: time
    end_time: time

    @model_validator(mode="after")
    def check_time_range(self):
        if self.start_time >= self.end_time:
            raise ValueError("start_time must be before end_time")
        return self
