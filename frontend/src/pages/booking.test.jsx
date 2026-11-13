import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import * as api from '../api';
import { ApiError } from '../api/client';
import { addDays } from '../lib/time';
import { CUSTOMER, PROVIDER, renderApp, slot, slotsResponse } from '../test/utils';

const SLOTS = [slot(0), slot(30), slot(360)]; // 9:00 am, 9:30 am and 3:00 pm Kolkata time

function setup({ user = null } = {}) {
  api.getProvider.mockResolvedValue(PROVIDER);
  api.getSlots.mockResolvedValue(slotsResponse(SLOTS));
  api.listMyAppointments.mockResolvedValue([]);
  return renderApp('/providers/1', { user });
}

describe('booking a slot', () => {
  it('shows free times grouped by part of the day, in the provider timezone', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: 'Morning' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Afternoon' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Evening' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '9:00 am' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3:00 pm' })).toBeInTheDocument();
    expect(screen.getByText(/All times are in Kolkata time/)).toBeInTheDocument();
  });

  it('sends a logged-out visitor to log in, and remembers where they were', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: '9:00 am' }));
    const bar = screen.getByRole('region', { name: 'Your selection' });
    expect(bar).toHaveTextContent('9:00 am to 9:30 am');
    await userEvent.click(screen.getByRole('button', { name: 'Log in to book' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  it('books the chosen slot and lands on My appointments with a confirmation', async () => {
    setup({ user: CUSTOMER });
    const booked = { id: 5, customer_id: 7, provider_id: 1, ...slot(0), status: 'booked', created_at: '2030-01-01T00:00:00Z' };
    api.bookAppointment.mockResolvedValue(booked);
    api.listMyAppointments.mockResolvedValue([booked]);

    await userEvent.click(await screen.findByRole('button', { name: '9:00 am' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm booking' }));

    expect(api.bookAppointment).toHaveBeenCalledWith({ providerId: 1, startAt: slot(0).start_at });
    expect(await screen.findByText(/Booked\. General Checkup on Monday, 7 January 2030/)).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/appointments');
  });

  it('handles losing the race: says so, clears the choice and reloads the times (409)', async () => {
    setup({ user: CUSTOMER });
    api.bookAppointment.mockRejectedValue(new ApiError(409, 'This slot is no longer available'));

    await userEvent.click(await screen.findByRole('button', { name: '9:00 am' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm booking' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Someone just booked that time');
    await waitFor(() => expect(api.getSlots).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('region', { name: 'Your selection' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm booking' })).not.toBeInTheDocument();
  });

  it('shows the server message for a rejected request (422)', async () => {
    setup({ user: CUSTOMER });
    api.bookAppointment.mockRejectedValue(new ApiError(422, 'Cannot book a time in the past'));
    await userEvent.click(await screen.findByRole('button', { name: '9:00 am' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm booking' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot book a time in the past');
  });

  it('prevents booking your own provider profile', async () => {
    setup({ user: { ...CUSTOMER, id: 99, role: 'provider' } });
    expect(await screen.findByText(/your own provider profile/i)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: '9:00 am' }));
    expect(screen.queryByRole('button', { name: /confirm booking|log in to book/i })).not.toBeInTheDocument();
  });

  it('offers the next day when a day has no times', async () => {
    setup();
    api.getSlots.mockResolvedValue(slotsResponse([]));
    expect(await screen.findByRole('heading', { name: /No times on/ })).toBeInTheDocument();
    const firstDate = api.getSlots.mock.calls[0][1];
    await userEvent.click(screen.getByRole('button', { name: /^Check / }));
    await waitFor(() => expect(api.getSlots).toHaveBeenLastCalledWith(1, addDays(firstDate, 1), expect.anything()));
  });

  it('shows a not-found page for a provider that does not exist', async () => {
    api.getProvider.mockRejectedValue(new ApiError(404, 'Provider not found'));
    renderApp('/providers/999');
    expect(await screen.findByRole('heading', { name: /can’t find that provider/i })).toBeInTheDocument();
  });
});
