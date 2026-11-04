import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { cityClock, formatRanges, isOpenAt, localClock, openState, parseOpeningHours } from '../src/lib/opening-hours.ts';

const at = (day, time) => ({ day, minutes: Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) });
const MO = 0, TU = 1, WE = 2, TH = 3, FR = 4, SA = 5, SU = 6;

test('weekday rules, day lists and wrap-around day ranges read the catalog format', () => {
  const week = parseOpeningHours('Mo-Fr 07:00-17:00; Sa-Su 08:00-17:00');
  assert.deepEqual(week[MO], [[420, 1020]]);
  assert.deepEqual(week[SU], [[480, 1020]]);
  assert.deepEqual(parseOpeningHours('Mo-We,Sa 08:00-22:00; Th,Fr 08:00-23:00; Su 09:00-21:00')[SA], [[480, 1320]]);
  assert.deepEqual(parseOpeningHours('Sa, Su 08:00-18:00')[SA], [[480, 1080]], 'a spaced day list is one selector');
  const wrap = parseOpeningHours('Sa-Th 10:00-17:30; Fr 10:00-18:30');
  assert.deepEqual([wrap[SA], wrap[TH], wrap[FR]], [[[600, 1050]], [[600, 1050]], [[600, 1110]]]);
  assert.deepEqual(parseOpeningHours('11:00-22:00')[WE], [[660, 1320]], 'no weekday means every day');
  assert.deepEqual(parseOpeningHours('Mo-Fr 11:30-14:30,16:30-22:30; Sa-Su 16:30-22:30')[TU], [[690, 870], [990, 1350]]);
  assert.deepEqual(parseOpeningHours('We-Fr 11:30-14:00, 17:00-22:00')[TH], [[690, 840], [1020, 1320]]);
  assert.deepEqual(parseOpeningHours('24/7')[SU], [[0, 1440]]);
});

test('days without a rule are closed, off clears a day and a later ; rule replaces earlier days', () => {
  const week = parseOpeningHours('Mo-Fr 09:00-17:00');
  assert.deepEqual([week[SA], week[SU]], [[], []]);
  assert.deepEqual(parseOpeningHours('Mo off; Tu-Su 17:00-02:00')[MO], []);
  assert.deepEqual(parseOpeningHours('Tu-Su 10:00-17:00; We 17:00-21:00')[WE], [[1020, 1260]], 'normal rule overrides');
  assert.deepEqual(parseOpeningHours('Th-Su 17:00-22:00, Sa,Su 11:00-14:00')[SA], [[1020, 1320], [660, 840]], 'comma rule adds');
  assert.deepEqual(parseOpeningHours('Mo-Fr 07:00-17:00, Sa-Su 08:00-17:00')[SU], [[480, 1020]]);
  assert.deepEqual(parseOpeningHours('Mo-Fr 07:30-17:00; Sa-Su,PH closed')[SA], []);
});

test('hours past midnight belong to the evening they started and stay open into the next morning', () => {
  const week = parseOpeningHours('Mo-We 11:30-24:00; Th 11:30-03:00; Fr-Sa 11:30-04:00; Su 11:30-01:00');
  assert.equal(isOpenAt(week, at(FR, '02:30')), true, 'Thursday until 03:00');
  assert.equal(isOpenAt(week, at(FR, '03:00')), false);
  assert.equal(isOpenAt(week, at(SA, '03:59')), true, 'Friday until 04:00');
  assert.equal(isOpenAt(week, at(MO, '00:30')), true, 'Sunday into Monday');
  assert.equal(isOpenAt(week, at(TU, '00:00')), false, 'Monday ends at 24:00');
  assert.equal(isOpenAt(week, at(MO, '23:59')), true);
  assert.equal(isOpenAt(week, at(MO, '11:29')), false);
  const late = parseOpeningHours('Mo off; Tu-Su 17:00-02:00');
  assert.equal(isOpenAt(late, at(TU, '01:00')), false, 'Monday is off, so nothing spills into Tuesday');
  assert.equal(isOpenAt(late, at(WE, '01:00')), true);
  assert.equal(isOpenAt(parseOpeningHours('Mo-Fr 05:30-00:00'), at(TU, '23:59')), true, '00:00 as an end means midnight');
  assert.equal(isOpenAt(parseOpeningHours('Fr,Sa 00:00-00:00'), at(SA, '12:00')), true);
  assert.equal(formatRanges(late[FR]), '17:00–02:00');
  assert.equal(formatRanges(parseOpeningHours('Mo-Su 07:00-24:00')[MO]), '07:00–24:00');
});

