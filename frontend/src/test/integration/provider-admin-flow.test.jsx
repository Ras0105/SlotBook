// The provider and admin stories against a REAL backend (no mocks):
//   sign up -> become a provider -> set hours -> a customer books -> block time (clash, then success) -> remove
//   hours -> edit the profile -> (optional) an admin looks at the numbers and the booking list.
//
// The admin part needs an existing admin account, because the API deliberately has no way to create one:
//   python -m app.scripts.create_admin --email admin@example.com
//   VITE_TEST_ADMIN_EMAIL=admin@example.com VITE_TEST_ADMIN_PASSWORD=... npm run test:integration
// Without those variables the admin test is skipped.
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it } from 'vitest';
import App from '../../App';
import { API_URL } from '../../api/client';
import { AuthProvider } from '../../auth/AuthContext';
import { WEEKDAYS, addDays, todayIn } from '../../lib/time';

const RUN = Date.now();
const TZ = 'Asia/Kolkata';
const TOMORROW = addDays(todayIn(TZ), 1);
const WEEKDAY = WEEKDAYS[(new Date(`${TOMORROW}T12:00:00Z`).getUTCDay() + 6) % 7]; // 0 = Monday, like the API
const SERVICE = `Provider Flow Clinic ${RUN}`;
const RENAMED = `${SERVICE} Plus`;
const PASSWORD = 'integration-pass-1';
const ADMIN_EMAIL = import.meta.env.VITE_TEST_ADMIN_EMAIL;
const ADMIN_PASSWORD = import.meta.env.VITE_TEST_ADMIN_PASSWORD;

async function raw(path, { method = 'GET', body, token, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: form ? new URLSearchParams(form).toString() : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function newUser(label) {
  const email = `${label}.${RUN}@example.com`;
  await raw('/auth/register', { method: 'POST', body: { name: label, email, password: PASSWORD } });
  const { data } = await raw('/auth/login', { method: 'POST', form: { username: email, password: PASSWORD } });
  return { email, token: data.access_token };
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const change = (el, value) => fireEvent.change(el, { target: { value } });

beforeAll(async () => {
  const health = await fetch(`${API_URL}/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Backend not reachable at ${API_URL}. Start it first (see frontend/README.md).`);
});

describe('provider flow against the real backend', () => {
  it('signs up, becomes a provider, sets hours, blocks time and edits the profile', async () => {
    const user = userEvent.setup();

    // 1. Sign up as a customer through the form.
    renderAt('/register');
    await user.type(screen.getByLabelText('Name'), 'Dr Flow');
    await user.type(screen.getByLabelText('Email'), `doctor.${RUN}@example.com`);
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Book an appointment' })).toBeInTheDocument();

    // 2. Become a provider: the menu changes with the role.
    await user.click(screen.getByRole('link', { name: 'Become a provider' }));
    await user.type(await screen.findByLabelText('What do you offer?'), SERVICE);
    await user.selectOptions(screen.getByLabelText('Your timezone'), TZ);
    await user.click(screen.getByRole('button', { name: 'Create my profile' }));
    expect(await screen.findByRole('heading', { name: 'Provider dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Become a provider' })).not.toBeInTheDocument();

    // 3. Add working hours for tomorrow's weekday: 09:00-12:00.
    await screen.findByText(/customers cannot book you/);
    await user.selectOptions(screen.getByLabelText('Day'), WEEKDAY);
    change(screen.getByLabelText('From'), '09:00');
    change(screen.getByLabelText('To'), '12:00');
    await user.click(screen.getByRole('button', { name: 'Add hours' }));
    const hours = await screen.findByRole('list', { name: 'Working hours' });
    expect(within(hours).getByText('9:00 am to 12:00 pm')).toBeInTheDocument();

    // The public side now offers slots (09:00 Kolkata = 03:30 UTC).
    const found = await raw(`/providers?search=${encodeURIComponent(SERVICE)}`);
    const providerId = found.data[0].id;
    const slotsOf = async () => (await raw(`/providers/${providerId}/slots?date=${TOMORROW}`)).data.slots.map((s) => s.start_at);
    expect((await slotsOf()).length).toBe(6);

    // 4. A customer books 09:00, so blocking that time must be refused.
    const customer = await newUser('patient');
    const booking = await raw('/appointments', {
      method: 'POST',
      token: customer.token,
      body: { provider_id: providerId, start_at: `${TOMORROW}T03:30:00Z` },
    });
    expect(booking.status).toBe(201);

    await user.click(screen.getByRole('tab', { name: 'Time off' }));
    await screen.findByText('No time off planned');
    change(screen.getByLabelText('From date'), TOMORROW);
    change(screen.getByLabelText('From time'), '09:00');
    change(screen.getByLabelText('To time'), '10:00');
    await user.click(screen.getByRole('button', { name: 'Add time off' }));
    expect(await screen.findByText(/Existing appointments overlap this period/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open your appointments' })).toBeInTheDocument();

    // 5. A free hour (10:00-11:00) can be blocked, and the public slots lose it.
    change(screen.getByLabelText('From time'), '10:00');
    change(screen.getByLabelText('To time'), '11:00');
    await user.type(screen.getByLabelText('Reason (optional)'), 'Lunch');
    await user.click(screen.getByRole('button', { name: 'Add time off' }));
    expect(await screen.findByText(/Time off added/)).toBeInTheDocument();
    const offList = screen.getByRole('list', { name: 'Time off' });
    expect(within(offList).getByText('Lunch')).toBeInTheDocument();
    expect(await slotsOf()).not.toContain(`${TOMORROW}T04:30:00Z`); // 10:00 Kolkata

    // ...and removing it frees the time again.
    await user.click(within(offList).getByRole('button', { name: /Remove time off/ }));
    expect(await screen.findByText(/That time can be booked again/)).toBeInTheDocument();
    expect(await slotsOf()).toContain(`${TOMORROW}T04:30:00Z`);

    // 6. Edit the profile.
    await user.click(screen.getByRole('tab', { name: 'Profile' }));
    const name = await screen.findByLabelText('What do you offer?');
    await user.clear(name);
    await user.type(name, RENAMED);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
    expect((await raw(`/providers/${providerId}`)).data.service_name).toBe(RENAMED);

    // 7. Remove the working hours: customers can no longer see slots.
    await user.click(screen.getByRole('tab', { name: 'Working hours' }));
    await user.click(await screen.findByRole('button', { name: `Remove ${WEEKDAY} hours` }));
    await screen.findByText(/customers cannot book you/);
    expect((await slotsOf()).length).toBe(0);
  });
});

describe.skipIf(!ADMIN_EMAIL || !ADMIN_PASSWORD)('admin flow against the real backend', () => {
  it('logs in as an admin and sees the numbers and the booking list', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    await user.type(screen.getByLabelText('Email'), ADMIN_EMAIL);
    await user.type(screen.getByLabelText('Password'), ADMIN_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    await user.click(await screen.findByRole('link', { name: 'Admin' }));
    expect(await screen.findByRole('heading', { name: 'Admin overview' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Totals')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'All appointments' }));
    expect(await screen.findByRole('heading', { name: 'All appointments' })).toBeInTheDocument();
    expect(await screen.findAllByRole('row')).not.toHaveLength(0);
  });
});
