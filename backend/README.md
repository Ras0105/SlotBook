# SlotBook backend

FastAPI, PostgreSQL, SQLAlchemy, Alembic, Pytest.

## Run tests
Integration tests need a PostgreSQL database (they are skipped if it is unreachable):
```bash
createdb slotbook_test          # or point TEST_DATABASE_URL at any empty database
cd backend
pip install -r requirements.txt
pytest
```
Default URL: `postgresql+psycopg2://slotbook:slotbook@localhost:5432/slotbook_test`

## Next steps
1. `alembic init migrations`, point it at `app.database.base.Base`, generate the first migration.
2. Finish the TODOs in `app/routes`, `app/services`, `app/repositories`.
3. Pick a double-booking strategy and test it in `tests/test_concurrency.py`.
