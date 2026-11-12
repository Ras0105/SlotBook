# API reference

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

TODO: add example request/response payloads.
