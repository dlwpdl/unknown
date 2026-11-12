import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { cityClock, formatRanges, formatTime, isOpenAt, localClock, minutesUntilClose, openState, parseOpeningHours } from '../src/lib/opening-hours.ts';

const at = (day, time) => ({ day, minutes: Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) });
const plain = text => text.replace(/\s/g, ' '); // ICU puts a narrow space before AM/PM
const MO = 0, TU = 1, WE = 2, TH = 3, FR = 4, SA = 5, SU = 6;
// A city clock on a fixed calendar day, the way localClock returns it.
const on = (iso, time = '12:00') => {
  const date = new Date(`${iso}T00:00:00Z`);
  return { ...at((date.getUTCDay() + 6) % 7, time), year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, date: date.getUTCDate() };
};

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
  assert.equal(plain(formatRanges(late[FR], 'en-US')), '5:00 PM–2:00 AM');
  assert.equal(plain(formatRanges(parseOpeningHours('Mo-Su 07:00-24:00')[MO], 'en-US')), '7:00 AM–12:00 AM');
});

test('ends written past 24:00 (up to 48:00) run into the next morning', () => {
  const week = parseOpeningHours('Mo-We 16:00-24:00; Th 16:00-25:00; Fr-Sa 16:00-26:00; Su 16:00-24:30');
  assert.deepEqual([week[WE], week[TH], week[FR], week[SU]], [[[960, 1440]], [[960, 1500]], [[960, 1560]], [[960, 1470]]]);
  assert.equal(isOpenAt(week, at(FR, '00:59')), true, 'Thursday until 01:00');
  assert.equal(isOpenAt(week, at(FR, '01:00')), false);
  assert.equal(isOpenAt(week, at(SA, '01:59')), true, 'Friday until 02:00');
  assert.equal(isOpenAt(week, at(MO, '00:15')), true, 'Sunday until 00:30');
  assert.equal(minutesUntilClose(week, at(TH, '23:30')), 90);
  assert.equal(plain(formatRanges(week[TH], 'en-US')), '4:00 PM–1:00 AM');
  assert.equal(plain(formatRanges(week[FR], 'en-US')), '4:00 PM–2:00 AM');
  assert.deepEqual(parseOpeningHours('Mo-Th 11:30-22:00; Fr 11:30-25:00; Sa 11:00-25:00; Su 11:00-22:00')[FR], [[690, 1500]]);
  assert.deepEqual(parseOpeningHours('Mo 08:00-48:00')[MO], [[480, 2880]]);
});

