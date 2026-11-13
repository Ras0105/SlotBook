import { formatDayShort } from '../lib/time';

/**
 * Bookings per day as plain CSS bars (no chart library needed for one simple chart).
 * Screen readers get a one-sentence summary; a table with the same numbers sits right below.
 *   days: [{ date: '2026-11-16', count: 3 }, ...] oldest first, including days with 0
 */
export default function BarChart({ days }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((sum, d) => sum + d.count, 0);
  const busiest = days.reduce((best, d) => (d.count > best.count ? d : best), days[0]);
  const summary =
    total === 0
      ? `Bookings per day: none in these ${days.length} days.`
      : `Bookings per day: ${total} in ${days.length} days. Busiest day ${formatDayShort(busiest.date)} with ${busiest.count}.`;

  return (
    <div>
      <figure className="chart">
        <div className="bars" role="img" aria-label={summary}>
          {days.map((d) => (
            <div key={d.date} className="bars__col" title={`${formatDayShort(d.date)}: ${d.count}`}>
              <div className="bars__bar" style={{ height: `${(d.count / max) * 100}%` }} data-empty={d.count === 0} />
            </div>
          ))}
        </div>
        <figcaption className="muted">Days are UTC days. {days.length > 0 && `${formatDayShort(days[0].date)} to ${formatDayShort(days[days.length - 1].date)}.`}</figcaption>
      </figure>
      <details className="chart-table">
        <summary>Show the numbers</summary>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col" className="num">Bookings</th>
            </tr>
          </thead>
          <tbody>
            {days.filter((d) => d.count > 0).map((d) => (
              <tr key={d.date}>
                <td>{formatDayShort(d.date)}</td>
                <td className="num">{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
