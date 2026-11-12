# backend/app/core/config.py
# Purpose: load app settings (database URL, JWT secret, token expiry) from environment variables / .env.
# In production (ENVIRONMENT=production) the app refuses to start with an insecure configuration.

import logging

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

# Values that must never be used to sign tokens outside local development.
INSECURE_SECRET_KEYS = {"change-me", "replace-with-a-long-random-string", "secret", "changeme", ""}
MIN_SECRET_KEY_LENGTH = 32


class Settings(BaseSettings):
    environment: str = "development"  # "development" | "test" | "production"
    database_url: str = "postgresql+psycopg2://slotbook:slotbook@db:5432/slotbook"
    secret_key: str = "change-me"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    lock_timeout_ms: int = 5000  # max time a booking waits for a row lock before returning 503

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"production", "prod"}

    @model_validator(mode="after")
    def validate_for_environment(self):
        """Fail fast at startup instead of silently running with a guessable JWT secret."""
        insecure = self.secret_key.strip().lower() in INSECURE_SECRET_KEYS or len(self.secret_key) < MIN_SECRET_KEY_LENGTH
        if self.is_production:
            problems = []
            if insecure:
                problems.append(
                    f"SECRET_KEY must be a random string of at least {MIN_SECRET_KEY_LENGTH} characters "
                    "(generate one with: python -c \"import secrets; print(secrets.token_urlsafe(48))\")"
                )
            if self.algorithm.lower() == "none":
                problems.append("ALGORITHM must not be 'none'")
            if self.access_token_expire_minutes <= 0:
                problems.append("ACCESS_TOKEN_EXPIRE_MINUTES must be positive")
            if problems:
                raise ValueError("Insecure production configuration: " + "; ".join(problems))
        elif insecure:
            logger.warning("Using a weak/default SECRET_KEY. This is only acceptable for local development.")
        return self


settings = Settings()
