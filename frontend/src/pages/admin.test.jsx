import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import * as api from '../api';
import { ApiError } from '../api/client';
import { addDays, startOfDay, userTimeZone } from '../lib/time';
import { ADMIN, CUSTOMER, PROVIDER, renderApp } from '../test/utils';

const change = (el, value) => fireEvent.change(el, { target: { value } });
const location = () => screen.getByTestId('location').textContent;
const DAY = 86_400_000;

const STATS = {
  date_from: '2030-01-01T00:00:00Z',
  date_to: '2030-01-06T00:00:00Z',
  total_appointments: 6,
  by_status: { booked: 2, cancelled: 2, completed: 2 },
  cancellation_rate: 0.3333,
  bookings_per_day: [
    { date: '2030-01-02', count: 2 },
    { date: '2030-01-04', count: 1 },
  ],
  top_providers: [
    { provider_id: 1, service_name: 'General Checkup', bookings: 3 },
    { provider_id: 2, service_name: 'Massage', bookings: 1 },
  ],
};

function appt(id, extra = {}) {
  return {
    id,
    customer_id: 7,
    provider_id: 1,
    start_at: '2030-01-07T03:30:00Z', // 09:00 in Kolkata
    end_at: '2030-01-07T04:00:00Z',
    status: 'booked',
    created_at: '2029-12-01T00:00:00Z',
    ...extra,
  };
}

describe('who can open the admin pages', () => {
  it('shows a customer that the page is not for them', async () => {
    renderApp('/admin', { user: CUSTOMER });
    expect(await screen.findByText('This page is not for your account')).toBeInTheDocument();
    expect(screen.getByText('It is only for administrators.')).toBeInTheDocument();
    expect(api.getAdminStats).not.toHaveBeenCalled();
  });

  it('gives an admin an Admin menu item and no "My appointments"', async () => {
    api.getAdminStats.mockResolvedValue(STATS);
    renderApp('/admin', { user: ADMIN });
    await screen.findByRole('heading', { name: 'Admin overview' });
    expect(screen.getByRole('link', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'My appointments' })).not.toBeInTheDocument();
  });

  it('sends a logged-out visitor to log in', async () => {
    renderApp('/admin/appointments');
    await screen.findByRole('heading', { name: /Log in/ });
    expect(location()).toBe('/login');
  });
});

