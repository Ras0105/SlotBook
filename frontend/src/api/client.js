// The one place that talks to the backend. Everything else calls the functions in api/index.js.
//  - adds "Authorization: Bearer <token>" when you are logged in
//  - sends JSON, except login which the backend wants form-encoded (OAuth2 style)
//  - turns every failure into an ApiError with a message that is fine to show to a person

export const API_URL = (import.meta.env?.VITE_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');

const TOKEN_KEY = 'slotbook.token';

export const tokenStore = {
  get() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null; // storage can be blocked (private mode); then you simply stay logged out
    }
  },
  set(token) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* ignore */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

export class ApiError extends Error {
  /**
   * @param status     HTTP status, or 0 when the server could not be reached
   * @param message    text that is safe to show to the user
   * @param extra.fields      for 422: { fieldName: "what is wrong" }
   * @param extra.retryAfter  seconds from the Retry-After header (429 / 503)
   */
  constructor(status, message, { fields = {}, retryAfter = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fields = fields;
    this.retryAfter = retryAfter;
  }
}

// Called when the server says our token is no longer valid (expired, tampered, user gone).
let unauthorizedHandler = null;
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

/** FastAPI's 422 detail is a list like [{loc: ['body','email'], msg: '...'}]. Make it readable. */
export function parseValidationDetail(detail) {
  const fields = {};
  const messages = [];
  for (const item of detail) {
    const field = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : null;
    const text = String(item.msg ?? 'Invalid value').replace(/^Value error, /, '');
    if (typeof field === 'string' && !(field in fields)) fields[field] = text;
    messages.push(typeof field === 'string' ? `${field}: ${text}` : text);
  }
  return { fields, message: messages.join('. ') || 'Some of the information is not valid.' };
}

async function readBody(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * request('/providers', { method, body, form, auth, signal })
 *   body: object, sent as JSON      form: object, sent form-encoded (login only)
 *   formData: a FormData (file upload); the browser sets the multipart Content-Type itself
 *   auth: false to skip the token (login/register)
 */
export async function request(path, { method = 'GET', body, form, formData, auth = true, signal } = {}) {
  const headers = {};
  const token = auth ? tokenStore.get() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload;
  if (formData) {
    payload = formData; // no Content-Type here: the browser adds it, including the multipart boundary
  } else if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, { method, headers, body: payload, signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError(0, "Can't reach the server. Check your connection and that the backend is running.");
  }

  const data = await readBody(response);
  if (response.ok) return data;

  const retryAfter = Number(response.headers.get('Retry-After')) || null;
  let message;
  let fields = {};
  if (Array.isArray(data?.detail)) {
    ({ fields, message } = parseValidationDetail(data.detail));
  } else if (typeof data?.detail === 'string') {
    message = data.detail;
  } else {
    message = `Something went wrong (error ${response.status}).`;
  }

  // A 401 on a request that carried a token means the session is over. (A 401 from the
  // login form itself has no token, so it just means "wrong email or password".)
  if (response.status === 401 && token && unauthorizedHandler) unauthorizedHandler();

  throw new ApiError(response.status, message, { fields, retryAfter });
}
