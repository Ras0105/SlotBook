import { getSlots } from '../api';
import useAsync from '../hooks/useAsync';
import { addDays, formatDay, groupSlots, formatTime, todayIn, tzLabel } from '../lib/time';
import { friendlyError } from '../lib/errors';
import Alert from './Alert';
import DateStrip from './DateStrip';
import Spinner from './Spinner';

/**
 * Pick a day, see that day's free times, choose one. Used for booking AND rescheduling.
 * The parent owns `date` and `selected`, so it can clear them (for example after a 409).
 * Bump `reloadKey` to fetch the day's slots again.
 */
export default function SlotPicker({ provider, date, onDateChange, selected, onSelect, reloadKey = 0 }) {
  const tz = provider.timezone;
  const today = todayIn(tz);
  const { data, error, loading, reload } = useAsync((signal) => getSlots(provider.id, date, signal), [
    provider.id,
    date,
    reloadKey,
  ]);

  return (
    <section className="picker" aria-labelledby="picker-title">
      <h2 id="picker-title">Pick a time</h2>
      <p className="picker__zone">
        All times are in {tzLabel(tz)} time ({tz}).
      </p>

      <DateStrip today={today} selected={date} onSelect={onDateChange} />
      <div className="date-jump">
        <label htmlFor="jump-date">Another date</label>
        <input
          id="jump-date"
          type="date"
          min={today}
          value={date}
          onChange={(e) => e.target.value && e.target.value >= today && onDateChange(e.target.value)}
        />
        {date !== today && (
          <button type="button" className="btn-link" onClick={() => onDateChange(today)}>
            Back to today
          </button>
        )}
      </div>

      <div className="slot-day">
        {loading && <Spinner label="Loading times" />}

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

        {data && data.slots.length === 0 && (
          <div className="empty">
            <h2>No times on {formatDay(date)}</h2>
            <p>The provider has nothing free that day. Try another day.</p>
            <button type="button" className="btn btn--secondary" onClick={() => onDateChange(addDays(date, 1))}>
              Check {formatDay(addDays(date, 1)).split(',')[0]}
            </button>
          </div>
        )}

        {data && data.slots.length > 0 && (
          <>
            <p className="visually-hidden" role="status">
              {data.slots.length} times available on {formatDay(date)}
            </p>
            {groupSlots(data.slots, tz).map((group) => (
              <div className="slot-group" key={group.key}>
                <h3>{group.label}</h3>
                <ul className="slot-grid">
                  {group.slots.map((slot) => (
                    <li key={slot.start_at}>
                      <button
                        type="button"
                        className="slot"
                        aria-pressed={selected?.start_at === slot.start_at}
                        onClick={() => onSelect(slot)}
                      >
                        {formatTime(slot.start_at, tz)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
