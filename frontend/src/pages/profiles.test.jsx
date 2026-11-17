import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { ApiError } from '../api/client';
import { CUSTOMER, PROVIDER, PROVIDER_USER, renderApp, slotsResponse } from '../test/utils';

// jsdom cannot decode or draw pictures, so the resizing step is replaced; the file checks stay real.
vi.mock('../lib/image', async (importOriginal) => ({
  ...(await importOriginal()),
  squareThumbnail: vi.fn(async () => new Blob(['jpeg-bytes'], { type: 'image/jpeg' })),
}));

const change = (el, value) => fireEvent.change(el, { target: { value } });
const location = () => screen.getByTestId('location').textContent;

const DENTIST = {
  ...PROVIDER,
  id: 2,
  service_name: 'Bright Smiles',
  category: 'dentist',
  description: 'Family dentistry in the heart of town.',
  photo_url: '/providers/2/photo?v=1',
  rating_avg: 4.5,
  review_count: 12,
};

describe('provider list: details and category chips', () => {
  it('shows each provider’s photo, category, description and rating', async () => {
    api.listProviders.mockResolvedValue([DENTIST, { ...PROVIDER, id: 3, service_name: 'No Frills' }]);
    renderApp('/providers');
    const link = await screen.findByRole('link', { name: /Bright Smiles/ });
    expect(within(link).getByText(/Dentist\. 30 minute appointments, Kolkata time/)).toBeInTheDocument();
    expect(within(link).getByText('Family dentistry in the heart of town.')).toBeInTheDocument();
    expect(within(link).getByRole('img', { name: '4.5 out of 5, 12 reviews' })).toBeInTheDocument();
    expect(link.querySelector('img.provider-avatar')).toHaveAttribute('src', expect.stringContaining('/providers/2/photo?v=1'));

    const plain = screen.getByRole('link', { name: /No Frills/ });
    expect(within(plain).getByText('No reviews yet')).toBeInTheDocument();
    expect(plain.querySelector('img')).toBeNull(); // initials instead of a picture
  });

  it('offers a chip for every category and filters when one is chosen', async () => {
    api.listProviders.mockResolvedValue([DENTIST]);
    renderApp('/providers');
    await screen.findByRole('link', { name: /Bright Smiles/ });

    const group = screen.getByRole('group', { name: 'Filter by category' });
    expect(within(group).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    ['Dentist', 'Doctor', 'Therapist', 'Tutor', 'Fitness', 'Salon and barber', 'Legal', 'Consultant', 'Other'].forEach((name) =>
      expect(within(group).getByRole('button', { name })).toBeInTheDocument(),
    );

    await userEvent.click(within(group).getByRole('button', { name: 'Dentist' }));
    await waitFor(() =>
      expect(api.listProviders).toHaveBeenLastCalledWith({ search: '', category: 'dentist', skip: 0, limit: 11 }, expect.anything()),
    );
    expect(location()).toBe('/providers?category=dentist');
    expect(within(group).getByRole('button', { name: 'Dentist' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(within(group).getByRole('button', { name: 'All' }));
    await waitFor(() => expect(location()).toBe('/providers'));
    expect(api.listProviders).toHaveBeenLastCalledWith({ search: '', skip: 0, limit: 11 }, expect.anything());
  });

  it('starts from the category in the address, so links and refresh keep the filter', async () => {
    api.listProviders.mockResolvedValue([DENTIST]);
    renderApp('/providers?category=tutor');
    await screen.findByRole('link', { name: /Bright Smiles/ });
    expect(api.listProviders).toHaveBeenCalledWith({ search: '', category: 'tutor', skip: 0, limit: 11 }, expect.anything());
    expect(screen.getByRole('button', { name: 'Tutor' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('ignores a category it does not know', async () => {
    api.listProviders.mockResolvedValue([DENTIST]);
    renderApp('/providers?category=wizard');
    await screen.findByRole('link', { name: /Bright Smiles/ });
    expect(api.listProviders).toHaveBeenCalledWith({ search: '', skip: 0, limit: 11 }, expect.anything());
  });

  it('keeps the category while searching, and goes back to page 1 when the category changes', async () => {
    api.listProviders.mockResolvedValue([DENTIST]);
    renderApp('/providers?category=dentist&page=3');
    await screen.findByRole('link', { name: /Bright Smiles/ });

    await userEvent.type(screen.getByRole('searchbox'), 'sm');
    await waitFor(() => expect(location()).toBe('/providers?q=sm&category=dentist'));

    await userEvent.click(screen.getByRole('button', { name: 'Tutor' }));
    await waitFor(() => expect(location()).toBe('/providers?q=sm&category=tutor')); // no page=
  });

  it('explains an empty category and offers to show everything', async () => {
    api.listProviders.mockResolvedValue([]);
    renderApp('/providers?category=legal');
    expect(await screen.findByRole('heading', { name: 'No legal providers yet' })).toBeInTheDocument();
    api.listProviders.mockResolvedValue([DENTIST]);
    await userEvent.click(screen.getByRole('button', { name: 'Show all categories' }));
    expect(await screen.findByRole('link', { name: /Bright Smiles/ })).toBeInTheDocument();
    expect(location()).toBe('/providers');
  });
});

describe('provider page: profile and reviews', () => {
  const REVIEWS = [
    { id: 2, appointment_id: 9, provider_id: 2, rating: 4, comment: 'Quick and painless', reviewer_name: 'Alice S.', created_at: '2030-01-05T10:00:00Z' },
    { id: 1, appointment_id: 8, provider_id: 2, rating: 5, comment: null, reviewer_name: 'Bob', created_at: '2030-01-04T10:00:00Z' },
  ];

  function open(provider = DENTIST, reviews = REVIEWS) {
    api.getProvider.mockResolvedValue(provider);
    api.getSlots.mockResolvedValue(slotsResponse([]));
    api.listProviderReviews.mockResolvedValue(reviews);
    return renderApp('/providers/2');
  }

  it('shows the description, category, rating and the reviews', async () => {
    open();
    expect(await screen.findByRole('heading', { name: 'Bright Smiles' })).toBeInTheDocument();
    expect(screen.getByText('Family dentistry in the heart of town.')).toBeInTheDocument();
    expect(screen.getByText(/Dentist\. 30 minute appointments/)).toBeInTheDocument();

    const reviews = await screen.findByRole('region', { name: 'Reviews' });
    expect(within(reviews).getByRole('img', { name: '4.5 out of 5, 12 reviews' })).toBeInTheDocument();
    expect(within(reviews).getByText('Alice S.')).toBeInTheDocument();
    expect(within(reviews).getByText('Quick and painless')).toBeInTheDocument();
    expect(within(reviews).getByRole('img', { name: '4 out of 5' })).toBeInTheDocument();
    expect(within(reviews).getByText('Bob')).toBeInTheDocument();
    expect(api.listProviderReviews).toHaveBeenCalledWith(2, { skip: 0, limit: 11 }, expect.anything());
    expect(within(reviews).queryByRole('button', { name: 'Show more reviews' })).not.toBeInTheDocument();
  });

  it('says so when there are no reviews yet', async () => {
    open({ ...DENTIST, rating_avg: null, review_count: 0, description: null }, []);
    const reviews = await screen.findByRole('region', { name: 'Reviews' });
    expect(await within(reviews).findByText(/None yet/)).toBeInTheDocument();
    expect(within(reviews).getByText('No reviews yet')).toBeInTheDocument();
  });

  it('loads more reviews on request', async () => {
    const many = (from, n) =>
      Array.from({ length: n }, (_, i) => ({ ...REVIEWS[0], id: from + i, reviewer_name: `Person ${from + i}` }));
    open(DENTIST, many(1, 11)); // 11 back = a page of 10 and "there is more"
    const reviews = await screen.findByRole('region', { name: 'Reviews' });
    expect(await within(reviews).findAllByRole('listitem')).toHaveLength(10);

    api.listProviderReviews.mockResolvedValue(many(11, 2));
    await userEvent.click(within(reviews).getByRole('button', { name: 'Show more reviews' }));
    await waitFor(() => expect(within(reviews).getAllByRole('listitem')).toHaveLength(12));
    expect(api.listProviderReviews).toHaveBeenLastCalledWith(2, { skip: 10, limit: 11 });
    expect(within(reviews).queryByRole('button', { name: 'Show more reviews' })).not.toBeInTheDocument();
  });

  it('offers a retry when reviews cannot be loaded, without breaking the booking page', async () => {
    api.getProvider.mockResolvedValue(DENTIST);
    api.getSlots.mockResolvedValue(slotsResponse([]));
    api.listProviderReviews.mockRejectedValue(new ApiError(0, "Can't reach the server."));
    renderApp('/providers/2');
    const reviews = await screen.findByRole('region', { name: 'Reviews' });
    expect(await within(reviews).findByRole('alert')).toHaveTextContent("Can't reach the server");
    expect(screen.getByRole('heading', { name: 'Bright Smiles' })).toBeInTheDocument();
    api.listProviderReviews.mockResolvedValue(REVIEWS);
    await userEvent.click(within(reviews).getByRole('button', { name: 'Try again' }));
    expect(await within(reviews).findByText('Alice S.')).toBeInTheDocument();
  });
});

describe('provider profile form: category, description and photo', () => {
  function dashboard(provider = PROVIDER) {
    api.getMyProvider.mockResolvedValue(provider);
    api.listAvailability.mockResolvedValue([]);
    api.listBlockedSlots.mockResolvedValue([]);
    return renderApp('/dashboard?tab=profile', { user: PROVIDER_USER });
  }

  it('saves the category and description with the rest of the profile', async () => {
    dashboard({ ...PROVIDER, category: 'dentist', description: 'Old text' });
    expect(await screen.findByLabelText('Category')).toHaveValue('dentist');
    expect(screen.getByLabelText('Short description (optional)')).toHaveValue('Old text');

    api.updateMyProvider.mockResolvedValue({ ...PROVIDER, category: 'tutor', description: 'New text' });
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'tutor');
    change(screen.getByLabelText('Short description (optional)'), '  New text ');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
    expect(api.updateMyProvider).toHaveBeenCalledWith({
      serviceName: 'General Checkup',
      durationMinutes: 30,
      timezone: 'Asia/Kolkata',
      description: 'New text',
      category: 'tutor',
    });
  });

  it('clears the description by sending an empty one', async () => {
    dashboard({ ...PROVIDER, description: 'Old text' });
    api.updateMyProvider.mockResolvedValue(PROVIDER);
    change(await screen.findByLabelText('Short description (optional)'), '');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Profile saved.');
    expect(api.updateMyProvider).toHaveBeenCalledWith(expect.objectContaining({ description: '' }));
  });

  it('shows a counter and an error for a description that is too long', async () => {
    dashboard();
    const box = await screen.findByLabelText('Short description (optional)');
    expect(box).toHaveAttribute('maxLength', '500');
    expect(screen.getByText(/0 of 500 characters/)).toBeInTheDocument();
    change(box, 'hello');
    expect(screen.getByText(/5 of 500 characters/)).toBeInTheDocument();
  });

  it('uploads a photo (shrunk first) and shows it', async () => {
    dashboard();
    await screen.findByRole('heading', { name: 'Photo or logo' });
    api.uploadMyPhoto.mockResolvedValue({ ...PROVIDER, photo_url: '/providers/1/photo?v=5' });

    const file = new File(['x'], 'me.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('Choose a photo or logo'), file);

    expect(await screen.findByText('Photo saved.')).toBeInTheDocument();
    expect(api.uploadMyPhoto).toHaveBeenCalledTimes(1);
    const sent = api.uploadMyPhoto.mock.calls[0][0];
    expect(sent).toBeInstanceOf(Blob);
    expect(sent.type).toBe('image/jpeg'); // the shrunk version, not the original file
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeInTheDocument();
    expect(document.querySelector('img.provider-avatar')).toHaveAttribute('src', expect.stringContaining('/providers/1/photo?v=5'));
  });

  it('refuses a file that is not a picture without calling the server', async () => {
    dashboard();
    await screen.findByRole('heading', { name: 'Photo or logo' });
    const input = screen.getByLabelText('Choose a photo or logo');
    fireEvent.change(input, { target: { files: [new File(['x'], 'notes.pdf', { type: 'application/pdf' })] } });
    expect(await screen.findByText('Use a JPEG, PNG or WebP picture.')).toBeInTheDocument();
    expect(api.uploadMyPhoto).not.toHaveBeenCalled();
  });

  it('shows the server’s reason when the upload is rejected', async () => {
    dashboard();
    await screen.findByRole('heading', { name: 'Photo or logo' });
    api.uploadMyPhoto.mockRejectedValue(new ApiError(413, 'The photo is too large (512 KB at most)'));
    await userEvent.upload(screen.getByLabelText('Choose a photo or logo'), new File(['x'], 'me.png', { type: 'image/png' }));
    expect(await screen.findByText('The photo is too large (512 KB at most)')).toBeInTheDocument();
  });

  it('removes the photo', async () => {
    dashboard({ ...PROVIDER, photo_url: '/providers/1/photo?v=5' });
    api.deleteMyPhoto.mockResolvedValue(PROVIDER);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove photo' }));
    expect(await screen.findByText('Photo removed.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove photo' })).not.toBeInTheDocument();
  });

  it('lets a new provider choose a category and describe themselves', async () => {
    renderApp('/become-provider', { user: CUSTOMER });
    await screen.findByRole('heading', { name: 'Become a provider' });
    api.createProvider.mockResolvedValue(PROVIDER);
    api.getMe.mockResolvedValue({ ...CUSTOMER, role: 'provider' });
    api.getMyProvider.mockResolvedValue(PROVIDER);
    api.listAvailability.mockResolvedValue([]);

    await userEvent.type(screen.getByLabelText('What do you offer?'), 'Maths lessons');
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'tutor');
    await userEvent.type(screen.getByLabelText('Short description (optional)'), 'GCSE and A level');
    await userEvent.click(screen.getByRole('button', { name: 'Create my profile' }));

    await waitFor(() =>
      expect(api.createProvider).toHaveBeenCalledWith(
        expect.objectContaining({ serviceName: 'Maths lessons', category: 'tutor', description: 'GCSE and A level' }),
      ),
    );
  });
});
