import { useState } from 'react';
import { getMyCalendar, listBlockedSlots } from '../api';
import useAsync from '../hooks/useAsync';
import { friendlyError } from '../lib/errors';
import {
  addDays,
  dayParts,
  formatDay,
  formatPeriod,
  formatRange,
  formatWeekRange,
  minutesOfDay,
  mondayOf,
  startOfDay,
  todayIn,
  tzLabel,
  weekDays,
} from '../lib/time';
import Alert from './Alert';
import Spinner from './Spinner';

const DEFAULT_FIRST_HOUR = 8; // the grid always shows at least 8 am to 6 pm,
const DEFAULT_LAST_HOUR = 18; // and grows to fit earlier or later appointments

const hourLabel = (h) => `${h % 12 === 0 ? 12 : h % 12} ${h >= 12 ? 'pm' : 'am'}`;

/** Which hours the grid covers: [first, last), whole hours. */
export function hourRange(entries, timeZone) {
  let first = DEFAULT_FIRST_HOUR;
  let last = DEFAULT_LAST_HOUR;
  entries.forEach((e) => {
    first = Math.min(first, Math.floor(minutesOfDay(e.start_at, timeZone) / 60));
    const endMinutes = minutesOfDay(e.end_at, timeZone);
    // An appointment ending exactly at midnight reads as minute 0 of the next day: treat it as 24:00.
    last = Math.max(last, Math.ceil((endMinutes === 0 ? 24 * 60 : endMinutes) / 60));
  });
  return [first, Math.max(last, first + 1)];
}

/** Where an appointment sits inside its day column, in minutes from the top of the grid (clipped to the day). */
export function placement(entry, day, timeZone, firstHour) {
  const startedBeforeToday = new Date(entry.start_at) < new Date(startOfDay(day, timeZone));
  const sameDayStart = startedBeforeToday ? 0 : minutesOfDay(entry.start_at, timeZone);
  const duration = (new Date(entry.end_at) - new Date(entry.start_at)) / 60_000;
  const top = sameDayStart - firstHour * 60;
  return { top, height: Math.max(duration, 15) };
}

/**
 * Where a time-off period sits inside one day's column: minutes from the top of the grid, clipped to that day and
 * to the hours the grid shows. Returns null when the period does not touch this day's visible hours.
 */
export function blockPlacement(block, day, timeZone, firstHour, lastHour) {
  const dayStart = new Date(startOfDay(day, timeZone)).getTime();
  const dayEnd = new Date(startOfDay(addDays(day, 1), timeZone)).getTime();
  const from = Math.max(new Date(block.start_at).getTime(), dayStart);
  const to = Math.min(new Date(block.end_at).getTime(), dayEnd);
  if (from >= to) return null; // does not touch this day
  const startMinutes = from === dayStart ? 0 : minutesOfDay(new Date(from).toISOString(), timeZone);
  const endMinutes = to === dayEnd ? 24 * 60 : minutesOfDay(new Date(to).toISOString(), timeZone);
  const top = Math.max(startMinutes, firstHour * 60);
  const bottom = Math.min(endMinutes, lastHour * 60);
  if (bottom <= top) return null; // only outside the visible hours
  return { top: top - firstHour * 60, height: bottom - top };
}

// Compare real instants (Date), never the ISO text: "…:00Z" and "…:00.000Z" sort differently as strings.
function dayOfEntry(entry, days, timeZone) {
  const at = new Date(entry.start_at).getTime();
  return days.find((d) => {
    const start = new Date(startOfDay(d, timeZone)).getTime();
    const end = new Date(startOfDay(addDays(d, 1), timeZone)).getTime();
    return at >= start && at < end;
  });
}

/**
 * The provider's week: seven columns (Monday to Sunday, in the PROVIDER's timezone) and the booked
 * and completed appointments as blocks at their time of day. Cancelled ones are not shown.
 */
