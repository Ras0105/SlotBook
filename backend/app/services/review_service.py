# backend/app/services/review_service.py
# Purpose: business rules for reviews: who may review, when, and keeping the provider's rating summary right.

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.database.errors import translate_db_errors
from app.database.transaction import transaction
from app.models import AppointmentStatus, Provider, Review, Role, User
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
<<<<<<< HEAD


def _own_review_locked(db: Session, review_id: int, user: User, allow_admin: bool) -> tuple[Review, Provider]:
    """Find the review, check who may change it, and lock its provider (same lock order as everywhere else)."""
    review = review_repository.get_by_id(db, review_id)
    if not review:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Review not found")
    if review.customer_id != user.id and not (allow_admin and user.role == Role.admin):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only change your own review")
    provider = appointment_repository.lock_provider(db, review.provider_id)
    review = review_repository.get_by_id(db, review_id, refresh=True)  # re-read under the lock
    if review is None:  # deleted while we waited
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Review not found")
    return review, provider


def update_review(db: Session, user: User, review_id: int, data: ReviewCreate, now: datetime | None = None) -> Review:
    """Change your own rating and comment. The comment is replaced, so leaving it out clears it."""
    now = now or datetime.now(timezone.utc)
    with translate_db_errors(), transaction(db):
        review, provider = _own_review_locked(db, review_id, user, allow_admin=False)
        review.rating = data.rating
        review.comment = data.comment
        review.updated_at = now
        db.flush()
        provider.rating_avg, provider.review_count = review_repository.summary_for_provider(db, provider.id)
    db.refresh(review)
    return review


def delete_review(db: Session, user: User, review_id: int) -> None:
    """Delete a review: its author or an admin. The appointment can be reviewed again afterwards."""
    with translate_db_errors(), transaction(db):
        review, provider = _own_review_locked(db, review_id, user, allow_admin=True)
        review_repository.delete(db, review)
        provider.rating_avg, provider.review_count = review_repository.summary_for_provider(db, provider.id)
=======
>>>>>>> 8f5cf25e62fe66a545fd61d9619c447499f1f637
