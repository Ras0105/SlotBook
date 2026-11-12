"""Scripted demo of SlotBook: a successful booking, then a conflicting one.

Run against a running API (docker compose up, or uvicorn):

    python scripts/demo.py                       # uses http://localhost:8000
    python scripts/demo.py http://localhost:8000

It creates fresh demo users (random email suffix), so it can be run repeatedly.
Record the terminal (e.g. with asciinema or a screen recorder) to get the short demo for the README.
"""

import json
import sys
import uuid
from datetime import date, datetime, timedelta

import httpx

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")
RUN = uuid.uuid4().hex[:6]
client = httpx.Client(base_url=BASE, timeout=15)


def show(title: str, response: httpx.Response, request_body=None) -> httpx.Response:
    req = response.request
    print(f"\n### {title}")
    print(f"{req.method} {req.url.raw_path.decode()}")
    if request_body is not None:
        print("request :", json.dumps(request_body))
    body = response.text
    try:
        body = json.dumps(response.json(), indent=2)
    except ValueError:
        pass
    print(f"-> {response.status_code}\n{body}" if body else f"-> {response.status_code}")
    return response


def register_and_login(name: str, email: str) -> dict:
    password = "demo-password-1"
    show(f"Register {name}", client.post("/auth/register", json={"name": name, "email": email, "password": password}),
         {"name": name, "email": email, "password": "********"})
    token = client.post("/auth/login", data={"username": email, "password": password}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def next_monday() -> date:
    today = date.today()
    return today + timedelta(days=(7 - today.weekday()) % 7 or 7)


def main() -> None:
    print(f"SlotBook demo against {BASE}")
    day = next_monday()

    provider = register_and_login("Dr. Asha Rao", f"asha.{RUN}@example.com")
    alice = register_and_login("Alice", f"alice.{RUN}@example.com")
    bob = register_and_login("Bob", f"bob.{RUN}@example.com")

    body = {"service_name": "General Checkup", "appointment_duration_minutes": 30, "timezone": "Asia/Kolkata"}
    p = show("Provider creates a profile", client.post("/providers", json=body, headers=provider), body).json()

    body = {"weekday": day.weekday(), "start_time": "09:00:00", "end_time": "12:00:00"}
    show("Provider sets working hours (Mondays 09:00-12:00 Kolkata time)", client.post("/availability", json=body, headers=provider), body)

    show("Customer browses providers", client.get("/providers"))
    slots = show(f"Customer asks for slots on {day}", client.get(f"/providers/{p['id']}/slots", params={"date": day.isoformat()})).json()
    first = slots["slots"][0]["start_at"]

    body = {"provider_id": p["id"], "start_at": first}
    booked = show("Alice books the first slot -> 201 Created", client.post("/appointments", json=body, headers=alice), body).json()

    show("Bob tries to book the SAME slot -> 409 Conflict", client.post("/appointments", json=body, headers=bob), body)

    body = {"provider_id": p["id"], "start_at": (datetime.fromisoformat(first) + timedelta(minutes=15)).isoformat()}
    show("Bob tries a slot that only PARTLY overlaps -> 422 (not on the slot grid)", client.post("/appointments", json=body, headers=bob), body)

    show("Alice views her appointment (with history)", client.get(f"/appointments/{booked['id']}", headers=alice))
    show("Alice cancels", client.patch(f"/appointments/{booked['id']}/cancel", headers=alice))
    body = {"provider_id": p["id"], "start_at": first}
    show("Bob books the slot Alice freed -> 201 Created", client.post("/appointments", json=body, headers=bob), body)
    show("Bob views his appointments", client.get("/appointments/me", headers=bob))
    print("\nDone: one slot, two customers, exactly one booking at a time.")


if __name__ == "__main__":
    main()
