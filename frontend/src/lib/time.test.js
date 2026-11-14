import { describe, expect, it } from 'vitest';
import {
  addDays,
  allTimeZones,
  clockToApi,
  clockToInput,
  dayOf,
  formatClock,
  formatClockRange,
  formatDayShort,
  formatPeriod,
  formatRange,
  formatTime,
  formatWeekRange,
  minutesOfDay,
  modernZone,
  mondayOf,
  weekDays,
  startOfDay,
  WEEKDAYS,
  zonedTimeToUtc,
  groupSlots,
  hourOf,
  humanizeNote,
  isDateString,
  todayIn,
  yourTimeNote,
} from './time';

describe('todayIn', () => {
  // 20:00 UTC on 15 Nov is already 01:30 on 16 Nov in Kolkata, still the 15th in UTC.
  const instant = new Date('2026-11-15T20:00:00Z');
  it('uses the calendar day of the given timezone', () => {
    expect(todayIn('Asia/Kolkata', instant)).toBe('2026-11-16');
    expect(todayIn('UTC', instant)).toBe('2026-11-15');
    expect(todayIn('America/Los_Angeles', instant)).toBe('2026-11-15');
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('is not confused by daylight saving changes', () => {
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
    expect(addDays('2026-10-31', 2)).toBe('2026-11-02');
  });
});

describe('isDateString', () => {
  it('accepts only real YYYY-MM-DD dates', () => {
    expect(isDateString('2026-11-16')).toBe(true);
    expect(isDateString('2026-13-45')).toBe(false);
    expect(isDateString('16/11/2026')).toBe(false);
    expect(isDateString(null)).toBe(false);
  });
});

describe('formatting in the provider timezone', () => {
  it('shows 03:30 UTC as 9:00 am in Kolkata', () => {
    expect(formatTime('2026-11-16T03:30:00Z', 'Asia/Kolkata')).toBe('9:00 am');
    expect(formatTime('2026-11-16T03:30:00Z', 'UTC')).toBe('3:30 am');
  });
  it('formats a range', () => {
    expect(formatRange('2026-11-16T03:30:00Z', '2026-11-16T04:00:00Z', 'Asia/Kolkata')).toBe('9:00 am to 9:30 am');
  });
  it('knows which provider-local day an instant belongs to', () => {
    expect(dayOf('2026-11-15T20:00:00Z', 'Asia/Kolkata')).toBe('2026-11-16');
  });
  it('treats local midnight as hour 0, not 24', () => {
    expect(hourOf('2026-11-15T18:30:00Z', 'Asia/Kolkata')).toBe(0);
  });
});

describe('groupSlots', () => {
  const at = (utc) => ({ start_at: utc, end_at: utc });
  it('groups by the provider local part of day and drops empty groups', () => {
    // Kolkata: 09:00, 12:00, 17:00
    const slots = [at('2026-11-16T03:30:00Z'), at('2026-11-16T06:30:00Z'), at('2026-11-16T11:30:00Z')];
    const groups = groupSlots(slots, 'Asia/Kolkata');
    expect(groups.map((g) => [g.key, g.slots.length])).toEqual([
      ['morning', 1],
      ['afternoon', 1],
      ['evening', 1],
    ]);
    expect(groupSlots([slots[0]], 'Asia/Kolkata').map((g) => g.key)).toEqual(['morning']);
  });
});

describe('yourTimeNote', () => {
  const iso = '2026-11-16T03:30:00Z';
  it('is null when the visitor is in the same timezone', () => {
    expect(yourTimeNote(iso, 'Asia/Kolkata', 'Asia/Kolkata')).toBeNull();
  });
  it('is null for two names of the same zone', () => {
    expect(yourTimeNote(iso, 'Asia/Kolkata', 'Asia/Calcutta')).toBeNull();
  });
  it('shows the visitor local time when it differs', () => {
    expect(yourTimeNote(iso, 'Asia/Kolkata', 'UTC')).toBe('3:30 am your time');
  });
  it('includes the date when the day differs', () => {
    // 01:30 on the 17th in Kolkata is still 20:00 on the 16th in UTC.
    expect(yourTimeNote('2026-11-16T20:00:00Z', 'Asia/Kolkata', 'UTC')).toBe('Mon 16 Nov, 8:00 pm your time');
  });
});

describe('humanizeNote', () => {
  it('rewrites raw UTC timestamps in server notes as provider-local times', () => {
    const note = 'Rescheduled from 2026-11-14T03:30:00+00:00 to 2026-11-14T04:30:00+00:00';
    expect(humanizeNote(note, 'Asia/Kolkata')).toBe('Rescheduled from Sat 14 Nov, 9:00 am to Sat 14 Nov, 10:00 am');
  });
  it('leaves ordinary notes alone', () => {
    expect(humanizeNote('Cancelled', 'Asia/Kolkata')).toBe('Cancelled');
    expect(humanizeNote(null, 'Asia/Kolkata')).toBeNull();
  });
  it('understands Z and fractional seconds', () => {
    expect(humanizeNote('at 2026-11-14T03:30:00.123Z', 'UTC')).toBe('at Sat 14 Nov, 3:30 am');
  });
});

// ---------------------------------------------------------------------------------------------
describe('provider dashboard time helpers', () => {
  it('converts a provider wall-clock time to the UTC instant', () => {
    expect(zonedTimeToUtc('2026-11-16', '09:00', 'Asia/Kolkata')).toBe('2026-11-16T03:30:00.000Z');
    expect(zonedTimeToUtc('2026-11-16', '09:00', 'UTC')).toBe('2026-11-16T09:00:00.000Z');
    // before 05:30 in Kolkata it is still the previous UTC day
    expect(zonedTimeToUtc('2026-11-16', '01:30', 'Asia/Kolkata')).toBe('2026-11-15T20:00:00.000Z');
    expect(zonedTimeToUtc('2026-11-16', '09:00', 'Asia/Calcutta')).toBe('2026-11-16T03:30:00.000Z'); // old alias
  });

  it('follows daylight saving: the same wall time maps to different UTC on either side of the change', () => {
    expect(zonedTimeToUtc('2026-03-07', '09:00', 'America/New_York')).toBe('2026-03-07T14:00:00.000Z'); // EST, UTC-5
    expect(zonedTimeToUtc('2026-03-09', '09:00', 'America/New_York')).toBe('2026-03-09T13:00:00.000Z'); // EDT, UTC-4
    // on the change day itself (clocks jump 02:00 -> 03:00 on 8 March 2026)
    expect(zonedTimeToUtc('2026-03-08', '09:00', 'America/New_York')).toBe('2026-03-08T13:00:00.000Z');
    expect(zonedTimeToUtc('2026-03-08', '01:00', 'America/New_York')).toBe('2026-03-08T06:00:00.000Z');
    expect(zonedTimeToUtc('2026-01-15', '09:00', 'Australia/Sydney')).toBe('2026-01-14T22:00:00.000Z'); // AEDT, UTC+11
  });

  it('round-trips with the display helpers', () => {
    const iso = zonedTimeToUtc('2026-11-16', '09:00', 'Asia/Kolkata');
    expect(dayOf(iso, 'Asia/Kolkata')).toBe('2026-11-16');
    expect(formatTime(iso, 'Asia/Kolkata')).toBe('9:00 am');
  });

  it('formats working hours as plain clock times', () => {
    expect(formatClock('09:00:00')).toBe('9:00 am');
    expect(formatClock('00:05:00')).toBe('12:05 am');
    expect(formatClock('12:00:00')).toBe('12:00 pm');
    expect(formatClock('17:30:00')).toBe('5:30 pm');
    expect(formatClockRange('09:00:00', '12:00:00')).toBe('9:00 am to 12:00 pm');
  });

  it('converts between the API clock format and <input type="time">', () => {
    expect(clockToInput('09:00:00')).toBe('09:00');
    expect(clockToApi('09:00')).toBe('09:00:00');
    expect(clockToApi('09:00:00')).toBe('09:00:00');
  });

  it('describes a period, with both dates when it spans days', () => {
    const tz = 'Asia/Kolkata';
    const a = zonedTimeToUtc('2026-11-16', '09:00', tz);
    const b = zonedTimeToUtc('2026-11-16', '12:00', tz);
    const c = zonedTimeToUtc('2026-11-18', '09:00', tz);
    expect(formatPeriod(a, b, tz)).toBe('Mon 16 Nov, 9:00 am to 12:00 pm');
    expect(formatPeriod(a, c, tz)).toBe('Mon 16 Nov, 9:00 am to Wed 18 Nov, 9:00 am');
  });

  it('finds when a calendar day starts in a timezone, and labels plain days', () => {
    expect(startOfDay('2026-11-16', 'Asia/Kolkata')).toBe('2026-11-15T18:30:00.000Z');
    expect(formatDayShort('2026-11-16')).toBe('Mon 16 Nov');
    expect(WEEKDAYS[0]).toBe('Monday'); // 0 = Monday, like the API
  });

  it('offers current timezone names only, with UTC first', () => {
    expect(modernZone('Asia/Calcutta')).toBe('Asia/Kolkata');
    const zones = allTimeZones();
    expect(zones[0]).toBe('UTC');
    expect(zones).toContain('Asia/Kolkata');
    expect(zones).not.toContain('Asia/Calcutta');
  });
});

describe('week helpers', () => {
  it('finds the Monday of any day in the week', () => {
    expect(mondayOf('2030-01-07')).toBe('2030-01-07'); // a Monday
    expect(mondayOf('2030-01-09')).toBe('2030-01-07');
    expect(mondayOf('2030-01-13')).toBe('2030-01-07'); // Sunday belongs to the week that started on Monday
    expect(mondayOf('2030-01-14')).toBe('2030-01-14');
    expect(mondayOf('2030-01-01')).toBe('2029-12-31'); // across a year boundary
  });

  it('lists the seven days of a week', () => {
    expect(weekDays('2030-01-07')).toEqual([
      '2030-01-07', '2030-01-08', '2030-01-09', '2030-01-10', '2030-01-11', '2030-01-12', '2030-01-13',
    ]);
  });

  it('reads the minutes since midnight on the provider clock', () => {
    expect(minutesOfDay('2030-01-07T03:30:00Z', 'Asia/Kolkata')).toBe(9 * 60); // 09:00 in Kolkata
    expect(minutesOfDay('2030-01-07T03:30:00Z', 'UTC')).toBe(3 * 60 + 30);
    expect(minutesOfDay('2030-01-06T18:30:00Z', 'Asia/Kolkata')).toBe(0); // midnight, not 24:00
  });

  it('writes the week as a range', () => {
    expect(formatWeekRange('2030-01-07')).toBe('7 to 13 Jan 2030');
    expect(formatWeekRange('2030-01-28')).toBe('28 Jan to 3 Feb 2030');
    expect(formatWeekRange('2029-12-31')).toBe('31 Dec 2029 to 6 Jan 2030');
  });
});
