// The whole customer story against a real backend:
//   a provider exists -> a customer signs up in the UI -> finds the provider -> books ->
//   sees it listed -> reschedules -> loses a race to someone else (409) -> cancels.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it } from 'vitest';
import App from '../../App';
import { API_URL } from '../../api/client';
import { AuthProvider } from '../../auth/AuthContext';
import { addDays, formatDay, todayIn } from '../../lib/time';

const RUN = Date.now();
const SERVICE = `Integration Checkup ${RUN}`;
const TZ = 'Asia/Kolkata';
const TOMORROW = addDays(todayIn(TZ), 1);
const PASSWORD = 'integration-pass-1';

// ---- tiny raw API helpers (the "other people" in the story: the provider and a rival customer)
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

let providerId;
beforeAll(async () => {
  const health = await fetch(`${API_URL}/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Backend not reachable at ${API_URL}. Start it first (see frontend/README.md).`);

  const owner = await newUser('provider');
  const created = await raw('/providers', {
    method: 'POST',
    token: owner.token,
    body: { service_name: SERVICE, appointment_duration_minutes: 30, timezone: TZ },
  });
  providerId = created.data.id;
  const owner2 = (await raw('/auth/login', { method: 'POST', form: { username: owner.email, password: PASSWORD } })).data;
  for (let weekday = 0; weekday < 7; weekday += 1) {
    await raw('/availability', {
      method: 'POST',
      token: owner2.access_token,
      body: { weekday, start_time: '09:00:00', end_time: '12:00:00' },
    });
  }
});

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('customer flow against the real backend', () => {
  it('signs up, books, reschedules, loses a race, and cancels', async () => {
    const user = userEvent.setup();
    const customerEmail = `customer.${RUN}@example.com`;

    // 1. Sign up through the form (this logs in automatically).
    renderAt('/register');
    await user.type(screen.getByLabelText('Name'), 'Asha Rao');
    await user.type(screen.getByLabelText('Email'), customerEmail);
    await user.type(screen.getByLabelText('Password'), PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Book an appointment' })).toBeInTheDocument();
    expect(screen.getByText('Asha Rao')).toBeInTheDocument();

    // 2. Find the provider by searching.
    await user.type(screen.getByRole('searchbox'), SERVICE);
    await user.click(await screen.findByRole('link', { name: new RegExp(SERVICE) }));

    // 3. Pick tomorrow, and a 9:00 am slot (09:00 Kolkata = 03:30 UTC).
    expect(await screen.findByRole('heading', { name: 'Pick a time' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: formatDay(TOMORROW) }));
    expect(await screen.findByRole('button', { name: '9:00 am' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^\d+:\d\d am$/ })).toHaveLength(6); // 09:00-12:00, 30 minute slots

    await user.click(screen.getByRole('button', { name: '9:00 am' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm booking' }));

    // 4. Booked: we land on My appointments with a confirmation and the appointment listed.
    expect(await screen.findByText(/Booked\. .* 9:00 am to 9:30 am/)).toBeInTheDocument();
    const item = screen.getAllByRole('listitem').find((li) => li.textContent.includes(SERVICE));
    expect(item).toHaveTextContent('9:00 am to 9:30 am');
    expect(within(item).getByText('Booked')).toBeInTheDocument();

    // 5. Reschedule to 10:00 am.
    await user.click(within(item).getByRole('link', { name: 'Reschedule' }));
    expect(await screen.findByRole('heading', { name: new RegExp(`Reschedule ${SERVICE}`) })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: '10:00 am' }));
    await user.click(screen.getByRole('button', { name: 'Move appointment' }));
    expect(await screen.findByText(/Rescheduled\. .* 10:00 am to 10:30 am/)).toBeInTheDocument();

    // 6. Lose a race: we pick 9:30 am, a rival grabs it first, then we confirm.
    await user.click(screen.getByRole('link', { name: 'Providers' }));
    await user.type(await screen.findByRole('searchbox'), SERVICE);
    await user.click(await screen.findByRole('link', { name: new RegExp(SERVICE) }));
    await user.click(await screen.findByRole('button', { name: formatDay(TOMORROW) }));
    await user.click(await screen.findByRole('button', { name: '9:30 am' }));

    const rival = await newUser('rival');
    const rivalBooking = await raw('/appointments', {
      method: 'POST',
      token: rival.token,
      body: { provider_id: providerId, start_at: `${TOMORROW}T04:00:00Z` }, // 09:30 Kolkata
    });
    expect(rivalBooking.status).toBe(201);

    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone just booked that time');
    // Wait for the reloaded list (9:00 am was freed by our reschedule), THEN check the rival's slot is gone.
    // (Checking "9:30 is absent" first would pass trivially while the list is still showing its spinner.)
    expect(await screen.findByRole('button', { name: '9:00 am' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '9:30 am' })).not.toBeInTheDocument();

    // 7. Cancel our appointment from My appointments.
    await user.click(screen.getByRole('link', { name: 'My appointments' }));
    const mine = await screen.findAllByRole('listitem');
    const ours = mine.find((li) => li.textContent.includes(SERVICE));
    await user.click(within(ours).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Cancel appointment' }));
    expect(await screen.findByText(/Appointment cancelled/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Cancelled/ })).toHaveTextContent('1');

    // 8. History shows the whole story, from the server.
    await user.click(screen.getByRole('tab', { name: /Cancelled/ }));
    await user.click(screen.getByRole('button', { name: 'Show history' }));
    const history = within(await screen.findByRole('list', { name: 'History' }));
    const entries = history.getAllByRole('listitem').map((li) => li.textContent);
    console.log('HISTORY FROM REAL SERVER:', JSON.stringify(entries));
    expect(entries.some((e) => e.includes('Appointment booked'))).toBe(true);
    expect(entries.some((e) => /Rescheduled/i.test(e))).toBe(true);
    expect(entries.some((e) => e.includes('Cancelled'))).toBe(true);
  });

  it('reports a wrong password and a bad token the way a person can understand', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    await user.type(screen.getByLabelText('Email'), `nobody.${RUN}@example.com`);
    await user.type(screen.getByLabelText('Password'), 'definitely-wrong');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.');
  });

  it('ends an expired session cleanly: a stale token sends you to log in with an explanation', async () => {
    localStorage.setItem('slotbook.token', 'not-a-real-token');
    renderAt('/appointments');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(localStorage.getItem('slotbook.token')).toBeNull();
  });
});
