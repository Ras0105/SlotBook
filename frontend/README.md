# SlotBook frontend

The customer-facing web app for SlotBook: sign up, find a provider, pick a time, book, and manage your appointments.
Built with **React 18 + Vite**, plain CSS, and React Router. It talks to the FastAPI backend over HTTP.

## Run it (Windows PowerShell)

You need the backend running first (see the root README), and [Node.js](https://nodejs.org) 20 or newer.

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The app expects the API at `http://localhost:8000`. To use another address, copy
`.env.example` to `.env.local` and change `VITE_API_URL`.

> The backend only accepts browser requests from the addresses in its `CORS_ORIGINS` setting. The default includes
> `http://localhost:5173`, which is where `npm run dev` runs.

## What is built

| Screen | Path | Notes |
| --- | --- | --- |
| Sign up / Log in | `/register`, `/login` | Field-level errors, lockout message (429), returns you to the page you were trying to reach |
| Home (landing) | `/` | Hero, how it works, live provider cards, provider call to action |
| Forgot / reset password | `/forgot-password`, `/reset-password?token=` | Emailed one-time link; same answer whether or not the email exists |
| Profile | `/profile` | Edit name/email (email needs current password), change password, choose light / dark / device theme |
| Browse providers | `/providers` | Search (debounced) and paging; both live in the URL |
| Pick a time and book | `/providers/:id` | Day strip + times in the **provider's** timezone; a bar appears once you choose a time |
| My appointments | `/appointments` | Upcoming / Past / Cancelled, cancel with confirmation, status history |
| Reschedule | `/appointments/:id/reschedule` | Same time picker; your current time stays booked until you confirm |

**Provider screens** (a customer can become a provider from the menu):

| Screen | Path | Notes |
| --- | --- | --- |
| Become a provider | `/become-provider` | Service name, appointment length, timezone. The role is refreshed afterwards, so the menu changes at once |
| Provider dashboard | `/dashboard` | Tabs (kept in the URL): **Working hours** (add, edit, remove per weekday), **Time off** (timed or whole-day blocks; a booking clash shows a link to your appointments), **Profile** |

**Admin screens** (administrators only; the menu shows "Admin" instead of "My appointments"):

| Screen | Path | Notes |
| --- | --- | --- |
| Overview | `/admin` | Last 7 / 30 / 90 days or a custom period (up to 92 days): totals, cancellation rate, bar chart of bookings per day (with a text summary and a table), busiest providers |
| All appointments | `/admin/appointments` | Filters (status, provider number, customer number, dates) and paging, all kept in the URL; times shown in each provider's timezone |

The role check on these pages (`RequireRole`) is only a courtesy: the backend refuses the requests with 403 anyway.

## How errors are shown

| Status | What the person sees |
| --- | --- |
| 401 | On the login form: "Wrong email or password." Anywhere else: the session ended, you are sent to log in |
| 403 | The server's message (for example, you can't reschedule someone else's booking) |
| 409 | Slot clash: "Someone just booked that time", the times reload and your choice is cleared |
| 422 | The server's message, shown next to the field when it names one |
| 429 | "Try again in N minutes" (from `Retry-After`) |
| 503 | "The booking system is busy. Try again in N seconds." |
| no response | "Can't reach the server..." with a Try again button |

## Project layout

```
src/
  api/          client.js (fetch wrapper, errors, token) and index.js (one function per endpoint)
  auth/         AuthContext (who is logged in), RequireAuth (logged in) and RequireRole (provider / admin pages)
  components/   Layout, SlotPicker, DateStrip, ConfirmBar, Modal, Alert, ...
  hooks/        useAsync (load data, track loading/error)
  lib/          time.js (all timezone logic), errors.js (status -> sentence), providerCache.js
  pages/        one file per screen, plus their tests
  styles/       app.css (design tokens at the top)
  test/         test setup, helpers, and integration/ (real backend)
```

## Things worth knowing

- **Time.** The API sends UTC. Everything is displayed in the provider's timezone, because that is where the
  appointment happens. If your own clock differs, the confirm bar and your appointments add "3:30 am your time".
  All of this lives in `src/lib/time.js` and is unit tested, including a day boundary (01:30 in Kolkata is still the
  previous day in UTC).
- **The login token** is kept in `localStorage` and sent as `Authorization: Bearer ...`. That is simple and fine for
  this project; the trade-off is that any script running on the page could read it, so never add untrusted scripts.
  (An httpOnly cookie would be the stricter alternative, and would need backend changes.)
- **Paging** uses `limit + 1`: the API returns a plain list with no total, so the app asks for one extra row to learn
  whether a next page exists.
- **My appointments** loads up to 100 appointments and sorts them in the browser.

## Tests

```powershell
npm test                  # 116 fast tests, API mocked
npm run test:integration  # end-to-end tests against a REAL running backend (customer flow, provider flow, optional admin flow)
```

The integration test needs the backend running at `VITE_API_URL` (default `http://localhost:8000`). It creates
its own users and a provider with unique emails, so it can run repeatedly against a development database. It walks
through: sign up, search, book, reschedule, lose a race to another customer (409), cancel, and view history.

Build for production with `npm run build` (output in `dist/`).

### Admin integration test

The admin part of the integration test needs an existing admin account (the API has no way to create one):

```powershell
cd backend
python -m app.scripts.create_admin --email admin@example.com
cd ../frontend
$env:VITE_TEST_ADMIN_EMAIL="admin@example.com"; $env:VITE_TEST_ADMIN_PASSWORD="your-password"; npm run test:integration
```

Without those variables the admin test is skipped.
