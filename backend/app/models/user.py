# backend/app/models/user.py
# Purpose: User table and Role enum (customer / provider / admin).

import enum
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Enum, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base


class Role(str, enum.Enum):
    customer = "customer"
    provider = "provider"
    admin = "admin"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(Enum(Role), default=Role.customer)
    # Optional mobile number in international format (+14155550123), used only for WhatsApp reminders.
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    reminders_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    provider: Mapped["Provider | None"] = relationship(back_populates="user", uselist=False)
    appointments: Mapped[list["Appointment"]] = relationship(back_populates="customer")
