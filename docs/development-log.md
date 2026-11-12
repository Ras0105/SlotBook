# Development log

Short notes on design decisions and bugs solved.

## Review round 1 (blocked slots, availability, migrations, admin)

- **Bug: booking vs blocked-slot race.** `create_blocked_slot()` did check-then-insert without the provider lock, so a
  booking and a block could both pass their checks. Fix: all availability writes run in one `transaction()` that takes
  `lock_provider()` first (same lock order as booking). A test that races the two 6 times fails 5/6 without the lock
  and never with it.
- **Availability overlap races** closed the same way, plus a PostgreSQL exclusion constraint as a second layer.
- **DB constraints** for weekday (0-6) and duration (> 0); all constraints now have explicit names (naming convention).
- **Alembic** added with a hand-reviewed initial migration. Autogenerate got three things wrong: it did not create
  `btree_gist`, it declared the `appointmentstatus` enum twice (second CREATE TYPE would fail), and the downgrade left
  the enum types behind. `tests/test_migrations.py` guards all of this (upgrade, drift check, downgrade, upgrade).
- **Admin API** `GET /admin/appointments` with filters/pagination, and a CLI to bootstrap admins.
- **Production config validation**: weak/default `SECRET_KEY` makes the app refuse to start when `ENVIRONMENT=production`.
- **Docker**: DB healthcheck, `slotbook_test` created automatically, migrations run on container start.

## Review round 2 (frontend readiness and polish)

- **CORS** with an explicit origin list (`CORS_ORIGINS`); `*` is refused in production. Tokens travel in a header, so no cookies/credentials.
- **`GET /auth/me`** so a frontend can learn the user's role after login.
- **Login lockout**: 5 failed attempts per (IP, email) in 5 minutes -> 429 + `Retry-After`; success resets it. In-memory, so
  per process (Redis would be the upgrade); behind a proxy it needs `--proxy-headers`/`FORWARDED_ALLOW_IPS` to see real IPs.
- **Email confirmations** for booked / cancelled / rescheduled, built after commit and sent as a background task.
  Delivery errors are caught and logged, never raised; 409/422/403 responses send nothing. Retry would need an outbox table.
- **`GET /admin/stats`**: per-status counts, cancellation rate, bookings per day, top providers; capped 366-day window.
- **Deployment bugs prevented**: hosts give `postgres://` URLs (SQLAlchemy needs `postgresql+psycopg2://`, now converted)
  and inject `$PORT` (the Dockerfile now honours it).
- Docs: ER diagram, architecture and sequence diagrams (Mermaid), real API examples from `scripts/demo.py`, deployment guide.
