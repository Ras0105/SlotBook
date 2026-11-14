import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { ApiError } from '../api/client';
import * as ics from '../lib/ics';
import { CUSTOMER, PROVIDER, renderApp } from '../test/utils';

vi.mock('../lib/ics', async (importOriginal) => ({ ...(await importOriginal()), downloadIcs: vi.fn() }));

function at(days, { hour = 4 } = {}) {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
function appt(id, { status = 'booked', days, review = null, customer = CUSTOMER.id } = {}) {
  const start = at(days);
  const end = new Date(new Date(start).getTime() + 30 * 60_000).toISOString();
  return { id, customer_id: customer, provider_id: 1, start_at: start, end_at: end, status, created_at: '2030-01-01T00:00:00Z', review };
}
const REVIEW = { id: 5, appointment_id: 3, provider_id: 1, rating: 4, comment: 'Lovely', reviewer_name: 'Asha R.', created_at: '2030-01-02T00:00:00Z' };

function setup(list) {
  api.getProvider.mockResolvedValue(PROVIDER);
  api.listMyAppointments.mockResolvedValue(list);
  return renderApp('/appointments', { user: CUSTOMER });
}
const openPast = async () => userEvent.click(await screen.findByRole('tab', { name: /Past/ }));

describe('reviewing a finished appointment', () => {
  it('offers "Rate this visit" only for finished appointments that have no review yet', async () => {
    setup([
      appt(1, { days: 2 }), // upcoming: not yet
      appt(2, { days: -2 }), // booked, but over
      appt(3, { status: 'completed', days: -3, review: REVIEW }), // already reviewed
      appt(4, { status: 'completed', days: -4 }),
      appt(5, { status: 'cancelled', days: -5 }), // cancelled: never
    ]);
    await openPast();
    expect(screen.getAllByRole('button', { name: 'Rate this visit' })).toHaveLength(2);

    await userEvent.click(screen.getByRole('tab', { name: /Upcoming/ }));
    expect(screen.queryByRole('button', { name: 'Rate this visit' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Cancelled/ }));
    expect(screen.queryByRole('button', { name: 'Rate this visit' })).not.toBeInTheDocument();
  });

  it('does not offer a review to the provider of the appointment', async () => {
    setup([appt(2, { days: -2, customer: 12345 })]);
    await openPast();
    expect(screen.queryByRole('button', { name: 'Rate this visit' })).not.toBeInTheDocument();
  });

  it('shows a past booking as Completed, and an existing review under it', async () => {
    setup([appt(2, { days: -2 }), appt(3, { status: 'completed', days: -3, review: REVIEW })]);
    await openPast();
    expect(screen.getAllByText('Completed')).toHaveLength(2); // the past "booked" one counts as completed
    expect(screen.queryByText('Booked')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: '4 out of 5' })).toBeInTheDocument();
    expect(screen.getByText('Lovely')).toBeInTheDocument();
  });

  it('asks for a star rating before sending, then saves rating and comment', async () => {
    setup([appt(2, { days: -2 })]);
    await openPast();
    await userEvent.click(screen.getByRole('button', { name: 'Rate this visit' }));
    const dialog = screen.getByRole('dialog', { name: 'Rate your appointment' });
    expect(within(dialog).getByText('How was General Checkup?')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit review' }));
    expect(within(dialog).getByText('Choose a rating from 1 to 5 stars.')).toBeInTheDocument();
    expect(api.createReview).not.toHaveBeenCalled();

    api.createReview.mockResolvedValue({ ...REVIEW, id: 9, appointment_id: 2, rating: 5, comment: 'Great' });
    await userEvent.click(within(dialog).getByRole('radio', { name: '5 stars, Excellent' }));
    await userEvent.type(within(dialog).getByLabelText('Comment (optional)'), 'Great');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit review' }));

    expect(api.createReview).toHaveBeenCalledWith(2, { rating: 5, comment: 'Great' });
    expect(await screen.findByText('Thanks for your review.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rate this visit' })).not.toBeInTheDocument(); // replaced by the review itself
    expect(screen.getByRole('img', { name: '5 out of 5' })).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('works with the keyboard: arrow keys change the stars', async () => {
    setup([appt(2, { days: -2 })]);
    await openPast();
    await userEvent.click(screen.getByRole('button', { name: 'Rate this visit' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('radio', { name: '1 star, Poor' }));
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(within(dialog).getByRole('radio', { name: '3 stars, Good' })).toBeChecked();
  });

  it('shows why it failed and refreshes the list when the server says it was already reviewed', async () => {
    setup([appt(2, { days: -2 })]);
    await openPast();
    await userEvent.click(screen.getByRole('button', { name: 'Rate this visit' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('radio', { name: '3 stars, Good' }));

    api.createReview.mockRejectedValue(new ApiError(409, 'You have already reviewed this appointment'));
    api.listMyAppointments.mockResolvedValue([appt(2, { status: 'completed', days: -2, review: { ...REVIEW, appointment_id: 2 } })]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit review' }));

    await waitFor(() => expect(api.listMyAppointments).toHaveBeenCalledTimes(2)); // reloaded
  });

  it('keeps the dialog open with the message when something else goes wrong', async () => {
    setup([appt(2, { days: -2 })]);
    await openPast();
    await userEvent.click(screen.getByRole('button', { name: 'Rate this visit' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('radio', { name: '3 stars, Good' }));
    api.createReview.mockRejectedValue(new ApiError(0, "Can't reach the server."));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit review' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("Can't reach the server");
    expect(within(dialog).getByRole('radio', { name: '3 stars, Good' })).toBeChecked(); // nothing typed is lost
  });

  it('closes without sending on "Not now"', async () => {
    setup([appt(2, { days: -2 })]);
    await openPast();
    await userEvent.click(screen.getByRole('button', { name: 'Rate this visit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.createReview).not.toHaveBeenCalled();
  });
});

describe('add to calendar', () => {
  it('downloads an .ics file for an upcoming appointment', async () => {
    const upcoming = appt(7, { days: 3 });
    setup([upcoming]);
    await userEvent.click(await screen.findByRole('button', { name: 'Add to calendar' }));

    expect(ics.downloadIcs).toHaveBeenCalledTimes(1);
    const [filename, text] = ics.downloadIcs.mock.calls[0];
    expect(filename).toBe('slotbook-appointment-7.ics');
    expect(text).toContain('BEGIN:VEVENT');
    expect(text).toContain('SUMMARY:General Checkup');
    expect(text).toContain('UID:appointment-7@slotbook');
    expect(text).toContain(`DTSTART:${upcoming.start_at.replace(/[-:]/g, '').replace('.000', '')}`);
  });

  it('is only offered for upcoming appointments', async () => {
    setup([appt(1, { days: 3 }), appt(2, { days: -2 }), appt(3, { status: 'cancelled', days: 2 })]);
    await screen.findByRole('tab', { name: /Upcoming/ });
    expect(screen.getAllByRole('button', { name: 'Add to calendar' })).toHaveLength(1);
    await openPast();
    expect(screen.queryByRole('button', { name: 'Add to calendar' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Cancelled/ }));
    expect(screen.queryByRole('button', { name: 'Add to calendar' })).not.toBeInTheDocument();
  });
});
