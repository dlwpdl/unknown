import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const path = new URL('../src/lib/city-place-refresh.ts', import.meta.url);
function refreshModule() {
  const exports = {};
  if (existsSync(path)) vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, Date, Intl });
  assert.equal(typeof exports.refreshCityPlaces, 'function');
  return exports.refreshCityPlaces;
}
function disk(initial = null) {
  let value = initial;
  return { getItem: async () => value, setItem: async (_key, next) => { value = next; } };
}
const beforeMidnight = Date.parse('2026-10-18T06:59:00Z'), afterMidnight = Date.parse('2026-10-18T07:01:00Z');
test('readers share one DB request and a same-day restart shows saved data without asking the DB again', async () => {
  const refresh = refreshModule(), storage = disk(), applied = [];
  let calls = 0, finish;
  const fetch = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const apply = catalog => { applied.push(catalog); };
  const a = refresh(storage, fetch, apply, beforeMidnight), b = refresh(storage, fetch, apply, beforeMidnight);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(calls, 1);
  finish({ version: 'one' }); await Promise.all([a, b]);
  await refreshModule()(storage, async () => { calls++; return { version: 'two' }; }, apply, beforeMidnight);
  assert.equal(calls, 1); assert.equal(applied.at(-1).version, 'one');
  await refreshModule()(storage, async () => { calls++; return { version: 'two' }; }, apply, afterMidnight);
  assert.equal(calls, 2); assert.equal(applied.at(-1).version, 'two');
});
test('a restart still asks when today\'s check only found an earlier day\'s catalog', async () => {
  const storage = disk(); let calls = 0;
  const early = Date.parse('2026-10-18T08:00:00Z');
  const fetch = async () => { calls++; return { recommendationTheme: 'photo-spots', collectedAt: '2026-10-17T11:10:00Z' }; };
  await refreshModule()(storage, fetch, () => true, early);
  await refreshModule()(storage, fetch, () => false, early + 16 * 60_000);
  assert.equal(calls, 2);
});
test('the next Vancouver day refreshes even across a short midnight interval', async () => {
  const refresh = refreshModule(), storage = disk(); let calls = 0;
  const fetch = async () => ({ version: ++calls });
  await refresh(storage, fetch, () => {}, beforeMidnight);
  await refresh(storage, fetch, () => {}, afterMidnight);
  assert.equal(calls, 2);
});
test('a failed or rejected update keeps the last good catalog, including after restart', async () => {
  const refresh = refreshModule(), storage = disk(), applied = [];
  const apply = value => { if (value.version !== 'good') throw new Error('INVALID_CATALOG'); applied.push(value); };
  await refresh(storage, async () => ({ version: 'good' }), apply, beforeMidnight);
  await refresh(storage, async () => ({ version: 'bad' }), apply, afterMidnight);
  let repeated = false;
  await refreshModule()(storage, async () => { repeated = true; throw new Error('offline'); }, apply, afterMidnight);
  assert.equal(repeated, false); assert.equal(applied.at(-1).version, 'good');
});
test('an offline first visit can recover later the same Vancouver day after restart', async () => {
  const storage = disk(); let calls = 0;
  await refreshModule()(storage, async () => { calls++; throw new Error('offline'); }, () => {}, afterMidnight);
  await refreshModule()(storage, async () => { calls++; return { version: 'online' }; }, () => {}, afterMidnight + 3_600_000);
  assert.equal(calls, 2);
});
test('opening before the daily publication does not hide a catalog published later that day', async () => {
  const storage = disk(), refresh = refreshModule(); let calls = 0;
  const early = Date.parse('2026-10-18T08:00:00Z'), published = Date.parse('2026-10-18T11:11:00Z');
  await refresh(storage, async () => { calls++; return { recommendationTheme: 'photo-spots', collectedAt: '2026-10-17T11:10:00Z' }; }, () => true, early);
  await refresh(storage, async () => { calls++; return { recommendationTheme: 'photo-spots', collectedAt: '2026-10-18T11:10:00Z' }; }, () => true, published);
  assert.equal(calls, 2);
});
test('a legacy or empty cached response cannot mark the current photo catalog as checked', async () => {
  for (const catalog of [null, { version: 'legacy' }]) {
    const storage = disk(JSON.stringify({ checkedOn: '2026-10-18', catalog })); let calls = 0;
    await refreshModule()(storage, async () => { calls++; return { version: 'photos' }; }, value => value?.version === 'photos', afterMidnight);
    assert.equal(calls, 1);
  }
});
test('same-session readers dedupe DB checks, then see another saved cohort after fifteen minutes', async () => {
  const storage = disk(); let calls = 0;
  const fetch = async () => { calls++; return { recommendationTheme: 'photo-spots', collectedAt: '2026-10-18T07:00:00Z' }; };
  const refresh = refreshModule();
  await refresh(storage, fetch, () => false, afterMidnight);
  await refresh(storage, fetch, () => false, afterMidnight + 60_000);
  assert.equal(calls, 1);
  await refresh(storage, fetch, () => false, afterMidnight + 16 * 60_000);
  assert.equal(calls, 2);
});