test('month and date rules apply only on the days of the current week they name', () => {
  // 2025-12-25 is a Thursday and 2026-01-01 a Thursday, so each holiday lands in its own weekday column.
  const xmas = 'Mo-Su 09:00-17:00; Jan 01,Dec 25,26 off';
  const christmasWeek = parseOpeningHours(xmas, on('2025-12-24'));
  assert.deepEqual([christmasWeek[WE], christmasWeek[TH], christmasWeek[FR], christmasWeek[SA]], [[[540, 1020]], [], [], [[540, 1020]]]);
  assert.deepEqual(parseOpeningHours(xmas, on('2025-12-30'))[TH], [], 'Jan 01 in the week after');
  assert.deepEqual(parseOpeningHours(xmas, on('2026-11-11'))[TH], [[540, 1020]], 'an ordinary week');
  assert.equal(openState(xmas, on('2025-12-25')), 'closed');
  assert.equal(openState(xmas, on('2025-12-24')), 'open');
  assert.equal(parseOpeningHours(xmas), null, 'without the city date it stays unknown');

  const range = parseOpeningHours('Mo-Sa 07:00-17:00; Su 07:00-16:00; Jan 01-02,Dec 25-26 off', on('2025-12-29'));
  assert.deepEqual([range[WE], range[TH], range[FR], range[SA]], [[[420, 1020]], [], [], [[420, 1020]]]);
  const split = parseOpeningHours('Mo-Sa 10:00-17:00; Su 12:00-17:00; Dec 25-26 off; Jan 01 off', on('2025-12-22'));
  assert.deepEqual([split[TH], split[FR], split[SA], split[SU]], [[], [], [[600, 1020]], [[720, 1020]]]);
  const spaced = parseOpeningHours('Mo-Su 07:00-19:00; PH 07:00-19:00; Dec 25, Dec 26, Jan 1 off', on('2025-12-22'));
  assert.deepEqual([spaced[WE], spaced[TH], spaced[FR]], [[[420, 1140]], [], []]);

  const seasons = 'Mo-Su 10:00-17:00; Mar 14-21 10:00-18:00; Jun 26-Sep 07 09:00-17:00; Nov 09 off; Dec 24,25 off';
  const march = parseOpeningHours(seasons, on('2026-03-16')); // Mar 16-22
  assert.deepEqual([march[MO], march[SA], march[SU]], [[[600, 1080]], [[600, 1080]], [[600, 1020]]]);
  const september = parseOpeningHours(seasons, on('2026-09-07')); // Mo Sep 07 is the last summer day
  assert.deepEqual([september[MO], september[TU]], [[[540, 1020]], [[600, 1020]]]);
  assert.deepEqual(parseOpeningHours(seasons, on('2026-11-11'))[MO], [], 'Nov 09 off');

  const holidays = 'Dec 24 11:00-17:00; Dec 25 off; Dec 26 11:00-17:00; Dec 31 11:00-17:00; Jan 1 off';
  assert.equal(parseOpeningHours(holidays, on('2025-12-22')), null, 'holiday lines alone say nothing about the other days of Christmas week');
  assert.equal(openState(holidays, on('2026-11-11')), 'unknown', 'nor about a normal week, so the raw text shows instead of closed');
});

test('month ranges wrap the new year, and a , rule keeps the months of the rule before it', () => {
  const summer = 'Mo-Fr 11:00-22:00; Sa-Su 10:00-22:00; Jun-Aug: Mo-Fr 11:00-23:00, Sa-Su 10:00-23:00';
  const july = parseOpeningHours(summer, on('2026-07-15'));
  assert.deepEqual([july[MO], july[SA]], [[[660, 1380]], [[600, 1380]]], 'the summer close widens the day instead of listing it twice');
  assert.equal(minutesUntilClose(july, at(SA, '21:30')), 90);
  const november = parseOpeningHours(summer, on('2026-11-11'));
  assert.deepEqual([november[MO], november[SA]], [[[660, 1320]], [[600, 1320]]], 'the Sa-Su rule is summer only');

  const museum = 'May-Aug: Mo-Su,PH 09:00-18:00; Sep-Apr: Tu-Su 09:00-17:00';
  assert.deepEqual(parseOpeningHours(museum, on('2026-11-11')).slice(0, 2), [[], [[540, 1020]]]);
  assert.deepEqual(parseOpeningHours(museum, on('2027-01-13'))[TU], [[540, 1020]], 'Sep-Apr includes January');
  const turn = parseOpeningHours(museum, on('2026-08-31')); // Monday Aug 31, Tuesday Sep 1
  assert.deepEqual([turn[MO], turn[TU]], [[[540, 1080]], [[540, 1020]]]);

  const winter = parseOpeningHours('Mar-Oct 09:00-17:00; Nov-Feb We-Su 09:00-17:00', on('2026-02-23')); // Feb 23 - Mar 1
  assert.deepEqual([winter[TU], winter[SA], winter[SU]], [[], [[540, 1020]], [[540, 1020]]]);
  const seasonal = 'Tu-Sa 10:00-14:00; Oct-May off';
  assert.equal(openState(seasonal, on('2026-11-10')), 'closed');
  assert.equal(openState(seasonal, on('2026-06-09')), 'open');
  const shifted = 'Oct-May 09:00-21:00; Jun-Sep 08:30-22:30';
  assert.deepEqual(parseOpeningHours(shifted, on('2026-11-11'))[MO], [[540, 1260]]);
  assert.deepEqual(parseOpeningHours(shifted, on('2026-07-15'))[MO], [[510, 1350]]);
});

