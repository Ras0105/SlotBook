# backend/app/models/appointment.py
# Purpose: Appointment table, its status enum, and the status-change history table.

import enum
from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Index, String, literal_column, text
from sqlalchemy.dialects.postgresql import ExcludeConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base


class AppointmentStatus(str, enum.Enum):
    booked = "booked"
    cancelled = "cancelled"
    completed = "completed"


class Appointment(Base):
    __tablename__ = "appointments"
    __table_args__ = (
        CheckConstraint("start_at < end_at", name="start_before_end"),
        Index("ix_appointments_provider_start", "provider_id", "start_at"),
        Index("ix_appointments_start_at", "start_at"),  # admin date-range filters
        # Database-enforced rule: one provider cannot have two overlapping BOOKED appointments.
        # Half-open ranges '[)' so back-to-back appointments (10:00-10:30, 10:30-11:00) are allowed.
        # Cancelled/completed rows are outside the WHERE clause, so they never block a slot.
        ExcludeConstraint(
            ("provider_id", "="),
            (literal_column("tstzrange(start_at, end_at, '[)')"), "&&"),
            where=text("status = 'booked'"),
            using="gist",
            name="ex_appointments_no_overlap",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"))
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[AppointmentStatus] = mapped_column(
        Enum(AppointmentStatus), default=AppointmentStatus.booked
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)  # the customer's "reason for visit"
    # Set when the 24h reminder has been sent (or is being sent), so it goes out only once. Cleared on reschedule.
    reminder_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    customer: Mapped["User"] = relationship(back_populates="appointments")
    provider: Mapped["Provider"] = relationship(back_populates="appointments")
    history: Mapped[list["AppointmentHistory"]] = relationship(
        back_populates="appointment", order_by="AppointmentHistory.id"
    )
    review: Mapped["Review | None"] = relationship(back_populates="appointment", uselist=False, lazy="selectin")


class AppointmentHistory(Base):
    __tablename__ = "appointment_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    appointment_id: Mapped[int] = mapped_column(ForeignKey("appointments.id"), index=True)
    old_status: Mapped[AppointmentStatus | None] = mapped_column(Enum(AppointmentStatus))
    new_status: Mapped[AppointmentStatus] = mapped_column(Enum(AppointmentStatus))
    changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    changed_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str | None] = mapped_column(String(255))  # e.g. "Rescheduled from ... to ..."

    appointment: Mapped[Appointment] = relationship(back_populates="history")
