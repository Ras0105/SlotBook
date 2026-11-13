import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, parseValidationDetail, request, setUnauthorizedHandler, tokenStore } from './client';
import { friendlyError } from '../lib/errors';

function respond(status, body, headers = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
  localStorage.clear();
});

describe('request', () => {
  it('sends JSON with the Bearer token when logged in', async () => {
    tokenStore.set('abc');
    fetch.mockResolvedValue(respond(201, { id: 1 }));
    await request('/appointments', { method: 'POST', body: { provider_id: 1 } });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toMatch(/\/appointments$/);
    expect(init.headers.Authorization).toBe('Bearer abc');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ provider_id: 1 });
  });

  it('sends login as a form, with no token', async () => {
    tokenStore.set('abc');
    fetch.mockResolvedValue(respond(200, { access_token: 't' }));
    await request('/auth/login', { method: 'POST', form: { username: 'a@b.co', password: 'pw pw' }, auth: false });
    const init = fetch.mock.calls[0][1];
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.body).toBe('username=a%40b.co&password=pw+pw');
  });

  it('turns a 422 list into readable messages and per-field errors', async () => {
    fetch.mockResolvedValue(
      respond(422, { detail: [{ loc: ['body', 'password'], msg: 'String should have at least 8 characters' }] }),
    );
    const error = await request('/auth/register', { method: 'POST', body: {} }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(422);
    expect(error.fields.password).toMatch(/at least 8/);
  });

  it('keeps a string detail and reads Retry-After', async () => {
    fetch.mockResolvedValue(respond(429, { detail: 'Too many failed login attempts.' }, { 'Retry-After': '300' }));
    const error = await request('/auth/login', { method: 'POST', form: {}, auth: false }).catch((e) => e);
    expect(error.status).toBe(429);
    expect(error.retryAfter).toBe(300);
  });

  it('reports an unreachable server as status 0', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const error = await request('/providers').catch((e) => e);
    expect(error.status).toBe(0);
    expect(error.message).toMatch(/can't reach the server/i);
  });

  it('ends the session on a 401 that carried a token', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    tokenStore.set('old');
    fetch.mockResolvedValue(respond(401, { detail: 'Invalid or expired token' }));
    await request('/appointments/me').catch(() => {});
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('does NOT end a session for a wrong-password 401 (no token was sent)', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    fetch.mockResolvedValue(respond(401, { detail: 'Invalid credentials' }));
    await request('/auth/login', { method: 'POST', form: {}, auth: false }).catch(() => {});
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

describe('parseValidationDetail', () => {
  it('strips the "Value error, " prefix pydantic adds', () => {
    const { message } = parseValidationDetail([{ loc: ['body', 'timezone'], msg: 'Value error, unknown timezone' }]);
    expect(message).toBe('timezone: unknown timezone');
  });
});

describe('friendlyError', () => {
  it('words a slot clash as "someone just booked that time"', () => {
    const e = new ApiError(409, 'This slot is no longer available');
    expect(friendlyError(e, 'book')).toMatch(/just booked that time/);
  });
  it('keeps the real message for other 409s when rescheduling', () => {
    const e = new ApiError(409, 'This appointment has already started');
    expect(friendlyError(e, 'reschedule')).toBe('This appointment has already started');
  });
  it('tells people how long to wait after a lockout', () => {
    expect(friendlyError(new ApiError(429, 'x', { retryAfter: 300 }), 'login')).toMatch(/5 minutes/);
  });
  it('words 401 differently on the login form', () => {
    expect(friendlyError(new ApiError(401, 'Invalid credentials'), 'login')).toBe('Wrong email or password.');
    expect(friendlyError(new ApiError(401, 'expired'))).toMatch(/log in again/i);
  });
  it('suggests retrying on 503', () => {
    expect(friendlyError(new ApiError(503, 'busy', { retryAfter: 2 }))).toMatch(/2 seconds/);
  });
});
