# Email, reminders and WhatsApp

## 1. Set up SMTP and check it
```
EMAIL_BACKEND=smtp
EMAIL_FROM=SlotBook <no-reply@yourdomain.com>
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587          # 587 + SMTP_USE_TLS=true (STARTTLS)   or   465 + SMTP_SSL=true
SMTP_USERNAME=...
SMTP_PASSWORD=...      # Gmail: an "app password", not your normal one
```
Then run `python -m app.scripts.send_test_email --to you@example.com`. Unlike the app (which only logs delivery
errors so a bad mail server can never break a booking) it prints exactly what failed: wrong login, untrusted
certificate, wrong port or TLS mode, refused recipient.

Good to know: certificates are always verified; the emails of one action share one connection; line breaks are
stripped from subjects (no header injection); every message has a Date and Message-ID. Use a sender address on a
domain you control and set up SPF/DKIM there, otherwise big mailbox providers may mark the mail as spam.

## 2. Reminders
A reminder goes to the customer and the provider (the provider's one includes the "reason for visit") for every booked
appointment that starts within `REMINDER_HOURS_BEFORE` (24) hours. Details:
- Each appointment is reminded once (it is marked in the database before sending). Rescheduling earns a new reminder.
- Appointments booked less than 24 h ahead get none (they just received the confirmation).
- If every channel fails, the mark is removed and the next run retries.
- Users can switch reminders off, and add a phone number, on their Profile page.

Something has to call the job regularly (the app has no background scheduler of its own, because serverless
hosting does not keep processes alive). Pick one:

**Vercel Cron** (backend project). Set `CRON_SECRET` in the project's environment variables, and add to `vercel.json`:
```json
{ "crons": [ { "path": "/internal/send-reminders", "schedule": "0 * * * *" } ] }
```
Vercel sends `Authorization: Bearer <CRON_SECRET>` itself. The free (Hobby) plan allows only once-a-day schedules; a daily
run still works, it reminds about everything starting in the next 24 h.

**Any pinger** (cron-job.org, GitHub Actions, ...): `GET https://<backend>/internal/send-reminders` with the header
`Authorization: Bearer <CRON_SECRET>`. The answer is `{"due":..,"sent":..,"retry_later":..,"emails":..,"whatsapp":..}`.

**Server / Docker cron:** `python -m app.scripts.send_reminders` (exit code 1 if some reminders must be retried).

## 3. WhatsApp (optional)
Uses Twilio. `WHATSAPP_BACKEND=twilio` plus `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`.
WhatsApp only lets a business start a chat with an approved template: create one in Twilio and set
`TWILIO_CONTENT_SID` (variables {{1}} name, {{2}} service, {{3}} time). Without it, messages are plain text, which works
in the Twilio sandbox and within 24 h of the person writing to you. I could only test this against a mocked Twilio, not a
real account. `WHATSAPP_BACKEND=console` just logs the messages.
