# backend/app/core/rate_limit.py
# Purpose: tiny in-memory limiter used to slow down password guessing on /auth/login.
#
# Honest limits (good interview talking points):
#   - State lives in this process only. With several workers/servers each has its own counters;
#     a shared store such as Redis would be the next step.
#   - Behind a reverse proxy request.client.host is the proxy's address unless the proxy's
#     X-Forwarded-For header is trusted (e.g. uvicorn --proxy-headers).

import time
from collections import defaultdict, deque
from threading import Lock


class FailureLimiter:
    """Counts failures per key inside a sliding time window."""

    def __init__(self) -> None:
        self._failures: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def _prune(self, key: str, window: float, now: float) -> deque[float]:
        events = self._failures[key]
        while events and now - events[0] >= window:
            events.popleft()
        if not events:
            self._failures.pop(key, None)
        return events

    def retry_after(self, key: str, max_failures: int, window: float) -> int:
        """0 if the key may try again, otherwise the seconds until it may."""
        now = time.monotonic()
        with self._lock:
            events = self._prune(key, window, now)
            if len(events) < max_failures:
                return 0
            return max(1, int(window - (now - events[0])) + 1)

    def record_failure(self, key: str, window: float) -> None:
        now = time.monotonic()
        with self._lock:
            self._prune(key, window, now)
            self._failures[key].append(now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)

    def reset_all(self) -> None:
        with self._lock:
            self._failures.clear()


login_limiter = FailureLimiter()
password_reset_limiter = FailureLimiter()  # counts every forgot-password request (not just failures)

verification_resend_limiter = FailureLimiter()  # "send me a new verification link" requests, per user
