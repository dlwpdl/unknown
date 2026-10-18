import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const snapshot = () => JSON.parse(readFileSync(new URL('src/lib/place-external-ratings.json', root), 'utf8'));
function load(rows = snapshot()) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('src/lib/place-external-ratings.ts', root), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, { exports, URL, require: () => rows });
  return exports;
}

test('external ratings stay scoped to the exact city and OSM identity, separate by provider', () => {
  const api = load();
  const ratings = api.getPlaceExternalRatings('vancouver', 'osm:node:703754423');
  assert.equal(ratings.length, 2);
  assert.equal(ratings.find(r => r.provider === 'Google').score, 4.5);
  assert.equal(ratings.find(r => r.provider === 'Google').count, 28661);
  assert.equal(ratings.find(r => r.provider === 'Tripadvisor').score, 4.1);
  assert.equal(api.getPlaceExternalRatings('toronto', 'osm:node:703754423').length, 0);
  assert.equal(api.getPlaceExternalRatings('vancouver', 'osm:node:1').length, 0);
});

test('missing, invalid and unsafe source metadata never becomes a visible score', () => {
  const row = snapshot()[0];
  for (const bad of [{ score: null }, { score: 0 }, { score: 6 }, { count: -1 }, { count: 1.5 }, { scale: 10 },
    { provider: 'Gling' }, { checkedAt: 'unknown' }, { sourceUrl: 'javascript:alert(1)' },
    { sourceUrl: 'https://wanderlog.com.evil.test/place/details/98400' }, { sourceUrl: 'https://user:pass@wanderlog.com/place/details/98400' }]) {
    assert.equal(load([{ ...row, ...bad }]).getPlaceExternalRatings(row.cityId, row.placeId).length, 0, JSON.stringify(bad));
  }
});

test('every bundled rating matches an existing place and keeps its observed source/date/count', () => {
  const catalog = JSON.parse(readFileSync(new URL('src/lib/city-places.catalog.json', root), 'utf8'));
  const rows = snapshot(), seen = new Set();
  assert.ok(rows.length >= 2);
  for (const row of rows) {
    const place = catalog.cities[row.cityId]?.places.find(p => p.id === row.placeId);
    assert.ok(place, `${row.cityId}/${row.placeId}`);
    assert.equal(row.placeName, place.name);
    assert.ok(!seen.has(`${row.cityId}/${row.placeId}/${row.provider}`));
    seen.add(`${row.cityId}/${row.placeId}/${row.provider}`);
    assert.ok(load().getPlaceExternalRatings(row.cityId, row.placeId).some(r => r.provider === row.provider));
    assert.ok(Date.parse(row.checkedAt) <= Date.now());
    assert.ok(row.count > 0);
    assert.ok(row.via === 'Wanderlog' || row.via === 'Resy');
    assert.equal(Object.hasOwn(row, 'reviews'), false, 'external data must not masquerade as member reviews');
  }
});
