# backend/app/repositories/review_repository.py
# Purpose: database queries for reviews (no business logic here).

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.models import Review


def get_for_appointment(db: Session, appointment_id: int) -> Review | None:
    return db.scalar(select(Review).where(Review.appointment_id == appointment_id))


def list_for_provider(db: Session, provider_id: int, skip: int = 0, limit: int = 20) -> list[Review]:
    stmt = (
        select(Review)
        .where(Review.provider_id == provider_id)
        .options(joinedload(Review.customer))
        .order_by(Review.created_at.desc(), Review.id.desc())
        .offset(skip)
        .limit(limit)
    )
    return list(db.scalars(stmt))


def create(db: Session, review: Review) -> Review:
    """Add the review and flush to get its id. The caller commits."""
    db.add(review)
    db.flush()
    return review


def summary_for_provider(db: Session, provider_id: int) -> tuple[float | None, int]:
    """(average rating, number of reviews). The average is None when there are no reviews."""
    avg, count = db.execute(
        select(func.avg(Review.rating), func.count(Review.id)).where(Review.provider_id == provider_id)
    ).one()
    return (round(float(avg), 2) if avg is not None else None), int(count)
