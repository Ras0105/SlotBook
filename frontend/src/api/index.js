// One function per backend endpoint used by the customer flow. Components never build URLs themselves.
import { request } from './client';

// ---- auth
export const register = ({ name, email, password }) =>
  request('/auth/register', { method: 'POST', body: { name, email, password }, auth: false });

// The backend's login is an OAuth2 form: the field is called "username" but holds the email.
export const login = async ({ email, password }) => {
  const data = await request('/auth/login', { method: 'POST', form: { username: email, password }, auth: false });
  return data.access_token;
};

export const getMe = () => request('/auth/me');

// ---- providers and slots (public)
export const listProviders = ({ search = '', skip = 0, limit = 10 } = {}, signal) => {
  const params = new URLSearchParams({ skip, limit });
  if (search.trim()) params.set('search', search.trim());
  return request(`/providers?${params}`, { auth: false, signal });
};

export const getProvider = (id, signal) => request(`/providers/${id}`, { auth: false, signal });

export const getSlots = (providerId, date, signal) =>
  request(`/providers/${providerId}/slots?date=${encodeURIComponent(date)}`, { auth: false, signal });

// ---- appointments
export const bookAppointment = ({ providerId, startAt }) =>
  request('/appointments', { method: 'POST', body: { provider_id: providerId, start_at: startAt } });

export const listMyAppointments = ({ skip = 0, limit = 100 } = {}, signal) =>
  request(`/appointments/me?skip=${skip}&limit=${limit}`, { signal });

export const getAppointment = (id, signal) => request(`/appointments/${id}`, { signal });

export const cancelAppointment = (id) => request(`/appointments/${id}/cancel`, { method: 'PATCH' });

export const rescheduleAppointment = (id, newStartAt) =>
  request(`/appointments/${id}/reschedule`, { method: 'PATCH', body: { new_start_at: newStartAt } });
