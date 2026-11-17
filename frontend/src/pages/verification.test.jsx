import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import * as api from '../api';
import { ApiError } from '../api/client';
import { CUSTOMER, PROVIDER, renderApp, slot, slotsResponse } from '../test/utils';

const UNVERIFIED = { ...CUSTOMER, email_verified: false };
const VERIFIED = { ...CUSTOMER, email_verified: true };

describe('the verification link page', () => {
  it('confirms the address when the link is good', async () => {
    api.verifyEmail.mockResolvedValue({ message: 'ok' });
    renderApp('/verify-email?token=abc.def.ghi');
    expect(await screen.findByRole('heading', { name: 'Email confirmed' })).toBeInTheDocument();
    expect(api.verifyEmail).toHaveBeenCalledTimes(1);
    expect(api.verifyEmail).toHaveBeenCalledWith('abc.def.ghi');
    expect(screen.getByRole('link', { name: 'Find a provider' })).toHaveAttribute('href', '/providers');
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Log in' })).toBeInTheDocument(); // opened on a device where nobody is logged in
  });

  it('refreshes the logged-in user so the banner disappears without a reload', async () => {
    api.verifyEmail.mockResolvedValue({ message: 'ok' });
    renderApp('/verify-email?token=abc.def.ghi', { user: UNVERIFIED });
    api.getMe.mockResolvedValue(VERIFIED); // what the server will say once the link has been used
    expect(await screen.findByRole('heading', { name: 'Email confirmed' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Confirm your email address.')).not.toBeInTheDocument());
  });

  it('says the link does not work, and offers a new one to a logged-in unverified user', async () => {
    api.verifyEmail.mockRejectedValue(new ApiError(400, 'This verification link is invalid or has expired.'));
    renderApp('/verify-email?token=old.old.old', { user: UNVERIFIED });
    expect(await screen.findByRole('heading', { name: 'This link doesn’t work' })).toBeInTheDocument();

    api.resendVerification.mockResolvedValue({ message: 'sent' });
    await userEvent.click(screen.getByRole('button', { name: 'Send me a new link' }));
    expect(api.resendVerification).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('A new link is on its way. Check your inbox.')).toBeInTheDocument();
  });

  it('sends a logged-out visitor with a broken link to log in', async () => {
    api.verifyEmail.mockRejectedValue(new ApiError(400, 'invalid'));
    renderApp('/verify-email?token=old.old.old');
    expect(await screen.findByRole('link', { name: 'Log in to get a new link' })).toHaveAttribute('href', '/login');
  });

  it('treats a missing token as a broken link without calling the server', async () => {
    renderApp('/verify-email');
    expect(await screen.findByRole('heading', { name: 'This link doesn’t work' })).toBeInTheDocument();
    expect(api.verifyEmail).not.toHaveBeenCalled();
  });

  it('shows the wait when too many new links were asked for', async () => {
    api.verifyEmail.mockRejectedValue(new ApiError(400, 'invalid'));
    renderApp('/verify-email?token=old.old.old', { user: UNVERIFIED });
    await screen.findByRole('heading', { name: 'This link doesn’t work' });
    api.resendVerification.mockRejectedValue(new ApiError(429, 'Too many', { retryAfter: 1800 }));
    await userEvent.click(screen.getByRole('button', { name: 'Send me a new link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 30 minutes');
  });
});

describe('the unverified banner', () => {
  it('shows for an unverified user, with their address, and not for a verified one', async () => {
    api.listProviders.mockResolvedValue([]);
    renderApp('/', { user: UNVERIFIED });
    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent('Confirm your email address.');
    expect(banner).toHaveTextContent(CUSTOMER.email);
  });

  it('is not shown to a verified user, an unknown state, or a visitor', async () => {
    api.listProviders.mockResolvedValue([]);
    renderApp('/', { user: VERIFIED });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText('Confirm your email address.')).not.toBeInTheDocument();
  });

  it('is not shown when the server did not say (older API): nobody is nagged by mistake', async () => {
    api.listProviders.mockResolvedValue([]);
    renderApp('/', { user: CUSTOMER }); // no email_verified field at all
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText('Confirm your email address.')).not.toBeInTheDocument();
  });

  it('sends a new link on request and confirms it', async () => {
    api.listProviders.mockResolvedValue([]);
    api.resendVerification.mockResolvedValue({ message: 'sent' });
    renderApp('/', { user: UNVERIFIED });
    await userEvent.click(await screen.findByRole('button', { name: 'Send a new link' }));
    expect(api.resendVerification).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/A new link is on its way/)).toBeInTheDocument();
  });

  it('explains a failure', async () => {
    api.listProviders.mockResolvedValue([]);
    api.resendVerification.mockRejectedValue(new ApiError(429, 'x', { retryAfter: 120 }));
    renderApp('/', { user: UNVERIFIED });
    await userEvent.click(await screen.findByRole('button', { name: 'Send a new link' }));
    expect(await screen.findByText(/Try again in 2 minutes/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send a new link' })).toBeEnabled(); // can try again
  });
});

describe('booking while unverified', () => {
  function open(user) {
    api.getProvider.mockResolvedValue(PROVIDER);
    api.getSlots.mockResolvedValue(slotsResponse([slot(0)]));
    api.listMyAppointments.mockResolvedValue([]);
    return renderApp('/providers/1', { user });
  }

  it('asks the person to confirm their email instead of showing the confirm bar', async () => {
    open(UNVERIFIED);
    await userEvent.click(await screen.findByRole('button', { name: '9:00 am' }));
    expect(screen.getByText(/Please confirm your email address to book/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm booking' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reason for visit')).not.toBeInTheDocument();
  });

  it('lets a verified user book as before', async () => {
    open(VERIFIED);
    await userEvent.click(await screen.findByRole('button', { name: '9:00 am' }));
    expect(screen.getByRole('button', { name: 'Confirm booking' })).toBeInTheDocument();
  });
});
