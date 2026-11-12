# backend/app/schemas/slot.py
# Purpose: Pydantic response models for available appointment slots.

from datetime import date, datetime

from pydantic import BaseModel


class SlotOut(BaseModel):
    start_at: datetime  # UTC
    end_at: datetime  # UTC


class SlotsResponse(BaseModel):
    provider_id: int
    date: date  # the day requested, in the provider's timezone
    timezone: str  # provider's IANA timezone, for displaying slots locally
    appointment_duration_minutes: int
    slots: list[SlotOut]
