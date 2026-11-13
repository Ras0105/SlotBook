import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listAdminAppointments } from '../api';
import AdminNav from '../components/AdminNav';
import Alert from '../components/Alert';
import EmptyState from '../components/EmptyState';
import Field from '../components/Field';
import Spinner from '../components/Spinner';
import StatusBadge from '../components/StatusBadge';
import useAsync from '../hooks/useAsync';
import { friendlyError } from '../lib/errors';
import { fetchProvider } from '../lib/providerCache';
import { addDays, formatPeriod, isDateString, startOfDay, userTimeZone } from '../lib/time';

const PAGE_SIZE = 20;
const STATUSES = ['booked', 'cancelled', 'completed'];

// Junk in the URL is ignored instead of being sent to the server.
const asId = (value) => (/^[1-9]\d{0,9}$/.test(value ?? '') ? value : '');
const asDay = (value) => (isDateString(value) ? value : '');

async function load({ filters, page, tz }, signal) {
  const rows = await listAdminAppointments(
    {
      providerId: filters.provider,
      customerId: filters.customer,
      status: filters.status,
      dateFrom: filters.from ? startOfDay(filters.from, tz) : undefined,
      dateTo: filters.to ? startOfDay(addDays(filters.to, 1), tz) : undefined, // "to" is inclusive
      skip: (page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE + 1, // one extra row tells us whether a next page exists
    },
    signal,
  );
  const ids = [...new Set(rows.map((a) => a.provider_id))];
  const results = await Promise.allSettled(ids.map((id) => fetchProvider(id)));
  const providers = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') providers[ids[i]] = r.value;
  });
  return { rows, providers };
}

export default function AdminAppointmentsPage() {
  const tz = userTimeZone();
  const [params, setParams] = useSearchParams();
  const filters = {
    status: STATUSES.includes(params.get('status')) ? params.get('status') : '',
    provider: asId(params.get('provider')),
    customer: asId(params.get('customer')),
    from: asDay(params.get('from')),
    to: asDay(params.get('to')),
  };
  const page = Math.max(1, Number(params.get('page')) || 1);
  const backwards = Boolean(filters.from && filters.to && filters.from > filters.to);
  const [draft, setDraft] = useState(filters);

  const { data, error, loading, reload } = useAsync(
    (signal) => (backwards ? Promise.resolve(null) : load({ filters, page, tz }, signal)),
    [filters.status, filters.provider, filters.customer, filters.from, filters.to, page, backwards],
  );

  const set = (key) => (event) => setDraft((d) => ({ ...d, [key]: event.target.value }));

  function writeParams(next, nextPage = 1) {
    const out = new URLSearchParams();
    Object.entries(next).forEach(([key, value]) => {
      if (value) out.set(key, value);
    });
    if (nextPage > 1) out.set('page', String(nextPage));
    setParams(out);
  }

  function apply(event) {
    event.preventDefault();
    writeParams({ status: draft.status, provider: draft.provider.trim(), customer: draft.customer.trim(), from: draft.from, to: draft.to });
  }

  function clear() {
    const empty = { status: '', provider: '', customer: '', from: '', to: '' };
    setDraft(empty);
    setParams(new URLSearchParams());
  }

  const rows = data?.rows.slice(0, PAGE_SIZE) ?? [];
  const hasNext = (data?.rows.length ?? 0) > PAGE_SIZE;
  const filtered = Object.values(filters).some(Boolean);

  return (
    <div className="page">
      <div className="page-head">
        <h1>All appointments</h1>
        <p>Every booking in the system, newest first.</p>
      </div>
      <AdminNav />

      <form className="form form--filters" onSubmit={apply} noValidate>
        <Field id="f-status" label="Status">
          {(props) => (
            <select {...props} value={draft.status} onChange={set('status')}>
              <option value="">Any status</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          )}
        </Field>
        <Field id="f-provider" label="Provider number">
          {(props) => <input {...props} inputMode="numeric" value={draft.provider} onChange={set('provider')} />}
        </Field>
        <Field id="f-customer" label="Customer number">
          {(props) => <input {...props} inputMode="numeric" value={draft.customer} onChange={set('customer')} />}
        </Field>
        <Field id="f-from" label="From date">
          {(props) => <input {...props} type="date" value={draft.from} onChange={set('from')} />}
        </Field>
        <Field id="f-to" label="To date">
          {(props) => <input {...props} type="date" value={draft.to} onChange={set('to')} />}
        </Field>
        <div className="form__buttons">
          <button className="btn btn--primary" type="submit">Apply filters</button>
          <button className="btn btn--secondary" type="button" onClick={clear}>Clear</button>
        </div>
      </form>

      {backwards && <Alert kind="error">The first date must not be after the last.</Alert>}
      {!backwards && loading && <Spinner label="Loading appointments" />}
      {!backwards && error && (
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

      {!backwards && data && rows.length === 0 && (
        <EmptyState title={filtered ? 'No appointments match these filters' : 'No appointments yet'}>
          {filtered ? 'Try removing a filter.' : 'Bookings will show up here.'}
        </EmptyState>
      )}

      {!backwards && data && rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">No.</th>
                  <th scope="col">Provider</th>
                  <th scope="col">Customer</th>
                  <th scope="col">When (provider's time)</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const provider = data.providers[a.provider_id];
                  const zone = provider?.timezone ?? tz;
                  return (
                    <tr key={a.id}>
                      <td className="num">{a.id}</td>
                      <td>
                        {provider ? <Link to={`/providers/${a.provider_id}`}>{provider.service_name}</Link> : `Provider #${a.provider_id}`}
                      </td>
                      <td className="num">#{a.customer_id}</td>
                      <td className="num">{formatPeriod(a.start_at, a.end_at, zone)}</td>
                      <td><StatusBadge status={a.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <button type="button" className="btn btn--secondary" disabled={page <= 1} onClick={() => writeParams(filters, page - 1)}>
              Previous
            </button>
            <span className="muted">Page {page}</span>
            <button type="button" className="btn btn--secondary" disabled={!hasNext} onClick={() => writeParams(filters, page + 1)}>
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