export default function CalendarPanel({ provider }) {
  const tz = provider.timezone;
  const today = todayIn(tz);
  const [monday, setMonday] = useState(() => mondayOf(today));
  const days = weekDays(monday);

  // Bookings and time off for the week, fetched together so the grid never shows half the picture.
  const { data, error, loading, reload } = useAsync(async (signal) => {
    const range = { start: startOfDay(monday, tz), end: startOfDay(addDays(monday, 7), tz) };
    const [entries, blocks] = await Promise.all([getMyCalendar(range, signal), listBlockedSlots(range, signal)]);
    return { entries, blocks };
  }, [monday, tz]);

  const entries = data?.entries ?? [];
  const blocks = data?.blocks ?? [];
  const { data, error, loading, reload } = useAsync(
    (signal) => getMyCalendar({ start: startOfDay(monday, tz), end: startOfDay(addDays(monday, 7), tz) }, signal),
    [monday, tz],
  );

  const entries = data ?? [];
  const [firstHour, lastHour] = hourRange(entries, tz);
  const hours = Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i);
  const byDay = Object.fromEntries(days.map((d) => [d, []]));
  entries.forEach((e) => {
    const d = dayOfEntry(e, days, tz);
    if (d) byDay[d].push(e);
  });
  const count = entries.length;

  return (
    <section className="calendar" aria-labelledby="calendar-heading">
      <div className="calendar__bar">
        <h2 id="calendar-heading">
          <span className="visually-hidden">Calendar, week of </span>
          {formatWeekRange(monday)}
        </h2>
        <div className="calendar__nav">
          <button type="button" className="btn btn--secondary btn--small" onClick={() => setMonday(addDays(monday, -7))}>
            Previous week
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={() => setMonday(mondayOf(today))}
            disabled={monday === mondayOf(today)}
          >
            This week
          </button>
          <button type="button" className="btn btn--secondary btn--small" onClick={() => setMonday(addDays(monday, 7))}>
            Next week
          </button>
        </div>
      </div>
      <p className="muted calendar__zone">
        {tzLabel(tz)} time.{' '}
        {loading ? 'Loading…' : count === 0 ? 'No appointments this week.' : `${count} ${count === 1 ? 'appointment' : 'appointments'} this week.`}
        {blocks.length > 0 && ' Hatched areas are time off.'}
      </p>

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
      {loading && !data && <Spinner label="Loading your calendar" />}

      <div className="calendar__scroll">
        <div className="week" style={{ '--hours': hours.length }}>
          <div className="week__corner" aria-hidden="true" />
          {days.map((d) => {
            const parts = dayParts(d);
            return (
              <div className={`week__head${d === today ? ' is-today' : ''}`} key={d} aria-hidden="true">
                <span>{parts.weekday}</span>
                <strong>{parts.dayOfMonth}</strong>
              </div>
            );
          })}

          <div className="week__hours" aria-hidden="true">
            {hours.map((h) => (
              <div className="week__hour" key={h}>
                <span>{hourLabel(h)}</span>
              </div>
            ))}
          </div>

          {days.map((d) => (
            <section className={`week__day${d === today ? ' is-today' : ''}`} key={d} aria-label={formatDay(d)}>
              <div className="week__lines" aria-hidden="true">
                {hours.map((h) => (
                  <div key={h} />
                ))}
              </div>
              <ul className="week__blocks">
                {blocks.map((b) => {
                  const placed = blockPlacement(b, d, tz, firstHour, lastHour);
                  if (!placed) return null;
                  return (
                    <li key={b.id} className="block" style={{ '--top': placed.top, '--height': placed.height }}>
                      <strong>Time off</strong>
                      {b.reason && <span>{b.reason}</span>}
                      <span className="visually-hidden">, {formatPeriod(b.start_at, b.end_at, tz)}</span>
                    </li>
                  );
                })}
              </ul>
              <ul className="week__events">
                {byDay[d].map((e) => {
                  const { top, height } = placement(e, d, tz, firstHour);
                  return (
                    <li
                      key={e.id}
                      className={`event event--${e.status}`}
                      style={{ '--top': top, '--height': height }}
                    >
                      <strong>{e.customer_name}</strong>
                      <span className="num">{formatRange(e.start_at, e.end_at, tz)}</span>
                      {e.notes && <span className="event__note">{e.notes}</span>}
                      <span className="visually-hidden">
                        , {e.status}
                        {e.notes ? `, reason for visit: ${e.notes}` : ''}
                      </span>
                      <span className="visually-hidden">, {e.status}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
