import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getAdminStats } from '../api';
import AdminNav from '../components/AdminNav';
import Alert from '../components/Alert';
import BarChart from '../components/BarChart';
import EmptyState from '../components/EmptyState';
import Field from '../components/Field';
import Spinner from '../components/Spinner';
import useAsync from '../hooks/useAsync';
import { friendlyError } from '../lib/errors';
import { addDays, isDateString, startOfDay, todayIn, userTimeZone } from '../lib/time';

const PRESETS = [
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
];
const MAX_CUSTOM_DAYS = 92;

/** Work out the period from the URL: { query } to send, or { problem } to show instead. */
function resolvePeriod(range, from, to, tz) {
  const preset = PRESETS.find((p) => p.key === range);
  if (range !== 'custom') {
    const p = preset ?? PRESETS[1];
    const today = todayIn(tz);
    return { key: p.key, query: { dateFrom: startOfDay(addDays(today, -(p.days - 1)), tz), dateTo: startOfDay(addDays(today, 1), tz) } };
  }
  if (!isDateString(from) || !isDateString(to)) return { key: 'custom', problem: null }; // nothing chosen yet
  if (from > to) return { key: 'custom', problem: 'The first date must not be after the last.' };
  if (new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`) > (MAX_CUSTOM_DAYS - 1) * 86_400_000) {
    return { key: 'custom', problem: `Choose a period of up to ${MAX_CUSTOM_DAYS} days.` };
  }
  return { key: 'custom', query: { dateFrom: startOfDay(from, tz), dateTo: startOfDay(addDays(to, 1), tz) } };
}

/** The API only lists days that have bookings; the chart wants every day in the period. */
function fillDays(stats) {
  const counts = new Map(stats.bookings_per_day.map((d) => [d.date, d.count]));
  const first = stats.date_from.slice(0, 10);
  const last = new Date(new Date(stats.date_to).getTime() - 1).toISOString().slice(0, 10);
  const days = [];
  for (let day = first; day <= last && days.length < 400; day = addDays(day, 1)) {
    days.push({ date: day, count: counts.get(day) ?? 0 });
  }
  return days;
}

const percent = (rate) => `${Math.round(rate * 1000) / 10}%`;

export default function AdminOverviewPage() {
  const tz = userTimeZone();
  const [params, setParams] = useSearchParams();
  const range = params.get('range') ?? '30';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const period = resolvePeriod(range, from, to, tz);
  const [draft, setDraft] = useState({ from, to });

  const { data, error, loading, reload } = useAsync(
    (signal) => (period.query ? getAdminStats(period.query, signal) : Promise.resolve(null)),
    [period.key, period.query?.dateFrom, period.query?.dateTo],
  );

  function choose(key) {
    setParams(key === '30' ? {} : { range: key }, { replace: true });
  }

  function showCustom(event) {
    event.preventDefault();
    setParams({ range: 'custom', from: draft.from, to: draft.to }, { replace: true });
  }

  const days = data ? fillDays(data) : [];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Admin overview</h1>
        <p>How busy SlotBook has been. Counts cover appointments that start in the chosen period.</p>
      </div>
      <AdminNav />

      <div className="range-picker" role="group" aria-label="Period">
        {PRESETS.map((p) => (
          <button key={p.key} type="button" className="btn btn--secondary btn--small" aria-pressed={period.key === p.key} onClick={() => choose(p.key)}>
            {p.label}
          </button>
        ))}
        <button type="button" className="btn btn--secondary btn--small" aria-pressed={period.key === 'custom'} onClick={() => choose('custom')}>
          Custom
        </button>
      </div>

      {period.key === 'custom' && (
        <form className="form form--row" onSubmit={showCustom} noValidate>
          <Field id="stats-from" label="First day">
            {(props) => <input {...props} type="date" value={draft.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />}
          </Field>
          <Field id="stats-to" label="Last day">
            {(props) => <input {...props} type="date" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />}
          </Field>
          <button className="btn btn--primary" type="submit">
            Show
          </button>
        </form>
      )}

      {period.problem && <Alert kind="error">{period.problem}</Alert>}
      {!period.query && !period.problem && <EmptyState title="Pick a period">Choose the first and last day, then press Show.</EmptyState>}

      {period.query && loading && <Spinner label="Loading statistics" />}
      {period.query && error && (
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
      )}

      {period.query && data && (
        <>
          <dl className="stat-grid" aria-label="Totals">
            <div className="stat"><dt>Appointments</dt><dd className="num">{data.total_appointments}</dd></div>
            <div className="stat"><dt>Booked</dt><dd className="num">{data.by_status.booked}</dd></div>
            <div className="stat"><dt>Completed</dt><dd className="num">{data.by_status.completed}</dd></div>
            <div className="stat"><dt>Cancelled</dt><dd className="num">{data.by_status.cancelled}</dd></div>
            <div className="stat"><dt>Cancellation rate</dt><dd className="num">{percent(data.cancellation_rate)}</dd></div>
          </dl>

          {data.total_appointments === 0 ? (
            <EmptyState title="Nothing was booked in this period">Try a longer period.</EmptyState>
          ) : (
            <>
              <h2 className="section-title">Bookings per day</h2>
              {days.length > 0 && <BarChart days={days} />}

              <h2 className="section-title">Busiest providers</h2>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Provider</th>
                    <th scope="col" className="num">Bookings</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_providers.map((p) => (
                    <tr key={p.provider_id}>
                      <td><Link to={`/providers/${p.provider_id}`}>{p.service_name}</Link></td>
                      <td className="num">{p.bookings}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted">Cancelled appointments are not counted here.</p>
            </>
          )}
        </>
      )}
    </div>
  );
}
