# backend/app/routes/reviews.py
# Purpose: HTTP endpoints for ratings and reviews.

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.dependencies.auth import get_current_user
from app.models import User
from app.schemas.review import ReviewCreate, ReviewOut
from app.services import review_service

router = APIRouter(tags=["reviews"])


@router.post("/appointments/{appointment_id}/review", response_model=ReviewOut, status_code=status.HTTP_201_CREATED)
def review_appointment(
    appointment_id: int,
    data: ReviewCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return review_service.create_review(db, user, appointment_id, data)


@router.get("/providers/{provider_id}/reviews", response_model=list[ReviewOut])
def list_provider_reviews(
    provider_id: int,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Public: newest reviews first."""
    return review_service.list_provider_reviews(db, provider_id, skip=skip, limit=limit)


@router.patch("/reviews/{review_id}", response_model=ReviewOut)
def update_review(
    review_id: int,
    data: ReviewCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change your own review. Send the rating and the comment you want to end up with."""
    return review_service.update_review(db, user, review_id, data)


@router.delete("/reviews/{review_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_review(review_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    review_service.delete_review(db, user, review_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
