# backend/app/models/__init__.py
# Purpose: import all models in one place so SQLAlchemy/Alembic register every table.

from app.models.user import Role, User  # noqa: F401
from app.models.provider import Availability, BlockedSlot, Provider  # noqa: F401
from app.models.appointment import Appointment, AppointmentHistory, AppointmentStatus  # noqa: F401
from app.models.password_reset import PasswordResetToken  # noqa: F401
from app.models.review import Review  # noqa: F401
