# Booking rules: create / cancel / reschedule inside one transaction,
# with the double-booking protection (exclusion constraint or row lock),
# plus history records. Return 409 on conflict. TODO (Week 2-3)
