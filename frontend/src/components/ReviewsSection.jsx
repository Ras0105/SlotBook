import { useState } from 'react';
import { listProviderReviews } from '../api';
import useAsync from '../hooks/useAsync';
import { friendlyError } from '../lib/errors';
import Alert from './Alert';
import Spinner from './Spinner';
import StarRating, { StarsOnly } from './StarRating';

const PAGE = 10;

const formatDate = (iso) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

/** The public reviews of one provider, newest first, with a "Show more" button. */
export default function ReviewsSection({ provider }) {
  const first = useAsync((signal) => listProviderReviews(provider.id, { skip: 0, limit: PAGE + 1 }, signal), [provider.id]);
  const [more, setMore] = useState([]); // pages loaded after the first
  const [hasMore, setHasMore] = useState(null); // null: not decided by a "Show more" yet
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');

  const firstRows = first.data?.slice(0, PAGE) ?? [];
  const rows = [...firstRows, ...more];
  const canLoadMore = hasMore ?? (first.data?.length ?? 0) > PAGE;

  async function showMore() {
    setLoadingMore(true);
    setMoreError('');
    try {
      const next = await listProviderReviews(provider.id, { skip: rows.length, limit: PAGE + 1 });
      setMore((m) => [...m, ...next.slice(0, PAGE)]);
      setHasMore(next.length > PAGE);
    } catch (err) {
      setMoreError(friendlyError(err));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="reviews" aria-labelledby="reviews-heading">
      <h2 id="reviews-heading">Reviews</h2>
      <p className="reviews__summary">
        <StarRating average={provider.rating_avg} count={provider.review_count} />
      </p>

      {first.loading && <Spinner label="Loading reviews" />}
      {first.error && (
        <Alert
          kind="error"
          action={
            <button type="button" className="btn-link" onClick={first.reload}>
              Try again
            </button>
          }
        >
          {friendlyError(first.error)}
        </Alert>
      )}

      {first.data && rows.length === 0 && (
        <p className="muted">Customers can leave a review after their appointment. None yet.</p>
      )}

      {rows.length > 0 && (
        <ul className="review-list">
          {rows.map((r) => (
            <li className="review" key={r.id}>
              <div className="review__top">
                <strong>{r.reviewer_name}</strong>
                <StarsOnly rating={r.rating} />
                <time className="muted" dateTime={r.created_at}>
                  {formatDate(r.created_at)}
                </time>
              </div>
              {r.comment && <p className="review__comment">{r.comment}</p>}
            </li>
          ))}
        </ul>
      )}

      {moreError && <Alert kind="error" onDismiss={() => setMoreError('')}>{moreError}</Alert>}
      {canLoadMore && (
        <button type="button" className="btn btn--secondary" onClick={showMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Show more reviews'}
        </button>
      )}
    </section>
  );
}
