# SlotBook backend

FastAPI, PostgreSQL, SQLAlchemy, Alembic, Pytest.

## Run with Docker (recommended)
```bash
cp .env.example .env            # then set SECRET_KEY
cd .. && docker compose up --build
# Swagger UI: http://localhost:8000/docs
```
The backend container runs `alembic upgrade head` before starting the API.

## Run locally (without Docker for the API)
```bash
docker compose up -d db         # from the repo root: starts PostgreSQL (and creates slotbook_test)
cd backend
pip install -r requirements.txt
export DATABASE_URL=postgresql+psycopg2://slotbook:slotbook@localhost:5432/slotbook
alembic upgrade head
uvicorn app.main:app --reload
```

## Migrations (Alembic)
```bash
alembic upgrade head                              # apply all migrations
alembic revision --autogenerate -m "describe it"  # after changing a model; ALWAYS review the generated file
alembic downgrade -1                              # undo the last one
alembic check                                     # fails if models and migrations have drifted apart
```
The first migration creates the `btree_gist` extension, which the PostgreSQL exclusion constraints need
(the database role must be allowed to create extensions; the default Docker `postgres` image user is).
`tests/test_migrations.py` verifies that migrations match the models and can run up and down.

## Create an admin user
Registration always creates customers, so admins are bootstrapped from the command line:
```bash
python -m app.scripts.create_admin --email admin@example.com --name "Admin"   # prompts for the password
# in Docker: docker compose exec backend python -m app.scripts.create_admin --email admin@example.com
```
Then log in via `POST /auth/login` and use `GET /admin/appointments`.

## Run tests
Integration tests need PostgreSQL and a `slotbook_test` database (they are skipped if it is unreachable).
The Docker Compose database creates it automatically on first start; on an older volume run
`docker compose exec db createdb -U slotbook slotbook_test`.
```bash
cd backend
pip install -r requirements.txt
pytest -v
```
Default URL: `postgresql+psycopg2://slotbook:slotbook@localhost:5432/slotbook_test` (override with `TEST_DATABASE_URL`).
The migration test also needs permission to create/drop a scratch database (`slotbook_migration_test`).

## Demo script
`python scripts/demo.py [base_url]` runs a full booking story against a running API (successful booking, 409 conflict, cancel, rebook).

## Email
`EMAIL_BACKEND=console` (default) just logs the email text, so you can see confirmations without a mail server.
Set `EMAIL_BACKEND=smtp` plus the `SMTP_*` variables to really send. Emails go out after the booking commits;
if sending fails it is logged and the booking is unaffected.

## Production configuration
Set `ENVIRONMENT=production` and a random `SECRET_KEY` of at least 32 characters. The application
raises an error at startup if the secret is a default/placeholder value, shorter than 32 characters,
the JWT algorithm is `none`, `CORS_ORIGINS` contains `*`, or SMTP is selected without `SMTP_HOST`.
See `../docs/deployment.md`.
