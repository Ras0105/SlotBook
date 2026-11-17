import { Link } from 'react-router-dom';
import { getNextAppointment } from '../api';
import useAsync from '../hooks/useAsync';
import { appointmentIcs, downloadIcs, icsFilename } from '../lib/ics';
import { fetchProvider } from '../lib/providerCache';
import { formatLongDate, formatRange, timeUntil, tzLabel, yourTimeNote } from '../lib/time';

async function load(signal) {
  const appointment = await getNextAppointment(signal);
  if (!appointment) return null;
  const provider = await fetchProvider(appointment.provider_id).catch(() => null); // the card still works without it
  return { appointment, provider };
}

/** "Your next appointment" for a logged-in customer. Shows nothing while loading, on errors, or when nothing is booked. */
export default function NextAppointmentCard() {
  const { data } = useAsync(load, []);
  if (!data) return null;
  const { appointment, provider } = data;
  const tz = provider?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const service = provider?.service_name ?? 'Your appointment';
  const note = yourTimeNote(appointment.start_at, tz);

  return (
    <section className="section next-appt-section" aria-labelledby="next-appt-title">
      <div className="section__inner">
        <div className="next-appt">
          <div>
            <p className="eyebrow" id="next-appt-title">
              Your next appointment
            </p>
            <h2 className="next-appt__service">{provider ? <Link to={`/providers/${provider.id}`}>{service}</Link> : service}</h2>
            <p className="next-appt__when num">
              {formatLongDate(appointment.start_at, tz)}, {formatRange(appointment.start_at, appointment.end_at, tz)}
            </p>
            <p className="muted">
              {timeUntil(appointment.start_at)}. {tzLabel(tz)} time{note ? `, ${note}` : ''}
            </p>
            {appointment.notes && (
              <p className="next-appt__notes">
                <span className="muted">Reason for visit:</span> {appointment.notes}
              </p>
            )}
          </div>
          <div className="next-appt__actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => downloadIcs(icsFilename(appointment), appointmentIcs(appointment, provider))}
            >
              Add to calendar
            </button>
            <Link className="btn btn--secondary" to={`/appointments/${appointment.id}/reschedule`}>
              Reschedule
            </Link>
            <Link className="btn btn--primary" to="/appointments">
              All appointments
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
