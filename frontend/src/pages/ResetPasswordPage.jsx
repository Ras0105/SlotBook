import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { resetPassword } from '../api';
import Alert from '../components/Alert';
import Field from '../components/Field';
import PasswordInput from '../components/PasswordInput';
import StrengthMeter from '../components/StrengthMeter';
import { friendlyError } from '../lib/errors';
import { MIN_PASSWORD_LENGTH } from '../lib/password';

// The page the emailed link opens: /reset-password?token=...
export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [linkBroken, setLinkBroken] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!token || linkBroken) {
    return (
      <div className="page page--narrow">
        <div className="card">
          <h1>This link doesn’t work</h1>
          <p className="lede">It may have expired, already been used, or been copied incompletely. Reset links work once.</p>
          <Link className="btn btn--primary btn--block" to="/forgot-password">
            Get a new link
          </Link>
          <p className="card__foot">
            <Link to="/login">Back to log in</Link>
          </p>
        </div>
      </div>
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    const problems = {};
    if (password.length < MIN_PASSWORD_LENGTH) problems.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (confirm !== password) problems.confirm = 'The two passwords do not match.';
    setErrors(problems);
    if (Object.keys(problems).length) return;

    setBusy(true);
    try {
      await resetPassword({ token, newPassword: password });
      navigate('/login', { replace: true, state: { notice: 'Password reset. You were signed out on all devices. Log in with your new password.' } });
    } catch (err) {
      if (err.status === 400) setLinkBroken(true);
      else if (err.status === 422 && err.fields?.new_password) setErrors({ password: err.fields.new_password });
      else setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <div className="page page--narrow">
      <div className="card">
        <h1>Choose a new password</h1>
        <p className="lede">Pick something you don’t use anywhere else.</p>

        {error && <Alert kind="error">{error}</Alert>}

        <form className="form" onSubmit={handleSubmit} noValidate>
          <Field id="new-password" label="New password" error={errors.password} hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
            {(props) => (
              <PasswordInput {...props} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            )}
          </Field>
          <StrengthMeter password={password} />
          <Field id="confirm-password" label="Confirm new password" error={errors.confirm}>
            {(props) => (
              <PasswordInput {...props} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            )}
          </Field>
          <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Reset password'}
          </button>
        </form>
      </div>
    </div>
  );
}
