# backend/app/schemas/review.py
# Purpose: Pydantic request/response models for ratings and reviews.

from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class ReviewCreate(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=1000)

    @field_validator("comment")
    @classmethod
    def _trim(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        return value or None


class ReviewOut(BaseModel):
    id: int
    appointment_id: int
    provider_id: int
    rating: int
    comment: str | None
    reviewer_name: str  # "Asha R."
    created_at: datetime
    updated_at: datetime | None = None  # set when the review was edited

    model_config = {"from_attributes": True}
