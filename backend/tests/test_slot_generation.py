# backend/tests/test_slot_generation.py
# Purpose: unit tests for the slot algorithm (no database needed).

from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

from app.models import Appointment, Availability, BlockedSlot
from app.services.slot_service import compute_slots

UTC = timezone.utc
DAY = date(2026, 11, 14)  # a Saturday, weekday() == 5
LONG_AGO = datetime(2020, 1, 1, tzinfo=UTC)


def rule(start, end):
    return Availability(weekday=DAY.weekday(), start_time=start, end_time=end)


def dt(h, m=0):
    return datetime(2026, 11, 14, h, m, tzinfo=UTC)


def run(rules, blocked=(), appts=(), tz="UTC", duration=30, now=LONG_AGO):
    return compute_slots(DAY, ZoneInfo(tz), duration, rules, list(blocked), list(appts), now)


def test_generates_back_to_back_slots():
    slots = run([rule(time(9), time(11))])
    assert [s for s, _ in slots] == [dt(9), dt(9, 30), dt(10), dt(10, 30)]
    assert slots[-1][1] == dt(11)


def test_no_rules_means_no_slots():
    assert run([]) == []


def test_duration_longer_than_window_gives_nothing():
    assert run([rule(time(9), time(9, 45))], duration=60) == []


def test_partial_slot_at_end_is_dropped():
    assert len(run([rule(time(9), time(10, 45))])) == 3  # 9:00, 9:30, 10:00


def test_uses_provider_timezone():
    slots = run([rule(time(9), time(10))], tz="Asia/Kolkata")
    assert slots[0][0] == dt(3, 30)  # 09:00 IST = 03:30 UTC


def test_blocked_period_removes_overlapping_slots():
    blocked = [BlockedSlot(start_at=dt(9, 15), end_at=dt(9, 45))]
    starts = [s for s, _ in run([rule(time(9), time(11))], blocked=blocked)]
    assert starts == [dt(10), dt(10, 30)]  # 9:00 and 9:30 both touch the block


def test_active_appointment_removes_its_slot_only():
    appts = [Appointment(start_at=dt(9, 30), end_at=dt(10))]
    starts = [s for s, _ in run([rule(time(9), time(11))], appts=appts)]
    assert starts == [dt(9), dt(10), dt(10, 30)]


def test_busy_period_that_only_touches_a_slot_does_not_remove_it():
    blocked = [BlockedSlot(start_at=dt(9), end_at=dt(9, 30))]
    starts = [s for s, _ in run([rule(time(9), time(10))], blocked=blocked)]
    assert starts == [dt(9, 30)]


def test_slots_that_already_started_are_removed():
    starts = [s for s, _ in run([rule(time(9), time(11))], now=dt(9, 45))]
    assert starts == [dt(10), dt(10, 30)]


def test_multiple_rules_in_a_day():
    slots = run([rule(time(14), time(15)), rule(time(9), time(10))])
    assert [s for s, _ in slots] == [dt(9), dt(9, 30), dt(14), dt(14, 30)]
