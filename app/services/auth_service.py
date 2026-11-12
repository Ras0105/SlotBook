from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password, verify_password
from app.models import Role, User
from app.repositories import user_repository
from app.schemas.auth import RegisterRequest


def register(db: Session, data: RegisterRequest) -> User:
    if user_repository.get_by_email(db, data.email):
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    user = User(name=data.name, email=data.email, password_hash=hash_password(data.password), role=Role.customer)
    user_repository.create(db, user)
    db.commit()
    return user


def login(db: Session, email: str, password: str) -> str:
    user = user_repository.get_by_email(db, email)
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    return create_access_token(str(user.id))
