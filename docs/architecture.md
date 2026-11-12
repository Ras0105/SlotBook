# Architecture

Modular monolith: one FastAPI app with clear internal layers.

- **routes/**: HTTP endpoints, request parsing, status codes
- **dependencies/**: current user, role checks
- **services/**: business rules (booking, slots, auth)
- **repositories/**: database queries
- **models/**: SQLAlchemy tables
- **schemas/**: Pydantic request/response models

Flow: client -> route -> dependency (auth) -> service -> repository -> PostgreSQL.
Send email only after the booking transaction commits.

TODO: add an architecture diagram.
