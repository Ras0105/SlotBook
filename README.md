# SlotBook

Appointment-booking backend (FastAPI + PostgreSQL) for clinics, salons, consultants and trainers.
Customers browse providers, see free slots and book, cancel or reschedule. Providers manage working hours and time off.
Admins oversee every booking and see statistics.

**The interesting part:** two customers can never hold overlapping appointments for one provider, even when their
requests arrive at the same instant. This is enforced by a row lock *and* a PostgreSQL exclusion constraint, and proven
with concurrent tests. See [docs/concurrency.md](docs/concurrency.md).

## Features
- JWT login, Argon2 password hashing, roles (customer / provider / admin), ownership checks on every protected route
- Provider profiles with timezones, weekly working hours, blocked periods
- Slot generation from working hours, blocks and existing bookings
- Book, view, cancel, reschedule, with a full status history
- Double-booking protection: provider row lock + exclusion constraint; 409 on conflict
- Admin: filtered, paginated booking list and statistics (per day, cancellation rate, busiest providers)
- Confirmation emails sent only after the booking commits; email failures never break a booking
- Login lockout after repeated failures, CORS for a separate frontend, startup checks for unsafe production config
- Alembic migrations, Docker Compose, 150+ automated tests on real PostgreSQL

```
slotbook/
├── backend/    FastAPI app, models, migrations, tests, Dockerfile
├── frontend/   Client app (placeholder)
├── docs/       Architecture, database, API, concurrency, deployment
└── docker-compose.yml
```

## Run locally
```bash
cp backend/.env.example backend/.env     # then set SECRET_KEY
docker compose up --build
# Swagger UI: http://localhost:8000/docs
```
Create an admin: `docker compose exec backend python -m app.scripts.create_admin --email you@example.com`

## Run the tests
```bash
docker compose up -d db
cd backend && pip install -r requirements.txt && pytest -v
```

## Demo: a successful booking, then a conflict
With the API running:
```bash
python backend/scripts/demo.py
```
The script registers a provider and two customers, books a slot (201), shows the second customer getting
**409 Conflict** for the same slot, then cancels and lets the second customer book the freed slot.
Record it (asciinema or a screen recorder) and link the recording here.

## Documentation
| | |
| --- | --- |
| [Architecture](docs/architecture.md) | Layers, booking sequence diagram, design decisions |
| [Database](docs/database.md) | ER diagram, constraints |
| [API](docs/api.md) | Endpoint table, status codes, real example payloads |
| [Concurrency](docs/concurrency.md) | The double-booking problem and how it is solved and tested |
| [Deployment](docs/deployment.md) | Environment variables and hosting steps |
| [Development log](docs/development-log.md) | Bugs found and design decisions |

## Live demo
_Not deployed yet. After deploying, add the URL and the Swagger link here (see docs/deployment.md)._
