import { formatRange, formatShortDate, tzLabel, yourTimeNote } from '../lib/time';

/** Sticks to the bottom of the screen once a slot is chosen: what you picked + the one button that commits. */
export default function ConfirmBar({ slot, timeZone, actionLabel, busyLabel, busy, onConfirm, children }) {
  const note = yourTimeNote(slot.start_at, timeZone);
  return (
    <div className="confirm-bar" role="region" aria-label="Your selection" aria-live="polite">
      <div className="confirm-bar__inner">
        <div>
          <div className="confirm-bar__when num">
            {formatShortDate(slot.start_at, timeZone)}, {formatRange(slot.start_at, slot.end_at, timeZone)}
          </div>
          <div className="confirm-bar__sub">
            {tzLabel(timeZone)} time{note ? `, ${note}` : ''}
          </div>
        </div>
        {children}
        <button type="button" className="btn btn--primary" onClick={onConfirm} disabled={busy}>
          {busy ? busyLabel : actionLabel}
        </button>
      </div>
    </div>
  );
}
