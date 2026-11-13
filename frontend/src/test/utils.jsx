import { render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import * as api from '../api';
import App from '../App';
import { tokenStore } from '../api/client';
import { AuthProvider } from '../auth/AuthContext';

export const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };

export const CUSTOMER = { id: 7, name: 'Asha Rao', email: 'asha@example.com', role: 'customer' };

export const PROVIDER_USER = { id: 99, name: 'Dr Rao', email: 'rao@example.com', role: 'provider' };
export const ADMIN = { id: 1, name: 'Root', email: 'root@example.com', role: 'admin' };

export const PROVIDER = {
  id: 1,
  user_id: 99,
  service_name: 'General Checkup',
  appointment_duration_minutes: 30,
  timezone: 'Asia/Kolkata',
};

// 09:00 Kolkata = 03:30 UTC. Built from "now" so slots are never in the past or on a odd day.
export function slot(offsetMinutes, durationMinutes = 30) {
  const start = new Date('2030-01-07T03:30:00Z'); // a Monday in the far future
  start.setUTCMinutes(start.getUTCMinutes() + offsetMinutes);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return { start_at: start.toISOString(), end_at: end.toISOString() };
}

export function slotsResponse(slots) {
  return { provider_id: 1, date: '2030-01-07', timezone: 'Asia/Kolkata', appointment_duration_minutes: 30, slots };
}

function LocationSpy() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

/** Render the whole app at `path`. Pass `user` to start logged in. */
export function renderApp(path, { user = null } = {}) {
  if (user) {
    tokenStore.set('test-token');
    api.getMe.mockResolvedValue(user);
  }
  return render(
    <MemoryRouter initialEntries={[path]} future={ROUTER_FUTURE}>
      <AuthProvider>
        <App />
        <LocationSpy />
      </AuthProvider>
    </MemoryRouter>,
  );
}
