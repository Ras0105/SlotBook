# Development log

Short notes on design decisions and bugs solved.

## Review round 1 (blocked slots, availability, migrations, admin)

- **Bug: booking vs blocked-slot race.** `create_blocked_slot()` did check-then-insert without the provider lock, so a
  booking and a block could both pass their checks. Fix: all availability writes run in one `transaction()` that takes
  `lock_provider()` first (same lock order as booking). A test that races the two 6 times fails 5/6 without the lock
  and never with it.
- **Availability overlap races** closed the same way, plus a PostgreSQL exclusion constraint as a second layer.
- **DB constraints** for weekday (0-6) and duration (> 0); all constraints now have explicit names (naming convention).
- **Alembic** added with a hand-reviewed initial migration. Autogenerate got three things wrong: it did not create
  `btree_gist`, it declared the `appointmentstatus` enum twice (second CREATE TYPE would fail), and the downgrade left
  the enum types behind. `tests/test_migrations.py` guards all of this (upgrade, drift check, downgrade, upgrade).
- **Admin API** `GET /admin/appointments` with filters/pagination, and a CLI to bootstrap admins.
- **Production config validation**: weak/default `SECRET_KEY` makes the app refuse to start when `ENVIRONMENT=production`.
- **Docker**: DB healthcheck, `slotbook_test` created automatically, migrations run on container start.

## Review round 2 (frontend readiness and polish)

- **CORS** with an explicit origin list (`CORS_ORIGINS`); `*` is refused in production. Tokens travel in a header, so no cookies/credentials.
- **`GET /auth/me`** so a frontend can learn the user's role after login.
- **Login lockout**: 5 failed attempts per (IP, email) in 5 minutes -> 429 + `Retry-After`; success resets it. In-memory, so
  per process (Redis would be the upgrade); behind a proxy it needs `--proxy-headers`/`FORWARDED_ALLOW_IPS` to see real IPs.
- **Email confirmations** for booked / cancelled / rescheduled, built after commit and sent as a background task.
  Delivery errors are caught and logged, never raised; 409/422/403 responses send nothing. Retry would need an outbox table.
- **`GET /admin/stats`**: per-status counts, cancellation rate, bookings per day, top providers; capped 366-day window.
- **Deployment bugs prevented**: hosts give `postgres://` URLs (SQLAlchemy needs `postgresql+psycopg2://`, now converted)
  and inject `$PORT` (the Dockerfile now honours it).
- Docs: ER diagram, architecture and sequence diagrams (Mermaid), real API examples from `scripts/demo.py`, deployment guide.

## Frontend: customer flow (React + Vite)

- **Found before starting:** the merge commit `4ab82e6` had been committed with unresolved conflict markers
  (`<<<<<<< HEAD`) in 9 files, including `config.py` and `admin.py`, so the backend could not even start. Resolved by
  keeping the HEAD side, which was byte-identical to the clean parent `b74d073` in all 9 files (the discarded side was an
  older copy of the same work). Verified: 169 backend tests pass on PostgreSQL 16. Lesson: run the tests before
  committing a merge, and `git grep -n "<<<<<<<"` to find leftover markers.
- **Screens:** register/login, provider list (search, paging), provider page with day strip and time slots, booking with
  a confirm bar, My appointments (upcoming/past/cancelled, cancel, history), reschedule.
- **Timezones:** times are shown in the provider's timezone, with an "your time" note when the visitor's clock differs.
  Calendar days are handled as plain `YYYY-MM-DD` strings so daylight-saving and midnight never shift a date.
- **Booking race (409):** when someone else takes the slot first, the UI says so, clears the selection and reloads the
  day's times. Covered by a mocked test and by a real two-user race in the integration test.
- **Found by running against the real API:** reschedule history notes contain raw UTC timestamps
  (`Rescheduled from 2026-11-14T03:30:00+00:00 ...`); the UI now rewrites them in the provider's local time.
- **Accessibility check:** every text/background pair meets WCAG AA contrast; form-field and time-slot borders were
  only 1.9:1 and were darkened to 3.7:1. Keyboard focus is visible, the cancel dialog traps focus and starts on the safe
  choice, and animation respects `prefers-reduced-motion`.
- **Not verified:** the layout has not been looked at in a real browser by the assistant (no browser was available),
  only through component tests and the integration test. Check the screens on a phone-width window.
- **Bug found by the first real browser run (blank page):** `useEffect(() => window.scrollTo(0, 0), ...)` returned the
  value of `scrollTo()`. Modern Chrome returns a *Promise* from it, React treated that as a cleanup function and crashed
  the whole app (`destroy is not a function`). jsdom's fake `scrollTo` returns nothing, so every test passed. Fix: effects
  that do work use braces and return nothing. The test setup now makes `scrollTo` return a Promise like Chrome, and
  reverting the fix makes the suite fail. Also added a root `ErrorBoundary` so a crash shows a message instead of a blank page.
- **Browser check:** the flow (sign up, search, slots, book, cancel) was then run in real headless Chromium with no console
  errors; a mobile header layout problem was found from a screenshot and fixed.

## Frontend: provider dashboard and admin pages

- **Backend gaps found first:** the dashboard needs to *read* things the API could only write. Added
  `GET /providers/me`, `GET /availability/blocked-slots` (own periods, soonest first, past ones hidden unless
  `include_past=true`) and `DELETE /availability/blocked-slots/{id}` (takes the same provider row lock as every other
  availability change; 404 for a missing id, 403 for someone else's). `GET /providers/me` is declared before
  `/providers/{provider_id}`, otherwise `me` would be parsed as an id and answered with 422. Covered by
  `tests/test_provider_dashboard_api.py`.
- **Wall clock to UTC:** a provider types "9:00 on 16 Nov" meaning *their* clock, but the API wants a UTC instant.
  `zonedTimeToUtc` looks up the timezone's offset at a first guess and re-checks it at the corrected time, so it is right
  on daylight-saving change days. Unit tests cover Kolkata (the 01:30 previous-UTC-day case), New York either side of
  the change, and Sydney. Flipping one sign in it makes 5 tests fail.
- **Whole-day time off** runs from the start of the first day to the start of the day *after* the last, so "8 to 9
  January" blocks both days completely.
- **Timezone names:** browsers still list `Asia/Calcutta`. The pickers show and save the current name (`Asia/Kolkata`);
  the backend accepts both.
- **Bug found by a test:** after creating a provider profile the app refreshes the user. The role change made the page
  redirect to the dashboard on its own, before the code that attached the "profile is ready" message ran, so the message
  was lost. The redirect now carries the message.
- **Admin stats:** the API lists only days that have bookings; the chart fills in the zero days. Days are UTC days (the
  API's choice), and the chart says so. A custom period is limited to 92 days so the bars stay readable, and a backwards
  or too-long period is explained on screen instead of being sent.
- **Admin booking list:** filters, page number and the extra-row paging trick all live in the URL. Junk in the URL
  (`?status=pizza`) is ignored rather than sent. The API returns customer ids only, so customers are shown as `#7`.
- **Not verified in this environment:** no PostgreSQL and no network were available, so the new backend tests and the
  live-backend integration test (`provider-admin-flow.test.jsx`) were **written but not run**; run
  `python -m pytest` and `npm run test:integration` on your machine. The frontend unit/component tests (116) were run
  and pass, and the whole app compiles and bundles; `npm run build` itself was not run.