describe('admin overview', () => {
  beforeEach(() => {
    // braces matter: a returned function would be run by vitest as a cleanup callback
    api.getAdminStats.mockResolvedValue(STATS);
  });

  it('asks for the last 30 days by default and shows the totals', async () => {
    renderApp('/admin', { user: ADMIN });
    await screen.findByRole('img', { name: /Bookings per day/ });
    const [first] = api.getAdminStats.mock.calls[0];
    expect(Math.round((new Date(first.dateTo) - new Date(first.dateFrom)) / DAY)).toBe(30);
    expect(screen.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'true');

    const totals = within(screen.getByLabelText('Totals'));
    expect(totals.getByText('Appointments').nextSibling).toHaveTextContent('6');
    expect(totals.getByText('Cancelled').nextSibling).toHaveTextContent('2');
    expect(totals.getByText('Cancellation rate').nextSibling).toHaveTextContent('33.3%');
  });

  it('draws one bar for every day, including days without bookings, and describes it in words', async () => {
    renderApp('/admin', { user: ADMIN });
    const chart = await screen.findByRole('img', { name: /Bookings per day/ });
    expect(chart).toHaveAttribute('aria-label', 'Bookings per day: 3 in 5 days. Busiest day Wed 2 Jan with 2.');
    expect(chart.children).toHaveLength(5); // 1 to 5 January
  });

  it('lists the busiest providers with links to them', async () => {
    renderApp('/admin', { user: ADMIN });
    await screen.findByRole('img', { name: /Bookings per day/ });
    const link = screen.getByRole('link', { name: 'General Checkup' });
    expect(link).toHaveAttribute('href', '/providers/1');
    expect(screen.getByText('Massage')).toBeInTheDocument();
  });

  it('switches the period with one click and keeps it in the URL', async () => {
    renderApp('/admin', { user: ADMIN });
    await screen.findByRole('img', { name: /Bookings per day/ });
    await userEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    await waitFor(() => expect(api.getAdminStats).toHaveBeenCalledTimes(2));
    const [second] = api.getAdminStats.mock.calls[1];
    expect(Math.round((new Date(second.dateTo) - new Date(second.dateFrom)) / DAY)).toBe(7);
    expect(location()).toBe('/admin?range=7');
  });

  it('uses a custom period, counting the last day as a whole day', async () => {
    renderApp('/admin?range=custom&from=2030-01-01&to=2030-01-05', { user: ADMIN });
    await screen.findByRole('img', { name: /Bookings per day/ });
    expect(api.getAdminStats).toHaveBeenCalledTimes(1);
    expect(api.getAdminStats.mock.calls[0][0]).toEqual({
      dateFrom: startOfDay('2030-01-01', userTimeZone()),
      dateTo: startOfDay(addDays('2030-01-05', 1), userTimeZone()),
    });
  });

  it('waits for both custom dates before asking the server', async () => {
    renderApp('/admin', { user: ADMIN });
    await screen.findByRole('img', { name: /Bookings per day/ });
    await userEvent.click(screen.getByRole('button', { name: 'Custom' }));
    expect(await screen.findByText('Pick a period')).toBeInTheDocument();
    expect(api.getAdminStats).toHaveBeenCalledTimes(1); // only the default load

    change(screen.getByLabelText('First day'), '2030-01-01');
    change(screen.getByLabelText('Last day'), '2030-01-05');
    await userEvent.click(screen.getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(api.getAdminStats).toHaveBeenCalledTimes(2));
    expect(location()).toBe('/admin?range=custom&from=2030-01-01&to=2030-01-05');
  });

  it('explains a backwards or far too long custom period instead of asking the server', async () => {
    renderApp('/admin?range=custom&from=2030-02-01&to=2030-01-01', { user: ADMIN });
    expect(await screen.findByText('The first date must not be after the last.')).toBeInTheDocument();
    expect(api.getAdminStats).not.toHaveBeenCalled();
  });

  it('refuses a custom period longer than 92 days', async () => {
    renderApp('/admin?range=custom&from=2030-01-01&to=2030-06-01', { user: ADMIN });
    expect(await screen.findByText('Choose a period of up to 92 days.')).toBeInTheDocument();
    expect(api.getAdminStats).not.toHaveBeenCalled();
  });

  it('says so when nothing was booked in the period', async () => {
    api.getAdminStats.mockResolvedValue({
      ...STATS,
      total_appointments: 0,
      by_status: { booked: 0, cancelled: 0, completed: 0 },
      cancellation_rate: 0,
      bookings_per_day: [],
      top_providers: [],
    });
    renderApp('/admin', { user: ADMIN });
    expect(await screen.findByText('Nothing was booked in this period')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Bookings per day/ })).not.toBeInTheDocument();
  });

  it('offers a retry when loading fails', async () => {
    api.getAdminStats.mockRejectedValueOnce(new ApiError(0, "Can't reach the server."));
    renderApp('/admin', { user: ADMIN });
    expect(await screen.findByText("Can't reach the server.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('img', { name: /Bookings per day/ })).toBeInTheDocument();
  });
});

