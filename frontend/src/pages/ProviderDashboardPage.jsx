import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { getMyProvider, updateMyProvider } from '../api';
import Alert from '../components/Alert';
import CalendarPanel from '../components/CalendarPanel';
import PhotoPanel from '../components/PhotoPanel';
import ProviderForm from '../components/ProviderForm';
import Spinner from '../components/Spinner';
import TimeOffPanel from '../components/TimeOffPanel';
import WorkingHoursPanel from '../components/WorkingHoursPanel';
import useAsync from '../hooks/useAsync';
import { friendlyError } from '../lib/errors';
import { tzLabel } from '../lib/time';

const TABS = [
  { key: 'hours', label: 'Working hours' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'time-off', label: 'Time off' },
  { key: 'profile', label: 'Profile' },
];

function ProfilePanel({ provider, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const [saved, setSaved] = useState(false);

  async function submit(values) {
    setBusy(true);
    setError('');
    setFields({});
    setSaved(false);
    try {
      onSaved(await updateMyProvider(values));
      setSaved(true);
    } catch (err) {
      setError(friendlyError(err));
      setFields(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel-narrow">
      <PhotoPanel provider={provider} onChanged={onSaved} />
      <h2>Details</h2>
      {error && <Alert kind="error" onDismiss={() => setError('')}>{error}</Alert>}
      {saved && <Alert kind="success" onDismiss={() => setSaved(false)}>Profile saved.</Alert>}
      <ProviderForm
        initial={{
          serviceName: provider.service_name,
          durationMinutes: String(provider.appointment_duration_minutes),
          timezone: provider.timezone,
          description: provider.description ?? '',
          category: provider.category ?? 'other',
        }}
        submitLabel="Save changes"
        busyLabel="Saving…"
        busy={busy}
        serverFields={fields}
        onSubmit={submit}
        hint="Your working hours and time off are read in this timezone. Changing it moves them to the new clock."
      />
    </div>
  );
}

export default function ProviderDashboardPage() {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const { data, error, loading, reload } = useAsync((signal) => getMyProvider(signal), []);
  const [saved, setSaved] = useState(null); // the profile after an edit on this page
  const [flash, setFlash] = useState(location.state?.flash ?? '');

  if (loading) return <div className="page"><Spinner label="Loading your dashboard" /></div>;
  if (error) {
    return (
      <div className="page">
        <Alert
          kind="error"
          action={
            error.status === 404 ? (
              <Link className="btn-link" to="/become-provider">Create a profile</Link>
            ) : (
              <button type="button" className="btn-link" onClick={reload}>Try again</button>
            )
          }
        >
          {friendlyError(error)}
        </Alert>
      </div>
    );
  }

  const provider = saved ?? data;
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'hours';

  return (
    <div className="page">
      <div className="page-head">
        <h1>Provider dashboard</h1>
        <p>
          {provider.service_name}: {provider.appointment_duration_minutes} minute appointments, {tzLabel(provider.timezone)} time.
        </p>
        <div className="page-head__links">
          <Link to={`/providers/${provider.id}`}>View your public page</Link>
          <Link to="/appointments">Your appointments</Link>
        </div>
      </div>

      {flash && <Alert kind="success" onDismiss={() => setFlash('')}>{flash}</Alert>}

      <div className="tabs" role="tablist" aria-label="Dashboard sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`dash-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls="dash-panel"
            className="tab"
            onClick={() => setParams(t.key === 'hours' ? {} : { tab: t.key }, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id="dash-panel" role="tabpanel" aria-labelledby={`dash-tab-${tab}`}>
        {tab === 'hours' && <WorkingHoursPanel provider={provider} />}
        {tab === 'calendar' && <CalendarPanel provider={provider} />}
        {tab === 'time-off' && <TimeOffPanel provider={provider} />}
        {tab === 'profile' && <ProfilePanel provider={provider} onSaved={setSaved} />}
      </div>
    </div>
  );
}
