// Turns an ApiError into one plain sentence for the screen. Says what happened and what to do.
// `context` lets the same status code read differently (a 409 means different things when
// booking, versus registering).

export function formatWait(seconds) {
  if (!seconds) return 'a moment';
  if (seconds >= 60) {
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

export function friendlyError(error, context = '') {
  if (!error || typeof error.status !== 'number') return 'Something unexpected went wrong. Please try again.';
  switch (error.status) {
    case 401:
      return context === 'login'
        ? 'Wrong email or password.'
        : 'Your session has ended. Log in again to continue.';
    case 409:
      // The backend says "This slot is no longer available" for a real slot clash. Other 409s
      // ("already started", "already cancelled") have their own message, which is more accurate.
      if ((context === 'book' || context === 'reschedule') && /no longer available/i.test(error.message)) {
        return 'Someone just booked that time. Pick another slot below.';
      }
      if (context === 'register') return 'An account with this email already exists. Try logging in instead.';
      return error.message;
    case 429:
      if (context === 'verify') return `Too many requests for a new link. Try again in ${formatWait(error.retryAfter)}.`;
      if (context === 'forgot') return `Too many reset requests. Try again in ${formatWait(error.retryAfter)}.`;
      if (context === 'password') return `Too many wrong passwords. Try again in ${formatWait(error.retryAfter)}.`;
      return `Too many failed login attempts. Try again in ${formatWait(error.retryAfter)}.`;
    case 503:
      return `The booking system is busy right now. Try again in ${formatWait(error.retryAfter ?? 5)}.`;
    default:
      return error.message;
  }
}
