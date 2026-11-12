# backend/tests/helpers.py
# Purpose: small helpers shared by API tests (register/login, time formatting).

from datetime import date, datetime, timedelta, timezone


def auth_headers(client, email: str, name: str = "Test User", password: str = "password123") -> dict:
    client.post("/auth/register", json={"name": name, "email": email, "password": password})
    response = client.post("/auth/login", data={"username": email, "password": password})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def future_day(days_ahead: int = 7) -> date:
    return datetime.now(timezone.utc).date() + timedelta(days=days_ahead)


def iso(day: date, hour: int, minute: int = 0) -> str:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=timezone.utc).isoformat()
