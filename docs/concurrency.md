# Preventing double booking

Check-then-insert is unsafe: two concurrent requests can both pass the check.
A unique constraint on (provider_id, start_at) does not stop partial overlaps
(10:00-10:30 and 10:15-10:45 have different start times but overlap).

## Layer 1: provider row lock (application level)

`appointment_repository.lock_provider()` runs `SELECT ... FOR UPDATE` on the provider row.
Booking and rescheduling take this lock first, then check availability, insert, and commit.
A second request for the same provider waits, then sees the first appointment and gets HTTP 409.
Lock order is always provider row, then appointment row, so booking, cancelling and
rescheduling cannot deadlock. Cancelling re-reads the appointment under a row lock, so two
simultaneous cancels produce one success and one 409 (and one history entry).

## Layer 2: exclusion constraint (database level)

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE appointments ADD CONSTRAINT ex_appointments_no_overlap
  EXCLUDE USING gist (provider_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)
  WHERE (status = 'booked');
```

PostgreSQL itself rejects two overlapping booked rows for one provider, even if the
application lock is bypassed or a bug slips through. Back-to-back appointments are allowed
(half-open ranges) and cancelled rows are ignored. The service maps the resulting
IntegrityError to HTTP 409. The Alembic migration must create the extension and this constraint.

## Transactions

`app/database/transaction.py` provides `transaction(db)`: commit on success, rollback on any
exception, and `SET LOCAL lock_timeout` (default 5 s, `LOCK_TIMEOUT_MS`) so a request never
waits forever for a lock. A lock timeout or deadlock returns HTTP 503 with `Retry-After: 1`.
Booking writes the appointment and its history row in the same transaction: both or neither.

## Evidence (tests)

- `test_concurrency.py`: 8 simultaneous bookings for one slot -> exactly 1 succeeds, 7 get 409.
  With the lock removed, the exclusion constraint alone still gives 1 success; with both removed, 5 of 8 got through.
- Also: unrelated slots all succeed in parallel; concurrent cancels; two reschedules into one slot; booking vs reschedule race.
- `test_db_constraints.py`: duplicate and partial overlaps rejected, back-to-back and cancelled allowed.
- `test_reliability.py`: rollback on mid-booking failure, failed reschedule changes nothing, lock timeout -> 503, history.

## Honest limits

- This guarantees conflicting requests cannot both commit. It does not claim exactly-once delivery of client retries.
- Slots shown by `GET /providers/{id}/slots` are a snapshot; the booking step is what enforces correctness.
