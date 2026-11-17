# API reference

Interactive docs: `http://localhost:8000/docs` (Swagger UI). All timestamps are **UTC** ISO-8601 and **must include a
timezone** when sent (e.g. `2026-11-16T03:30:00Z` or `2026-11-16T09:00:00+05:30`). Naive timestamps are rejected with 422.

Protected endpoints need the header `Authorization: Bearer <access_token>` (from `POST /auth/login`).

| Method | Endpoint | Who | Purpose |
| --- | --- | --- | --- |
| POST | /auth/register | anyone | Register (always a customer) |
| POST | /auth/login | anyone | Log in (form fields `username` = email, `password`); returns a token |
| GET | /auth/me | logged in | The current user: id, name, email, role, created_at |
| PATCH | /auth/me | logged in | Update `name` and/or `email` (changing email needs `current_password`; wrong password = 400, not 401) |
| POST | /auth/change-password | logged in | `current_password` + `new_password`; sends a "password changed" email |
| POST | /auth/forgot-password | anyone | `{email}` -> always 202 (no account probing); emails a one-time link, valid 30 min; rate limited (429) |
| POST | /auth/reset-password | anyone | `{token, new_password}`; link works once, 400 if used/expired |
| GET | /providers | anyone | List providers (`search`, `skip`, `limit`) |
| GET | /providers/{id} | anyone | One provider |
| POST | /providers | customer | Create your provider profile (you become a provider) |
| GET | /providers/me | provider | Your own profile |
| PATCH | /providers/me | provider | Update your profile |
| GET | /providers/{id}/slots?date=YYYY-MM-DD | anyone | Free slots on a day (in the provider's timezone) |
| GET | /providers/{id}/availability | anyone | A provider's weekly working hours |
| POST | /availability | provider | Add working hours |
| PATCH / DELETE | /availability/{id} | provider (owner) | Change / remove a working-hours rule |
| GET | /availability/blocked-slots | provider | Your blocked periods, soonest first; periods already over are hidden unless `include_past=true` |
| POST | /availability/blocked-slots | provider | Block a period (409 if bookings exist inside it) |
| DELETE | /availability/blocked-slots/{id} | provider (owner) | Remove a blocked period (the time becomes bookable again) |
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

## Profiles, reviews and calendar

| Method and path | Who | What |
|---|---|---|
| `GET /providers?category=dentist&search=...` | anyone | Filter by category (`dentist, doctor, therapist, tutor, fitness, salon, legal, consultant, other`); search also matches the description |
| `POST /providers`, `PATCH /providers/me` | provider | Now accept `description` (max 500, `""` clears) and `category` |
| `POST /providers/me/photo` | provider | Multipart field `file`: JPEG, PNG or WebP, max 512 KB (content is checked, not just the header). Returns the profile |
| `DELETE /providers/me/photo` | provider | Remove the photo |
| `GET /providers/{id}/photo` | anyone | The image; `photo_url` in the profile carries `?v=<ms>` so long caching is safe |
| `GET /providers/me/calendar?start=&end=` | provider | Booked + completed appointments overlapping the range (max 62 days) with `customer_name` |
| `POST /appointments/{id}/review` | the customer | `{rating: 1-5, comment?}`. Allowed once the appointment is over (status completed, or booked with a past end time, which is then marked completed). 409 if cancelled, not over, or already reviewed |
| `GET /providers/{id}/reviews?skip&limit` | anyone | Newest first; reviewer shown as "Asha R." |

Provider objects now include `description`, `category`, `photo_url`, `rating_avg` (null until reviewed) and `review_count`. Appointment objects include `review` (or null).
"Add to calendar" needs no endpoint: the browser builds the `.ics` file.

## Notes, reminders, next appointment, review changes
| Method and path | Who | What |
|---|---|---|
| `POST /appointments` | customer | New optional `notes` (max 500): the reason for visit. Returned as `notes` on appointments and calendar entries |
| `GET /appointments/next` | customer | Soonest upcoming booked appointment, or `null` |
| `PATCH /reviews/{id}` | author | `{rating, comment?}` replaces the review (omitting `comment` clears it); sets `updated_at` |
| `DELETE /reviews/{id}` | author or admin | 204. The appointment can be reviewed again |
| `GET /availability/blocked-slots?start=&end=` | provider | Time off overlapping a range (max 62 days, past included) |
| `PATCH /auth/me` | user | New `phone` (+country code, `""` removes) and `reminders_enabled` |
| `GET/POST /internal/send-reminders` | scheduler | `Authorization: Bearer CRON_SECRET`; 404 when CRON_SECRET is empty. See `docs/reminders-and-email.md` |
