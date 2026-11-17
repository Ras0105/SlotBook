import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { bookAppointment, getProvider } from '../api';
import { useAuth } from '../auth/AuthContext';
import Alert from '../components/Alert';
import ConfirmBar from '../components/ConfirmBar';
import ProviderAvatar from '../components/ProviderAvatar';
import ReviewsSection from '../components/ReviewsSection';
import SlotPicker from '../components/SlotPicker';
import Spinner from '../components/Spinner';
import StarRating from '../components/StarRating';
import useAsync from '../hooks/useAsync';
import { categoryLabel } from '../lib/categories';
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
  const [notes, setNotes] = useState(''); // the customer's reason for visit, sent with the booking
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
  const needsVerification = user?.email_verified === false; // booking needs a confirmed email address

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
      const appt = await bookAppointment({ providerId: provider.id, startAt: selected.start_at, ...(notes.trim() ? { notes: notes.trim() } : {}) });
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
        <ProviderAvatar provider={provider} size="xl" />
        <div>
          <h1>{provider.service_name}</h1>
          <p className="muted">
            {categoryLabel(provider.category)}. {provider.appointment_duration_minutes} minute appointments, {tzLabel(tz)} time
          </p>
          <p className="provider-head__rating">
            <StarRating average={provider.rating_avg} count={provider.review_count} />
          </p>
        </div>
      </div>

      {provider.description && <p className="provider-about">{provider.description}</p>}

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

      {selected && !isOwnProfile && needsVerification && (
        <Alert kind="info">
          Please confirm your email address to book. We sent a link to {user.email}; the bar at the top of the page can send a
          new one.
        </Alert>
      )}

      {selected && !isOwnProfile && !needsVerification && (
        <section className="booking-notes" aria-labelledby="notes-heading">
          <h2 id="notes-heading">Reason for visit (optional)</h2>
          <div className="field">
            <label className="visually-hidden" htmlFor="booking-notes">
              Reason for visit
            </label>
            <textarea
              id="booking-notes"
              rows={3}
              maxLength={500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything the provider should know before you arrive"
            />
            <p className="field__hint">{notes.length} of 500 characters. The provider sees this with your booking.</p>
          </div>
        </section>
      )}

      {selected && !isOwnProfile && !needsVerification && (
        <ConfirmBar
          slot={selected}
          timeZone={tz}
          actionLabel={user ? 'Confirm booking' : 'Log in to book'}
          busyLabel="Booking…"
          busy={booking}
          onConfirm={confirmBooking}
        />
      )}

      <ReviewsSection provider={provider} />
    </div>
  );
}