describe('admin appointments', () => {
  beforeEach(() => {
    api.listAdminAppointments.mockResolvedValue([appt(11), appt(12, { status: 'cancelled', customer_id: 8 })]);
    api.getProvider.mockResolvedValue(PROVIDER);
  });

  it("lists appointments with provider names and times in each provider's own timezone", async () => {
    renderApp('/admin/appointments', { user: ADMIN });
    expect(await screen.findAllByRole('link', { name: 'General Checkup' })).toHaveLength(2);
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('Mon 7 Jan, 9:00 am to 9:30 am')).toBeInTheDocument();
    expect(within(rows[1]).getByText('#7')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Cancelled')).toBeInTheDocument();
    expect(api.getProvider).toHaveBeenCalledTimes(1); // both rows share one provider lookup
  });

  it('still lists appointments (with ids) if the provider names cannot be loaded', async () => {
    api.getProvider.mockRejectedValue(new ApiError(500, 'boom'));
    renderApp('/admin/appointments', { user: ADMIN });
    expect(await screen.findAllByText('Provider #1')).toHaveLength(2);
  });

  it('applies filters, keeps them in the URL, and sends them to the API', async () => {
    renderApp('/admin/appointments', { user: ADMIN });
    await screen.findAllByRole('link', { name: 'General Checkup' });

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'cancelled');
    await userEvent.type(screen.getByLabelText('Provider number'), '1');
    change(screen.getByLabelText('From date'), '2030-01-01');
    change(screen.getByLabelText('To date'), '2030-01-31');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => expect(location()).toContain('status=cancelled'));
    expect(location()).toBe('/admin/appointments?status=cancelled&provider=1&from=2030-01-01&to=2030-01-31');
    await waitFor(() => expect(api.listAdminAppointments).toHaveBeenCalledTimes(2));
    expect(api.listAdminAppointments.mock.calls[1][0]).toMatchObject({
      status: 'cancelled',
      providerId: '1',
      dateFrom: startOfDay('2030-01-01', userTimeZone()),
      dateTo: startOfDay('2030-02-01', userTimeZone()), // "to" 31 Jan includes the whole of 31 Jan
      skip: 0,
      limit: 21,
    });
  });

  it('starts from the URL, and Clear removes every filter', async () => {
    renderApp('/admin/appointments?status=booked&customer=7', { user: ADMIN });
    await screen.findAllByRole('link', { name: 'General Checkup' });
    expect(screen.getByLabelText('Status')).toHaveValue('booked');
    expect(screen.getByLabelText('Customer number')).toHaveValue('7');
    expect(api.listAdminAppointments.mock.calls[0][0]).toMatchObject({ status: 'booked', customerId: '7' });

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(location()).toBe('/admin/appointments'));
    expect(screen.getByLabelText('Status')).toHaveValue('');
  });

  it('pages through results using one extra row to detect a next page', async () => {
    api.listAdminAppointments.mockResolvedValueOnce(Array.from({ length: 21 }, (_, i) => appt(100 + i)));
    renderApp('/admin/appointments', { user: ADMIN });
    await screen.findAllByRole('link', { name: 'General Checkup' });
    expect(screen.getAllByRole('row')).toHaveLength(21); // header + 20 shown, the 21st only proves there is more
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    api.listAdminAppointments.mockResolvedValueOnce([appt(200)]);
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(location()).toBe('/admin/appointments?page=2'));
    await waitFor(() => expect(screen.getByText('Page 2')).toBeInTheDocument());
    expect(api.listAdminAppointments.mock.calls[1][0]).toMatchObject({ skip: 20, limit: 21 });
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('says when nothing matches', async () => {
    api.listAdminAppointments.mockResolvedValue([]);
    renderApp('/admin/appointments?status=completed', { user: ADMIN });
    expect(await screen.findByText('No appointments match these filters')).toBeInTheDocument();
  });

  it('does not ask the server for a date range that runs backwards', async () => {
    renderApp('/admin/appointments?from=2030-02-01&to=2030-01-01', { user: ADMIN });
    expect(await screen.findByText('The first date must not be after the last.')).toBeInTheDocument();
    expect(api.listAdminAppointments).not.toHaveBeenCalled();
  });

  it('ignores junk in the URL instead of sending it', async () => {
    renderApp('/admin/appointments?status=pizza&provider=abc&customer=-1&from=yesterday', { user: ADMIN });
    await screen.findAllByRole('link', { name: 'General Checkup' });
    expect(api.listAdminAppointments.mock.calls[0][0]).toMatchObject({
      status: '',
      providerId: '',
      customerId: '',
      dateFrom: undefined,
      dateTo: undefined,
    });
  });

  it('offers a retry when loading fails', async () => {
    api.listAdminAppointments.mockRejectedValueOnce(new ApiError(503, 'The booking system is busy', { retryAfter: 2 }));
    renderApp('/admin/appointments', { user: ADMIN });
    expect(await screen.findByText(/busy right now/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findAllByRole('link', { name: 'General Checkup' })).toHaveLength(2);
  });
});
