import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import * as api from '../api';
import { ApiError } from '../api/client';
import { CUSTOMER, PROVIDER, renderApp, slot, slotsResponse } from '../test/utils';

function inDays(n) {
  const d = new Date(Date.now() + n * 86_400_000);
  d.setUTCHours(4, 0, 0, 0);
  return d.toISOString();
}
function appt(id, { status = 'booked', days, customer = CUSTOMER.id } = {}) {
  const start = inDays(days);
  const end = new Date(new Date(start).getTime() + 30 * 60_000).toISOString();
  return { id, customer_id: customer, provider_id: 1, start_at: start, end_at: end, status, created_at: '2030-01-01T00:00:00Z' };
}

const LIST = [
  appt(1, { days: 3 }), // upcoming, later
  appt(2, { days: 1 }), // upcoming, sooner
  appt(3, { days: -2 }), // booked but already past
  appt(4, { status: 'completed', days: -5 }),
  appt(5, { status: 'cancelled', days: 2 }),
];

function setup(list = LIST) {
  api.getProvider.mockResolvedValue(PROVIDER);
  api.listMyAppointments.mockResolvedValue(list);
  return renderApp('/appointments', { user: CUSTOMER });
}
const tab = (name) => screen.findByRole('tab', { name });

describe('my appointments', () => {
  it('sorts appointments into upcoming, past and cancelled, soonest first', async () => {
    setup();
    expect(await tab(/Upcoming/)).toHaveTextContent('2');
    expect(screen.getByRole('tab', { name: /Past/ })).toHaveTextContent('2');
    expect(screen.getByRole('tab', { name: /Cancelled/ })).toHaveTextContent('1');
    const links = screen.getAllByRole('link', { name: 'Reschedule' });
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/appointments/2/reschedule', '/appointments/1/reschedule']);

    await userEvent.click(screen.getByRole('tab', { name: /Past/ }));
    expect(screen.queryByRole('link', { name: 'Reschedule' })).not.toBeInTheDocument(); // past ones cannot be changed
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('asks before cancelling, defaulting to the safe choice, then updates the list', async () => {
    setup();
    await tab(/Upcoming/);
    api.cancelAppointment.mockResolvedValue({ ...LIST[1], status: 'cancelled' });

    await userEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]);
    const dialog = screen.getByRole('dialog', { name: 'Cancel this appointment?' });
    expect(within(dialog).getByRole('button', { name: 'Keep appointment' })).toHaveFocus();
    expect(api.cancelAppointment).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel appointment' }));
    expect(api.cancelAppointment).toHaveBeenCalledWith(2);
    expect(await screen.findByText(/Appointment cancelled/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Upcoming/ })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /Cancelled/ })).toHaveTextContent('2');
  });

  it('closes the dialog with Escape without cancelling anything', async () => {
    setup();
    await tab(/Upcoming/);
    await userEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.cancelAppointment).not.toHaveBeenCalled();
  });

  it('explains a failed cancel and refreshes the list (409)', async () => {
    setup();
    await tab(/Upcoming/);
    api.cancelAppointment.mockRejectedValue(new ApiError(409, 'This appointment has already started'));
    await userEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel appointment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This appointment has already started');
    await waitFor(() => expect(api.listMyAppointments).toHaveBeenCalledTimes(2));
  });

  it('shows history on request', async () => {
    setup();
    await tab(/Upcoming/);
    api.getAppointment.mockResolvedValue({
      ...LIST[1],
      history: [{ old_status: null, new_status: 'booked', changed_at: LIST[1].created_at, changed_by: 7, note: 'Appointment booked' }],
    });
    await userEvent.click(screen.getAllByRole('button', { name: 'Show history' })[0]);
    expect(await screen.findByText('Appointment booked')).toBeInTheDocument();
  });

  it('does not offer Reschedule on appointments where you are the provider', async () => {
    setup([appt(9, { days: 2, customer: 555 })]);
    await tab(/Upcoming/);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Reschedule' })).not.toBeInTheDocument();
  });

  it('shows an invitation when there is nothing upcoming', async () => {
    setup([]);
    expect(await screen.findByRole('heading', { name: 'No upcoming appointments' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Find a provider' })).toHaveAttribute('href', '/providers');
  });
});

describe('rescheduling', () => {
  function setupReschedule(appointment) {
    api.getAppointment.mockResolvedValue({ ...appointment, history: [] });
    api.getProvider.mockResolvedValue(PROVIDER);
    api.getSlots.mockResolvedValue(slotsResponse([slot(0), slot(30)]));
    api.listMyAppointments.mockResolvedValue([]);
    return renderApp(`/appointments/${appointment.id}/reschedule`, { user: CUSTOMER });
  }

  it('moves the appointment to the chosen slot', async () => {
    const a = appt(2, { days: 1 });
    setupReschedule(a);
    api.rescheduleAppointment.mockResolvedValue({ ...a, ...slot(30) });
    await userEvent.click(await screen.findByRole('button', { name: '9:30 am' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move appointment' }));
    expect(api.rescheduleAppointment).toHaveBeenCalledWith(2, slot(30).start_at);
    expect(await screen.findByText(/Rescheduled\. General Checkup is now/)).toBeInTheDocument();
  });

  it('handles a taken slot (409) by refreshing the times', async () => {
    setupReschedule(appt(2, { days: 1 }));
    api.rescheduleAppointment.mockRejectedValue(new ApiError(409, 'This slot is no longer available'));
    await userEvent.click(await screen.findByRole('button', { name: '9:30 am' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move appointment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone just booked that time');
    await waitFor(() => expect(api.getSlots).toHaveBeenCalledTimes(2));
  });

  it('refuses to reschedule a cancelled appointment', async () => {
    setupReschedule(appt(5, { status: 'cancelled', days: 2 }));
    expect(await screen.findByText(/is cancelled, so it can’t be moved/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^\d/ })).not.toBeInTheDocument();
  });
});
