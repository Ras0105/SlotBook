# API reference

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | /auth/register | Register a user |
| POST | /auth/login | Log in, get a token |
| GET | /providers | List providers |
| POST | /providers | Create provider profile |
| POST | /availability | Create or update working hours |
| GET | /providers/{id}/slots?date=YYYY-MM-DD | Available slots |
| POST | /appointments | Book |
| GET | /appointments/me | Current user's appointments |
| GET | /appointments/{id} | Appointment details |
| PATCH | /appointments/{id}/cancel | Cancel |
| PATCH | /appointments/{id}/reschedule | Reschedule |
| GET | /admin/appointments | Admin list with filters |

Status codes: 201, 200, 401, 403, 404, 409 (slot conflict), 422.

TODO: add example request/response payloads.
