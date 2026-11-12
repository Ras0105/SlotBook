# Deployment guide

The backend ships as a Docker image. On start it runs `alembic upgrade head` and then the API on `$PORT`
(default 8000). You need: a PostgreSQL database, and somewhere to run the container.

> This guide describes the steps, but I could not test it against a live hosting account. Treat the provider-specific
> names as a starting point and check your host's current documentation.

## 1. Environment variables

| Variable | Value |
| --- | --- |
| `ENVIRONMENT` | `production` (turns on the startup safety checks) |
| `DATABASE_URL` | The database URL from your host. `postgres://...` is converted automatically |
| `SECRET_KEY` | `python -c "import secrets; print(secrets.token_urlsafe(48))"` (>= 32 chars, or the app refuses to start) |
| `CORS_ORIGINS` | Your frontend's exact URL, e.g. `https://slotbook.example.com` (not `*`) |
| `EMAIL_BACKEND` | `smtp` with `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `EMAIL_FROM`; or leave `console` / `disabled` |
| `FORWARDED_ALLOW_IPS` | Your platform's proxy address(es), so the login limiter sees real client IPs (optional) |

## 2. Example: Render (Docker web service + managed PostgreSQL)

1. Push the repository to GitHub.
2. In Render: **New > PostgreSQL**. Copy its *Internal Database URL*.
3. **New > Web Service**, connect the repo, set **Root Directory** to `backend`, runtime **Docker**.
4. Add the environment variables from the table above.
5. Deploy. Check `https://<your-service>/health` returns `{"status":"ok"}`, then open `/docs`.
6. Create the first admin from the service's shell:
   `python -m app.scripts.create_admin --email you@example.com --name "Admin"`

Other hosts (Fly.io, Railway, a VPS with Docker Compose) work the same way: a Postgres database plus the same image and variables.

## 3. PostgreSQL requirements

The first migration runs `CREATE EXTENSION IF NOT EXISTS btree_gist` (needed by the double-booking constraints).
Most managed Postgres services allow it. If the migration fails with a permission error, run
`CREATE EXTENSION btree_gist;` once as the database admin, then redeploy.

## 4. After deploying

- Put the live URL and the Swagger link at the top of the README.
- Run the demo against it: `python backend/scripts/demo.py https://<your-service>`.
- Use HTTPS only (hosting platforms provide it) and keep `CORS_ORIGINS` narrow.
- Free tiers may sleep when idle, so the first request can be slow.

## 5. Known limits

- The login rate limiter is in memory per process; several workers or servers would each count separately (Redis would fix that).
- Emails are sent in a background task with no retry; a failed send is logged. An outbox table + worker is the upgrade path.
