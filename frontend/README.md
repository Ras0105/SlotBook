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

## What is built (customer flow)

| Screen | Path | Notes |
| --- | --- | --- |
| Sign up / Log in | `/register`, `/login` | Field-level errors, lockout message (429), returns you to the page you were trying to reach |
| Browse providers | `/providers` | Search (debounced) and paging; both live in the URL |
| Pick a time and book | `/providers/:id` | Day strip + times in the **provider's** timezone; a bar appears once you choose a time |
| My appointments | `/appointments` | Upcoming / Past / Cancelled, cancel with confirmation, status history |
| Reschedule | `/appointments/:id/reschedule` | Same time picker; your current time stays booked until you confirm |

Not built yet: the provider dashboard (working hours, blocked times) and the admin pages.

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
  auth/         AuthContext (who is logged in) and RequireAuth (protected pages)
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
npm test                  # 59 fast tests, API mocked
npm run test:integration  # 3 end-to-end tests against a REAL running backend
```

The integration test needs the backend running at `VITE_API_URL` (default `http://localhost:8000`). It creates
its own users and a provider with unique emails, so it can run repeatedly against a development database. It walks
through: sign up, search, book, reschedule, lose a race to another customer (409), cancel, and view history.

Build for production with `npm run build` (output in `dist/`).
