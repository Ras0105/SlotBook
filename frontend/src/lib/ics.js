// "Add to calendar": builds an iCalendar (.ics) file for one appointment. Every calendar app
// (Apple, Google, Outlook, Thunderbird) can import it. Everything is done in the browser.

/** 2030-01-07T03:30:00Z -> "20300107T033000Z" */
function stamp(date) {
  return new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** iCalendar text values escape backslash, semicolon, comma and line breaks. */
export function escapeText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Lines may be at most 75 bytes; longer ones continue on the next line after a single space. */
export function fold(line) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/**
 * buildIcs({ uid, title, start, end, description, location, url, now })
 * start / end: ISO strings (UTC instants, as the API sends them). Returns the file text.
 */
export function buildIcs({ uid, title, start, end, description, location, url, now = new Date() }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SlotBook//Appointments//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escapeText(title)}`,
    ...(description ? [`DESCRIPTION:${escapeText(description)}`] : []),
    ...(location ? [`LOCATION:${escapeText(location)}`] : []),
    ...(url ? [`URL:${url}`] : []),
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(title)}`,
    'TRIGGER:-PT1H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** The .ics text for one SlotBook appointment. `provider` may be missing (then the title is generic). */
export function appointmentIcs(appt, provider, { origin = window.location.origin, now } = {}) {
  const service = provider?.service_name ?? 'Appointment';
  return buildIcs({
    uid: `appointment-${appt.id}@slotbook`, // the same UID every time: importing again updates the event
    title: service,
    start: appt.start_at,
    end: appt.end_at,
    description: `Booked on SlotBook. Reference #${appt.id}.`,
    url: provider ? `${origin}/providers/${provider.id}` : undefined,
    now,
  });
}

export const icsFilename = (appt) => `slotbook-appointment-${appt.id}.ics`;

/** Hand the file to the browser as a download. */
export function downloadIcs(filename, text) {
  const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
