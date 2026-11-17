# UI improvement ideas (not yet built)

1. **Toasts** for "Booked", "Cancelled", "Profile updated" instead of inline banners that sit in the page flow.
2. **Skeleton loaders** instead of the spinner on lists and the slot picker (less layout jump).
3. **Provider photos / logo + short description** and categories (dentist, tutor...) with filter chips on /providers.
4. **Ratings and reviews** after a completed appointment.
5. **Calendar view** for providers (week grid of bookings) and "Add to calendar" (.ics) for customers.
6. **Booking notes** field ("reason for visit") shown to the provider.
7. **Appointment reminders** (email/WhatsApp 24h before) and a "Next appointment" card on the landing page when logged in.
8. **Email verification** on sign-up, and sign-out of other devices after a password reset (needs a token version on users).
9. **Command palette / keyboard shortcuts** (e.g. `/` focuses search); breadcrumb on provider pages.
10. **Illustrated empty states** and a short onboarding checklist for new providers (add hours -> add time off -> share link).
11. **Shareable provider link / QR code** so providers can promote their booking page.
12. **Admin charts** with tooltips, CSV export, and customer names instead of `#7`.
13. **i18n** (Hindi etc.) and local date formats; **PWA** install for mobile.
14. **Visual regression tests** (Playwright screenshots in light and dark) so theme changes don't break pages silently.
