# Preventing double booking

Check-then-insert is unsafe: two concurrent requests can both pass the check.
A unique constraint on (provider_id, start_at) does not stop partial overlaps.

Options (pick one, then test it):
1. PostgreSQL exclusion constraint on (provider_id, tstzrange(start_at, end_at)) WHERE status = 'booked'
2. Lock the provider row inside the transaction, check overlaps, then insert

Create the appointment and its history row in the same transaction. Return 409 on conflict.

TODO: record the chosen strategy and test results.
