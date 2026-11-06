import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CITY_ZONE, clockZone, defaultMeetupStart, formatMeetupTime, fromPickerValue, localDay, meetupZone, mergePickerDate, moveMeetupZone, parseLocalDay, toPickerValue, zoneDayGap } from '../src/lib/chilling-date.ts';
import { meetupFeeDueIso, meetupFeeDueOn } from '../src/lib/meetup-host-tools.ts';
import { chillingSchedule } from '../src/lib/chilling.ts';

const clock = (iso, zone) => formatMeetupTime(iso, 'en-CA', zone, { hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
// The picker carries clock numbers in a device-local Date, so a pick is "this device's Date showing that time".
const picked = (year, month, day, hour, minute = 0) => new Date(year, month - 1, day, hour, minute).toISOString();
const withDeviceZone = (zone, run) => {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try { run(); } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
};
const DEVICES = ['Asia/Seoul', 'America/Vancouver', 'America/Toronto', 'UTC'];
// Same as @expo/ui's Android picker: it shows the local day of the Date it gets, and returns that Date moved to the tapped day.
const tap = (value, year, month, day) => { const moved = new Date(value); moved.setFullYear(year, month - 1, day); return moved; };

test('a Vancouver meetup after the fall 2026 change stays UTC-7 whatever zone data the device has', () => {
  // Node here can carry zone data older than tz 2026b, the same state as an old phone: bare Intl says 18:00 for this instant.
  assert.equal(clock('2026-12-02T02:00:00Z', 'America/Vancouver'), '19:00');
  assert.equal(clock('2027-07-02T02:00:00Z', 'America/Vancouver'), '19:00');
  assert.match(chillingSchedule({ eventKind: 'once', startsAt: '2026-12-02T02:00:00Z', endsAt: '2026-12-02T03:00:00Z', timezone: 'America/Vancouver' }, 'en-CA'), /19:00.*20:00/);
});

test('only instants from the change onward use the fixed clock; earlier ones and other cities keep their own zone', () => {
  assert.equal(clockZone('America/Vancouver', Date.UTC(2026, 10, 1, 8, 59)), 'America/Vancouver');
  assert.equal(clockZone('America/Vancouver', Date.UTC(2026, 10, 1, 9)), 'America/Phoenix');
  assert.equal(clockZone('America/Toronto', Date.UTC(2026, 11, 1)), 'America/Toronto');
  // Same answer on old and new zone data: B.C. was on UTC-7 from March until the change, and on UTC-8 last winter.
  assert.equal(clock('2026-10-16T02:00:00Z', 'America/Vancouver'), '19:00');
  assert.equal(clock('2026-01-16T03:00:00Z', 'America/Vancouver'), '19:00');
});

test('a time picked for the meetup city saves the same instant from any device zone', () => {
  for (const device of DEVICES) withDeviceZone(device, () => {
    assert.equal(fromPickerValue(picked(2026, 12, 1, 19), 'America/Vancouver'), '2026-12-02T02:00:00.000Z', device);
    assert.equal(fromPickerValue(picked(2027, 7, 1, 19), 'America/Vancouver'), '2027-07-02T02:00:00.000Z', device);
    assert.equal(fromPickerValue(picked(2027, 1, 15, 19), 'America/Toronto'), '2027-01-16T00:00:00.000Z', device);
    assert.equal(fromPickerValue(picked(2027, 7, 15, 19), 'America/Toronto'), '2027-07-15T23:00:00.000Z', device);
  });
});

test('the picker shows the meetup city clock and a round trip changes nothing', () => {
  for (const device of DEVICES) withDeviceZone(device, () => {
    const shown = new Date(toPickerValue('2026-12-02T02:00:00.000Z', 'America/Vancouver'));
    assert.deepEqual([shown.getMonth() + 1, shown.getDate(), shown.getHours(), shown.getMinutes()], [12, 1, 19, 0], device);
    for (const [iso, zone] of [['2026-12-02T02:00:00.000Z', 'America/Vancouver'], ['2026-10-16T02:00:00.000Z', 'America/Vancouver'], ['2027-01-16T00:00:00.000Z', 'America/Toronto'], ['2027-07-15T23:00:00.000Z', 'America/Toronto']])
      assert.equal(fromPickerValue(toPickerValue(iso, zone), zone), iso, `${device} ${zone}`);
  });
});

test('the Android date picker keeps the day it shows and saves the day tapped, in every device zone', () => {
  const iso = '2026-11-08T02:00:00.000Z'; // Nov 7, 9 p.m. in Montreal.
  for (const device of DEVICES) withDeviceZone(device, () => {
    const shown = toPickerValue(iso, 'America/Toronto');
    assert.equal(new Date(shown).getDate(), 7, device);
    assert.equal(fromPickerValue(mergePickerDate(shown, tap(new Date(shown), 2026, 11, 14), 'date'), 'America/Toronto'), '2026-11-15T02:00:00.000Z', device);
  });
  // The library converts to Material's UTC day itself; converting here too showed the day before in every Canadian zone.
  assert.doesNotMatch(readFileSync(new URL('../src/components/chilling-date-input.tsx', import.meta.url), 'utf8'), /Date\.UTC/);
});

test('pickers that keep only the day (housing move-in and its filter, fee due) save the day tapped in every device zone', () => {
  for (const device of DEVICES) withDeviceZone(device, () => {
    const day = parseLocalDay('2026-11-07'), fee = meetupFeeDueIso('2026-11-07');
    assert.equal(new Date(day).getDate(), 7, device);
    assert.equal(localDay(mergePickerDate(day, tap(new Date(day), 2026, 11, 14), 'date')), '2026-11-14', device);
    assert.equal(new Date(fee).getDate(), 7, device);
    assert.equal(meetupFeeDueOn(mergePickerDate(fee, tap(new Date(fee), 2026, 11, 14), 'date')), '2026-11-14', device);
  });
});

test('without a zone, or with an unreadable date, the picker value passes through untouched', () => {
  const iso = '2026-12-02T02:00:00.000Z';
  assert.equal(toPickerValue(iso), iso); assert.equal(fromPickerValue(iso, null), iso);
  assert.equal(toPickerValue('', 'America/Toronto'), ''); assert.equal(fromPickerValue('', 'America/Toronto'), '');
});

test('the default start is tomorrow 7 p.m. in the meetup city, on that city\'s calendar', () => {
  const now = Date.parse('2026-11-07T06:30:00Z'); // Nov 6 23:30 in Vancouver, Nov 7 01:30 in Toronto, Nov 7 15:30 in Seoul.
  for (const device of DEVICES) withDeviceZone(device, () => {
    assert.equal(defaultMeetupStart('America/Vancouver', now), '2026-11-08T02:00:00.000Z', device);
    assert.equal(defaultMeetupStart('America/Toronto', now), '2026-11-09T00:00:00.000Z', device);
  });
});

test('moving to another city keeps the clock time, not the instant', () => {
  assert.equal(moveMeetupZone('2026-12-02T02:00:00.000Z', 'America/Vancouver', 'America/Toronto'), '2026-12-02T00:00:00.000Z');
  assert.equal(moveMeetupZone('', 'America/Vancouver', 'America/Toronto'), '');
});

test('today and tomorrow follow the meetup city calendar', () => {
  const now = Date.parse('2026-11-07T06:30:00Z');
  assert.equal(zoneDayGap(now, Date.parse('2026-11-07T06:45:00Z'), 'America/Vancouver'), 0); // 23:45 the same day in Vancouver.
  assert.equal(zoneDayGap(now, Date.parse('2026-11-07T07:30:00Z'), 'America/Vancouver'), 1); // 00:30 the next day.
  assert.equal(zoneDayGap(now, Date.parse('2026-11-07T07:30:00Z'), 'America/Toronto'), 0);
});

test('a stored zone wins, a meetup without one follows its city, and an unknown one falls back to the device', () => {
  assert.equal(meetupZone({ timezone: 'America/Cambridge_Bay' }, 'montreal'), 'America/Cambridge_Bay');
  assert.equal(meetupZone({ timezone: null }, 'montreal'), 'America/Toronto');
  assert.equal(meetupZone(null, 'vancouver'), 'America/Vancouver');
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.equal(meetupZone({ timezone: 'Not/AZone' }, null), device);
  assert.equal(meetupZone(null, 'nowhere'), device);
  for (const zone of Object.values(CITY_ZONE)) assert.doesNotThrow(() => clock('2026-12-02T02:00:00Z', zone));
});

test('an unreadable time formats to nothing instead of throwing during render', () => {
  assert.equal(formatMeetupTime('', 'en-CA', 'America/Toronto', { hour: 'numeric' }), '');
});
