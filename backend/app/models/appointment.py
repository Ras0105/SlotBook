# backend/app/models/appointment.py
# Purpose: Appointment table, its status enum, and the status-change history table.

import enum
from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base


class AppointmentStatus(str, enum.Enum):
    booked = "booked"
    cancelled = "cancelled"
    completed = "completed"


class Appointment(Base):
    __tablename__ = "appointments"
    __table_args__ = (
        CheckConstraint("start_at < end_at"),
        Index("ix_appointments_provider_start", "provider_id", "start_at"),
        # TODO (Week 3): add a PostgreSQL exclusion constraint on
        # (provider_id, tstzrange(start_at, end_at)) WHERE status = 'booked'
        # in an Alembic migration, or use row locking in the booking service.
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

    customer: Mapped["User"] = relationship(back_populates="appointments")
    provider: Mapped["Provider"] = relationship(back_populates="appointments")
    history: Mapped[list["AppointmentHistory"]] = relationship(back_populates="appointment")


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

    appointment: Mapped[Appointment] = relationship(back_populates="history")
