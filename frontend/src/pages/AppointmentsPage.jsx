import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { cancelAppointment, deleteReview, getAppointment, listMyAppointments } from '../api';
import { useAuth } from '../auth/AuthContext';
import Alert from '../components/Alert';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import ReviewModal from '../components/ReviewModal';
import Spinner from '../components/Spinner';
import { StarsOnly } from '../components/StarRating';
import StatusBadge from '../components/StatusBadge';
import useAsync from '../hooks/useAsync';
import { friendlyError } from '../lib/errors';
import { appointmentIcs, downloadIcs, icsFilename } from '../lib/ics';
import { fetchProvider } from '../lib/providerCache';
import {
  dayParts,
  dayOf,
  formatLongDate,
  formatRange,
  formatShortDate,
  formatTime,
  humanizeNote,
  tzLabel,
  userTimeZone,
  yourTimeNote,
} from '../lib/time';

const LIMIT = 100;

const TABS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'cancelled', label: 'Cancelled' },
];

function classify(appt, now) {
  if (appt.status === 'cancelled') return 'cancelled';
  if (appt.status === 'booked' && new Date(appt.start_at).getTime() > now) return 'upcoming';
  return 'past';
}

async function loadAppointments(signal) {
  const appointments = await listMyAppointments({ limit: LIMIT }, signal);
  const ids = [...new Set(appointments.map((a) => a.provider_id))];
  const results = await Promise.allSettled(ids.map((id) => fetchProvider(id)));
  const providers = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') providers[ids[i]] = r.value;
  });
  return { appointments, providers };
}

function History({ appointmentId, timeZone }) {
  const { data, error, loading } = useAsync((signal) => getAppointment(appointmentId, signal), [appointmentId]);
  if (loading) return <Spinner label="Loading history" />;
  if (error) return <p className="appt__note">{friendlyError(error)}</p>;
  return (
    <ul className="history" aria-label="History">
      {data.history.map((h, i) => (
        <li key={i}>
          <time dateTime={h.changed_at}>
            {formatShortDate(h.changed_at, timeZone)}, {formatTime(h.changed_at, timeZone)}
          </time>
          <span>{humanizeNote(h.note, timeZone) ?? h.new_status}</span>
        </li>
      ))}
    </ul>
  );
}

// A booking whose end time has passed took place, even if nobody clicked "complete".
const hasEnded = (appt, now = Date.now()) => appt.status === 'completed' || (appt.status === 'booked' && new Date(appt.end_at).getTime() <= now);

function AppointmentItem({ appt, provider, user, highlighted, upcoming, onCancel, onReview, onDeleteReview }) {
  const [showHistory, setShowHistory] = useState(false);
  const tz = provider?.timezone ?? userTimeZone();
  const parts = dayParts(dayOf(appt.start_at, tz));
  const name = provider?.service_name ?? `Provider #${appt.provider_id}`;
  const note = yourTimeNote(appt.start_at, tz);
  const isCustomer = appt.customer_id === user.id;
  const ended = hasEnded(appt);
  const shownStatus = ended ? 'completed' : appt.status;
  const canReview = ended && isCustomer && !appt.review;

  return (
    <li className={`appt appt--${appt.status}${highlighted ? ' appt--new' : ''}`}>
      <div className="date-block" aria-hidden="true">
        <span className="date-block__wd">{parts.weekday}</span>
        <span className="date-block__num">{parts.dayOfMonth}</span>
        <span className="date-block__mon">{parts.month}</span>
      </div>
      <div>
        <div className="appt__top">
          <div>
            <div className="appt__service">
              {provider ? <Link to={`/providers/${appt.provider_id}`}>{name}</Link> : name}
            </div>
            <div className="appt__time num">
              {formatLongDate(appt.start_at, tz)}, {formatRange(appt.start_at, appt.end_at, tz)}
            </div>
            <div className="appt__note">
              {provider ? `${tzLabel(tz)} time` : 'Your time'}
              {note ? `, ${note}` : ''}
            </div>
          </div>
          <StatusBadge status={shownStatus} />
        </div>

        {appt.notes && (
          <p className="appt__notes">
            <span className="muted">Reason for visit:</span> {appt.notes}
          </p>
        )}

        {appt.review && (
          <div className="appt__review">
            <span className="muted">Your review</span> <StarsOnly rating={appt.review.rating} />
            {appt.review.updated_at && <span className="muted"> (edited)</span>}
            {appt.review.comment && <p className="appt__review-text">{appt.review.comment}</p>}
            {isCustomer && (
              <div className="appt__review-actions">
                <button type="button" className="btn-link" onClick={() => onReview(appt)}>
                  Edit review
                </button>
                <button type="button" className="btn-link btn-link--danger" onClick={() => onDeleteReview(appt)}>
                  Delete review
                </button>
              </div>
            )}
          </div>
        )}

        <div className="appt__actions">
          {upcoming && (
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() => downloadIcs(icsFilename(appt), appointmentIcs(appt, provider))}
            >
              Add to calendar
            </button>
          )}
          {canReview && (
            <button type="button" className="btn btn--primary btn--small" onClick={() => onReview(appt)}>
              Rate this visit
            </button>
          )}
          {upcoming && isCustomer && (
            <Link className="btn btn--secondary btn--small" to={`/appointments/${appt.id}/reschedule`}>
              Reschedule
            </Link>
          )}
          {upcoming && (
            <button type="button" className="btn btn--quiet btn--small" onClick={() => onCancel(appt)}>
              Cancel
            </button>
          )}
          <button
            type="button"
            className="btn-link"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((v) => !v)}
          >
            {showHistory ? 'Hide history' : 'Show history'}
          </button>
        </div>

        {showHistory && <History appointmentId={appt.id} timeZone={tz} />}
      </div>
    </li>
  );
}

