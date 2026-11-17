# backend/app/routes/appointments.py
# Purpose: HTTP endpoints for the booking lifecycle (book, list mine, view, cancel, reschedule).

from fastapi import APIRouter, BackgroundTasks, Depends, Query, status
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.dependencies.auth import get_current_user, require_verified_role
from app.models import AppointmentStatus, Role, User
from app.schemas.appointment import (
    AppointmentCreate,
    AppointmentDetailOut,
    AppointmentOut,
    AppointmentReschedule,
)
from app.services import appointment_service, email_service, notification_service

router = APIRouter(prefix="/appointments", tags=["appointments"])


@router.post("", response_model=AppointmentOut, status_code=status.HTTP_201_CREATED)
def book_appointment(
    data: AppointmentCreate,
    background_tasks: BackgroundTasks,
    user: User = Depends(require_verified_role(Role.customer, Role.provider)),
    db: Session = Depends(get_db),
):
    appointment = appointment_service.create_appointment(db, user, data)  # committed (or raised) by here
    # Emails run after the response is ready, and only because the booking really committed.
    background_tasks.add_task(email_service.send_all, notification_service.booking_confirmed(appointment))
    return appointment


# Declared before "/{appointment_id}" so "me" and "next" are never parsed as an id.
@router.get("/next", response_model=AppointmentOut | None)
def get_next_appointment(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The logged-in customer's soonest upcoming appointment, or null when there is none."""
    return appointment_service.get_next_appointment(db, user)


@router.get("/me", response_model=list[AppointmentOut])
def list_my_appointments(
    status_filter: AppointmentStatus | None = Query(default=None, alias="status"),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return appointment_service.list_my_appointments(
        db, user, status_filter=status_filter, skip=skip, limit=limit
    )


@router.get("/{appointment_id}", response_model=AppointmentDetailOut)
def get_appointment(
    appointment_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return appointment_service.get_appointment(db, user, appointment_id)


@router.patch("/{appointment_id}/cancel", response_model=AppointmentOut)
def cancel_appointment(
    appointment_id: int,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    appointment = appointment_service.cancel_appointment(db, user, appointment_id)
    background_tasks.add_task(
        email_service.send_all, notification_service.booking_cancelled(appointment, cancelled_by_name=user.name)
    )
    return appointment


@router.patch("/{appointment_id}/reschedule", response_model=AppointmentOut)
def reschedule_appointment(
    appointment_id: int,
    data: AppointmentReschedule,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    appointment = appointment_service.reschedule_appointment(db, user, appointment_id, data)
    background_tasks.add_task(email_service.send_all, notification_service.booking_rescheduled(appointment))
    return appointment
