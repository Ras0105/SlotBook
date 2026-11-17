# backend/app/schemas/auth.py
# Purpose: Pydantic request/response models for registration and login.

import re
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class UserOut(BaseModel):
    id: int
    name: str
    email: EmailStr
    role: str
    created_at: datetime
<<<<<<< HEAD
    phone: str | None = None
    reminders_enabled: bool = True
=======
>>>>>>> 8f5cf25e62fe66a545fd61d9619c447499f1f637

    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    new_password: str = Field(min_length=8, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class ProfileUpdate(BaseModel):
    """Both fields are optional: send only what changes. Changing the email also needs the current password."""

    name: str | None = Field(default=None, max_length=120)
    email: EmailStr | None = None
    current_password: str | None = Field(default=None, max_length=128)
<<<<<<< HEAD
    # International format, e.g. +14155550123. "" removes the number. Used only for WhatsApp reminders.
    phone: str | None = Field(default=None, max_length=20)
    reminders_enabled: bool | None = None

    @field_validator("phone")
    @classmethod
    def phone_format(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = re.sub(r"[ \-().]", "", value.strip())  # people type spaces and dashes
        if value == "":
            return ""
        if not re.fullmatch(r"\+[1-9]\d{7,14}", value):
            raise ValueError("Enter the number with its country code, like +91 98765 43210")
        return value
=======
>>>>>>> 8f5cf25e62fe66a545fd61d9619c447499f1f637

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Name cannot be empty")
        return value


class MessageOut(BaseModel):
    message: str
