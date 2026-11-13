import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import * as api from '../api';
import { ApiError } from '../api/client';
import { PROVIDER, renderApp } from '../test/utils';

const make = (n) => Array.from({ length: n }, (_, i) => ({ ...PROVIDER, id: i + 1, service_name: `Service ${i + 1}` }));

describe('browsing providers', () => {
  it('lists providers, each linking to its booking page', async () => {
    api.listProviders.mockResolvedValue(make(3));
    renderApp('/providers');
    const link = await screen.findByRole('link', { name: /Service 2/ });
    expect(link).toHaveAttribute('href', '/providers/2');
    expect(screen.getAllByText(/30 minute appointments, Kolkata time/)).toHaveLength(3);
    expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument(); // one page only
  });

  it('pages through results, asking for one extra row to know if there is a next page', async () => {
    api.listProviders.mockResolvedValue(make(11)); // page size 10, so 11 means "more"
    renderApp('/providers');
    expect(await screen.findAllByRole('listitem')).toHaveLength(10);
    expect(api.listProviders).toHaveBeenCalledWith({ search: '', skip: 0, limit: 11 }, expect.anything());

    api.listProviders.mockResolvedValue(make(2));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(api.listProviders).toHaveBeenLastCalledWith({ search: '', skip: 10, limit: 11 }, expect.anything()));
    expect(await screen.findByText('Page 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
  });

  it('searches after the person stops typing', async () => {
    api.listProviders.mockResolvedValue(make(1));
    renderApp('/providers');
    await screen.findByRole('link', { name: /Service 1/ });
    await userEvent.type(screen.getByRole('searchbox'), 'den');
    await waitFor(() => expect(api.listProviders).toHaveBeenLastCalledWith({ search: 'den', skip: 0, limit: 11 }, expect.anything()));
    expect(screen.getByTestId('location')).toHaveTextContent('?q=den');
  });

  it('explains an empty search and offers to clear it', async () => {
    api.listProviders.mockResolvedValue([]);
    renderApp('/providers?q=zzz');
    expect(await screen.findByRole('heading', { name: 'No providers match “zzz”' })).toBeInTheDocument();
    api.listProviders.mockResolvedValue(make(1));
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByRole('link', { name: /Service 1/ })).toBeInTheDocument();
  });

  it('shows a retry when the server cannot be reached', async () => {
    api.listProviders.mockRejectedValue(new ApiError(0, "Can't reach the server. Check your connection and that the backend is running."));
    renderApp('/providers');
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server");
    api.listProviders.mockResolvedValue(make(1));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: /Service 1/ })).toBeInTheDocument();
  });
});
