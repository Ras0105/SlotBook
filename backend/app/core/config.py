# backend/app/core/config.py
# Purpose: load app settings (database URL, JWT secret, token expiry) from environment variables / .env.

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg2://slotbook:slotbook@db:5432/slotbook"
    secret_key: str = "change-me"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    lock_timeout_ms: int = 5000  # max time a booking waits for a row lock before returning 503

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
