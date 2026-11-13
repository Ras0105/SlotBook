import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import Alert from '../components/Alert';
import { friendlyError } from '../lib/errors';

export default function LoginPage() {
  const { signIn, status, expired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from ?? '/providers'; // where the visitor was trying to go

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (status === 'authed') return <Navigate to={from} replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(friendlyError(err, 'login'));
      setBusy(false);
    }
  }

  return (
    <div className="page page--narrow">
      <div className="card">
        <h1>Log in</h1>
        <p className="lede">Welcome back. Log in to book and manage your appointments.</p>

        {expired && !error && <Alert kind="info">Your session ended. Log in again to continue.</Alert>}
        {error && <Alert kind="error">{error}</Alert>}

        <form className="form" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button className="btn btn--primary btn--block" type="submit" disabled={busy || !email || !password}>
            {busy ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <p className="card__foot">
          New to SlotBook? <Link to="/register" state={location.state}>Create an account</Link>
        </p>
      </div>
    </div>
  );
}