export default function AppointmentsPage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // A message from the page we just came from ("Booked. ..."). Read it once, then clear it from
  // the browser history so a refresh does not show it again.
  const [flash, setFlash] = useState(location.state?.flash ?? '');
  const [highlightId] = useState(location.state?.highlightId ?? null);
  useEffect(() => {
    if (location.state) navigate(location.pathname, { replace: true, state: null });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { data, error, loading, reload } = useAsync(loadAppointments, []);
  const [updated, setUpdated] = useState({}); // appointments changed on this page, by id
  const [tab, setTab] = useState('upcoming');
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState('');
  const [reviewTarget, setReviewTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null); // the appointment whose review is about to be deleted
  const [deleting, setDeleting] = useState(false);

  async function confirmCancel() {
    setCancelling(true);
    try {
      const result = await cancelAppointment(cancelTarget.id);
      setUpdated((u) => ({ ...u, [result.id]: result }));
      setFlash('Appointment cancelled. The time is free for others again.');
      setActionError('');
      setCancelTarget(null);
    } catch (err) {
      setActionError(friendlyError(err, 'cancel'));
      setCancelTarget(null);
      if (err.status === 409 || err.status === 404) reload(); // our list was out of date
    } finally {
      setCancelling(false);
    }
  }

  function reviewSaved(review) {
    // Reviewing a past booking also marks it completed on the server, so show it that way here too.
    setUpdated((u) => {
      const current = u[review.appointment_id] ?? data.appointments.find((a) => a.id === review.appointment_id);
      return { ...u, [review.appointment_id]: { ...current, status: 'completed', review } };
    });
    const edited = Boolean(reviewTarget?.review);
    setReviewTarget(null);
    setFlash(edited ? 'Your review was updated.' : 'Thanks for your review.');
    setActionError('');
  }

  async function confirmDeleteReview() {
    setDeleting(true);
    try {
      await deleteReview(deleteTarget.review.id);
      setUpdated((u) => ({ ...u, [deleteTarget.id]: { ...(u[deleteTarget.id] ?? deleteTarget), review: null } }));
      setFlash('Your review was deleted.');
      setActionError('');
    } catch (err) {
      setActionError(friendlyError(err));
      if (err.status === 404 || err.status === 403) reload(); // the list was out of date
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }


  if (loading) return <div className="page"><Spinner label="Loading your appointments" /></div>;
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

  const now = Date.now();
  const all = data.appointments.map((a) => updated[a.id] ?? a);
  const groups = { upcoming: [], past: [], cancelled: [] };
  all.forEach((a) => groups[classify(a, now)].push(a));
  groups.upcoming.sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
  groups.past.sort((a, b) => new Date(b.start_at) - new Date(a.start_at));
  groups.cancelled.sort((a, b) => new Date(b.start_at) - new Date(a.start_at));

  const visible = groups[tab];
  const cancelTz = cancelTarget ? (data.providers[cancelTarget.provider_id]?.timezone ?? userTimeZone()) : null;

  const emptyText = {
    upcoming: ['No upcoming appointments', 'Find a provider and book a time.'],
    past: ['No past appointments', 'Appointments you have attended will show here.'],
    cancelled: ['Nothing cancelled', 'Cancelled appointments will show here.'],
  }[tab];

  return (
    <div className="page">
      <div className="page-head">
        <h1>My appointments</h1>
      </div>

      {flash && (
        <Alert kind="success" onDismiss={() => setFlash('')}>
          {flash}
        </Alert>
      )}
      {actionError && (
        <Alert kind="error" onDismiss={() => setActionError('')}>
          {actionError}
        </Alert>
      )}
      {data.appointments.length >= LIMIT && (
        <Alert kind="info">Showing {LIMIT} appointments. Older past appointments are not listed.</Alert>
      )}

      <div className="tabs" role="tablist" aria-label="Appointment groups">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls="appt-panel"
            className="tab"
            onClick={() => setTab(t.key)}
          >
            {t.label}
            <span className="tab__count">{groups[t.key].length}</span>
          </button>
        ))}
      </div>

      <div id="appt-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {visible.length === 0 ? (
          <EmptyState
            title={emptyText[0]}
            action={
              tab === 'upcoming' ? (
                <Link className="btn btn--primary" to="/providers">
                  Find a provider
                </Link>
              ) : null
            }
          >
            {emptyText[1]}
          </EmptyState>
        ) : (
          <ul className="appt-list">
            {visible.map((appt) => (
              <AppointmentItem
                key={appt.id}
                appt={appt}
                provider={data.providers[appt.provider_id]}
                user={user}
                highlighted={appt.id === highlightId}
                upcoming={tab === 'upcoming'}
                onCancel={setCancelTarget}
                onReview={setReviewTarget}
                onDeleteReview={setDeleteTarget}
              />
            ))}
          </ul>
        )}
      </div>

      {reviewTarget && (
        <ReviewModal
          appointment={reviewTarget}
          serviceName={data.providers[reviewTarget.provider_id]?.service_name ?? 'your appointment'}
          onDone={reviewSaved}
          onStale={reload}
          onClose={() => setReviewTarget(null)}
        />
      )}

      {deleteTarget && (
        <Modal
          title="Delete your review?"
          busy={deleting}
          onClose={() => setDeleteTarget(null)}
          actions={
            <>
              <button type="button" className="btn btn--secondary" data-autofocus onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Keep review
              </button>
              <button type="button" className="btn btn--danger" onClick={confirmDeleteReview} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete review'}
              </button>
            </>
          }
        >
          <p>
            Your {deleteTarget.review.rating} star review of{' '}
            {data.providers[deleteTarget.provider_id]?.service_name ?? 'this appointment'} will be removed and the provider’s
            rating updated. You can write a new one afterwards.
          </p>
        </Modal>
      )}

      {cancelTarget && (
        <Modal
          title="Cancel this appointment?"
          busy={cancelling}
          onClose={() => setCancelTarget(null)}
          actions={
            <>
              <button type="button" className="btn btn--secondary" data-autofocus onClick={() => setCancelTarget(null)} disabled={cancelling}>
                Keep appointment
              </button>
              <button type="button" className="btn btn--danger" onClick={confirmCancel} disabled={cancelling}>
                {cancelling ? 'Cancelling…' : 'Cancel appointment'}
              </button>
            </>
          }
        >
          <p>
            {data.providers[cancelTarget.provider_id]?.service_name ?? 'Your appointment'} on{' '}
            {formatLongDate(cancelTarget.start_at, cancelTz)}, {formatRange(cancelTarget.start_at, cancelTarget.end_at, cancelTz)}.
            The time becomes available to other customers.
          </p>
        </Modal>
      )}
    </div>
  );
}
