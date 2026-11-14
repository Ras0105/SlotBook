import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import * as api from '../api';
import { ApiError } from '../api/client';
import { startOfDay, zonedTimeToUtc } from '../lib/time';
import { ADMIN, CUSTOMER, PROVIDER, PROVIDER_USER, renderApp } from '../test/utils';

const MONDAY = { id: 1, provider_id: 1, weekday: 0, start_time: '09:00:00', end_time: '12:00:00' };
const BLOCK = { id: 5, provider_id: 1, start_at: '2030-01-07T03:30:00Z', end_at: '2030-01-07T07:30:00Z', reason: 'Dentist' };
const change = (el, value) => fireEvent.change(el, { target: { value } });
const location = () => screen.getByTestId('location').textContent;

function providerSetup({ rules = [MONDAY], blocks = [] } = {}) {
  api.getMyProvider.mockResolvedValue(PROVIDER);
  api.listAvailability.mockResolvedValue(rules);
  api.listBlockedSlots.mockResolvedValue(blocks);
}

describe('becoming a provider', () => {
  it('creates the profile, refreshes the role and lands on the dashboard', async () => {
    renderApp('/become-provider', { user: CUSTOMER });
    await screen.findByRole('heading', { name: 'Become a provider' });

    api.createProvider.mockResolvedValue(PROVIDER);
    api.getMe.mockResolvedValue({ ...CUSTOMER, role: 'provider' }); // what the server says once the profile exists
    providerSetup({ rules: [] });

    await userEvent.type(screen.getByLabelText('What do you offer?'), '  Dental checkup ');
    change(screen.getByLabelText('Appointment length (minutes)'), '45');
    await userEvent.selectOptions(screen.getByLabelText('Your timezone'), 'Asia/Kolkata');
    await userEvent.click(screen.getByRole('button', { name: 'Create my profile' }));

    expect(await screen.findByRole('heading', { name: 'Provider dashboard' })).toBeInTheDocument();
    expect(api.createProvider).toHaveBeenCalledWith({
      serviceName: 'Dental checkup',
      durationMinutes: 45,
      timezone: 'Asia/Kolkata',
      description: '',
      category: 'other',
    });
    expect(location()).toBe('/dashboard');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument(); // the menu follows the new role
    expect(screen.getByText(/Your provider profile is ready/)).toBeInTheDocument();
  });

  it('checks the form before sending anything', async () => {
    renderApp('/become-provider', { user: CUSTOMER });
    await screen.findByRole('heading', { name: 'Become a provider' });
    change(screen.getByLabelText('Appointment length (minutes)'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Create my profile' }));

    expect(await screen.findByText(/Say what you offer/)).toBeInTheDocument();
    expect(screen.getByText('Enter a whole number of minutes from 5 to 480.')).toBeInTheDocument();
    expect(api.createProvider).not.toHaveBeenCalled();
  });

  it('shows the server message next to the field it names', async () => {
    renderApp('/become-provider', { user: CUSTOMER });
    await screen.findByRole('heading', { name: 'Become a provider' });
    api.createProvider.mockRejectedValue(new ApiError(422, 'service_name: too long', { fields: { service_name: 'Too long for the server' } }));

    await userEvent.type(screen.getByLabelText('What do you offer?'), 'Checkup');
    await userEvent.click(screen.getByRole('button', { name: 'Create my profile' }));

    expect(await screen.findByText('Too long for the server')).toBeInTheDocument();
    expect(screen.getByLabelText('What do you offer?')).toHaveAttribute('aria-invalid', 'true');
    expect(location()).toBe('/become-provider');
  });

  it('sends someone who is already a provider to the dashboard', async () => {
    providerSetup();
    renderApp('/become-provider', { user: PROVIDER_USER });
    expect(await screen.findByRole('heading', { name: 'Provider dashboard' })).toBeInTheDocument();
    expect(location()).toBe('/dashboard');
  });

  it('asks a logged-out visitor to log in first', async () => {
    renderApp('/become-provider');
    expect(await screen.findByRole('heading', { name: /Log in/ })).toBeInTheDocument();
    expect(location()).toBe('/login');
  });
});

describe('who can open the dashboard', () => {
  it('shows a customer that the page is not for them, without asking the server for anything', async () => {
    renderApp('/dashboard', { user: CUSTOMER });
    expect(await screen.findByText('This page is not for your account')).toBeInTheDocument();
    expect(screen.getByText('It is only for providers.')).toBeInTheDocument();
    expect(api.getMyProvider).not.toHaveBeenCalled();
  });

  it('shows each role the menu items that fit it', async () => {
    providerSetup();
    renderApp('/dashboard', { user: PROVIDER_USER });
    await screen.findByRole('heading', { name: 'Provider dashboard' });
    expect(screen.getByRole('link', { name: 'My appointments' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Become a provider' })).not.toBeInTheDocument();
  });

  it('offers a customer the way to become a provider', async () => {
    api.listProviders.mockResolvedValue([]);
    renderApp('/providers', { user: CUSTOMER });
    expect(await screen.findByRole('link', { name: 'Become a provider' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
  });

  it('keeps administrators out of the provider pages', async () => {
    renderApp('/dashboard', { user: ADMIN });
    expect(await screen.findByText('This page is not for your account')).toBeInTheDocument();
  });
});

describe('working hours', () => {
  beforeEach(() => providerSetup());

  it('lists the weekly hours in plain words', async () => {
    renderApp('/dashboard', { user: PROVIDER_USER });
    const list = await screen.findByRole('list', { name: 'Working hours' });
    expect(within(list).getByText('Monday')).toBeInTheDocument();
    expect(within(list).getByText('9:00 am to 12:00 pm')).toBeInTheDocument();
    expect(api.listAvailability).toHaveBeenCalledWith(1, expect.anything());
  });

  it('tells a new provider that nobody can book yet', async () => {
    api.listAvailability.mockResolvedValue([]);
    renderApp('/dashboard', { user: PROVIDER_USER });
    expect(await screen.findByText(/customers cannot book you/)).toBeInTheDocument();
  });

  it('adds hours and keeps the list in weekday order', async () => {
    renderApp('/dashboard', { user: PROVIDER_USER });
    await screen.findByRole('list', { name: 'Working hours' });
    api.createAvailability.mockResolvedValue({ id: 2, provider_id: 1, weekday: 1, start_time: '14:00:00', end_time: '17:30:00' });

    await userEvent.selectOptions(screen.getByLabelText('Day'), 'Tuesday');
    change(screen.getByLabelText('From'), '14:00');
    change(screen.getByLabelText('To'), '17:30');
    await userEvent.click(screen.getByRole('button', { name: 'Add hours' }));

    expect(await screen.findByText('2:00 pm to 5:30 pm')).toBeInTheDocument();
    expect(api.createAvailability).toHaveBeenCalledWith({ weekday: 1, startTime: '14:00:00', endTime: '17:30:00' });
    const days = within(screen.getByRole('list', { name: 'Working hours' })).getAllByText(/day$/).map((n) => n.textContent);
    expect(days).toEqual(['Monday', 'Tuesday']);
  });

  it('refuses hours that end before they start, without calling the server', async () => {
    renderApp('/dashboard', { user: PROVIDER_USER });
    await screen.findByRole('list', { name: 'Working hours' });
    change(screen.getByLabelText('From'), '15:00');
    change(screen.getByLabelText('To'), '10:00');
    await userEvent.click(screen.getByRole('button', { name: 'Add hours' }));
    expect(await screen.findByText('The start time must be before the end time.')).toBeInTheDocument();
    expect(api.createAvailability).not.toHaveBeenCalled();
  });

  it('explains an overlap (409) next to the form and keeps the list unchanged', async () => {
    renderApp('/dashboard', { user: PROVIDER_USER });
    await screen.findByRole('list', { name: 'Working hours' });
    api.createAvailability.mockRejectedValue(new ApiError(409, 'Working hours overlap an existing rule on that weekday'));
    await userEvent.click(screen.getByRole('button', { name: 'Add hours' }));
    expect(await screen.findByText('Working hours overlap an existing rule on that weekday')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Working hours' })).getAllByRole('listitem')).toHaveLength(1);
  });

  it('edits a rule in place', async () => {
    renderApp('/dashboard', { user: PROVIDER_USER });
    await screen.findByRole('list', { name: 'Working hours' });
    api.updateAvailability.mockResolvedValue({ ...MONDAY, end_time: '13:00:00' });

    await userEvent.click(screen.getByRole('button', { name: 'Edit Monday hours' }));
    const row = screen.getAllByRole('listitem')[0];
    change(within(row).getByLabelText('To'), '13:00');
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('9:00 am to 1:00 pm')).toBeInTheDocument();
    expect(api.updateAvailability).toHaveBeenCalledWith(1, { weekday: 0, startTime: '09:00:00', endTime: '13:00:00' });
  });

  it('removes a rule', async () => {
    renderApp('/dashboard', { user: PROVIDER_USER });
    await screen.findByRole('list', { name: 'Working hours' });
    api.deleteAvailability.mockResolvedValue(null);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Monday hours' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Working hours' })).not.toBeInTheDocument());
    expect(api.deleteAvailability).toHaveBeenCalledWith(1);
  });

  it('offers a retry when the hours cannot be loaded', async () => {
    api.listAvailability.mockRejectedValueOnce(new ApiError(0, "Can't reach the server."));
    renderApp('/dashboard', { user: PROVIDER_USER });
    expect(await screen.findByText("Can't reach the server.")).toBeInTheDocument();
    api.listAvailability.mockResolvedValue([MONDAY]);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list', { name: 'Working hours' })).toBeInTheDocument();
  });
});

describe('time off', () => {
  beforeEach(() => providerSetup({ blocks: [BLOCK] }));

  async function openTimeOff() {
    renderApp('/dashboard?tab=time-off', { user: PROVIDER_USER });
    return screen.findByRole('list', { name: 'Time off' });
  }

  it('lists blocked periods in the provider timezone, and the tab lives in the URL', async () => {
    const list = await openTimeOff();
    expect(within(list).getByText('Dentist')).toBeInTheDocument();
    expect(within(list).getByText('Mon 7 Jan, 9:00 am to 1:00 pm')).toBeInTheDocument(); // 03:30Z-07:30Z in Kolkata
    expect(screen.getByRole('tab', { name: 'Time off' })).toHaveAttribute('aria-selected', 'true');
  });

  it('adds a timed block, converting the provider wall-clock time to UTC', async () => {
    await openTimeOff();
    api.createBlockedSlot.mockResolvedValue({ ...BLOCK, id: 6, reason: 'Lunch' });

    change(screen.getByLabelText('From date'), '2030-01-08');
    change(screen.getByLabelText('From time'), '13:00');
    change(screen.getByLabelText('To time'), '14:00');
    await userEvent.type(screen.getByLabelText('Reason (optional)'), ' Lunch ');
    await userEvent.click(screen.getByRole('button', { name: 'Add time off' }));

    expect(await screen.findByText(/Time off added/)).toBeInTheDocument();
    expect(api.createBlockedSlot).toHaveBeenCalledWith({
      startAt: zonedTimeToUtc('2030-01-08', '13:00', 'Asia/Kolkata'),
      endAt: zonedTimeToUtc('2030-01-08', '14:00', 'Asia/Kolkata'),
      reason: 'Lunch',
    });
  });

  it('blocks whole days, through the end of the last one', async () => {
    await openTimeOff();
    api.createBlockedSlot.mockResolvedValue({ ...BLOCK, id: 7 });
    await userEvent.click(screen.getByLabelText('All day (whole days)'));
    expect(screen.queryByLabelText('From time')).not.toBeInTheDocument();
    change(screen.getByLabelText('From date'), '2030-01-08');
    change(screen.getByLabelText('To date'), '2030-01-09');
    await userEvent.click(screen.getByRole('button', { name: 'Add time off' }));

    await screen.findByText(/Time off added/);
    expect(api.createBlockedSlot).toHaveBeenCalledWith({
      startAt: startOfDay('2030-01-08', 'Asia/Kolkata'),
      endAt: startOfDay('2030-01-10', 'Asia/Kolkata'),
      reason: '',
    });
  });

  it('refuses an end before the start without calling the server', async () => {
    await openTimeOff();
    change(screen.getByLabelText('From date'), '2030-01-08');
    change(screen.getByLabelText('From time'), '15:00');
    change(screen.getByLabelText('To time'), '10:00');
    await userEvent.click(screen.getByRole('button', { name: 'Add time off' }));
    expect(await screen.findByText('The end must be after the start.')).toBeInTheDocument();
    expect(api.createBlockedSlot).not.toHaveBeenCalled();
  });

  it('explains a booking clash (409) and points to the appointments', async () => {
    await openTimeOff();
    api.createBlockedSlot.mockRejectedValue(
      new ApiError(409, 'Existing appointments overlap this period; cancel or reschedule them first'),
    );
    change(screen.getByLabelText('From date'), '2030-01-08');
    await userEvent.click(screen.getByRole('button', { name: 'Add time off' }));

    expect(await screen.findByText(/Existing appointments overlap this period/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open your appointments' })).toHaveAttribute('href', '/appointments');
    expect(within(screen.getByRole('list', { name: 'Time off' })).getAllByRole('listitem')).toHaveLength(1);
  });

  it('removes a block', async () => {
    await openTimeOff();
    api.deleteBlockedSlot.mockResolvedValue(null);
    await userEvent.click(screen.getByRole('button', { name: /Remove time off/ }));
    expect(await screen.findByText(/That time can be booked again/)).toBeInTheDocument();
    expect(api.deleteBlockedSlot).toHaveBeenCalledWith(5);
    expect(screen.getByText('No time off planned')).toBeInTheDocument();
  });

  it('shows an empty state when nothing is planned', async () => {
    api.listBlockedSlots.mockResolvedValue([]);
    renderApp('/dashboard?tab=time-off', { user: PROVIDER_USER });
    expect(await screen.findByText('No time off planned')).toBeInTheDocument();
  });
});

describe('provider profile', () => {
  beforeEach(() => providerSetup());

  it('saves changes and shows them in the page heading', async () => {
    renderApp('/dashboard?tab=profile', { user: PROVIDER_USER });
    const name = await screen.findByLabelText('What do you offer?');
    expect(name).toHaveValue('General Checkup');
    expect(screen.getByLabelText('Your timezone')).toHaveValue('Asia/Kolkata');

    api.updateMyProvider.mockResolvedValue({ ...PROVIDER, service_name: 'Family Checkup', appointment_duration_minutes: 20 });
    await userEvent.clear(name);
    await userEvent.type(name, 'Family Checkup');
    change(screen.getByLabelText('Appointment length (minutes)'), '20');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
    expect(api.updateMyProvider).toHaveBeenCalledWith({
      serviceName: 'Family Checkup',
      durationMinutes: 20,
      timezone: 'Asia/Kolkata',
      description: '',
      category: 'other',
    });
    expect(screen.getByText(/Family Checkup: 20 minute appointments/)).toBeInTheDocument();
  });

  it('shows a server error without losing what was typed', async () => {
    renderApp('/dashboard?tab=profile', { user: PROVIDER_USER });
    const name = await screen.findByLabelText('What do you offer?');
    api.updateMyProvider.mockRejectedValue(new ApiError(503, 'The booking system is busy', { retryAfter: 2 }));
    await userEvent.type(name, ' 2');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/busy right now/)).toBeInTheDocument();
    expect(screen.getByLabelText('What do you offer?')).toHaveValue('General Checkup 2');
  });

  it('switches tabs through the URL', async () => {
    renderApp('/dashboard', { user: PROVIDER_USER });
    await screen.findByRole('list', { name: 'Working hours' });
    await userEvent.click(screen.getByRole('tab', { name: 'Profile' }));
    expect(location()).toBe('/dashboard?tab=profile');
    await userEvent.click(screen.getByRole('tab', { name: 'Working hours' }));
    expect(location()).toBe('/dashboard');
  });
});
