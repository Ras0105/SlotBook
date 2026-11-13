import { useEffect, useState } from 'react';
import { createAvailability, deleteAvailability, listAvailability, updateAvailability } from '../api';
import useAsync from '../hooks/useAsync';
import { friendlyError } from '../lib/errors';
import { WEEKDAYS, clockToApi, clockToInput, formatClockRange } from '../lib/time';
import Alert from './Alert';
import Field from './Field';
import Spinner from './Spinner';

const byTime = (a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time);
const EMPTY = { weekday: '0', start: '09:00', end: '17:00' };

function checkRange(form) {
  if (!form.start || !form.end) return 'Choose a start and an end time.';
  if (form.start >= form.end) return 'The start time must be before the end time.';
  return '';
}

export default function WorkingHoursPanel({ provider }) {
  const { data, error, loading, reload } = useAsync((signal) => listAvailability(provider.id, signal), [provider.id]);
  const [rules, setRules] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [edit, setEdit] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (data) setRules([...data].sort(byTime));
  }, [data]);

  const setField = (key) => (event) => {
    setForm((f) => ({ ...f, [key]: event.target.value }));
    setFormError('');
  };
  const setEditField = (key) => (event) => setEdit((f) => ({ ...f, [key]: event.target.value }));

  async function add(event) {
    event.preventDefault();
    const problem = checkRange(form);
    if (problem) return setFormError(problem);
    setBusy(true);
    setFormError('');
    try {
      const rule = await createAvailability({
        weekday: Number(form.weekday),
        startTime: clockToApi(form.start),
        endTime: clockToApi(form.end),
      });
      setRules((list) => [...list, rule].sort(byTime));
    } catch (err) {
      setFormError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(rule) {
    setEditId(rule.id);
    setEdit({ weekday: String(rule.weekday), start: clockToInput(rule.start_time), end: clockToInput(rule.end_time) });
    setActionError('');
  }

  async function saveEdit(rule) {
    const problem = checkRange(edit);
    if (problem) return setActionError(problem);
    setBusy(true);
    setActionError('');
    try {
      const updated = await updateAvailability(rule.id, {
        weekday: Number(edit.weekday),
        startTime: clockToApi(edit.start),
        endTime: clockToApi(edit.end),
      });
      setRules((list) => list.map((r) => (r.id === updated.id ? updated : r)).sort(byTime));
      setEditId(null);
    } catch (err) {
      setActionError(friendlyError(err));
      if (err.status === 404) reload();
    } finally {
      setBusy(false);
    }
  }

  async function remove(rule) {
    setBusy(true);
    setActionError('');
    try {
      await deleteAvailability(rule.id);
      setRules((list) => list.filter((r) => r.id !== rule.id));
    } catch (err) {
      setActionError(friendlyError(err));
      if (err.status === 404) reload();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Loading working hours" />;
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

  const weekdayOptions = WEEKDAYS.map((name, i) => (
    <option key={name} value={i}>
      {name}
    </option>
  ));

  return (
    <div>
      <p className="panel-intro muted">
        Customers can book inside these hours, in {provider.timezone.replace(/_/g, ' ')} time. Removing hours does not
        cancel appointments that are already booked.
      </p>

      {actionError && (
        <Alert kind="error" onDismiss={() => setActionError('')}>
          {actionError}
        </Alert>
      )}

      {rules.length === 0 ? (
        <Alert kind="info">You have no working hours yet, so customers cannot book you. Add your first hours below.</Alert>
      ) : (
        <ul className="rule-list" aria-label="Working hours">
          {rules.map((rule) =>
            editId === rule.id ? (
              <li key={rule.id} className="rule rule--editing">
                <div className="inline-form">
                  <Field id={`edit-day-${rule.id}`} label="Day">
                    {(props) => (
                      <select {...props} value={edit.weekday} onChange={setEditField('weekday')}>
                        {weekdayOptions}
                      </select>
                    )}
                  </Field>
                  <Field id={`edit-start-${rule.id}`} label="From">
                    {(props) => <input {...props} type="time" value={edit.start} onChange={setEditField('start')} />}
                  </Field>
                  <Field id={`edit-end-${rule.id}`} label="To">
                    {(props) => <input {...props} type="time" value={edit.end} onChange={setEditField('end')} />}
                  </Field>
                </div>
                <div className="rule__actions">
                  <button type="button" className="btn btn--primary btn--small" disabled={busy} onClick={() => saveEdit(rule)}>
                    Save
                  </button>
                  <button type="button" className="btn btn--secondary btn--small" disabled={busy} onClick={() => setEditId(null)}>
                    Cancel
                  </button>
                </div>
              </li>
            ) : (
              <li key={rule.id} className="rule">
                <span className="rule__day">{WEEKDAYS[rule.weekday]}</span>
                <span className="rule__time num">{formatClockRange(rule.start_time, rule.end_time)}</span>
                <span className="rule__actions">
                  <button type="button" className="btn-link" disabled={busy} onClick={() => startEdit(rule)} aria-label={`Edit ${WEEKDAYS[rule.weekday]} hours`}>
                    Edit
                  </button>
                  <button type="button" className="btn-link btn-link--danger" disabled={busy} onClick={() => remove(rule)} aria-label={`Remove ${WEEKDAYS[rule.weekday]} hours`}>
                    Remove
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}

      <h2 className="section-title">Add working hours</h2>
      <form className="form form--row" onSubmit={add} noValidate>
        <Field id="new-day" label="Day">
          {(props) => (
            <select {...props} value={form.weekday} onChange={setField('weekday')}>
              {weekdayOptions}
            </select>
          )}
        </Field>
        <Field id="new-start" label="From">
          {(props) => <input {...props} type="time" value={form.start} onChange={setField('start')} />}
        </Field>
        <Field id="new-end" label="To" error={formError}>
          {(props) => <input {...props} type="time" value={form.end} onChange={setField('end')} />}
        </Field>
        <button className="btn btn--primary" type="submit" disabled={busy}>
          Add hours
        </button>
      </form>
    </div>
  );
}
