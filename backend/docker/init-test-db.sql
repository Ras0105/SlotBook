-- Runs once, the first time the Postgres volume is created (docker-entrypoint-initdb.d).
-- The test suite (tests/conftest.py) uses its own database so it never touches development data.
CREATE DATABASE slotbook_test OWNER slotbook;
