import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as discovery from '../src/lib/discovery.ts';

test('the seven-day festival window includes today, crosses month/year boundaries and stays local through DST', () => {
  assert.deepEqual(discovery.discoveryDays('week', 'vancouver', '', Date.parse('2026-12-29T08:30:00Z')),
    ['2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04']);
  const at = Date.parse('2026-11-01T06:30:00Z');
  assert.equal(discovery.discoveryDays('week', 'vancouver', '', at)[0], '2026-10-31');
  assert.equal(discovery.discoveryDays('week', 'toronto', '', at)[0], '2026-11-01');
  assert.equal(new Set(discovery.discoveryDays('week', 'vancouver', '', at)).size, 7);
});

test('the actual map defaults to today, widens festivals to seven days and preserves explicitly chosen dates', () => {
  const source = readFileSync(new URL('../src/app/map.tsx', import.meta.url), 'utf8');
  const declaration = source.match(/  const dateFilter: DiscoveryDate = [^\n]+/);
  assert.ok(declaration, 'map must distinguish an explicit date from its category default');
  const run = (selectedFilters, chosenDateFilter) => {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(`${declaration[0]}\nexports.value = dateFilter;`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
      { exports, selectedFilters, chosenDateFilter });
    return exports.value;
  };
  assert.equal(run([], null), 'today');
  assert.equal(run(['festival'], null), 'week');
  assert.equal(run(['cafe', 'festival'], null), 'week');
  for (const chosen of ['today', 'weekend', 'date', 'all']) assert.equal(run(['festival'], chosen), chosen);
  assert.equal(run(['cafe'], 'week'), 'week');
});

test('provided multi-day events overlap local days, midnight end is exclusive and places remain independent of dates', () => {
  assert.equal(typeof discovery.discoveryEventOnDays, 'function');
  const event = { source: 'event', cityId: 'vancouver', category: 'festival', startsAt: '2026-10-16T20:00:00Z', endsAt: '2026-10-19T07:00:00Z', localDate: '2026-10-16' };
  assert.equal(discovery.discoveryEventOnDays(event, ['2026-10-18']), true);
  assert.equal(discovery.discoveryEventOnDays(event, ['2026-10-19']), false);
  assert.equal(discovery.discoveryEventOnDays(event, ['2026-10-15']), false);
  assert.equal(discovery.discoveryEventOnDays({ source: 'event', cityId: 'vancouver', category: 'festival', localDate: '2026-10-18' }, ['2026-10-18']), true);
  assert.equal(discovery.discoveryEventOnDays({ source: 'event', cityId: 'vancouver', category: 'event' }, ['2026-10-18']), false);
  assert.equal(discovery.discoveryEventOnDays({ source: 'place', category: 'exhibition' }, ['2026-10-18']), true);
  assert.equal(discovery.discoveryEventOnDays({ source: 'post', category: 'housing' }, ['2026-10-18']), true);
  assert.equal(discovery.discoveryEventOnDays(event, []), true);
});
