# backend/app/models/provider.py
# Purpose: Provider profile, weekly working hours (Availability) and blocked periods (BlockedSlot).

from datetime import datetime, time

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    Time,
    literal_column,
)
from sqlalchemy.dialects.postgresql import ExcludeConstraint
from sqlalchemy.orm import Mapped, deferred, mapped_column, relationship

from app.database.base import Base


class Provider(Base):
    __tablename__ = "providers"
    __table_args__ = (
        CheckConstraint("appointment_duration_minutes > 0", name="duration_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    service_name: Mapped[str] = mapped_column(String(150))
    appointment_duration_minutes: Mapped[int] = mapped_column(default=30)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC", server_default="UTC")  # IANA name

    # Public profile: short description, a category for the filter chips, and an optional photo / logo.
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    category: Mapped[str] = mapped_column(String(32), default="other", server_default="other")
    # The image bytes live in the database (hosting like Vercel has no persistent disk). They are deferred, so
    # listing providers never loads them; GET /providers/{id}/photo reads them on demand.
    photo_data: Mapped[bytes | None] = deferred(mapped_column(LargeBinary, nullable=True))
    photo_content_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    photo_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Review summary, kept in step with the reviews table inside the same transaction as each new review.
    rating_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
    review_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    user: Mapped["User"] = relationship(back_populates="provider")
    availability: Mapped[list["Availability"]] = relationship(back_populates="provider")
    blocked_slots: Mapped[list["BlockedSlot"]] = relationship(back_populates="provider")
    appointments: Mapped[list["Appointment"]] = relationship(back_populates="provider")

    @property
    def photo_url(self) -> str | None:
        """Relative URL of the photo; the millisecond timestamp changes with every upload, so caches never serve a stale one."""
        if self.photo_updated_at is None:
            return None
        return f"/providers/{self.id}/photo?v={int(self.photo_updated_at.timestamp() * 1000)}"


class Availability(Base):
    __tablename__ = "availability"
    __table_args__ = (
        CheckConstraint("start_time < end_time", name="start_before_end"),
        CheckConstraint("weekday BETWEEN 0 AND 6", name="weekday_range"),
        # Safety net behind the application check: one provider cannot have two overlapping working-hour
        # rules on the same weekday. Half-open ranges, so 09:00-12:00 and 12:00-15:00 may touch.
        # (date + time -> timestamp is just a trick to build a range out of two time-of-day values.)
        ExcludeConstraint(
            ("provider_id", "="),
            ("weekday", "="),
            (
                literal_column("tsrange(DATE '2000-01-01' + start_time, DATE '2000-01-01' + end_time, '[)')"),
                "&&",
            ),
            using="gist",
            name="ex_availability_no_overlap",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"), index=True)
    weekday: Mapped[int] = mapped_column(SmallInteger)  # 0 = Monday
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)

    provider: Mapped[Provider] = relationship(back_populates="availability")


class BlockedSlot(Base):
    __tablename__ = "blocked_slots"
    __table_args__ = (CheckConstraint("start_at < end_at", name="start_before_end"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"), index=True)
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    reason: Mapped[str | None] = mapped_column(String(255))

    provider: Mapped[Provider] = relationship(back_populates="blocked_slots")
