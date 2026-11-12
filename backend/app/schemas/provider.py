from datetime import time

from pydantic import BaseModel


class ProviderCreate(BaseModel):
    service_name: str
    appointment_duration_minutes: int = 30


class ProviderOut(ProviderCreate):
    id: int
    model_config = {"from_attributes": True}


class AvailabilityCreate(BaseModel):
    weekday: int
    start_time: time
    end_time: time