test('values the reader cannot be sure of stay unknown instead of guessing', () => {
  for (const value of ['sunset-(sunrise-07:00)', 'Mo-Su 17:00+', '17:00+', 'Tu-Sa 17:30-11:00+', '"by appointment"', 'closed "Temporarily closed for renovations"', 'PH off',
    'Su-Th 16:00-21:30; Fr,Sa 16:00-22:30; PH open "hours may vary"', 'Tu-Fr 11:00-14:00 open "Lunch" || Tu-Su 17:00+ open "Dinner"',
    'Sep Mo[1] +1 day-Oct 31: Mo-Su 09:00-17:00; Nov-Dec: Mo-Su 10:00-14:00; Dec 25 off', 'Mon–Thu 11:00–22:00; Fri–Sat 11:00–24:00', 'SH Fr-Su 11:30-15:00',
    'Daily from 17:00', 'Nov 3 - Apr 27 Su 10:00-14:00', 'Tu-Su 10:00-17:00; easter off', 'Dec 25-03 off', 'Dec-Feb sunset-(sunrise+03:00)',
    'Mo-Fr', 'Mo-Fr 25:00-26:00', 'Mo-Fr 24:00-02:00', 'Mo-Fr 16:00-48:30', 'mo-fr 09:00-17:00', '', '   ', null, undefined, 42, 'x'.repeat(1001)]) {
    assert.equal(parseOpeningHours(value, on('2025-12-25')), null, String(value));
    assert.equal(openState(value, on('2025-12-25')), 'unknown');
  }
  assert.equal(openState('Mo-Su 09:00-17:00', null), 'unknown', 'a city without a known time zone is unknown');
  assert.deepEqual(parseOpeningHours('Mo-Sa 10:00-17:30; Su 12:00-16:00; PH off')[SU], [[720, 960]], 'holiday rules are skipped');
});

test('every bundled catalog value is either read or left unknown, and Vancouver keeps a usable share', () => {
  const catalog = JSON.parse(readFileSync(new URL('../src/lib/city-places.catalog.json', import.meta.url), 'utf8'));
  const places = Object.values(catalog.cities).flatMap(city => [...city.places, ...(city.regionalPlaces ?? []), ...(city.extraPlaces ?? []), ...(city.morePlaces ?? [])]);
  const values = places.map(place => place.openingHours).filter(Boolean);
  for (const value of values) {
    const week = parseOpeningHours(value, on('2025-12-25'));
    if (week) for (const day of week) for (const [start, end] of day) assert.ok(start >= 0 && start < 1440 && end > start && end <= 2880, value);
  }
  const vancouver = catalog.cities.vancouver.places.filter(place => place.openingHours);
  const read = vancouver.filter(place => parseOpeningHours(place.openingHours));
  assert.ok(read.length / vancouver.length > 0.85, `${read.length}/${vancouver.length}`);
});

test('the local clock follows the city time zone, including the daylight saving change', () => {
  // 2025-11-05 06:30 UTC is Tuesday 22:30 in Vancouver (PST) and Wednesday 01:30 in Toronto.
  // Not a later date: BC stopped changing clocks in 2026, so older and newer time zone data disagree after that.
  const now = Date.parse('2025-11-05T06:30:00Z');
  assert.deepEqual(localClock('America/Vancouver', now), on('2025-11-04', '22:30'));
  assert.deepEqual(cityClock('toronto', now), on('2025-11-05', '01:30'));
  assert.equal(cityClock('unknown-city', now), null);
  // 2026-07-01 05:30 UTC is Tuesday 22:30 in Vancouver (PDT).
  assert.deepEqual(cityClock('vancouver', Date.parse('2026-07-01T05:30:00Z')), on('2026-06-30', '22:30'));
  assert.equal(openState('Mo-Su 11:00-22:00', cityClock('vancouver', now)), 'closed');
  assert.equal(openState('Mo-Su 11:00-23:00', cityClock('vancouver', now)), 'open');
  assert.equal(openState('Tu 18:00-02:00', cityClock('toronto', now)), 'open', 'Tuesday spills into Wednesday morning');
  assert.equal(openState('Mo-We 11:30-24:00', cityClock('toronto', now)), 'closed', 'a 24:00 close does not spill');
});

