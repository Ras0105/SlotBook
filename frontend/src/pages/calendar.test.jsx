import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import * as api from '../api';
import { ApiError } from '../api/client';
import { hourRange, placement } from '../components/CalendarPanel';
import { addDays, mondayOf, startOfDay, todayIn, zonedTimeToUtc } from '../lib/time';
import { PROVIDER, PROVIDER_USER, renderApp } from '../test/utils';

const TZ = PROVIDER.timezone; // Asia/Kolkata
const MONDAY = mondayOf(todayIn(TZ));

function entry(id, day, from, to, { name = 'Casey Customer', status = 'booked' } = {}) {
  return {
    id,
    customer_id: 7,
    customer_name: name,
    start_at: zonedTimeToUtc(day, from, TZ),
    end_at: zonedTimeToUtc(day, to, TZ),
    status,
  };
}

function open(entries = []) {
  api.getMyProvider.mockResolvedValue(PROVIDER);
  api.listAvailability.mockResolvedValue([]);
  api.listBlockedSlots.mockResolvedValue([]);
  api.getMyCalendar.mockResolvedValue(entries);
  return renderApp('/dashboard?tab=calendar', { user: PROVIDER_USER });
}

describe('provider calendar', () => {
  it('asks for the current week, Monday to Monday, on the provider’s clock', async () => {
    open();
    await screen.findByRole('heading', { name: /Calendar, week of/ });
    expect(api.getMyCalendar).toHaveBeenCalledWith(
      { start: startOfDay(MONDAY, TZ), end: startOfDay(addDays(MONDAY, 7), TZ) },
      expect.anything(),
    );
    expect(await screen.findByText(/No appointments this week/)).toBeInTheDocument();
  });

  it('puts each booking in its day with the customer and time', async () => {
    const tuesday = addDays(MONDAY, 1);
    open([entry(1, tuesday, '10:00', '10:30'), entry(2, tuesday, '14:30', '15:00', { name: 'Dana Done', status: 'completed' })]);

    await screen.findByText('Casey Customer'); // the grid is drawn before the data arrives
    const day = screen.getByRole('region', { name: /^Tuesday/ });
    const events = within(day).getAllByRole('listitem');
    expect(events).toHaveLength(2);
    expect(events[0]).toHaveTextContent('Casey Customer');
    expect(events[0]).toHaveTextContent('10:00 am to 10:30 am');
    expect(events[0]).toHaveTextContent('booked');
    expect(events[1]).toHaveTextContent('Dana Done');
    expect(events[1]).toHaveTextContent('completed');
    expect(events[1]).toHaveClass('event--completed');
    expect(screen.getByText(/2 appointments this week/)).toBeInTheDocument();

    const monday = screen.getByRole('region', { name: /^Monday/ });
    expect(within(monday).queryByRole('listitem')).not.toBeInTheDocument(); // other days stay empty
  });

  it('positions a block by its time of day', async () => {
    open([entry(1, MONDAY, '09:30', '10:30')]);
    const block = (await screen.findByText('Casey Customer')).closest('li');
    // grid starts at 8 am; 9:30 is 90 minutes down and the appointment lasts 60
    expect(block.style.getPropertyValue('--top')).toBe('90');
    expect(block.style.getPropertyValue('--height')).toBe('60');
  });

  it('moves between weeks and back to this week', async () => {
    open();
    await screen.findByText(/No appointments this week/);
    expect(screen.getByRole('button', { name: 'This week' })).toBeDisabled();

    api.getMyCalendar.mockResolvedValue([entry(3, addDays(MONDAY, 7), '11:00', '11:30', { name: 'Next Week Person' })]);
    await userEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(await screen.findByText('Next Week Person')).toBeInTheDocument();
    expect(api.getMyCalendar).toHaveBeenLastCalledWith(
      { start: startOfDay(addDays(MONDAY, 7), TZ), end: startOfDay(addDays(MONDAY, 14), TZ) },
      expect.anything(),
    );
    expect(screen.getByRole('button', { name: 'This week' })).toBeEnabled();

    api.getMyCalendar.mockResolvedValue([]);
    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    await waitFor(() =>
      expect(api.getMyCalendar).toHaveBeenLastCalledWith(
        { start: startOfDay(addDays(MONDAY, -7), TZ), end: startOfDay(MONDAY, TZ) },
        expect.anything(),
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'This week' }));
    await waitFor(() =>
      expect(api.getMyCalendar).toHaveBeenLastCalledWith({ start: startOfDay(MONDAY, TZ), end: startOfDay(addDays(MONDAY, 7), TZ) }, expect.anything()),
    );
  });

  it('shows an error with a retry', async () => {
    api.getMyProvider.mockResolvedValue(PROVIDER);
    api.listAvailability.mockResolvedValue([]);
    api.getMyCalendar.mockRejectedValue(new ApiError(0, "Can't reach the server."));
    renderApp('/dashboard?tab=calendar', { user: PROVIDER_USER });
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server");
    api.getMyCalendar.mockResolvedValue([entry(1, MONDAY, '09:00', '09:30')]);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Casey Customer')).toBeInTheDocument();
  });

  it('is a tab of the dashboard, kept in the address', async () => {
    api.getMyProvider.mockResolvedValue(PROVIDER);
    api.listAvailability.mockResolvedValue([]);
    api.getMyCalendar.mockResolvedValue([]);
    renderApp('/dashboard', { user: PROVIDER_USER });
    await userEvent.click(await screen.findByRole('tab', { name: 'Calendar' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/dashboard?tab=calendar');
    expect(await screen.findByRole('heading', { name: /Calendar, week of/ })).toBeInTheDocument();
  });
});

describe('calendar grid maths', () => {
  it('always shows 8 am to 6 pm, and grows for early or late bookings', () => {
    expect(hourRange([], TZ)).toEqual([8, 18]);
    expect(hourRange([entry(1, MONDAY, '09:00', '10:00')], TZ)).toEqual([8, 18]);
    expect(hourRange([entry(1, MONDAY, '06:30', '07:00')], TZ)).toEqual([6, 18]);
    expect(hourRange([entry(1, MONDAY, '19:00', '20:15')], TZ)).toEqual([8, 21]);
  });

  it('treats an end at midnight as 24:00', () => {
    const late = { start_at: zonedTimeToUtc(MONDAY, '23:00', TZ), end_at: zonedTimeToUtc(addDays(MONDAY, 1), '00:00', TZ) };
    expect(hourRange([late], TZ)).toEqual([8, 24]);
  });

  it('places by minutes from the top of the grid, with a minimum height', () => {
    const e = entry(1, MONDAY, '08:00', '08:05');
    expect(placement(e, MONDAY, TZ, 8)).toEqual({ top: 0, height: 15 });
    expect(placement(entry(2, MONDAY, '10:15', '11:00'), MONDAY, TZ, 8)).toEqual({ top: 135, height: 45 });
  });
});
