import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { ApiError } from '../api/client';
import { blockPlacement } from '../components/CalendarPanel';
import * as ics from '../lib/ics';
import { normalizePhone } from '../lib/phone';
import { addDays, mondayOf, timeUntil, todayIn, zonedTimeToUtc } from '../lib/time';
import { CUSTOMER, PROVIDER, PROVIDER_USER, renderApp, slot, slotsResponse } from '../test/utils';

vi.mock('../lib/ics', async (importOriginal) => ({ ...(await importOriginal()), downloadIcs: vi.fn() }));

const change = (el, value) => fireEvent.change(el, { target: { value } });

function at(days, hour = 4) {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
function appt(id, { days, status = 'booked', notes = null, review = null }) {
  const start = at(days);
  return {
    id, customer_id: CUSTOMER.id, provider_id: 1, start_at: start, status, notes, review,
    end_at: new Date(new Date(start).getTime() + 30 * 60_000).toISOString(), created_at: '2030-01-01T00:00:00Z',
  };
}
const REVIEW = { id: 5, appointment_id: 2, provider_id: 1, rating: 4, comment: 'Lovely', reviewer_name: 'Asha R.', created_at: '2030-01-02T00:00:00Z', updated_at: null };

// ---------------------------------------------------------------- reason for visit
describe('reason for visit', () => {
  function bookingPage() {
    api.getProvider.mockResolvedValue(PROVIDER);
    api.getSlots.mockResolvedValue(slotsResponse([slot(0)]));
    api.listMyAppointments.mockResolvedValue([]);
    return renderApp('/providers/1', { user: CUSTOMER });
  }

  it('is asked for only once a time is chosen, and is optional', async () => {
    bookingPage();
    await screen.findByRole('button', { name: '9:00 am' });
    expect(screen.queryByLabelText('Reason for visit')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '9:00 am' }));
    expect(screen.getByLabelText('Reason for visit')).toHaveValue('');
    expect(screen.getByText(/0 of 500 characters/)).toBeInTheDocument();
  });

  it('is sent with the booking, trimmed', async () => {
    bookingPage();
    api.bookAppointment.mockResolvedValue({ ...appt(5, { days: 3 }), notes: 'Toothache' });
    await userEvent.click(await screen.findByRole('button', { name: '9:00 am' }));
    await userEvent.type(screen.getByLabelText('Reason for visit'), '  Toothache ');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
    expect(api.bookAppointment).toHaveBeenCalledWith({ providerId: 1, startAt: slot(0).start_at, notes: 'Toothache' });
  });

  it('is left out of the request when empty', async () => {
    bookingPage();
    api.bookAppointment.mockResolvedValue(appt(5, { days: 3 }));
    await userEvent.click(await screen.findByRole('button', { name: '9:00 am' }));
    await userEvent.type(screen.getByLabelText('Reason for visit'), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
    expect(api.bookAppointment).toHaveBeenCalledWith({ providerId: 1, startAt: slot(0).start_at });
  });

  it('shows up on the appointment', async () => {
    api.getProvider.mockResolvedValue(PROVIDER);
    api.listMyAppointments.mockResolvedValue([appt(1, { days: 3, notes: 'Bring X-rays' })]);
    renderApp('/appointments', { user: CUSTOMER });
    expect(await screen.findByText('Bring X-rays')).toBeInTheDocument();
    expect(screen.getByText('Reason for visit:')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- edit / delete a review
describe('editing and deleting a review', () => {
  const openPast = async () => userEvent.click(await screen.findByRole('tab', { name: /Past/ }));
  function setup(review = REVIEW) {
    api.getProvider.mockResolvedValue(PROVIDER);
    api.listMyAppointments.mockResolvedValue([appt(2, { days: -3, status: 'completed', review })]);
    return renderApp('/appointments', { user: CUSTOMER });
  }

  it('edits: the dialog starts with the current rating and comment, then saves the changes', async () => {
    setup();
    await openPast();
    await userEvent.click(screen.getByRole('button', { name: 'Edit review' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit your review' });
    expect(within(dialog).getByRole('radio', { name: '4 stars, Very good' })).toBeChecked();
    expect(within(dialog).getByLabelText('Comment (optional)')).toHaveValue('Lovely');

    api.updateReview.mockResolvedValue({ ...REVIEW, rating: 2, comment: 'Slow', updated_at: '2030-01-03T00:00:00Z' });
    await userEvent.click(within(dialog).getByRole('radio', { name: '2 stars, Fair' }));
    change(within(dialog).getByLabelText('Comment (optional)'), 'Slow');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect(api.updateReview).toHaveBeenCalledWith(5, { rating: 2, comment: 'Slow' });
    expect(api.createReview).not.toHaveBeenCalled();
    expect(await screen.findByText('Your review was updated.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '2 out of 5' })).toBeInTheDocument();
    expect(screen.getByText('Slow')).toBeInTheDocument();
    expect(screen.getByText('(edited)')).toBeInTheDocument();
  });

  it('asks before deleting, then offers to review again', async () => {
    setup();
    await openPast();
    await userEvent.click(screen.getByRole('button', { name: 'Delete review' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete your review?' });
    expect(within(dialog).getByRole('button', { name: 'Keep review' })).toHaveFocus(); // the safe choice
    expect(api.deleteReview).not.toHaveBeenCalled();

    api.deleteReview.mockResolvedValue(null);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete review' }));
    expect(api.deleteReview).toHaveBeenCalledWith(5);
    expect(await screen.findByText('Your review was deleted.')).toBeInTheDocument();
    expect(screen.queryByText('Lovely')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rate this visit' })).toBeInTheDocument();
  });

  it('keeps the review when deleting fails', async () => {
    setup();
    await openPast();
    await userEvent.click(screen.getByRole('button', { name: 'Delete review' }));
    api.deleteReview.mockRejectedValue(new ApiError(0, "Can't reach the server."));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete review' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server");
    expect(screen.getByText('Lovely')).toBeInTheDocument();
  });

  it('closes the delete dialog on "Keep review" without calling the server', async () => {
    setup();
    await openPast();
    await userEvent.click(screen.getByRole('button', { name: 'Delete review' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep review' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.deleteReview).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- next appointment on the landing page
describe('next appointment card', () => {
  it('shows the soonest booking to a logged-in customer, with actions', async () => {
    const next = appt(9, { days: 2, notes: 'Cleaning' });
    api.listProviders.mockResolvedValue([]);
    api.getNextAppointment.mockResolvedValue(next);
    api.getProvider.mockResolvedValue(PROVIDER);
    renderApp('/', { user: CUSTOMER });

    const card = await screen.findByRole('region', { name: 'Your next appointment' });
    expect(within(card).getByRole('link', { name: 'General Checkup' })).toHaveAttribute('href', '/providers/1');
    expect(within(card).getByText(/in 2 days|tomorrow|in \d+ hours/)).toBeInTheDocument();
    expect(within(card).getByText('Cleaning')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Reschedule' })).toHaveAttribute('href', '/appointments/9/reschedule');
    expect(within(card).getByRole('link', { name: 'All appointments' })).toHaveAttribute('href', '/appointments');

    await userEvent.click(within(card).getByRole('button', { name: 'Add to calendar' }));
    expect(ics.downloadIcs).toHaveBeenCalledWith('slotbook-appointment-9.ics', expect.stringContaining('UID:appointment-9@slotbook'));
  });

  it('is not there when nothing is booked', async () => {
    api.listProviders.mockResolvedValue([]);
    api.getNextAppointment.mockResolvedValue(null);
    renderApp('/', { user: CUSTOMER });
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(api.getNextAppointment).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'Your next appointment' })).not.toBeInTheDocument();
  });

  it('is not asked for at all when logged out', async () => {
    api.listProviders.mockResolvedValue([]);
    renderApp('/');
    await screen.findByRole('heading', { level: 1 });
    expect(api.getNextAppointment).not.toHaveBeenCalled();
  });

  it('quietly stays away when the server cannot be reached, and still shows the page', async () => {
    api.listProviders.mockResolvedValue([]);
    api.getNextAppointment.mockRejectedValue(new ApiError(0, "Can't reach the server."));
    renderApp('/', { user: CUSTOMER });
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Your next appointment' })).not.toBeInTheDocument();
  });

  it('still shows the time when the provider cannot be loaded', async () => {
    api.listProviders.mockResolvedValue([]);
    api.getNextAppointment.mockResolvedValue(appt(9, { days: 2 }));
    api.getProvider.mockRejectedValue(new ApiError(500, 'boom'));
    renderApp('/', { user: CUSTOMER });
    const card = await screen.findByRole('region', { name: 'Your next appointment' });
    expect(within(card).getByRole('heading', { name: 'Your appointment' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- reminder settings
describe('reminder settings on the profile', () => {
  const USER = { ...CUSTOMER, created_at: '2030-01-01T00:00:00Z', phone: null, reminders_enabled: true };

  it('saves a cleaned phone number', async () => {
    renderApp('/profile', { user: USER });
    const box = await screen.findByLabelText('Mobile number for WhatsApp (optional)');
    api.updateProfile.mockResolvedValue({ ...USER, phone: '+919876543210' });
    await userEvent.type(box, '+91 98765-43210');
    await userEvent.click(screen.getByRole('button', { name: 'Save reminders' }));
    expect(api.updateProfile).toHaveBeenCalledWith({ phone: '+919876543210' });
    expect(await screen.findByText('Reminder settings saved.')).toBeInTheDocument();
    expect(box).toHaveValue('+919876543210');
  });

  it('rejects a number without a country code before asking the server', async () => {
    renderApp('/profile', { user: USER });
    await userEvent.type(await screen.findByLabelText('Mobile number for WhatsApp (optional)'), '9876543210');
    await userEvent.click(screen.getByRole('button', { name: 'Save reminders' }));
    expect(await screen.findByText(/with its country code/)).toBeInTheDocument();
    expect(api.updateProfile).not.toHaveBeenCalled();
  });

  it('turns reminders off, and removes a number by clearing it', async () => {
    const withPhone = { ...USER, phone: '+919876543210' };
    renderApp('/profile', { user: withPhone });
    const box = await screen.findByLabelText('Mobile number for WhatsApp (optional)');
    expect(box).toHaveValue('+919876543210');
    expect(screen.getByRole('button', { name: 'Save reminders' })).toBeDisabled(); // nothing changed yet

    api.updateProfile.mockResolvedValue({ ...USER, reminders_enabled: false });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Send me appointment reminders' }));
    await userEvent.clear(box);
    await userEvent.click(screen.getByRole('button', { name: 'Save reminders' }));
    expect(api.updateProfile).toHaveBeenCalledWith({ phone: '', remindersEnabled: false });
  });

  it('shows the server’s message for a number it refuses', async () => {
    renderApp('/profile', { user: USER });
    api.updateProfile.mockRejectedValue(new ApiError(422, 'phone: nope', { fields: { phone: 'Enter the number with its country code' } }));
    await userEvent.type(await screen.findByLabelText('Mobile number for WhatsApp (optional)'), '+919876543210');
    await userEvent.click(screen.getByRole('button', { name: 'Save reminders' }));
    expect(await screen.findByText('Enter the number with its country code')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------- time off in the calendar
describe('time off in the provider calendar', () => {
  const TZ = PROVIDER.timezone;
  const MONDAY = mondayOf(todayIn(TZ));

  function open({ blocks = [], entries = [] } = {}) {
    api.getMyProvider.mockResolvedValue(PROVIDER);
    api.listAvailability.mockResolvedValue([]);
    api.getMyCalendar.mockResolvedValue(entries);
    api.listBlockedSlots.mockResolvedValue(blocks);
    return renderApp('/dashboard?tab=calendar', { user: PROVIDER_USER });
  }
  const block = (id, day, from, to, reason = null) => ({
    id, provider_id: 1, reason, start_at: zonedTimeToUtc(day, from, TZ), end_at: zonedTimeToUtc(day, to, TZ),
  });

  it('asks for time off in the same week as the bookings', async () => {
    open();
    await screen.findByText(/No appointments this week/);
    const [range] = api.getMyCalendar.mock.calls[0];
    expect(api.listBlockedSlots).toHaveBeenCalledWith(range, expect.anything());
  });

  it('draws a time-off block in its day, with the reason', async () => {
    const wed = addDays(MONDAY, 2);
    open({ blocks: [block(1, wed, '12:00', '14:00', 'Lunch and errands')] });
    await screen.findByText('Time off', { selector: 'strong' });
    const day = screen.getByRole('region', { name: /^Wednesday/ });
    const item = within(day).getByText('Time off', { selector: 'strong' }).closest('li');
    expect(item).toHaveTextContent('Lunch and errands');
    expect(item.style.getPropertyValue('--top')).toBe('240'); // 12:00 is 4 hours below the 8 am top
    expect(item.style.getPropertyValue('--height')).toBe('120');
    expect(screen.getByText(/Hatched areas are time off/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: /^Thursday/ })).queryByText('Time off', { selector: 'strong' })).not.toBeInTheDocument();
  });

  it('spreads a multi-day period over every day it covers', async () => {
    const mon = MONDAY;
    open({ blocks: [{ id: 2, provider_id: 1, reason: 'Holiday', start_at: zonedTimeToUtc(mon, '00:00', TZ), end_at: zonedTimeToUtc(addDays(mon, 3), '00:00', TZ) }] });
    await screen.findAllByText('Time off', { selector: 'strong' });
    expect(screen.getAllByText('Time off', { selector: 'strong' })).toHaveLength(3); // Mon, Tue, Wed
  });

  it('shows no hatching and no note when there is no time off', async () => {
    open();
    await screen.findByText(/No appointments this week/);
    expect(screen.queryByText('Time off', { selector: 'strong' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Hatched areas/)).not.toBeInTheDocument();
  });

  it('shows the reason for visit on a booking', async () => {
    open({ entries: [{ id: 1, customer_id: 7, customer_name: 'Casey', status: 'booked', notes: 'Knee pain', start_at: zonedTimeToUtc(MONDAY, '10:00', TZ), end_at: zonedTimeToUtc(MONDAY, '10:30', TZ) }] });
    const event = (await screen.findByText('Casey')).closest('li');
    expect(event).toHaveTextContent('Knee pain');
  });

  it('places blocks with clipping to the day and to the visible hours', () => {
    const d = MONDAY;
    expect(blockPlacement(block(1, d, '09:00', '10:00'), d, TZ, 8, 18)).toEqual({ top: 60, height: 60 });
    expect(blockPlacement(block(1, d, '06:00', '09:00'), d, TZ, 8, 18)).toEqual({ top: 0, height: 60 }); // clipped at the top
    expect(blockPlacement(block(1, d, '17:00', '21:00'), d, TZ, 8, 18)).toEqual({ top: 540, height: 60 }); // clipped at the bottom
    expect(blockPlacement(block(1, d, '19:00', '21:00'), d, TZ, 8, 18)).toBeNull(); // outside visible hours
    expect(blockPlacement(block(1, d, '09:00', '10:00'), addDays(d, 1), TZ, 8, 18)).toBeNull(); // another day
    const overnight = { id: 3, start_at: zonedTimeToUtc(d, '22:00', TZ), end_at: zonedTimeToUtc(addDays(d, 1), '09:00', TZ) };
    expect(blockPlacement(overnight, addDays(d, 1), TZ, 8, 18)).toEqual({ top: 0, height: 60 }); // the morning after
  });
});

// ---------------------------------------------------------------- small helpers
describe('helpers', () => {
  it('timeUntil', () => {
    const now = new Date('2030-01-07T00:00:00Z').getTime();
    const plus = (min) => new Date(now + min * 60_000).toISOString();
    expect(timeUntil(plus(-5), now)).toBe('starting now');
    expect(timeUntil(plus(1), now)).toBe('in 1 minute');
    expect(timeUntil(plus(45), now)).toBe('in 45 minutes');
    expect(timeUntil(plus(60), now)).toBe('in 1 hour');
    expect(timeUntil(plus(5 * 60), now)).toBe('in 5 hours');
    expect(timeUntil(plus(24 * 60), now)).toBe('tomorrow');
    expect(timeUntil(plus(3 * 24 * 60), now)).toBe('in 3 days');
  });

  it('normalizePhone', () => {
    expect(normalizePhone('+91 98765-43210')).toBe('+919876543210');
    expect(normalizePhone('+1 (415) 555-0123')).toBe('+14155550123');
    expect(normalizePhone('   ')).toBe('');
    expect(normalizePhone('9876543210')).toBeNull();
    expect(normalizePhone('+12')).toBeNull();
    expect(normalizePhone('+91abc')).toBeNull();
  });
});