test('P6 곧 닫음: minutes until close follow overnight hours, and 24-hour places never close', () => {
  const left = (value, day, time) => minutesUntilClose(parseOpeningHours(value), at(day, time));
  assert.equal(left('Mo-Fr 07:00-17:00', MO, '16:00'), 60, 'exactly one hour counts as soon');
  assert.equal(left('Mo-Fr 07:00-17:00', MO, '15:59'), 61);
  assert.equal(left('Mo-Fr 07:00-17:00', MO, '16:59'), 1);
  assert.equal(left('Mo-Fr 07:00-17:00', MO, '17:00'), null, 'closed now');
  assert.equal(left('Mo-Fr 07:00-17:00', SA, '12:00'), null);
  assert.equal(left('Mo-Fr 11:30-14:30,16:30-22:30', TU, '14:00'), 30, 'the lunch range closes first');
  assert.equal(left('Mo off; Tu-Su 17:00-02:00', TU, '23:30'), 150, 'closing after midnight');
  assert.equal(left('Mo off; Tu-Su 17:00-02:00', WE, '01:30'), 30, 'yesterday’s hours run into this morning');
  assert.equal(left('Mo off; Tu-Su 17:00-02:00', TU, '01:30'), null, 'Monday is off, so nothing spills into Tuesday');
  assert.equal(left('Su 11:30-01:00', MO, '00:15'), 45, 'Sunday into Monday wraps the week');
  assert.equal(left('Mo-Su 07:00-24:00', MO, '23:30'), 30, 'a 24:00 close with a later opening the next day');
  assert.equal(left('Mo 18:00-24:00; Tu 00:00-00:30', MO, '23:50'), 40, 'a range that reopens at midnight carries on');
  assert.equal(left('24/7', SU, '23:59'), null, 'open around the clock');
  assert.equal(left('Mo-Su 00:00-24:00', WE, '23:30'), null);
  assert.equal(left('Mo-Sa 00:00-24:00; Su 00:00-22:00', SU, '21:30'), 30, 'a 24-hour week that does end');
  assert.equal(left('Mo-Sa 00:00-24:00; Su 00:00-22:00', SA, '23:30'), 1350, 'Saturday night runs on to Sunday 22:00');
  assert.equal(left('Fr 18:00-48:00; Su 00:00-12:00', SA, '23:30'), 750, 'a 48:00 close reaches two days on before it carries over');
  assert.equal(left('Fr 18:00-48:00', SA, '23:30'), 30);
  const joined = parseOpeningHours('Mo 10:00-12:00,14:00-16:00, Mo 11:00-15:00');
  assert.deepEqual(joined[MO], [[600, 960]], 'one added range joins both ranges it overlaps');
  assert.equal(minutesUntilClose(joined, at(MO, '14:30')), 90);
  assert.deepEqual(parseOpeningHours('Mo-Fr 10:00-12:00,14:00-16:00, Mo 11:30-12:30')[MO], [[600, 750], [840, 960]], 'the joined range keeps its place in the day');
  assert.deepEqual(['23:30', '23:59', '01:30'].map(time => plain(formatTime(at(MO, time).minutes + 30, 'en-US'))), ['12:00 AM', '12:29 AM', '2:00 AM']);
});
