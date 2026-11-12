# backend/tests/test_config.py
# Purpose: the app must refuse to start in production with a default / weak JWT secret.

import pytest
from pydantic import ValidationError

from app.core.config import Settings

STRONG = "k3Jx9-very-long-random-secret-value-1234567890abcdef"


def make(**kw):
    return Settings(_env_file=None, **kw)


@pytest.mark.parametrize("secret", ["change-me", "replace-with-a-long-random-string", "", "short", "Change-Me"])
def test_production_rejects_weak_or_default_secret(secret):
    with pytest.raises(ValidationError, match="SECRET_KEY"):
        make(environment="production", secret_key=secret)


def test_production_accepts_strong_secret():
    assert make(environment="production", secret_key=STRONG).is_production


def test_prod_alias_is_also_checked():
    with pytest.raises(ValidationError):
        make(environment="PROD", secret_key="change-me")


def test_production_rejects_alg_none_and_bad_expiry():
    with pytest.raises(ValidationError, match="ALGORITHM"):
        make(environment="production", secret_key=STRONG, algorithm="none")
    with pytest.raises(ValidationError, match="ACCESS_TOKEN_EXPIRE_MINUTES"):
        make(environment="production", secret_key=STRONG, access_token_expire_minutes=0)


def test_development_allows_default_secret_but_warns(caplog):
    with caplog.at_level("WARNING"):
        s = make(environment="development")
    assert not s.is_production and "SECRET_KEY" in caplog.text


def test_default_environment_is_development():
    assert make().environment == "development"


def test_environment_is_read_from_env_vars(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("SECRET_KEY", "change-me")
    with pytest.raises(ValidationError):
        Settings(_env_file=None)
