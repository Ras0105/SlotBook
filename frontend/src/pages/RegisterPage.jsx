import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import Alert from '../components/Alert';
import PasswordInput from '../components/PasswordInput';
import StrengthMeter from '../components/StrengthMeter';
import { friendlyError } from '../lib/errors';

export default function RegisterPage() {
  const { signUp, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from ?? '/providers';

  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (status === 'authed') return <Navigate to={from} replace />;

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setFieldErrors({});

    // Quick checks so people get instant feedback; the server checks again.
    const problems = {};
    if (!form.name.trim()) problems.name = 'Enter your name.';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) problems.email = 'Enter a valid email address.';
    if (form.password.length < 8) problems.password = 'Use at least 8 characters.';
    if (Object.keys(problems).length) {
      setFieldErrors(problems);
      return;
    }

    setBusy(true);
    try {
      await signUp({ name: form.name.trim(), email: form.email.trim(), password: form.password });
      navigate(from, { replace: true });
    } catch (err) {
      if (err.status === 422 && Object.keys(err.fields).length) {
        setFieldErrors(err.fields);
      } else if (err.status === 409) {
        setFieldErrors({ email: friendlyError(err, 'register') });
      } else {
        setError(friendlyError(err, 'register'));
      }
      setBusy(false);
    }
  }

  return (
    <div className="page page--narrow">
      <div className="card">
        <h1>Create your account</h1>
        <p className="lede">It takes a minute. Then you can book any provider.</p>

        {error && <Alert kind="error">{error}</Alert>}

        <form className="form" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              autoComplete="name"
              value={form.name}
              onChange={set('name')}
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? 'name-error' : undefined}
            />
            {fieldErrors.name && (
              <p className="field__error" id="name-error">
                {fieldErrors.name}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={set('email')}
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? 'email-error' : undefined}
            />
            {fieldErrors.email && (
              <p className="field__error" id="email-error">
                {fieldErrors.email}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              value={form.password}
              onChange={set('password')}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? 'password-error' : 'password-hint'}
            />
            {fieldErrors.password ? (
              <p className="field__error" id="password-error">
                {fieldErrors.password}
              </p>
            ) : (
              <p className="field__hint" id="password-hint">
                At least 8 characters.
              </p>
            )}
            <StrengthMeter password={form.password} />
          </div>
          <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="card__foot">
          Already have an account? <Link to="/login" state={location.state}>Log in</Link>
        </p>
      </div>
    </div>
  );
}