test('values the reader cannot be sure of stay unknown instead of guessing', () => {
  for (const value of ['sunset-(sunrise-07:00)', 'Mo-Su 17:00+', 'Tu-Sa 17:30-11:00+', 'Mo-Sa 10:00-17:00; Su 12:00-17:00; Dec 25-26 off',
    'Oct-May 09:00-21:00; Jun-Sep 08:30-22:30', '"by appointment"', 'closed "Temporarily closed for renovations"', 'PH off',
    'Su-Th 16:00-21:30; Fr,Sa 16:00-22:30; PH open "hours may vary"', 'Tu-Fr 11:00-14:00 open "Lunch" || Tu-Su 17:00+ open "Dinner"',
    'Mo-Fr', 'Mo-Fr 25:00-26:00', 'Mo-Fr 24:00-02:00', 'mo-fr 09:00-17:00', '', '   ', null, undefined, 42, 'x'.repeat(1001)]) {
    assert.equal(parseOpeningHours(value), null, String(value));
    assert.equal(openState(value, at(MO, '12:00')), 'unknown');
  }
  assert.equal(openState('Mo-Su 09:00-17:00', null), 'unknown', 'a city without a known time zone is unknown');
  assert.deepEqual(parseOpeningHours('Mo-Sa 10:00-17:30; Su 12:00-16:00; PH off')[SU], [[720, 960]], 'holiday rules are skipped');
});

test('every bundled catalog value is either read or left unknown, and Vancouver keeps a usable share', () => {
  const catalog = JSON.parse(readFileSync(new URL('../src/lib/city-places.catalog.json', import.meta.url), 'utf8'));
  const places = Object.values(catalog.cities).flatMap(city => [...city.places, ...(city.regionalPlaces ?? []), ...(city.extraPlaces ?? [])]);
  const values = places.map(place => place.openingHours).filter(Boolean);
  for (const value of values) {
    const week = parseOpeningHours(value);
    if (week) for (const day of week) for (const [start, end] of day) assert.ok(start >= 0 && start < 1440 && end > start && end < 2880, value);
  }
  const vancouver = catalog.cities.vancouver.places.filter(place => place.openingHours);
  const read = vancouver.filter(place => parseOpeningHours(place.openingHours));
  assert.ok(read.length / vancouver.length > 0.85, `${read.length}/${vancouver.length}`);
});

test('the local clock follows the city time zone, including the daylight saving change', () => {
  // 2026-11-04 06:30 UTC is Tuesday 22:30 in Vancouver (PST) and Wednesday 01:30 in Toronto.
  const now = Date.parse('2026-11-04T06:30:00Z');
  assert.deepEqual(localClock('America/Vancouver', now), at(TU, '22:30'));
  assert.deepEqual(cityClock('toronto', now), at(WE, '01:30'));
  assert.equal(cityClock('unknown-city', now), null);
  // 2026-07-01 05:30 UTC is Tuesday 22:30 in Vancouver (PDT).
  assert.deepEqual(cityClock('vancouver', Date.parse('2026-07-01T05:30:00Z')), at(TU, '22:30'));
  assert.equal(openState('Mo-Su 11:00-22:00', cityClock('vancouver', now)), 'closed');
  assert.equal(openState('Mo-Su 11:00-23:00', cityClock('vancouver', now)), 'open');
  assert.equal(openState('Tu 18:00-02:00', cityClock('toronto', now)), 'open', 'Tuesday spills into Wednesday morning');
  assert.equal(openState('Mo-We 11:30-24:00', cityClock('toronto', now)), 'closed', 'a 24:00 close does not spill');
});
