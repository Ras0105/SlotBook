# SlotBook

Appointment-booking platform: FastAPI + PostgreSQL backend, optional frontend, and project docs.

```
slotbook/
├── backend/    FastAPI app, models, migrations, tests, Dockerfile
├── frontend/   Client app (placeholder, add after the API is stable)
├── docs/       Blueprint, architecture, database, API, concurrency notes
└── docker-compose.yml
```

## Run locally
```bash
cp backend/.env.example backend/.env
docker compose up --build
# Swagger UI: http://localhost:8000/docs
```

See `backend/README.md` for backend details and `docs/` for design notes.
