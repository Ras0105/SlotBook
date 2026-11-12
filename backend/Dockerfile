FROM python:3.12-slim
WORKDIR /code
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd --create-home appuser && chown -R appuser /code
USER appuser
# Apply database migrations, then start the API. Hosting platforms inject $PORT; locally it defaults to 8000.
# --proxy-headers makes uvicorn trust X-Forwarded-For from the addresses in FORWARDED_ALLOW_IPS (default: localhost only).
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers"]
