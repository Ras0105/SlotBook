import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getAppointment, rescheduleAppointment } from '../api';
import { useAuth } from '../auth/AuthContext';
import Alert from '../components/Alert';
import ConfirmBar from '../components/ConfirmBar';
import SlotPicker from '../components/SlotPicker';
import Spinner from '../components/Spinner';
import useAsync from '../hooks/useAsync';
import { friendlyError } from '../lib/errors';
import { fetchProvider } from '../lib/providerCache';
import { dayOf, formatLongDate, formatRange, todayIn, tzLabel } from '../lib/time';

async function load(id, signal) {
  const appointment = await getAppointment(id, signal);
  const provider = await fetchProvider(appointment.provider_id);
  return { appointment, provider };
}

export default function ReschedulePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data, error, loading, reload } = useAsync((signal) => load(id, signal), [id]);
  const [chosenDate, setChosenDate] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  if (loading) return <div className="page"><Spinner label="Loading appointment" /></div>;
  if (error) {
    return (
      <div className="page">
        <Link to="/appointments" className="back-link">Back to my appointments</Link>
        <Alert
          kind="error"
          action={error.status >= 500 || error.status === 0 ? (
            <button type="button" className="btn-link" onClick={reload}>Try again</button>
          ) : null}
        >
          {friendlyError(error)}
        </Alert>
      </div>
    );
  }

  const { appointment, provider } = data;
  const tz = provider.timezone;
  const today = todayIn(tz);
  const started = new Date(appointment.start_at).getTime() <= Date.now();
  const canMove = appointment.status === 'booked' && !started && appointment.customer_id === user.id;

  if (!canMove) {
    const reason =
      appointment.customer_id !== user.id
        ? 'Only the customer who booked an appointment can reschedule it.'
        : appointment.status !== 'booked'
          ? `This appointment is ${appointment.status}, so it can’t be moved.`
          : 'This appointment has already started, so it can’t be moved.';
    return (
      <div className="page">
        <Link to="/appointments" className="back-link">Back to my appointments</Link>
        <Alert kind="info">{reason}</Alert>
      </div>
    );
  }

  const currentDay = dayOf(appointment.start_at, tz);
  const date = chosenDate ?? (currentDay >= today ? currentDay : today);

  async function confirmMove() {
    setBusy(true);
    setActionError('');
    try {
      const moved = await rescheduleAppointment(appointment.id, selected.start_at);
      navigate('/appointments', {
        state: {
          flash: `Rescheduled. ${provider.service_name} is now ${formatLongDate(moved.start_at, tz)}, ${formatRange(moved.start_at, moved.end_at, tz)}.`,
          highlightId: moved.id,
        },
      });
    } catch (err) {
      setActionError(friendlyError(err, 'reschedule'));
      setBusy(false);
      if (err.status === 409 || err.status === 422) {
        setSelected(null);
        setReloadKey((k) => k + 1);
      }
    }
  }

  return (
    <div className="page">
      <Link to="/appointments" className="back-link">Back to my appointments</Link>
      <div className="page-head">
        <h1>Reschedule {provider.service_name}</h1>
        <p className="num">
          Currently {formatLongDate(appointment.start_at, tz)}, {formatRange(appointment.start_at, appointment.end_at, tz)} ({tzLabel(tz)} time).
          Choose the new time below. Your current time stays booked until you confirm.
        </p>
      </div>

      {actionError && (
        <Alert kind="error" onDismiss={() => setActionError('')}>
          {actionError}
        </Alert>
      )}

      <SlotPicker
        provider={provider}
        date={date}
        onDateChange={(d) => {
          setChosenDate(d);
          setSelected(null);
          setActionError('');
        }}
        selected={selected}
        onSelect={(slot) => {
          setSelected(slot);
          setActionError('');
        }}
        reloadKey={reloadKey}
      />

      {selected && (
        <ConfirmBar
          slot={selected}
          timeZone={tz}
          actionLabel="Move appointment"
          busyLabel="Moving…"
          busy={busy}
          onConfirm={confirmMove}
        />
      )}
    </div>
  );
}
