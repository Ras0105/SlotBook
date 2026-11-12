# SlotBook backend

FastAPI, PostgreSQL, SQLAlchemy, Alembic, Pytest.

## Run tests
```bash
cd backend
pip install -r requirements.txt
pytest
```

## Next steps
1. `alembic init migrations`, point it at `app.database.base.Base`, generate the first migration.
2. Finish the TODOs in `app/routes`, `app/services`, `app/repositories`.
3. Pick a double-booking strategy and test it in `tests/test_concurrency.py`.
