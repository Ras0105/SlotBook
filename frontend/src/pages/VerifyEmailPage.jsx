import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { resendVerification, verifyEmail } from '../api';
import { useAuth } from '../auth/AuthContext';
import Alert from '../components/Alert';
import Spinner from '../components/Spinner';
import { friendlyError } from '../lib/errors';

// The page the emailed link opens: /verify-email?token=...
// It works whether or not the person is logged in here (they may open the email on their phone).
export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { user, status, refreshUser } = useAuth();
  const [state, setState] = useState(token ? 'checking' : 'broken'); // checking | done | broken
  const [resent, setResent] = useState('');
  const [resendError, setResendError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true; // React may run effects twice in development; the link only needs checking once
    verifyEmail(token)
      .then(async () => {
        setState('done');
        if (tokenInUse()) await refreshUser().catch(() => {}); // so the banner goes away without a reload
      })
      .catch(() => setState('broken'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function tokenInUse() {
    return status === 'authed' || status === 'loading';
  }

  async function sendNew() {
    setResent('');
    setResendError('');
    try {
      await resendVerification();
      setResent('A new link is on its way. Check your inbox.');
    } catch (err) {
      setResendError(friendlyError(err, 'verify'));
    }
  }

  if (state === 'checking') {
    return (
      <div className="page page--narrow">
        <div className="card">
          <Spinner label="Confirming your email address" />
        </div>
      </div>
    );
  }

  if (state === 'done') {
    return (
      <div className="page page--narrow">
        <div className="card">
          <h1>Email confirmed</h1>
          <p className="lede">Thank you. Your email address is confirmed, and you can book appointments now.</p>
          <Link className="btn btn--primary btn--block" to="/providers">
            Find a provider
          </Link>
          {!user && status === 'anon' && (
            <p className="card__foot">
              <Link to="/login">Log in</Link>
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="page page--narrow">
      <div className="card">
        <h1>This link doesn’t work</h1>
        <p className="lede">It may have expired, or been copied incompletely, or it was for an email address you have since changed.</p>
        {resent && <Alert kind="success">{resent}</Alert>}
        {resendError && <Alert kind="error">{resendError}</Alert>}
        {status === 'authed' ? (
          user?.email_verified === false ? (
            <button type="button" className="btn btn--primary btn--block" onClick={sendNew}>
              Send me a new link
            </button>
          ) : (
            <Link className="btn btn--primary btn--block" to="/providers">
              Your email is already confirmed
            </Link>
          )
        ) : (
          <Link className="btn btn--primary btn--block" to="/login" state={{ from: { pathname: '/' } }}>
            Log in to get a new link
          </Link>
        )}
      </div>
    </div>
  );
}
