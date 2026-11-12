# Architecture

SlotBook is a **modular monolith**: one FastAPI application with clear internal layers, one PostgreSQL database.
No microservices, queues or caches are needed for this scope.

## Layers

```mermaid
flowchart LR
    Client["Client<br/>(browser / Swagger UI)"] -->|HTTP + JWT| Routes
    subgraph API["FastAPI application"]
        direction LR
        Routes["routes/<br/>HTTP, status codes"] --> Deps["dependencies/<br/>current user, role checks"]
        Routes --> Services["services/<br/>business rules, transactions"]
        Services --> Repos["repositories/<br/>SQL queries"]
        Repos --> Models["models/<br/>SQLAlchemy tables"]
        Routes -. "after commit" .-> Email["email_service<br/>(background task)"]
    end
    Models --> DB[("PostgreSQL<br/>row locks + exclusion constraints")]
    Email -. "SMTP" .-> Mail["Mail server"]
```

| Layer | Responsibility |
| --- | --- |
| `routes/` | HTTP endpoints, request parsing, response codes |
| `dependencies/` | Resolve the current user from the JWT, enforce roles |
| `schemas/` | Pydantic request/response models (validation, no password hashes in responses) |
| `services/` | Business rules: slot validation, booking lifecycle, availability, stats, notifications |
| `repositories/` | Database queries only |
| `models/` | SQLAlchemy tables and database constraints |
| `core/` | Settings, password hashing, JWT, login rate limiter |
| `database/` | Session, `transaction()` helper, DB-error to HTTP-error translation |

## Booking a slot

```mermaid
sequenceDiagram
    autonumber
    participant C as Customer
    participant R as Route
    participant S as appointment_service
    participant DB as PostgreSQL
    participant M as Email (background)

    C->>R: POST /appointments (JWT)
    R->>S: create_appointment()
    S->>DB: BEGIN
    S->>DB: SELECT provider FOR UPDATE (lock)
    S->>DB: read hours, blocks, bookings
    alt slot is free
        S->>DB: INSERT appointment + history
        Note over DB: exclusion constraint is the last safety net
        S->>DB: COMMIT (lock released)
        S-->>R: appointment
        R-->>C: 201 Created
        R-)M: send confirmations (after commit)
    else slot taken / overlaps
        S->>DB: ROLLBACK
        R-->>C: 409 Conflict (no email)
    end
```

Two simultaneous requests for the same slot queue on the provider lock; the second one then sees the first
booking and gets 409. See [concurrency.md](concurrency.md).

## Key decisions

- **PostgreSQL**: relational data, foreign keys, transactions, row locks and exclusion constraints.
- **Two layers against double booking**: application lock (clear to explain) + database constraint (cannot be bypassed).
- **Email after commit, never inside the transaction**: a mail failure cannot undo or block a booking; it is logged.
  A future outbox table + worker could retry failed sends.
- **UTC everywhere**: clients send timezone-aware timestamps; each provider has an IANA timezone for working hours.
- **Stateless auth**: short-lived JWT bearer tokens; no server-side sessions.
