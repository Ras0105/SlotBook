# backend/app/schemas/provider.py
# Purpose: Pydantic request/response models for provider profiles.

from pydantic import BaseModel, Field


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
