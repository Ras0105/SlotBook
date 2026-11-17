# SlotBook setup guide

This guide follows the order in which you use the app: start it, sign up, log in, then use it as a customer, a provider or an admin.

## 1. Start the app

You need Docker and Node.js.

```bash
# Backend and database (from the repo root)
cp backend/.env.example backend/.env      # then set SECRET_KEY
docker compose up --build
# API docs: http://localhost:8000/docs
```

```bash
# Frontend (in a second terminal)
cd frontend
npm install
npm run dev
# App: http://localhost:5173
```

The backend container runs `alembic upgrade head` on start, so the database tables are created for you.

Tip: for local testing, set `EMAIL_VERIFICATION_ENABLED=false` in `backend/.env`. Otherwise new accounts must click an emailed link before they can book (see step 2).

## 2. Sign up

1. Open the app and click **Sign up** (`/register`).
2. Enter your name, email and password.
3. Every new account is created as a **customer**. You cannot choose a role when you sign up.

If email verification is on, a banner asks you to verify your address. Click the link in the email you receive. Until you do, you can log in and browse, but you cannot book or become a provider.

## 3. Log in

1. Click **Log in** (`/login`) and enter your email and password.
2. After 5 failed attempts in a row, login is blocked for a few minutes.
3. Forgot your password? Use **Forgot password** (`/forgot-password`) to get a reset link by email.

What you see after login depends on your role:

| Role | Header links |
| --- | --- |
| Customer | Providers, My appointments, Become a provider |
| Provider | Providers, My appointments, Dashboard |
| Admin | Providers, Admin |

## 4. As a customer

This is the default role for everyone.

1. Open **Providers** and search or filter by category.
2. Pick a provider, choose a day and a free time slot.
3. Add an optional note and confirm the booking.
4. In **My appointments** you can reschedule, cancel, add the booking to your calendar, and review a visit after it has taken place.
5. Two customers can never hold the same slot. If someone books it first, you will see a conflict message and can pick another time.

Your profile (`/profile`) lets you change your name, phone number (for WhatsApp reminders) and theme.

## 5. As a provider

Any verified customer can become a provider. It is self-service.

1. Log in as a customer and click **Become a provider** (`/become-provider`).
2. Fill in your service name, description, category, timezone and appointment length, then save.
3. Your role changes to **provider** and you are taken to the **Dashboard** (`/dashboard`).
4. In the dashboard:
   - Set your weekly **working hours**.
   - Add **time off** (blocked periods).
   - See your bookings on the **calendar**.
   - Upload a photo or logo.
5. Customers can now find you under **Providers** and book the free slots.

Admin accounts cannot become providers. Use a separate customer account for that.

## 6. As an admin

**Admins cannot be created from the website.** Sign up always creates a customer, and there is no button, link or form that makes someone an admin. This is on purpose, so nobody can give themselves full access.

An admin account is set up by the person who runs the server (see `backend/README.md`). If you have been given admin access:

1. Log in with your account. If you were already logged in, log out and log in again.
2. The **Admin** link appears in the header (`/admin`).
3. Admins can see all bookings (`/admin/appointments`) with filters, and the statistics on the overview page.

Admins cannot book or manage appointments of their own. Use a separate customer account for that.

## Quick reference

| Step | Where | Who |
| --- | --- | --- |
| Sign up | `/register` | Anyone |
| Log in | `/login` | Anyone with an account |
| Book, reschedule, cancel, review | `/providers`, `/appointments` | Customer |
| Become a provider | `/become-provider` | Customer |
| Manage hours, time off, calendar | `/dashboard` | Provider |
| View all bookings and stats | `/admin`, `/admin/appointments` | Admin |
| Get admin access | Set up by the server operator | Server operator only |