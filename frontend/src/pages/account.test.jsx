import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { ApiError } from '../api/client';
import { CUSTOMER, PROVIDER, PROVIDER_USER, renderApp } from '../test/utils';

const type = (label, text) => userEvent.type(screen.getByLabelText(label), text);

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

describe('forgot password', () => {
  it('is reachable from the log in form, carrying the typed email along', async () => {
    renderApp('/login');
    await type('Email', 'asha@example.com');
    await userEvent.click(screen.getByRole('link', { name: 'Forgot password?' }));
    expect(await screen.findByRole('heading', { name: 'Forgot your password?' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('asha@example.com');
  });

  it('checks the email before calling the server', async () => {
    renderApp('/forgot-password');
    await type('Email', 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(api.forgotPassword).not.toHaveBeenCalled();
  });

  it('shows the same "check your email" screen whatever the server knows', async () => {
    api.forgotPassword.mockResolvedValue({ message: 'If an account exists...' });
    renderApp('/forgot-password');
    await type('Email', 'asha@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(api.forgotPassword).toHaveBeenCalledWith({ email: 'asha@example.com' });
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText(/If an account exists for/)).toHaveTextContent('asha@example.com');
  });

  it('lets the person go back and try another email', async () => {
    api.forgotPassword.mockResolvedValue({});
    renderApp('/forgot-password');
    await type('Email', 'a@b.co');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    await userEvent.click(await screen.findByRole('button', { name: 'try a different email' }));
    expect(await screen.findByRole('heading', { name: 'Forgot your password?' })).toBeInTheDocument();
  });

  it('explains a rate limit (429) with how long to wait', async () => {
    api.forgotPassword.mockRejectedValue(new ApiError(429, 'Too many reset requests.', { retryAfter: 600 }));
    renderApp('/forgot-password');
    await type('Email', 'a@b.co');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many reset requests. Try again in 10 minutes.');
  });

  it('sends a logged-in person to their profile instead', async () => {
    api.getProvider.mockResolvedValue({});
    renderApp('/forgot-password', { user: CUSTOMER });
    expect(await screen.findByRole('heading', { name: 'Asha Rao' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/profile');
  });
});

describe('reset password', () => {
  it('explains a link with no token and offers a new one', async () => {
    renderApp('/reset-password');
    expect(await screen.findByRole('heading', { name: 'This link doesn’t work' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get a new link' })).toHaveAttribute('href', '/forgot-password');
  });

  it('checks length and matching before calling the server', async () => {
    renderApp('/reset-password?token=abc');
    await type('New password', 'short');
    await type('Confirm new password', 'different');
    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(screen.getByText('The two passwords do not match.')).toBeInTheDocument();
    expect(api.resetPassword).not.toHaveBeenCalled();
  });

  it('saves the new password, then sends the person to log in with a confirmation', async () => {
    api.resetPassword.mockResolvedValue({ message: 'ok' });
    renderApp('/reset-password?token=the-token');
    await type('New password', 'brand-new-pass');
    await type('Confirm new password', 'brand-new-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(api.resetPassword).toHaveBeenCalledWith({ token: 'the-token', newPassword: 'brand-new-pass' });
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
    expect(screen.getByRole('status')).toHaveTextContent('Password reset. You were signed out on all devices. Log in with your new password.');
  });

  it('shows the "link doesn’t work" screen when the server says the token is used or expired', async () => {
    api.resetPassword.mockRejectedValue(new ApiError(400, 'This reset link is invalid or has expired. Request a new one.'));
    renderApp('/reset-password?token=old');
    await type('New password', 'brand-new-pass');
    await type('Confirm new password', 'brand-new-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByRole('heading', { name: 'This link doesn’t work' })).toBeInTheDocument();
  });

  it('can reveal the typed password with the show button', async () => {
    renderApp('/reset-password?token=abc');
    const box = screen.getByLabelText('New password');
    expect(box).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getAllByRole('button', { name: 'Show password' })[0]);
    expect(box).toHaveAttribute('type', 'text');
  });
});

describe('profile page', () => {
  const user = { ...CUSTOMER, created_at: '2026-03-10T08:00:00Z' };

  function open() {
    api.getProvider.mockResolvedValue({});
    return renderApp('/profile', { user });
  }

  it('needs a login', async () => {
    renderApp('/profile');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  it('shows who you are, and the header links to it', async () => {
    open();
    expect(await screen.findByRole('heading', { name: 'Asha Rao' })).toBeInTheDocument();
    expect(screen.getByText('Customer')).toBeInTheDocument();
    expect(screen.getByText(/Member since/)).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Asha Rao');
    expect(screen.getByLabelText('Email')).toHaveValue('asha@example.com');
    expect(screen.getByRole('link', { name: 'Asha Rao' })).toHaveAttribute('href', '/profile');
  });

  it('keeps Save disabled until something changes', async () => {
    open();
    const save = await screen.findByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Name'), ' B');
    expect(save).toBeEnabled();
  });

  it('saves a new name and the header updates at once', async () => {
    api.updateProfile.mockResolvedValue({ ...user, name: 'Asha Rao B' });
    open();
    const name = await screen.findByLabelText('Name');
    await userEvent.type(name, ' B');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(api.updateProfile).toHaveBeenCalledWith({ name: 'Asha Rao B' }); // only what changed
    expect(await screen.findByText('Profile updated.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Asha Rao B' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Asha Rao B' })).toBeInTheDocument();
  });

  it('asks for the current password when the email changes, and sends it', async () => {
    api.updateProfile.mockResolvedValue({ ...user, email: 'new@example.com' });
    open();
    const email = await screen.findByLabelText('Email');
    expect(screen.queryByLabelText('Current password', { selector: '#profile-current-password' })).not.toBeInTheDocument();
    await userEvent.clear(email);
    await userEvent.type(email, 'new@example.com');

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByText('Enter your current password to change your email.')).toBeInTheDocument();
    expect(api.updateProfile).not.toHaveBeenCalled();

    await userEvent.type(document.getElementById('profile-current-password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(api.updateProfile).toHaveBeenCalledWith({ email: 'new@example.com', currentPassword: 'password123' });
    expect(await screen.findByText('Profile updated.')).toBeInTheDocument();
  });

  it('shows "already used" under the email on a 409, and a wrong password under the password box', async () => {
    open();
    const email = await screen.findByLabelText('Email');
    await userEvent.clear(email);
    await userEvent.type(email, 'taken@example.com');
    await userEvent.type(document.getElementById('profile-current-password'), 'password123');

    api.updateProfile.mockRejectedValueOnce(new ApiError(409, 'Email already registered'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('That email is already used by another account.')).toBeInTheDocument();
    expect(email).toHaveAttribute('aria-invalid', 'true');

    api.updateProfile.mockRejectedValueOnce(new ApiError(400, 'Current password is incorrect'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Asha Rao' })).toBeInTheDocument(); // still logged in
  });

  it('discard puts the saved values back', async () => {
    open();
    const name = await screen.findByLabelText('Name');
    await userEvent.type(name, 'zzz');
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(name).toHaveValue('Asha Rao');
    expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument();
  });

  it('changes the password: checks the form, calls the API, clears the boxes', async () => {
    api.changePassword.mockResolvedValue({ message: 'Password changed.' });
    open();
    await screen.findByRole('heading', { name: 'Change password' });
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(screen.getByText('Enter your current password.')).toBeInTheDocument();
    expect(api.changePassword).not.toHaveBeenCalled();

    await type('Current password', 'old-password-1');
    await type('New password', 'brand-new-pass');
    await type('Confirm new password', 'brand-new-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(api.changePassword).toHaveBeenCalledWith({ currentPassword: 'old-password-1', newPassword: 'brand-new-pass' });
    expect(await screen.findByText(/Password changed/)).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveValue('');
  });

  it('says so on the field when the current password is wrong (and does not log out)', async () => {
    api.changePassword.mockRejectedValue(new ApiError(400, 'Current password is incorrect'));
    open();
    await screen.findByRole('heading', { name: 'Change password' });
    await type('Current password', 'wrong-wrong');
    await type('New password', 'brand-new-pass');
    await type('Confirm new password', 'brand-new-pass');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('That is not your current password.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Asha Rao' })).toBeInTheDocument();
  });

  it('points providers to the dashboard for service settings', async () => {
    api.getMyProvider.mockResolvedValue(PROVIDER);
    renderApp('/profile', { user: { ...PROVIDER_USER, created_at: '2026-01-01T00:00:00Z' } });
    expect(await screen.findByRole('link', { name: 'dashboard' })).toHaveAttribute('href', '/dashboard');
  });
});

describe('theme', () => {
  it('the header button switches to dark, remembers it, and back', async () => {
    api.listProviders.mockResolvedValue([]);
    renderApp('/providers');
    await screen.findByRole('heading', { name: 'Book an appointment' });
    expect(document.documentElement.dataset.theme).toBe('light');

    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('slotbook.theme')).toBe('dark');

    await userEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('slotbook.theme')).toBe('light');
  });

  it('starts dark when dark was saved', async () => {
    localStorage.setItem('slotbook.theme', 'dark');
    api.listProviders.mockResolvedValue([]);
    renderApp('/providers');
    await screen.findByRole('heading', { name: 'Book an appointment' });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
  });

  it('follows the device when set to "system"', async () => {
    const listeners = [];
    const query = { matches: true, addEventListener: (_, fn) => listeners.push(fn), removeEventListener: () => {} };
    vi.stubGlobal('matchMedia', () => query);
    window.matchMedia = () => query;
    try {
      api.listProviders.mockResolvedValue([]);
      renderApp('/providers');
      await screen.findByRole('heading', { name: 'Book an appointment' });
      expect(document.documentElement.dataset.theme).toBe('dark');
      query.matches = false;
      act(() => listeners.forEach((fn) => fn({ matches: false })));
      await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
    } finally {
      delete window.matchMedia;
      vi.unstubAllGlobals();
    }
  });

  it('can be chosen on the profile page too', async () => {
    api.getProvider.mockResolvedValue({});
    renderApp('/profile', { user: { ...CUSTOMER, created_at: '2026-03-10T08:00:00Z' } });
    await userEvent.click(await screen.findByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    await userEvent.click(screen.getByRole('radio', { name: 'Match my device' }));
    expect(localStorage.getItem('slotbook.theme')).toBe('system');
  });
});

describe('landing page', () => {
  it('is the home page, with calls to action for a visitor', async () => {
    api.listProviders.mockResolvedValue([]);
    renderApp('/');
    expect(await screen.findByRole('heading', { level: 1, name: /Book the right time/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Find a provider' })).toHaveAttribute('href', '/providers');
    expect(screen.getByRole('link', { name: 'Create a free account' })).toHaveAttribute('href', '/register');
  });

  it('lists a few real providers when the API answers', async () => {
    api.listProviders.mockResolvedValue([PROVIDER, { ...PROVIDER, id: 2, service_name: 'Dental Cleaning' }]);
    renderApp('/');
    const card = await screen.findByRole('link', { name: /Dental Cleaning/ });
    expect(card).toHaveAttribute('href', '/providers/2');
    expect(api.listProviders).toHaveBeenCalledWith({ limit: 3 }, expect.anything());
  });

  it('still works when the provider list fails', async () => {
    api.listProviders.mockRejectedValue(new ApiError(0, 'down'));
    renderApp('/');
    expect(await screen.findByRole('heading', { level: 1, name: /Book the right time/ })).toBeInTheDocument();
    expect(screen.queryByText('Available to book now')).not.toBeInTheDocument();
  });

  it('adapts to a logged-in customer', async () => {
    api.listProviders.mockResolvedValue([]);
    renderApp('/', { user: CUSTOMER });
    expect((await screen.findAllByRole('link', { name: 'My appointments' })).length).toBeGreaterThanOrEqual(2); // header + hero
    expect(screen.getAllByRole('link', { name: 'Become a provider' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'Create a free account' })).not.toBeInTheDocument();
  });
});
