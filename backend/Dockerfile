FROM python:3.12-slim
WORKDIR /code
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd --create-home appuser && chown -R appuser /code
USER appuser
<<<<<<< HEAD
# Apply database migrations, then start the API. Hosting platforms inject $PORT; locally it defaults to 8000.
# --proxy-headers makes uvicorn trust X-Forwarded-For from the addresses in FORWARDED_ALLOW_IPS (default: localhost only).
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers"]
=======
# Apply database migrations, then start the API. (Migrations are idempotent: nothing to do if up to date.)
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
>>>>>>> 1b166ad1a412ecd604ed83ea617b5aa4eb056234
