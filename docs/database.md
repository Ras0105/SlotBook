# Database design

| Table | Fields |
| --- | --- |
| users | id, name, email (unique), password_hash, role, created_at |
| providers | id, user_id (FK), service_name, appointment_duration_minutes |
| availability | id, provider_id (FK), weekday, start_time, end_time |
| blocked_slots | id, provider_id (FK), start_at, end_at, reason |
| appointments | id, customer_id (FK), provider_id (FK), start_at, end_at, status, created_at |
| appointment_history | id, appointment_id (FK), old_status, new_status, changed_at, changed_by |

Rules: store timestamps in UTC; validate start < end; cancelled appointments do not block slots.

TODO: add an ER diagram.
