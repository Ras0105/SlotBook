// Time helpers. The API sends every timestamp in UTC; people want to see them in the
// PROVIDER'S timezone (that is where the appointment happens). Dates like "2026-11-16"
// are plain calendar days in that timezone, so we only do arithmetic on them in UTC
// (noon UTC is never near a date boundary), which avoids off-by-one-day bugs.

/** Today's calendar date ("YYYY-MM-DD") in the given IANA timezone. */
export function todayIn(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function isDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function dayToUtcNoon(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** "2026-11-16" + 3 -> "2026-11-19" */
export function addDays(day, n) {
  const date = dayToUtcNoon(day);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/** Parts for the date strip: { weekday: 'Mon', dayOfMonth: '16', month: 'Nov' } */
export function dayParts(day) {
  const date = dayToUtcNoon(day);
  const fmt = (options) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options }).format(date);
  return {
    weekday: fmt({ weekday: 'short' }),
    dayOfMonth: fmt({ day: 'numeric' }),
    month: fmt({ month: 'short' }),
  };
}

/** "Monday, 16 November 2026" for a calendar day. */
export function formatDay(day) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(dayToUtcNoon(day));
}

/** "9:00 am" for a UTC instant, shown in `timeZone`. */
export function formatTime(iso, timeZone) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(iso))
    .replace(/\s/g, ' ') // some browsers use a narrow no-break space before am/pm
    .toLowerCase();
}

/** "9:00 am to 9:30 am" */
export function formatRange(startIso, endIso, timeZone) {
  return `${formatTime(startIso, timeZone)} to ${formatTime(endIso, timeZone)}`;
}

/** "Mon 16 Nov" for a UTC instant, in `timeZone`. */
export function formatShortDate(iso, timeZone) {
  return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(
    new Date(iso),
  );
}

/** "Monday, 16 November 2026" for a UTC instant, in `timeZone`. */
export function formatLongDate(iso, timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

/** Calendar day ("YYYY-MM-DD") of a UTC instant in `timeZone`. */
export function dayOf(iso, timeZone) {
  return todayIn(timeZone, new Date(iso));
}

/** Hour of day (0-23) of a UTC instant in `timeZone`. */
export function hourOf(iso, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hourCycle: 'h23' }).formatToParts(
    new Date(iso),
  );
  return Number(parts.find((p) => p.type === 'hour').value) % 24;
}

/** Short city-style label: "Asia/Kolkata" -> "Kolkata". */
export function tzLabel(timeZone) {
  return timeZone.split('/').pop().replace(/_/g, ' ');
}

export function userTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * If the visitor's own clock shows a different time than the provider's, return the
 * visitor's version ("3:30 am your time"), otherwise null. Compares the formatted text,
 * not the zone names, so "Asia/Calcutta" vs "Asia/Kolkata" does not trigger a note.
 */
export function yourTimeNote(iso, providerTimeZone, myTimeZone = userTimeZone()) {
  const theirDate = formatShortDate(iso, providerTimeZone);
  const myDate = formatShortDate(iso, myTimeZone);
  const theirTime = formatTime(iso, providerTimeZone);
  const myTime = formatTime(iso, myTimeZone);
  if (theirDate === myDate && theirTime === myTime) return null;
  return theirDate === myDate ? `${myTime} your time` : `${myDate}, ${myTime} your time`;
}

export const PERIODS = [
  { key: 'morning', label: 'Morning', test: (h) => h < 12 },
  { key: 'afternoon', label: 'Afternoon', test: (h) => h >= 12 && h < 17 },
  { key: 'evening', label: 'Evening', test: (h) => h >= 17 },
];

/** Group slots by part of the provider's day, dropping empty groups. */
export function groupSlots(slots, timeZone) {
  return PERIODS.map((period) => ({
    ...period,
    slots: slots.filter((slot) => period.test(hourOf(slot.start_at, timeZone))),
  })).filter((group) => group.slots.length > 0);
}

const ISO_IN_TEXT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})/g;

/**
 * The server writes some history notes with raw timestamps ("Rescheduled from
 * 2026-11-14T03:30:00+00:00 to ..."). Show them as the provider's local time instead.
 */
export function humanizeNote(note, timeZone) {
  if (!note) return note;
  return note.replace(ISO_IN_TEXT, (iso) => `${formatShortDate(iso, timeZone)}, ${formatTime(iso, timeZone)}`);
}
