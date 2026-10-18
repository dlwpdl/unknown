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
function disk() {
  let value = null;
  return { getItem: async () => value, setItem: async (_key, next) => { value = next; } };
}
const beforeMidnight = Date.parse('2026-10-18T06:59:00Z'), afterMidnight = Date.parse('2026-10-18T07:01:00Z');
test('all readers share one request and a restart reads the saved catalog without another same-day request', async () => {
  const refresh = refreshModule(), storage = disk(), applied = [];
  let calls = 0, finish;
  const fetch = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const apply = catalog => { applied.push(catalog); };
  const a = refresh(storage, fetch, apply, beforeMidnight), b = refresh(storage, fetch, apply, beforeMidnight);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(calls, 1);
  finish({ version: 'one' }); await Promise.all([a, b]);
  await refreshModule()(storage, fetch, apply, beforeMidnight);
  assert.equal(calls, 1); assert.equal(applied.at(-1).version, 'one');
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
