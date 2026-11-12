# API reference

<<<<<<< HEAD
Interactive docs: `http://localhost:8000/docs` (Swagger UI). All timestamps are **UTC** ISO-8601 and **must include a
timezone** when sent (e.g. `2026-11-16T03:30:00Z` or `2026-11-16T09:00:00+05:30`). Naive timestamps are rejected with 422.

Protected endpoints need the header `Authorization: Bearer <access_token>` (from `POST /auth/login`).
=======
| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | /auth/register | Register a user |
| POST | /auth/login | Log in, get a token |
| GET | /providers | List providers |
| POST | /providers | Create provider profile |
| POST | /availability | Create working hours (provider) |
| PATCH / DELETE | /availability/{id} | Update / delete a working-hours rule (provider) |
| POST | /availability/blocked-slots | Block a period (provider; 409 if bookings exist in it) |
| GET | /providers/{id}/slots?date=YYYY-MM-DD | Available slots |
| POST | /appointments | Book |
| GET | /appointments/me | Current user's appointments |
| GET | /appointments/{id} | Appointment details |
| PATCH | /appointments/{id}/cancel | Cancel |
| PATCH | /appointments/{id}/reschedule | Reschedule |
| GET | /admin/appointments | Admin only. Filters: `provider_id`, `customer_id`, `status`, `date_from`, `date_to`; pagination: `skip`, `limit` (1-100) |

Status codes: 201, 200, 401, 403, 404, 409 (slot conflict), 422, 503 (lock timeout, retry; sent with `Retry-After`).

Admins cannot be created through the API; use `python -m app.scripts.create_admin`.
>>>>>>> 1b166ad1a412ecd604ed83ea617b5aa4eb056234

