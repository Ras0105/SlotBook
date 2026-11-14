# backend/app/services/review_service.py
# Purpose: business rules for reviews: who may review, when, and keeping the provider's rating summary right.

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.database.errors import translate_db_errors
from app.database.transaction import transaction
from app.models import AppointmentStatus, Review, User
from app.repositories import appointment_repository, provider_repository, review_repository
from app.schemas.review import ReviewCreate


def list_provider_reviews(db: Session, provider_id: int, skip: int = 0, limit: int = 20) -> list[Review]:
    if not provider_repository.get_by_id(db, provider_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Provider not found")
    return review_repository.list_for_provider(db, provider_id, skip=skip, limit=limit)


def create_review(
    db: Session, user: User, appointment_id: int, data: ReviewCreate, now: datetime | None = None
) -> Review:
    """Review an appointment that has taken place.

    Only the customer who had the appointment can review it, once. "Taken place" means the status is
    completed, or it is still "booked" but its end time has passed (nobody has to click "complete").
    In the second case the appointment is moved to completed, so the status matches reality.
    """
    now = now or datetime.now(timezone.utc)
    with translate_db_errors("You have already reviewed this appointment"), transaction(db):
        appointment = appointment_repository.get_by_id(db, appointment_id)
        if not appointment:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Appointment not found")
        if appointment.customer_id != user.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the customer who had the appointment can review it")

        # Lock the provider row first (same order as booking): two reviews for one provider update the
        # rating summary one after the other, so the summary never misses one.
        provider = appointment_repository.lock_provider(db, appointment.provider_id)
        appointment = appointment_repository.get_by_id_for_update(db, appointment_id)  # re-check under lock

        if appointment.status == AppointmentStatus.cancelled:
            raise HTTPException(status.HTTP_409_CONFLICT, "A cancelled appointment cannot be reviewed")
        if appointment.status == AppointmentStatus.booked:
            if appointment.end_at > now:
                raise HTTPException(status.HTTP_409_CONFLICT, "You can review once the appointment is over")
            appointment.status = AppointmentStatus.completed
            appointment_repository.add_history(
                db,
                appointment.id,
                AppointmentStatus.booked,
                AppointmentStatus.completed,
                user.id,
                note="Completed",
            )
        if review_repository.get_for_appointment(db, appointment.id):
            raise HTTPException(status.HTTP_409_CONFLICT, "You have already reviewed this appointment")

        review = review_repository.create(
            db,
            Review(
                appointment_id=appointment.id,
                provider_id=provider.id,
                customer_id=user.id,
                rating=data.rating,
                comment=data.comment,
            ),
        )
        provider.rating_avg, provider.review_count = review_repository.summary_for_provider(db, provider.id)

    db.refresh(review)
    return review
