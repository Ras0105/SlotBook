# backend/app/schemas/admin.py
# Purpose: response models for admin statistics.

from datetime import date, datetime

from pydantic import BaseModel


class DayCount(BaseModel):
    date: date  # UTC calendar day of the appointment's start
    count: int


class ProviderCount(BaseModel):
    provider_id: int
    service_name: str
    bookings: int


class StatsOut(BaseModel):
    date_from: datetime
    date_to: datetime
    total_appointments: int
    by_status: dict[str, int]  # always has booked / cancelled / completed
    cancellation_rate: float  # cancelled / total, 0.0 when there are no appointments (rounded to 4 places)
    bookings_per_day: list[DayCount]  # only days that have appointments, oldest first
    top_providers: list[ProviderCount]  # most appointments first (cancelled ones excluded), max 5
