import { useState } from 'react';
import { resendVerification } from '../api';
import { friendlyError } from '../lib/errors';

/** Shown under the header to a logged-in user whose email address is not confirmed yet. */
export default function VerifyEmailBanner({ email }) {
  const [state, setState] = useState('idle'); // idle | sending | sent | error
  const [message, setMessage] = useState('');

  async function resend() {
    setState('sending');
    try {
      await resendVerification();
      setState('sent');
      setMessage('A new link is on its way. Check your inbox (and spam).');
    } catch (err) {
      setState('error');
      setMessage(friendlyError(err, 'verify'));
    }
  }

  return (
    <div className="verify-banner" role="status">
      <div className="verify-banner__inner">
        <p>
          <strong>Confirm your email address.</strong> We sent a link to {email}. You can look around now; booking needs the
          confirmation.
        </p>
        <div className="verify-banner__actions">
          {message && <span className={state === 'error' ? 'verify-banner__error' : undefined}>{message}</span>}
          <button type="button" className="btn btn--secondary btn--small" onClick={resend} disabled={state === 'sending'}>
            {state === 'sending' ? 'Sending…' : 'Send a new link'}
          </button>
        </div>
      </div>
    </div>
  );
}
