import { useState } from 'react';
import { Link } from 'react-router-dom';
import { changePassword } from '../api';
import { useAuth } from '../auth/AuthContext';
import Alert from '../components/Alert';
import Avatar from '../components/Avatar';
import Field from '../components/Field';
import PasswordInput from '../components/PasswordInput';
import StrengthMeter from '../components/StrengthMeter';
import { friendlyError } from '../lib/errors';
import { MIN_PASSWORD_LENGTH } from '../lib/password';
import { useTheme } from '../theme/ThemeContext';

const ROLE_LABELS = { customer: 'Customer', provider: 'Provider', admin: 'Administrator' };

function memberSince(createdAt) {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date);
}

function DetailsForm() {
  const { user, updateProfile } = useAuth();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [currentPassword, setCurrentPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const emailChanged = email.trim() !== user.email;
  const unchanged = name.trim() === user.name && !emailChanged;

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSaved(false);
    const problems = {};
    if (!name.trim()) problems.name = 'Enter your name.';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) problems.email = 'Enter a valid email address.';
    if (emailChanged && !currentPassword) problems.currentPassword = 'Enter your current password to change your email.';
    setErrors(problems);
    if (Object.keys(problems).length) return;

    const changes = {};
    if (name.trim() !== user.name) changes.name = name.trim();
    if (emailChanged) {
      changes.email = email.trim();
      changes.currentPassword = currentPassword;
    }
    setBusy(true);
    try {
      const me = await updateProfile(changes);
      setName(me.name);
      setEmail(me.email);
      setCurrentPassword('');
      setSaved(true);
    } catch (err) {
      if (err.status === 409) setErrors({ email: 'That email is already used by another account.' });
      else if (err.status === 400 && /password/i.test(err.message)) setErrors({ currentPassword: err.message });
      else if (err.status === 422 && Object.keys(err.fields ?? {}).length) {
        setErrors({ name: err.fields.name, email: err.fields.email });
      } else setError(friendlyError(err, 'password'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card panel" aria-labelledby="details-title">
      <h2 id="details-title">Your details</h2>
      <p className="muted panel__intro">Your name appears on bookings. Your email is where confirmations are sent.</p>
      {saved && <Alert kind="success" onDismiss={() => setSaved(false)}>Profile updated.</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      <form className="form" onSubmit={handleSubmit} noValidate>
        <Field id="profile-name" label="Name" error={errors.name}>
          {(props) => <input {...props} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field id="profile-email" label="Email" error={errors.email}>
          {(props) => <input {...props} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        {emailChanged && (
          <Field
            id="profile-current-password"
            label="Current password"
            error={errors.currentPassword}
            hint="We ask for it because your email is also your log in name."
          >
            {(props) => (
              <PasswordInput {...props} autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            )}
          </Field>
        )}
        <div className="form__buttons">
          <button className="btn btn--primary" type="submit" disabled={busy || unchanged}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          {!unchanged && (
            <button
              className="btn btn--secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                setName(user.name);
                setEmail(user.email);
                setCurrentPassword('');
                setErrors({});
              }}
            >
              Discard
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setDone(false);
    const problems = {};
    if (!current) problems.current = 'Enter your current password.';
    if (next.length < MIN_PASSWORD_LENGTH) problems.next = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (confirm !== next) problems.confirm = 'The two passwords do not match.';
    setErrors(problems);
    if (Object.keys(problems).length) return;

    setBusy(true);
    try {
      await changePassword({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
    } catch (err) {
      if (err.status === 400 && /current password is incorrect/i.test(err.message)) setErrors({ current: 'That is not your current password.' });
      else if (err.status === 422 && err.fields?.new_password) setErrors({ next: err.fields.new_password });
      else setError(friendlyError(err, 'password'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card panel" aria-labelledby="password-title">
      <h2 id="password-title">Change password</h2>
      <p className="muted panel__intro">Forgot the current one? Log out and use “Forgot password” on the log in page.</p>
      {done && <Alert kind="success" onDismiss={() => setDone(false)}>Password changed. We emailed you a notice.</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      <form className="form" onSubmit={handleSubmit} noValidate>
        <Field id="current-password" label="Current password" error={errors.current}>
          {(props) => <PasswordInput {...props} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}
        </Field>
        <Field id="profile-new-password" label="New password" error={errors.next} hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
          {(props) => <PasswordInput {...props} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
        </Field>
        <StrengthMeter password={next} />
        <Field id="profile-confirm-password" label="Confirm new password" error={errors.confirm}>
          {(props) => <PasswordInput {...props} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        </Field>
        <div className="form__buttons">
          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Update password'}
          </button>
        </div>
      </form>
    </section>
  );
}

const THEME_CHOICES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Match my device' },
];

function AppearanceCard() {
  const { preference, setPreference } = useTheme();
  return (
    <section className="card panel" aria-labelledby="appearance-title">
      <h2 id="appearance-title">Appearance</h2>
      <p className="muted panel__intro">Saved on this device.</p>
      <fieldset className="choice-group">
        <legend className="visually-hidden">Theme</legend>
        {THEME_CHOICES.map((choice) => (
          <label key={choice.value} className="choice" data-checked={preference === choice.value}>
            <input type="radio" name="theme" value={choice.value} checked={preference === choice.value} onChange={() => setPreference(choice.value)} />
            <span>{choice.label}</span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}

export default function ProfilePage() {
  const { user } = useAuth();
  const since = memberSince(user.created_at);

  return (
    <div className="page page--medium">
      <header className="profile-head">
        <Avatar name={user.name} size="lg" />
        <div>
          <h1>{user.name}</h1>
          <p className="muted">
            <span className="badge badge--role">{ROLE_LABELS[user.role] ?? user.role}</span>
            {since && <span className="profile-head__since"> Member since {since}</span>}
          </p>
        </div>
      </header>

      <div className="profile-grid">
        <DetailsForm />
        <PasswordForm />
        <AppearanceCard />
      </div>

      {user.role === 'provider' && (
        <p className="muted profile-foot">
          Looking for your service name, hours or time off? Those are in the <Link to="/dashboard">dashboard</Link>.
        </p>
      )}
    </div>
  );
}
