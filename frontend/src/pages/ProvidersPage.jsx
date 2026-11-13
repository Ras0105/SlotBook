import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { listProviders } from '../api';
import Alert from '../components/Alert';
import EmptyState from '../components/EmptyState';
import Spinner from '../components/Spinner';
import useAsync from '../hooks/useAsync';
import { friendlyError } from '../lib/errors';
import { tzLabel } from '../lib/time';

const PAGE_SIZE = 10;

export default function ProvidersPage() {
  // The search text and page number live in the URL, so refresh and the Back button keep working.
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const [text, setText] = useState(q);
  useEffect(() => {
    setText(q);
  }, [q]);

  // Wait until the person stops typing before searching.
  useEffect(() => {
    if (text.trim() === q) return undefined;
    const timer = setTimeout(() => {
      const next = new URLSearchParams();
      if (text.trim()) next.set('q', text.trim());
      setParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(timer);
  }, [text, q, setParams]);

  // Ask for one extra row: if it comes back, there is a next page (the API has no total count).
  const { data, error, loading, reload } = useAsync(
    (signal) => listProviders({ search: q, skip: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE + 1 }, signal),
    [q, page],
  );

  const providers = data?.slice(0, PAGE_SIZE) ?? [];
  const hasNext = (data?.length ?? 0) > PAGE_SIZE;

  function goToPage(n) {
    const next = new URLSearchParams(params);
    if (n <= 1) next.delete('page');
    else next.set('page', String(n));
    setParams(next);
    window.scrollTo({ top: 0 });
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Book an appointment</h1>
        <p>Choose a provider, pick a time that works, and you are booked.</p>
      </div>

      <form className="search" role="search" onSubmit={(e) => e.preventDefault()}>
        <label className="visually-hidden" htmlFor="provider-search">
          Search by service
        </label>
        <input
          id="provider-search"
          type="search"
          placeholder="Search by service, like dentist or haircut"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </form>

      {loading && <Spinner label="Loading providers" />}

      {error && (
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

      {data && providers.length === 0 && (
        <EmptyState
          title={q ? `No providers match “${q}”` : 'No providers yet'}
          action={
            q || page > 1 ? (
              <button type="button" className="btn btn--secondary" onClick={() => setParams({})}>
                {q ? 'Clear search' : 'Back to the first page'}
              </button>
            ) : null
          }
        >
          {q ? 'Try a shorter or different word.' : 'Providers show up here once they set up their profile.'}
        </EmptyState>
      )}

      {providers.length > 0 && (
        <>
          <ul className="provider-list" aria-label="Providers">
            {providers.map((p) => (
              <li className="provider-row" key={p.id}>
                <Link className="provider-row__link" to={`/providers/${p.id}`}>
                  <span className="duration" aria-hidden="true">
                    <strong>{p.appointment_duration_minutes}</strong>
                    <span>min</span>
                  </span>
                  <span>
                    <span className="provider-row__name">{p.service_name}</span>
                    <br />
                    <span className="provider-row__meta">
                      {p.appointment_duration_minutes} minute appointments, {tzLabel(p.timezone)} time
                    </span>
                  </span>
                  <span className="provider-row__go">See times</span>
                </Link>
              </li>
            ))}
          </ul>

          {(page > 1 || hasNext) && (
            <nav className="pager" aria-label="Pages">
              <button type="button" className="btn btn--secondary" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
                Previous
              </button>
              <span className="muted">Page {page}</span>
              <button type="button" className="btn btn--secondary" disabled={!hasNext} onClick={() => goToPage(page + 1)}>
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
