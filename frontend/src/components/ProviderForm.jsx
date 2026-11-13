import { useMemo, useState } from 'react';
import Field from './Field';
import { allTimeZones, modernZone } from '../lib/time';

// Backend field name -> form field name, so a server-side 422 lands next to the right input.
const SERVER_FIELDS = {
  service_name: 'serviceName',
  appointment_duration_minutes: 'durationMinutes',
  timezone: 'timezone',
};

/** The same rules as the backend, so mistakes are caught before sending. Returns { field: message }. */
export function validateProvider(values) {
  const errors = {};
  const name = values.serviceName.trim();
  if (!name) errors.serviceName = 'Say what you offer, for example "Dental checkup".';
  else if (name.length > 150) errors.serviceName = 'Use 150 characters or fewer.';

  const minutes = Number(values.durationMinutes);
  if (values.durationMinutes === '' || !Number.isInteger(minutes) || minutes < 5 || minutes > 480) {
    errors.durationMinutes = 'Enter a whole number of minutes from 5 to 480.';
  }
  if (!values.timezone) errors.timezone = 'Choose a timezone.';
  return errors;
}

/**
 * The provider profile form, used both to create a profile and to edit it.
 *   initial: { serviceName, durationMinutes, timezone }
 *   onSubmit(values) receives trimmed, typed values: { serviceName, durationMinutes (number), timezone }
 *   serverFields: errors the server sent back, keyed by the BACKEND's field names
 */
export default function ProviderForm({ initial, submitLabel, busyLabel, busy, onSubmit, serverFields = {}, hint }) {
  const [values, setValues] = useState({ ...initial, timezone: modernZone(initial.timezone) });
  const [errors, setErrors] = useState({});
  const zones = useMemo(() => allTimeZones(), []);

  const set = (key) => (event) => {
    setValues((v) => ({ ...v, [key]: event.target.value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const fromServer = {};
  Object.entries(serverFields).forEach(([backendName, message]) => {
    if (SERVER_FIELDS[backendName]) fromServer[SERVER_FIELDS[backendName]] = message;
  });
  const shown = (key) => errors[key] ?? fromServer[key];

  function handleSubmit(event) {
    event.preventDefault();
    const found = validateProvider(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSubmit({
      serviceName: values.serviceName.trim(),
      durationMinutes: Number(values.durationMinutes),
      timezone: values.timezone,
    });
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <Field id="serviceName" label="What do you offer?" error={shown('serviceName')} hint="Customers see this name.">
        {(props) => <input {...props} value={values.serviceName} onChange={set('serviceName')} maxLength={150} />}
      </Field>
      <Field id="durationMinutes" label="Appointment length (minutes)" error={shown('durationMinutes')}>
        {(props) => (
          <input {...props} type="number" inputMode="numeric" min={5} max={480} value={values.durationMinutes} onChange={set('durationMinutes')} />
        )}
      </Field>
      <Field id="timezone" label="Your timezone" error={shown('timezone')} hint={hint}>
        {(props) => (
          <select {...props} value={values.timezone} onChange={set('timezone')}>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        )}
      </Field>
      <button className="btn btn--primary" type="submit" disabled={busy}>
        {busy ? busyLabel : submitLabel}
      </button>
    </form>
  );
}
