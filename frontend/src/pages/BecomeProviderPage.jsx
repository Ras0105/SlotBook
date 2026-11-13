import { useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { createProvider } from '../api';
import { useAuth } from '../auth/AuthContext';
import RequireAuth from '../auth/RequireAuth';
import Alert from '../components/Alert';
import ProviderForm from '../components/ProviderForm';
import { friendlyError } from '../lib/errors';
import { modernZone, userTimeZone } from '../lib/time';

const READY = 'Your provider profile is ready. Add your working hours so customers can book you.';

function Form() {
  const { user, refreshUser } = useAuth();
  const justCreated = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});

  // Once the role is "provider" (after creating the profile, or because it already was), go to the dashboard.
  if (user.role === 'provider') {
    return <Navigate to="/dashboard" replace state={justCreated.current ? { flash: READY } : undefined} />;
  }
  if (user.role !== 'customer') {
    return (
      <div className="page page--narrow">
        <Alert kind="info">Administrator accounts cannot become providers. Use a customer account for that.</Alert>
      </div>
    );
  }

  async function submit(values) {
    setBusy(true);
    setError('');
    setFields({});
    try {
      await createProvider(values);
    } catch (err) {
      // 409: the profile already exists (a second tab, a double click). Treat it as success and carry on.
      if (err.status !== 409) {
        setError(friendlyError(err));
        setFields(err.fields ?? {});
        setBusy(false);
        return;
      }
    }
    try {
      justCreated.current = true;
      // The role is now "provider": the menu and the dashboard depend on it. Updating the user is what
      // sends us to the dashboard (see the <Navigate> above).
      const me = await refreshUser();
      if (me.role !== 'provider') {
        justCreated.current = false;
        setError('Your profile was created, but your account has not updated yet. Reload the page.');
        setBusy(false);
      }
    } catch (err) {
      justCreated.current = false;
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <div className="page page--narrow">
      <div className="card">
        <h1>Become a provider</h1>
        <p className="lede">Offer appointments on SlotBook. You choose the hours; customers pick a free time.</p>
        {error && <Alert kind="error" onDismiss={() => setError('')}>{error}</Alert>}
        <ProviderForm
          initial={{ serviceName: '', durationMinutes: '30', timezone: modernZone(userTimeZone()) }}
          submitLabel="Create my profile"
          busyLabel="Creating profile…"
          busy={busy}
          serverFields={fields}
          onSubmit={submit}
          hint="Your working hours use this timezone."
        />
      </div>
    </div>
  );
}

export default function BecomeProviderPage() {
  return (
    <RequireAuth>
      <Form />
    </RequireAuth>
  );
}
