import { addDays, dayParts, formatDay } from '../lib/time';

const DAYS_SHOWN = 14;

/**
 * A scrolling row of days. `today` and `selected` are calendar days ("YYYY-MM-DD") in the
 * provider's timezone. If the chosen date is beyond the two weeks shown, the strip starts there.
 */
export default function DateStrip({ today, selected, onSelect }) {
  const start = selected >= addDays(today, DAYS_SHOWN) ? selected : today;
  const days = Array.from({ length: DAYS_SHOWN }, (_, i) => addDays(start, i));

  return (
    <div className="date-strip" role="group" aria-label="Choose a day">
      {days.map((day) => {
        const parts = dayParts(day);
        return (
          <button
            key={day}
            type="button"
            className="day"
            aria-pressed={day === selected}
            aria-label={`${formatDay(day)}${day === today ? ', today' : ''}`}
            onClick={() => onSelect(day)}
          >
            {day === today && <span className="day__today" aria-hidden="true" />}
            <span className="day__weekday">{parts.weekday}</span>
            <span className="day__num">{parts.dayOfMonth}</span>
            <span className="day__month">{parts.month}</span>
          </button>
        );
      })}
    </div>
  );
}
