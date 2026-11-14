import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { clearProviderCache } from '../lib/providerCache';

// Component tests never touch the network: every API function is a mock the test controls.
// (Tests of api/client.js import it directly, so they are not affected.)
vi.mock('../api', () => ({
  register: vi.fn(),
  login: vi.fn(),
  getMe: vi.fn(),
  updateProfile: vi.fn(),
  changePassword: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
  listProviders: vi.fn(),
  getProvider: vi.fn(),
  getSlots: vi.fn(),
  bookAppointment: vi.fn(),
  listMyAppointments: vi.fn(),
  getAppointment: vi.fn(),
  cancelAppointment: vi.fn(),
  rescheduleAppointment: vi.fn(),
  createReview: vi.fn(),
  listProviderReviews: vi.fn(() => Promise.resolve([])), // every provider page loads reviews; most tests do not care
  createProvider: vi.fn(),
  getMyProvider: vi.fn(),
  updateMyProvider: vi.fn(),
  uploadMyPhoto: vi.fn(),
  deleteMyPhoto: vi.fn(),
  getMyCalendar: vi.fn(),
  listAvailability: vi.fn(),
  createAvailability: vi.fn(),
  updateAvailability: vi.fn(),
  deleteAvailability: vi.fn(),
  listBlockedSlots: vi.fn(),
  createBlockedSlot: vi.fn(),
  deleteBlockedSlot: vi.fn(),
  getAdminStats: vi.fn(),
  listAdminAppointments: vi.fn(),
}));

// jsdom has no scrolling; the app calls window.scrollTo on page changes.
window.scrollTo = vi.fn(() => Promise.resolve()); // like modern Chrome, which returns a Promise

afterEach(() => {
  cleanup();
  localStorage.clear();
  clearProviderCache();
  vi.resetAllMocks();
});
