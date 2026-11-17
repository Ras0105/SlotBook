# backend/app/models/review.py
# Purpose: a customer's star rating (1-5) and optional comment for one finished appointment.
# One review per appointment (unique), so a customer cannot rate the same visit twice.

from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base


class Review(Base):
    __tablename__ = "reviews"
    __table_args__ = (
        CheckConstraint("rating BETWEEN 1 AND 5", name="rating_range"),
        UniqueConstraint("appointment_id"),  # named uq_reviews_appointment_id by the naming convention
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    appointment_id: Mapped[int] = mapped_column(ForeignKey("appointments.id"))
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"), index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    rating: Mapped[int]
    comment: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # set when edited

    appointment: Mapped["Appointment"] = relationship(back_populates="review")
    customer: Mapped["User"] = relationship()

    @property
    def reviewer_name(self) -> str:
        """\"Asha Rao\" -> \"Asha R.\": reviews are public, so the surname is shortened."""
        parts = self.customer.name.split()
        if len(parts) <= 1:
            return parts[0] if parts else "Customer"
        return f"{parts[0]} {parts[-1][0]}."
