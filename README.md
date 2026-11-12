# SlotBook

Appointment-booking backend: FastAPI, PostgreSQL, SQLAlchemy, Alembic.

## Run locally
```bash
cp .env.example .env
docker compose up --build
# Swagger UI: http://localhost:8000/docs
```

## Next steps
1. `alembic init migrations`, point it at `app.database.base.Base`, generate the first migration.
2. Finish the TODOs in `routes/`, `services/`, `repositories/` (see the 4-week plan).
3. Pick a double-booking strategy (exclusion constraint or row lock) and test it in `tests/test_concurrency.py`.
