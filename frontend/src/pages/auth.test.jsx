import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import * as api from '../api';
import { ApiError } from '../api/client';
import { CUSTOMER, renderApp } from '../test/utils';

describe('protected pages', () => {
  it('sends a logged-out visitor to log in, then back to the page they wanted', async () => {
    renderApp('/appointments');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/login');

    api.login.mockResolvedValue('tok');
    api.getMe.mockResolvedValue(CUSTOMER);
    api.getProvider.mockResolvedValue({});
    api.listMyAppointments.mockResolvedValue([]);
    await userEvent.type(screen.getByLabelText('Email'), 'asha@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(api.login).toHaveBeenCalledWith({ email: 'asha@example.com', password: 'correct-horse' });
    expect(await screen.findByRole('heading', { name: 'My appointments' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/appointments');
    expect(screen.getByText('Asha Rao')).toBeInTheDocument();
  });
});

describe('log in form', () => {
  it('says "wrong email or password" on a 401', async () => {
    renderApp('/login');
    api.login.mockRejectedValue(new ApiError(401, 'Invalid credentials'));
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'nope-nope');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.');
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled(); // can try again
  });

  it('tells the user how long a lockout lasts (429)', async () => {
    renderApp('/login');
    api.login.mockRejectedValue(new ApiError(429, 'Too many failed login attempts.', { retryAfter: 300 }));
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'nope-nope');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 5 minutes');
  });
});

describe('sign up form', () => {
  it('checks the fields before calling the server', async () => {
    renderApp('/register');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByText('Enter your name.')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(api.register).not.toHaveBeenCalled();
  });

  it('shows "already exists" under the email field on a 409', async () => {
    renderApp('/register');
    api.register.mockRejectedValue(new ApiError(409, 'Email already registered'));
    await userEvent.type(screen.getByLabelText('Name'), 'Asha Rao');
    await userEvent.type(screen.getByLabelText('Email'), 'asha@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'long-enough-1');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/account with this email already exists/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('creates the account, logs in and goes to the providers page', async () => {
    api.register.mockResolvedValue(CUSTOMER);
    api.login.mockResolvedValue('tok');
    api.getMe.mockResolvedValue(CUSTOMER);
    api.listProviders.mockResolvedValue([]);
    renderApp('/register');
    await userEvent.type(screen.getByLabelText('Name'), 'Asha Rao');
    await userEvent.type(screen.getByLabelText('Email'), 'asha@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'long-enough-1');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(api.register).toHaveBeenCalledWith({ name: 'Asha Rao', email: 'asha@example.com', password: 'long-enough-1' });
    expect(await screen.findByRole('heading', { name: 'Book an appointment' })).toBeInTheDocument();
    expect(screen.getByText('Asha Rao')).toBeInTheDocument();
  });
});
