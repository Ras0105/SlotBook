import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayOf,
  formatRange,
  formatTime,
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
