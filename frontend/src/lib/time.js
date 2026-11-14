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

// ---------------------------------------------------------------------------------------------
// Provider dashboard and admin screens.
// A person types "9:00 on 16 Nov" meaning the PROVIDER's wall clock; the API wants the UTC instant.

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']; // 0 = Monday, like the API

/** How far `timeZone` is ahead of UTC at the UTC instant `utcMs`, in milliseconds (Kolkata: +19 800 000). */
function offsetMs(utcMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(utcMs));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asIfUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * "2026-11-16" + "09:00" on the wall clock of `timeZone` -> the UTC instant as ISO text ("2026-11-16T03:30:00.000Z").
 * Two passes make it correct on the day clocks change: the offset is looked up at the first guess,
 * then re-checked at the corrected time. A wall time that does not exist (spring forward) or happens
 * twice (fall back) resolves to one of the two valid instants, which is the usual convention.
 */
export function zonedTimeToUtc(day, clock, timeZone) {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = clock.split(':').map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, hh, mm);
  const first = wallAsUtc - offsetMs(wallAsUtc, timeZone);
  const second = wallAsUtc - offsetMs(first, timeZone);
  return new Date(second).toISOString();
}

/** The instant a calendar day begins in `timeZone`. */
export function startOfDay(day, timeZone) {
  return zonedTimeToUtc(day, '00:00', timeZone);
}

/** "09:00:00" (as the API sends working hours) -> "9:00 am". */
export function formatClock(value) {
  const [h, m] = value.split(':').map(Number);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
}

export const formatClockRange = (start, end) => `${formatClock(start)} to ${formatClock(end)}`;

/** "09:00:00" -> "09:00", the value an <input type="time"> wants. */
export const clockToInput = (value) => value.slice(0, 5);

/** "09:00" -> "09:00:00", what the API wants. */
export const clockToApi = (value) => (value.length === 5 ? `${value}:00` : value);

/** "Mon 16 Nov" for a plain calendar day. */
export function formatDayShort(day) {
  const { weekday, dayOfMonth, month } = dayParts(day);
  return `${weekday} ${dayOfMonth} ${month}`;
}

/** "Mon 16 Nov, 9:00 am to 12:00 pm", or with both dates when the period spans days. */
export function formatPeriod(startIso, endIso, timeZone) {
  const startDay = dayOf(startIso, timeZone);
  const endDay = dayOf(endIso, timeZone);
  const start = `${formatShortDate(startIso, timeZone)}, ${formatTime(startIso, timeZone)}`;
  if (startDay === endDay) return `${start} to ${formatTime(endIso, timeZone)}`;
  return `${start} to ${formatShortDate(endIso, timeZone)}, ${formatTime(endIso, timeZone)}`;
}

// Browsers still list a few places under their old names ("Asia/Calcutta"). People look for the current
// name ("Kolkata"), and both are valid for the backend, so show and save the current one.
const MODERN_NAMES = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
};

export const modernZone = (name) => MODERN_NAMES[name] ?? name;

/** Every timezone name the browser knows (current names, sorted), for the timezone pickers. */
export function allTimeZones() {
  let zones;
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = ['Asia/Kolkata', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney'];
  }
  return [...new Set(['UTC', ...zones.map(modernZone)])].sort((a, b) =>
    a === 'UTC' ? -1 : b === 'UTC' ? 1 : a.localeCompare(b),
  );
}

// ---------------------------------------------------------------------------------------------
// Week view (provider calendar).

/** The Monday of the week that contains `day` ("YYYY-MM-DD"). Weeks run Monday to Sunday, like the API's weekdays. */
export function mondayOf(day) {
  const weekday = (dayToUtcNoon(day).getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(day, -weekday);
}

/** The seven days of the week starting at `monday`. */
export function weekDays(monday) {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Minutes since midnight of a UTC instant, on the wall clock of `timeZone`. */
export function minutesOfDay(iso, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(
    new Date(iso),
  );
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return (get('hour') % 24) * 60 + get('minute');
}

/** "16 to 22 Nov 2026", or "28 Dec 2026 to 3 Jan 2027" when the week spans months. */
export function formatWeekRange(monday) {
  const sunday = addDays(monday, 6);
  const fmt = (day, options) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options }).format(dayToUtcNoon(day));
  const [a, b] = [monday, sunday];
  if (a.slice(0, 7) === b.slice(0, 7)) return `${fmt(a, { day: 'numeric' })} to ${fmt(b, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return `${fmt(a, { day: 'numeric', month: 'short', ...(a.slice(0, 4) !== b.slice(0, 4) ? { year: 'numeric' } : {}) })} to ${fmt(b, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
