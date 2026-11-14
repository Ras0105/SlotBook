import { useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { forgotPassword } from '../api';
import { useAuth } from '../auth/AuthContext';
import Alert from '../components/Alert';
import Icon from '../components/Icon';
import { friendlyError } from '../lib/errors';

export default function ForgotPasswordPage() {
  const { status } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState(location.state?.email ?? ''); // carried over from the log in form
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState('');

  if (status === 'authed') return <Navigate to="/profile" replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setFieldError('');
    const value = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(value)) {
      setFieldError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    try {
      await forgotPassword({ email: value });
      setSentTo(value);
    } catch (err) {
      if (err.status === 422) setFieldError('Enter a valid email address.');
      else setError(friendlyError(err, 'forgot'));
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <div className="page page--narrow">
        <div className="card">
          <div className="card__icon" aria-hidden="true">
            <Icon name="mail" size={26} />
          </div>
          <h1>Check your email</h1>
          <p className="lede">
            If an account exists for <strong>{sentTo}</strong>, we have sent a link to choose a new password. It works
            once and expires soon.
          </p>
          <p className="muted">
            Nothing after a few minutes? Check your spam folder, or{' '}
            <button type="button" className="btn-link" onClick={() => setSentTo('')}>
              try a different email
            </button>
            .
          </p>
          <p className="card__foot">
            <Link to="/login">Back to log in</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page page--narrow">
      <div className="card">
        <h1>Forgot your password?</h1>
        <p className="lede">Enter the email you signed up with and we will send you a link to reset it.</p>

        {error && <Alert kind="error">{error}</Alert>}

        <form className="form" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(fieldError)}
              aria-describedby={fieldError ? 'email-error' : undefined}
            />
            {fieldError && (
              <p className="field__error" id="email-error">
                {fieldError}
              </p>
            )}
          </div>
          <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>

        <p className="card__foot">
          Remembered it? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}
