import { describe, expect, it } from 'vitest';
import { appointmentIcs, buildIcs, escapeText, fold, icsFilename } from './ics';

const NOW = new Date('2030-01-01T00:00:00Z');
const APPT = { id: 42, start_at: '2030-01-07T03:30:00Z', end_at: '2030-01-07T04:00:00Z' };

describe('escapeText', () => {
  it('escapes backslash, semicolon, comma and line breaks', () => {
    expect(escapeText('a, b; c\\d\ne')).toBe('a\\, b\\; c\\\\d\\ne');
  });
});

describe('fold', () => {
  it('leaves short lines alone', () => {
    expect(fold('SUMMARY:Checkup')).toBe('SUMMARY:Checkup');
  });

  it('splits long lines at 75 bytes, continuing with a leading space', () => {
    const long = `DESCRIPTION:${'x'.repeat(200)}`;
    const lines = fold(long).split('\r\n');
    expect(lines.length).toBeGreaterThan(2);
    expect(new TextEncoder().encode(lines[0]).length).toBeLessThanOrEqual(75);
    lines.slice(1).forEach((l) => {
      expect(l.startsWith(' ')).toBe(true);
      expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    });
    expect(lines.map((l, i) => (i === 0 ? l : l.slice(1))).join('')).toBe(long); // unfolding restores it
  });

  it('never cuts a multi-byte character in half', () => {
    const long = `SUMMARY:${'é'.repeat(80)}`; // 2 bytes each
    const lines = fold(long).split('\r\n');
    lines.forEach((l) => expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75));
    expect(lines.map((l, i) => (i === 0 ? l : l.slice(1))).join('')).toBe(long);
  });
});

describe('buildIcs', () => {
  it('builds a valid single-event calendar with CRLF line endings', () => {
    const text = buildIcs({
      uid: 'appointment-42@slotbook',
      title: 'Dental checkup, 2nd visit',
      start: APPT.start_at,
      end: APPT.end_at,
      description: 'Bring X-rays',
      url: 'https://example.com/providers/1',
      now: NOW,
    });
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(text).not.toMatch(/[^\r]\n/); // every line break is CRLF
    expect(text).toContain('VERSION:2.0\r\n');
    expect(text).toContain('UID:appointment-42@slotbook\r\n');
    expect(text).toContain('DTSTAMP:20300101T000000Z\r\n');
    expect(text).toContain('DTSTART:20300107T033000Z\r\n'); // UTC instants, so every timezone shows the right local time
    expect(text).toContain('DTEND:20300107T040000Z\r\n');
    expect(text).toContain('SUMMARY:Dental checkup\\, 2nd visit\r\n');
    expect(text).toContain('DESCRIPTION:Bring X-rays\r\n');
    expect(text).toContain('URL:https://example.com/providers/1\r\n');
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it('leaves out optional lines that were not given', () => {
    const text = buildIcs({ uid: 'u', title: 'T', start: APPT.start_at, end: APPT.end_at, now: NOW });
    expect(text).not.toContain('LOCATION:');
    expect(text).not.toContain('URL:');
  });
});

describe('appointmentIcs', () => {
  it('uses the service name, a stable UID and the provider page link', () => {
    const text = appointmentIcs(APPT, { id: 7, service_name: 'General Checkup' }, { origin: 'https://slotbook.test', now: NOW });
    expect(text).toContain('SUMMARY:General Checkup');
    expect(text).toContain('UID:appointment-42@slotbook');
    expect(text).toContain('URL:https://slotbook.test/providers/7');
    expect(text).toContain('Reference #42');
  });

  it('still works when the provider could not be loaded', () => {
    const text = appointmentIcs(APPT, undefined, { origin: 'https://slotbook.test', now: NOW });
    expect(text).toContain('SUMMARY:Appointment');
    expect(text).not.toContain('URL:');
  });

  it('names the file after the appointment', () => {
    expect(icsFilename(APPT)).toBe('slotbook-appointment-42.ics');
  });
});