| Method | Endpoint | Who | Purpose |
| --- | --- | --- | --- |
| POST | /auth/register | anyone | Register (always a customer) |
| POST | /auth/login | anyone | Log in (form fields `username` = email, `password`); returns a token |
| GET | /auth/me | logged in | The current user: id, name, email, role |
| GET | /providers | anyone | List providers (`search`, `skip`, `limit`) |
| GET | /providers/{id} | anyone | One provider |
| POST | /providers | customer | Create your provider profile (you become a provider) |
| PATCH | /providers/me | provider | Update your profile |
| GET | /providers/{id}/slots?date=YYYY-MM-DD | anyone | Free slots on a day (in the provider's timezone) |
| GET | /providers/{id}/availability | anyone | A provider's weekly working hours |
| POST | /availability | provider | Add working hours |
| PATCH / DELETE | /availability/{id} | provider (owner) | Change / remove a working-hours rule |
| POST | /availability/blocked-slots | provider | Block a period (409 if bookings exist inside it) |
| POST | /appointments | customer, provider | Book a slot |
| GET | /appointments/me | logged in | My appointments (`status`, `skip`, `limit`) |
| GET | /appointments/{id} | customer, its provider, admin | Details with status history |
| PATCH | /appointments/{id}/cancel | customer, its provider, admin | Cancel |
| PATCH | /appointments/{id}/reschedule | customer who booked, admin | Move to another free slot |
| GET | /admin/appointments | admin | All appointments; filters `provider_id`, `customer_id`, `status`, `date_from`, `date_to`; `skip`, `limit` (1-100) |
| GET | /admin/stats | admin | Totals, cancellation rate, bookings per day, busiest providers |
| GET | /health | anyone | Liveness check |

## Status codes

| Code | Meaning |
| --- | --- |
| 200 / 201 / 204 | OK / created / deleted |
| 401 | Missing, invalid or expired token; wrong email or password |
| 403 | Logged in but not allowed (wrong role, or someone else's resource) |
| 404 | Resource not found |
| 409 | Conflict: slot taken or overlapping, duplicate email, overlapping working hours |
| 422 | Invalid data: bad format, naive timestamp, past time, slot not on the grid, outside working hours |
| 429 | Too many failed logins; wait `Retry-After` seconds |
| 503 | Database lock timeout; safe to retry (sent with `Retry-After`) |

## Examples

These are real responses captured by `backend/scripts/demo.py` (IDs and times will differ on your machine).

### Register, then log in
```http
POST /auth/register
{"name": "Alice", "email": "alice@example.com", "password": "demo-password-1"}
```
```json
201  {"id": 2, "name": "Alice", "email": "alice@example.com", "role": "customer"}
```
```http
POST /auth/login        (Content-Type: application/x-www-form-urlencoded)
username=alice@example.com&password=demo-password-1
```
```json
200  {"access_token": "<JWT>", "token_type": "bearer"}
```
```json
GET /auth/me  ->  200  {"id": 2, "name": "Alice", "email": "alice@example.com", "role": "customer"}
```

### Provider creates a profile and working hours
```http
POST /providers
{"service_name": "General Checkup", "appointment_duration_minutes": 30, "timezone": "Asia/Kolkata"}
```
```json
201  {"id": 1, "user_id": 1, "service_name": "General Checkup", "appointment_duration_minutes": 30, "timezone": "Asia/Kolkata"}
```
```http
POST /availability
{"weekday": 0, "start_time": "09:00:00", "end_time": "12:00:00"}
```
`weekday` 0 = Monday. Times are wall-clock times in the provider's timezone.

### Find free slots
```http
GET /providers/1/slots?date=2026-11-16
```
```json
{
  "provider_id": 1,
  "date": "2026-11-16",
  "timezone": "Asia/Kolkata",
  "appointment_duration_minutes": 30,
  "slots": [
    {"start_at": "2026-11-16T03:30:00Z", "end_at": "2026-11-16T04:00:00Z"},
    {"start_at": "2026-11-16T04:00:00Z", "end_at": "2026-11-16T04:30:00Z"}
  ]
}
```
(09:00 Kolkata = 03:30 UTC. The list continues to 11:30 Kolkata time.)

### Book a slot, and a conflicting booking
```http
POST /appointments
{"provider_id": 1, "start_at": "2026-11-16T03:30:00Z"}
```
```json
201  {"id": 1, "customer_id": 2, "provider_id": 1, "start_at": "2026-11-16T03:30:00Z",
      "end_at": "2026-11-16T04:00:00Z", "status": "booked", "created_at": "2026-11-12T21:24:52.905890Z"}
```
The same request from another customer:
```json
409  {"detail": "This slot is no longer available"}
```

### View an appointment (with history)
```json
GET /appointments/1  ->  200
{
  "id": 1, "customer_id": 2, "provider_id": 1,
  "start_at": "2026-11-16T03:30:00Z", "end_at": "2026-11-16T04:00:00Z",
  "status": "booked", "created_at": "2026-11-12T21:24:52.905890Z",
  "history": [
    {"old_status": null, "new_status": "booked", "changed_at": "2026-11-12T21:24:52.908035Z",
     "changed_by": 2, "note": "Appointment booked"}
  ]
}
```

### Cancel / reschedule
```http
PATCH /appointments/1/cancel                         -> 200, status "cancelled" (the slot is free again)
PATCH /appointments/1/reschedule
{"new_start_at": "2026-11-16T04:00:00Z"}             -> 200, or 409 if that slot is taken
```

### Admin: list and statistics
```http
GET /admin/appointments?status=booked&provider_id=1&date_from=2026-11-01T00:00:00Z&limit=2
```
```json
[{"id": 2, "customer_id": 3, "provider_id": 1, "start_at": "2026-11-16T03:30:00Z",
  "end_at": "2026-11-16T04:00:00Z", "status": "booked", "created_at": "2026-11-12T21:24:52.952527Z"}]
```
```http
GET /admin/stats?date_from=2026-11-01T00:00:00Z&date_to=2026-12-01T00:00:00Z
```
```json
{
  "date_from": "2026-11-01T00:00:00Z",
  "date_to": "2026-12-01T00:00:00Z",
  "total_appointments": 2,
  "by_status": {"booked": 1, "cancelled": 1, "completed": 0},
  "cancellation_rate": 0.5,
  "bookings_per_day": [{"date": "2026-11-16", "count": 1}],
  "top_providers": [{"provider_id": 1, "service_name": "General Checkup", "bookings": 1}]
}
```
Statistics cover appointments **starting** in `[date_from, date_to)`; without parameters, the last 30 UTC days (max range 366 days).
`bookings_per_day` and `top_providers` do not count cancelled appointments; `cancellation_rate` = cancelled / all.

### Login lockout
After 5 failed logins for one email from one IP within 5 minutes:
```http
429  Retry-After: 300
{"detail": "Too many failed login attempts. Please try again later."}
```

Admins cannot be created through the API; use `python -m app.scripts.create_admin`.
