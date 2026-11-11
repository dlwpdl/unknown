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
// October is PDT (UTC-7): 23:59, 00:01 and 05:01 Vancouver time; the daily catalog is published from 04:10 PT.
const beforeMidnight = Date.parse('2026-10-18T06:59:00Z'), afterMidnight = Date.parse('2026-10-18T07:01:00Z'), afterPublication = Date.parse('2026-10-18T12:01:00Z');
const DAY = 86_400_000;
test('readers share one DB request, a same-day restart shows saved data without asking the DB, and the next publication is read once', async () => {
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
  await refreshModule()(storage, async () => { calls++; return { version: 'two' }; }, apply, afterPublication);
  assert.equal(calls, 2); assert.equal(applied.at(-1).version, 'two');
});
test('an earlier day\'s catalog found before the 04:10 PT publication is asked again only once the publication is done', async () => {
  const storage = disk(); let calls = 0;
  const early = Date.parse('2026-10-18T08:00:00Z');
  const fetch = async () => { calls++; return { recommendationTheme: 'photo-spots', collectedAt: '2026-10-17T11:10:00Z' }; };
  await refreshModule()(storage, fetch, () => true, early);
  await refreshModule()(storage, fetch, () => false, early + 16 * 60_000);
  assert.equal(calls, 1);
  await refreshModule()(storage, fetch, () => false, afterPublication);
  assert.equal(calls, 2);
});
test('midnight alone does not download again; the next day\'s publication does', async () => {
  const refresh = refreshModule(), storage = disk(); let calls = 0;
  const fetch = async () => ({ version: ++calls });
  await refresh(storage, fetch, () => {}, beforeMidnight);
  await refresh(storage, fetch, () => {}, afterMidnight);
  assert.equal(calls, 1);
  await refresh(storage, fetch, () => {}, afterPublication);
  assert.equal(calls, 2);
});
test('a failed or rejected update keeps the last good catalog, including after restart', async () => {
  const refresh = refreshModule(), storage = disk(), applied = [];
  const apply = value => { if (value.version !== 'good') throw new Error('INVALID_CATALOG'); applied.push(value); };
  await refresh(storage, async () => ({ version: 'good' }), apply, beforeMidnight);
  await refresh(storage, async () => ({ version: 'bad' }), apply, afterPublication);
  let repeated = false;
  await refreshModule()(storage, async () => { repeated = true; throw new Error('offline'); }, apply, afterPublication);
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
  const early = Date.parse('2026-10-18T08:00:00Z'), published = Date.parse('2026-10-18T12:10:00Z');
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
test('today\'s catalog is downloaded once: map visits, foreground returns and restarts that day reuse it', async () => {
  const storage = disk(); let calls = 0;
  const fetch = async () => { calls++; return { recommendationTheme: 'photo-spots', collectedAt: new Date(afterPublication - 51 * 60_000 + (calls - 1) * DAY).toISOString() }; };
  const refresh = refreshModule();
  for (const later of [0, 60_000, 16 * 60_000, 6 * 3_600_000]) await refresh(storage, fetch, () => true, afterPublication + later);
  await refreshModule()(storage, fetch, () => false, afterPublication + 18 * 3_600_000);
  assert.equal(calls, 1);
  await refreshModule()(storage, fetch, () => true, afterPublication + DAY);
  assert.equal(calls, 2);
});
test('a day whose publication failed is asked once after 05:00 PT, not on every visit', async () => {
  const storage = disk(), refresh = refreshModule(); let calls = 0;
  const fetch = async () => { calls++; return { recommendationTheme: 'photo-spots', collectedAt: '2026-10-17T11:10:00Z' }; };
  for (const later of [0, 16 * 60_000, 3 * 3_600_000]) await refresh(storage, fetch, () => false, afterPublication + later);
  await refreshModule()(storage, fetch, () => false, afterPublication + 10 * 3_600_000);
  await refreshModule()(storage, fetch, () => false, afterMidnight + DAY);
  assert.equal(calls, 1);
  await refreshModule()(storage, fetch, () => false, afterPublication + DAY);
  assert.equal(calls, 2);
});
test('a failed request is retried after fifteen minutes in the same session', async () => {
  const storage = disk(), refresh = refreshModule(); let calls = 0;
  const fetch = async () => { if (++calls === 1) throw new Error('offline'); return { recommendationTheme: 'photo-spots', collectedAt: '2026-10-18T11:10:00Z' }; };
  await refresh(storage, fetch, () => true, afterPublication);
  await refresh(storage, fetch, () => true, afterPublication + 10 * 60_000);
  assert.equal(calls, 1);
  await refresh(storage, fetch, () => true, afterPublication + 16 * 60_000);
  await refresh(storage, fetch, () => true, afterPublication + 40 * 60_000);
  assert.equal(calls, 2);
});
test('the first launch after updating keeps a 1.5.1 copy that holds today\'s catalog and otherwise asks once', async () => {
  const today = { recommendationTheme: 'photo-spots', collectedAt: '2026-10-18T11:10:00Z' }, yesterday = { ...today, collectedAt: '2026-10-17T11:10:00Z' };
  for (const [catalog, expected] of [[today, 0], [yesterday, 1]]) {
    // 1.5.1 wrote lastCheckedAt even when that check failed, so it cannot stand for an answer.
    const storage = disk(JSON.stringify({ checkedOn: '2026-10-17', retryAfter: 0, lastCheckedAt: afterPublication - 60_000, catalog })); let calls = 0;
    await refreshModule()(storage, async () => { calls++; return yesterday; }, () => false, afterPublication);
    assert.equal(calls, expected);
  }
});
test('storage that cannot read or write keeps the downloaded catalog in memory without downloading again', async () => {
  const broken = { getItem: async () => { throw new Error('CursorWindow'); }, setItem: async () => { throw new Error('SQLITE_FULL'); } };
  const refresh = refreshModule(), applied = []; let calls = 0;
  const fetch = async () => { calls++; return { recommendationTheme: 'photo-spots', collectedAt: '2026-10-18T11:10:00Z' }; };
  await refresh(broken, fetch, value => { applied.push(value); return true; }, afterPublication);
  await refresh(broken, fetch, () => false, afterPublication + 16 * 60_000);
  assert.equal(calls, 1); assert.equal(applied.length, 1);
});
function nativeStorage(os, saved = { 'gling.city-places.v1': 'from-1.5.1' }) {
  let file = null, storage = null;
  const asyncStorage = { getItem: async key => saved[key] ?? null, setItem: async () => {}, removeItem: async key => { delete saved[key]; } };
  const imports = {
    '@react-native-async-storage/async-storage': { __esModule: true, default: asyncStorage },
    'expo-file-system': { Paths: { cache: 'cache' }, File: class { constructor(dir, name) { assert.equal(`${dir}/${name}`, 'cache/gling-city-places.json'); }
      get exists() { return file !== null; } async text() { return file; } async write(value) { file = value; } } },
    react: { useCallback: callback => callback, useSyncExternalStore: () => 0 },
    'react-native': { Platform: { OS: os }, AppState: { addEventListener: () => ({ remove() {} }) } },
    'expo-router': { useFocusEffect: effect => effect() },
    '@/lib/city-places': {}, '@/lib/supabase': {},
    '@/lib/city-place-refresh': { refreshCityPlaces: value => { storage = value; return Promise.resolve(); } },
  };
  const source = readFileSync(new URL('../src/hooks/use-city-places.ts', import.meta.url), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, { exports, require: name => imports[name] });
  exports.useCityPlacesRevision();
  return { storage, asyncStorage, saved, file: () => file };
}
test('native apps keep the catalog in a cache file and take over the AsyncStorage copy older versions left', async () => {
  const app = nativeStorage('ios');
  assert.notEqual(app.storage, app.asyncStorage);
  assert.equal(await app.storage.getItem('gling.city-places.v1'), 'from-1.5.1');
  await app.storage.setItem('gling.city-places.v1', 'x'.repeat(3_000_000));
  assert.equal(app.file().length, 3_000_000); assert.deepEqual(app.saved, {});
  assert.equal((await app.storage.getItem('gling.city-places.v1')).length, 3_000_000);
  const web = nativeStorage('web');
  assert.equal(web.storage, web.asyncStorage);
});
