// One function per backend endpoint. Components never build URLs themselves.
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

// Profile (logged in). Send only what changed; changing the email also needs the current password.
// phone: '+919876543210' (or '' to remove it); remindersEnabled: true / false.
export const updateProfile = ({ name, email, currentPassword, phone, remindersEnabled }) =>
  request('/auth/me', {
    method: 'PATCH',
    body: {
      ...(name !== undefined ? { name } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(currentPassword ? { current_password: currentPassword } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(remindersEnabled !== undefined ? { reminders_enabled: remindersEnabled } : {}),
    },
  });

export const changePassword = ({ currentPassword, newPassword }) =>
  request('/auth/change-password', {
    method: 'POST',
    body: { current_password: currentPassword, new_password: newPassword },
  });

// Forgot password (no login). The answer is the same whether or not the email has an account.
export const forgotPassword = ({ email }) =>
  request('/auth/forgot-password', { method: 'POST', body: { email }, auth: false });

export const resetPassword = ({ token, newPassword }) =>
  request('/auth/reset-password', { method: 'POST', body: { token, new_password: newPassword }, auth: false });

// Email verification: the emailed link opens /verify-email?token=...; the token is checked (no login needed).
export const verifyEmail = (token) => request('/auth/verify-email', { method: 'POST', body: { token }, auth: false });
export const resendVerification = () => request('/auth/resend-verification', { method: 'POST' });

// ---- providers and slots (public)
export const listProviders = ({ search = '', category = '', skip = 0, limit = 10 } = {}, signal) => {
  const params = new URLSearchParams({ skip, limit });
  if (search.trim()) params.set('search', search.trim());
  if (category) params.set('category', category);
  return request(`/providers?${params}`, { auth: false, signal });
};

export const getProvider = (id, signal) => request(`/providers/${id}`, { auth: false, signal });

export const getSlots = (providerId, date, signal) =>
  request(`/providers/${providerId}/slots?date=${encodeURIComponent(date)}`, { auth: false, signal });

// ---- appointments
// notes: the customer's reason for visit, shown to the provider (optional).
export const bookAppointment = ({ providerId, startAt, notes }) =>
  request('/appointments', {
    method: 'POST',
    body: { provider_id: providerId, start_at: startAt, ...(notes?.trim() ? { notes: notes.trim() } : {}) },
  });

// The logged-in customer's soonest upcoming appointment, or null.
export const getNextAppointment = (signal) => request('/appointments/next', { signal });

export const listMyAppointments = ({ skip = 0, limit = 100 } = {}, signal) =>
  request(`/appointments/me?skip=${skip}&limit=${limit}`, { signal });

export const getAppointment = (id, signal) => request(`/appointments/${id}`, { signal });

export const cancelAppointment = (id) => request(`/appointments/${id}/cancel`, { method: 'PATCH' });

export const rescheduleAppointment = (id, newStartAt) =>
  request(`/appointments/${id}/reschedule`, { method: 'PATCH', body: { new_start_at: newStartAt } });

// ---- reviews (a customer reviews an appointment that is over; reading reviews needs no login)
export const createReview = (appointmentId, { rating, comment }) =>
  request(`/appointments/${appointmentId}/review`, {
    method: 'POST',
    body: { rating, ...(comment?.trim() ? { comment: comment.trim() } : {}) },
  });

// Change your own review (send the rating and comment you want to end up with), or delete it.
export const updateReview = (reviewId, { rating, comment }) =>
  request(`/reviews/${reviewId}`, { method: 'PATCH', body: { rating, comment: comment?.trim() ? comment.trim() : null } });

export const deleteReview = (reviewId) => request(`/reviews/${reviewId}`, { method: 'DELETE' });

export const listProviderReviews = (providerId, { skip = 0, limit = 10 } = {}, signal) =>
  request(`/providers/${providerId}/reviews?skip=${skip}&limit=${limit}`, { auth: false, signal });

// ---- provider profile and working hours (provider role)
export const createProvider = ({ serviceName, durationMinutes, timezone, description, category }) =>
  request('/providers', {
    method: 'POST',
    body: {
      service_name: serviceName,
      appointment_duration_minutes: durationMinutes,
      timezone,
      ...(description !== undefined ? { description } : {}),
      ...(category !== undefined ? { category } : {}),
    },
  });

export const getMyProvider = (signal) => request('/providers/me', { signal });

// description: '' clears it.
export const updateMyProvider = ({ serviceName, durationMinutes, timezone, description, category }) =>
  request('/providers/me', {
    method: 'PATCH',
    body: {
      service_name: serviceName,
      appointment_duration_minutes: durationMinutes,
      timezone,
      ...(description !== undefined ? { description } : {}),
      ...(category !== undefined ? { category } : {}),
    },
  });

// The photo / logo. `file` is an image Blob (the page shrinks it first, see lib/image.js).
export const uploadMyPhoto = (file) => {
  const formData = new FormData();
  formData.append('file', file, 'photo');
  return request('/providers/me/photo', { method: 'POST', formData });
};

export const deleteMyPhoto = () => request('/providers/me/photo', { method: 'DELETE' });

// The provider's week view: booked and completed appointments with customer names. start/end are ISO instants.
export const getMyCalendar = ({ start, end }, signal) =>
  request(`/providers/me/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, { signal });

export const listAvailability = (providerId, signal) =>
  request(`/providers/${providerId}/availability`, { auth: false, signal });

export const createAvailability = ({ weekday, startTime, endTime }) =>
  request('/availability', { method: 'POST', body: { weekday, start_time: startTime, end_time: endTime } });

export const updateAvailability = (id, { weekday, startTime, endTime }) =>
  request(`/availability/${id}`, { method: 'PATCH', body: { weekday, start_time: startTime, end_time: endTime } });

export const deleteAvailability = (id) => request(`/availability/${id}`, { method: 'DELETE' });

// ---- time off (blocked periods)
// With start and end (ISO instants): only periods overlapping that range, past ones included (the calendar week).
export const listBlockedSlots = ({ includePast = false, start, end } = {}, signal) => {
  const params = new URLSearchParams();
  if (start && end) {
    params.set('start', start);
    params.set('end', end);
  } else if (includePast) {
    params.set('include_past', 'true');
  }
  const query = params.toString();
  return request(`/availability/blocked-slots${query ? `?${query}` : ''}`, { signal });
};

export const createBlockedSlot = ({ startAt, endAt, reason }) =>
  request('/availability/blocked-slots', {
    method: 'POST',
    body: { start_at: startAt, end_at: endAt, ...(reason ? { reason } : {}) },
  });

export const deleteBlockedSlot = (id) => request(`/availability/blocked-slots/${id}`, { method: 'DELETE' });

// ---- admin
export const getAdminStats = ({ dateFrom, dateTo } = {}, signal) => {
  const params = new URLSearchParams();
  if (dateFrom) params.set('date_from', dateFrom);
  if (dateTo) params.set('date_to', dateTo);
  const query = params.toString();
  return request(`/admin/stats${query ? `?${query}` : ''}`, { signal });
};

export const listAdminAppointments = (
  { providerId, customerId, status, dateFrom, dateTo, skip = 0, limit = 20 } = {},
  signal,
) => {
  const params = new URLSearchParams({ skip, limit });
  if (providerId) params.set('provider_id', providerId);
  if (customerId) params.set('customer_id', customerId);
  if (status) params.set('status', status);
  if (dateFrom) params.set('date_from', dateFrom);
  if (dateTo) params.set('date_to', dateTo);
  return request(`/admin/appointments?${params}`, { signal });
};
