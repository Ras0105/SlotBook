import { useState } from 'react';
import { createReview } from '../api';
import { friendlyError } from '../lib/errors';
import Alert from './Alert';
import Modal from './Modal';

const WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
const MAX_COMMENT = 1000;

/**
 * Ask for a rating (1 to 5 stars, required) and an optional comment.
 * Stars are a radio group, so the keyboard (arrow keys) and screen readers work as they do for any radio buttons.
 *   appointment, serviceName: what is being reviewed
 *   onDone(review): called after the review was saved
 *   onStale(): called when the server says this appointment cannot be reviewed (already reviewed, ...), so the page can refresh
 *   onClose(): cancel
 */
export default function ReviewModal({ appointment, serviceName, onDone, onStale, onClose }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ratingError, setRatingError] = useState('');

  async function submit() {
    if (rating < 1) {
      setRatingError('Choose a rating from 1 to 5 stars.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      onDone(await createReview(appointment.id, { rating, comment }));
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
      if (err.status === 409) onStale?.(); // already reviewed / not reviewable: the page's list is out of date
    }
  }

  return (
    <Modal
      title="Rate your appointment"
      busy={busy}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose} disabled={busy}>
            Not now
          </button>
          <button type="button" className="btn btn--primary" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : 'Submit review'}
          </button>
        </>
      }
    >
      <p>How was {serviceName}?</p>
      {error && <Alert kind="error">{error}</Alert>}

      <fieldset className="stars-input">
        <legend>Your rating</legend>
        <div className="stars-input__row">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className={`stars-input__star${rating >= n ? ' is-on' : ''}`}>
              <input
                type="radio"
                name="rating"
                value={n}
                checked={rating === n}
                onChange={() => {
                  setRating(n);
                  setRatingError('');
                }}
                data-autofocus={n === 1 ? true : undefined}
              />
              <span aria-hidden="true">★</span>
              <span className="visually-hidden">
                {n} {n === 1 ? 'star' : 'stars'}, {WORDS[n]}
              </span>
            </label>
          ))}
          <span className="stars-input__word" aria-hidden="true">
            {WORDS[rating]}
          </span>
        </div>
        {ratingError && <p className="field__error">{ratingError}</p>}
      </fieldset>

      <div className="field">
        <label htmlFor="review-comment">Comment (optional)</label>
        <textarea
          id="review-comment"
          rows={4}
          maxLength={MAX_COMMENT}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="What went well? What could be better?"
        />
        <p className="field__hint">
          Your first name and the first letter of your surname are shown with your review.
        </p>
      </div>
    </Modal>
  );
}
