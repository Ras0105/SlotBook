from datetime import datetime

from pydantic import BaseModel


class AppointmentCreate(BaseModel):
    provider_id: int
    start_at: datetime  # timezone-aware, stored as UTC


class AppointmentReschedule(BaseModel):
    new_start_at: datetime


class AppointmentOut(BaseModel):
    id: int
    customer_id: int
    provider_id: int
    start_at: datetime
    end_at: datetime
    status: str

    model_config = {"from_attributes": True}
