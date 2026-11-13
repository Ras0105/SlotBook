import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createBlockedSlot, deleteBlockedSlot, listBlockedSlots } from '../api';
import useAsync from '../hooks/useAsync';
import { friendlyError } from '../lib/errors';
import { addDays, formatPeriod, startOfDay, todayIn, zonedTimeToUtc } from '../lib/time';
import Alert from './Alert';
import EmptyState from './EmptyState';
import Field from './Field';
import Spinner from './Spinner';

const byStart = (a, b) => new Date(a.start_at) - new Date(b.start_at) || a.id - b.id;

export default function TimeOffPanel({ provider }) {
  const tz = provider.timezone;
  const today = todayIn(tz);
  const { data, error, loading, reload } = useAsync((signal) => listBlockedSlots({}, signal), []);
  const [blocks, setBlocks] = useState([]);
  const [form, setForm] = useState({ fromDay: today, fromTime: '09:00', toDay: today, toTime: '17:00', allDay: false, reason: '' });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [clash, setClash] = useState(false); // a 409 means customers are booked in that period
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (data) setBlocks([...data].sort(byStart));
  }, [data]);

  const set = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((f) => {
      const next = { ...f, [key]: value };
      // Keep "to" from falling behind "from" when the first date is moved forward.
      if (key === 'fromDay' && next.toDay < value) next.toDay = value;
      return next;
    });
    setFormError('');
    setClash(false);
  };

  async function add(event) {
    event.preventDefault();
    setNotice('');
    let startAt;
    let endAt;
    if (form.allDay) {
      startAt = startOfDay(form.fromDay, tz);
      endAt = startOfDay(addDays(form.toDay, 1), tz); // through the end of the last day
    } else {
      startAt = zonedTimeToUtc(form.fromDay, form.fromTime, tz);
      endAt = zonedTimeToUtc(form.toDay, form.toTime, tz);
    }
    if (!form.fromDay || !form.toDay || new Date(startAt) >= new Date(endAt)) {
      return setFormError('The end must be after the start.');
    }
    setBusy(true);
    setFormError('');
    setClash(false);
    try {
      const block = await createBlockedSlot({ startAt, endAt, reason: form.reason.trim() });
      setBlocks((list) => [...list, block].sort(byStart));
      setNotice('Time off added. Customers can no longer book that time.');
      setForm((f) => ({ ...f, reason: '' }));
    } catch (err) {
      setFormError(friendlyError(err));
      if (err.status === 409) setClash(true);
    } finally {
      setBusy(false);
    }
  }

  async function remove(block) {
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      await deleteBlockedSlot(block.id);
      setBlocks((list) => list.filter((b) => b.id !== block.id));
      setNotice('Time off removed. That time can be booked again.');
    } catch (err) {
      setActionError(friendlyError(err));
      if (err.status === 404) reload();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Loading time off" />;
  if (error) {
    return (
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
    );
  }

  return (
    <div>
      <p className="panel-intro muted">
        Block holidays, lunch breaks or anything else. Times are in {tz.replace(/_/g, ' ')} time. A period that has
        bookings in it cannot be blocked until those are cancelled or moved.
      </p>

      {notice && (
        <Alert kind="success" onDismiss={() => setNotice('')}>
          {notice}
        </Alert>
      )}
      {actionError && (
        <Alert kind="error" onDismiss={() => setActionError('')}>
          {actionError}
        </Alert>
      )}

      {blocks.length === 0 ? (
        <EmptyState title="No time off planned">Upcoming blocked periods will be listed here.</EmptyState>
      ) : (
        <ul className="rule-list" aria-label="Time off">
          {blocks.map((block) => (
            <li key={block.id} className="rule">
              <span className="rule__day">{block.reason || 'Time off'}</span>
              <span className="rule__time num">{formatPeriod(block.start_at, block.end_at, tz)}</span>
              <span className="rule__actions">
                <button
                  type="button"
                  className="btn-link btn-link--danger"
                  disabled={busy}
                  onClick={() => remove(block)}
                  aria-label={`Remove time off ${formatPeriod(block.start_at, block.end_at, tz)}`}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2 className="section-title">Add time off</h2>
      {clash && (
        <Alert kind="info">
          Customers are already booked in that period. <Link to="/appointments">Open your appointments</Link> to cancel
          or move them, then add the time off again.
        </Alert>
      )}
      <form className="form" onSubmit={add} noValidate>
        <label className="checkbox">
          <input type="checkbox" checked={form.allDay} onChange={set('allDay')} />
          All day (whole days)
        </label>
        <div className="form--row">
          <Field id="off-from-day" label="From date">
            {(props) => <input {...props} type="date" value={form.fromDay} min={today} onChange={set('fromDay')} />}
          </Field>
          {!form.allDay && (
            <Field id="off-from-time" label="From time">
              {(props) => <input {...props} type="time" value={form.fromTime} onChange={set('fromTime')} />}
            </Field>
          )}
          <Field id="off-to-day" label="To date">
            {(props) => <input {...props} type="date" value={form.toDay} min={form.fromDay} onChange={set('toDay')} />}
          </Field>
          {!form.allDay && (
            <Field id="off-to-time" label="To time">
              {(props) => <input {...props} type="time" value={form.toTime} onChange={set('toTime')} />}
            </Field>
          )}
        </div>
        <Field id="off-reason" label="Reason (optional)" error={formError}>
          {(props) => <input {...props} value={form.reason} maxLength={255} onChange={set('reason')} />}
        </Field>
        <button className="btn btn--primary" type="submit" disabled={busy}>
          Add time off
        </button>
      </form>
    </div>
  );
}
