import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('initial private metadata binds only the exact ten reviewed place identities', () => {
  const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const migration = read('supabase/migrations/20261024200000_regional_place_lookup.sql');
  const parts = migration.split('$regional_initial$');
  assert.equal(parts.length, 3, 'one explicit immutable seed is required');
  const rows = JSON.parse(parts[1]);
  const manifest = JSON.parse(read('docs/research/coquitlam-regional-catalog-20261024.json'));
  const places = JSON.parse(read('src/lib/city-places.catalog.json')).cities.vancouver.regionalPlaces;
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.map(row => row.place_key).sort(), [...manifest.placeIds].sort());
  const expected = places.map(place => ({ city_id: place.cityId, place_key: place.id, name: place.name, address: place.address }));
  const sorted = values => values.sort((a, b) => a.place_key.localeCompare(b.place_key));
  assert.deepEqual(sorted(rows), sorted(expected));
});
