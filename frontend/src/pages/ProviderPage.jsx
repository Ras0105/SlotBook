import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { bookAppointment, getProvider } from '../api';
import { useAuth } from '../auth/AuthContext';
import Alert from '../components/Alert';
import ConfirmBar from '../components/ConfirmBar';
import SlotPicker from '../components/SlotPicker';
import Spinner from '../components/Spinner';
import useAsync from '../hooks/useAsync';
import { friendlyError } from '../lib/errors';
import { formatLongDate, formatRange, isDateString, todayIn, tzLabel } from '../lib/time';
import NotFoundPage from './NotFoundPage';

export default function ProviderPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();

  const { data: provider, error, loading, reload } = useAsync((signal) => getProvider(id, signal), [id]);

  const [selected, setSelected] = useState(null);
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  if (loading) return <div className="page"><Spinner label="Loading provider" /></div>;
  if (error?.status === 404 || (error?.status === 422 && !provider)) return <NotFoundPage what="provider" />;
  if (error) {
    return (
      <div className="page">
        <Alert
          kind="error"
          action={
            <button type="button" className="btn-link" onClick={reload}>
              Try again
            </button>
          }
        >
          {friendlyError(error)}
        </Alert>
      </div>
    );
  }

  const tz = provider.timezone;
  const today = todayIn(tz);
  const dateParam = params.get('date');
  // The chosen day lives in the URL (?date=2026-11-16), so it survives login and refresh.
  const date = isDateString(dateParam) && dateParam >= today ? dateParam : today;
  const isOwnProfile = user?.id === provider.user_id;

  function changeDate(next) {
    setSelected(null);
    setBookError('');
    setParams(next === today ? {} : { date: next }, { replace: true });
  }

  async function confirmBooking() {
    if (!user) {
      navigate('/login', { state: { from: `${location.pathname}${location.search}` } });
      return;
    }
    setBooking(true);
    setBookError('');
    try {
      const appt = await bookAppointment({ providerId: provider.id, startAt: selected.start_at });
      navigate('/appointments', {
        state: {
          flash: `Booked. ${provider.service_name} on ${formatLongDate(appt.start_at, tz)}, ${formatRange(appt.start_at, appt.end_at, tz)}.`,
          highlightId: appt.id,
        },
      });
    } catch (err) {
      setBookError(friendlyError(err, 'book'));
      setBooking(false);
      if (err.status === 409 || err.status === 422) {
        // The slot is gone (or never valid). Clear it and fetch the day's fresh list.
        setSelected(null);
        setReloadKey((k) => k + 1);
      }
    }
  }

  return (
    <div className="page">
      <Link to="/providers" className="back-link">
        Back to all providers
      </Link>

      <div className="provider-head">
        <span className="duration" aria-hidden="true">
          <strong>{provider.appointment_duration_minutes}</strong>
          <span>min</span>
        </span>
        <div>
          <h1>{provider.service_name}</h1>
          <p className="muted">
            {provider.appointment_duration_minutes} minute appointments, {tzLabel(tz)} time
          </p>
        </div>
      </div>

      {bookError && (
        <Alert kind="error" onDismiss={() => setBookError('')}>
          {bookError}
        </Alert>
      )}

      {isOwnProfile && (
        <Alert kind="info">This is your own provider profile, so you can’t book it. Customers see this page.</Alert>
      )}

      <SlotPicker
        provider={provider}
        date={date}
        onDateChange={changeDate}
        selected={selected}
        onSelect={(slot) => {
          setSelected(slot);
          setBookError('');
        }}
        reloadKey={reloadKey}
      />

      {selected && !isOwnProfile && (
        <ConfirmBar
          slot={selected}
          timeZone={tz}
          actionLabel={user ? 'Confirm booking' : 'Log in to book'}
          busyLabel="Booking…"
          busy={booking}
          onConfirm={confirmBooking}
        />
      )}
    </div>
  );
}
