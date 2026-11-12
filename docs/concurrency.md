# Preventing double booking

Check-then-insert is unsafe: two concurrent requests can both pass the check.
A unique constraint on (provider_id, start_at) does not stop partial overlaps.

## Chosen strategy: provider row lock (implemented)

`appointment_repository.lock_provider()` runs `SELECT ... FOR UPDATE` on the provider row.
Booking and rescheduling take this lock first, then check availability, insert, and commit.
A second request for the same provider waits for the lock, then sees the first appointment
and gets HTTP 409. The lock is released on commit or rollback. Lock order is always
provider row, then appointment row, so booking, cancelling and rescheduling cannot deadlock.

Proof: `tests/test_concurrency.py` fires 8 simultaneous bookings for one slot from separate
database connections; exactly one succeeds and seven get 409. With the lock removed the same
test lets 7 of 8 through.

## Planned defence in depth (Alembic migration)

PostgreSQL exclusion constraint on (provider_id, tstzrange(start_at, end_at)) WHERE status = 'booked'
(needs the btree_gist extension). The service already maps IntegrityError to 409.
