import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const json = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));

test('the shipped Vancouver selection contains 50 distinct destinations, each with a real counted rating and an attributed offline photo', () => {
  const catalog = json('src/lib/city-places.catalog.json');
  const city = catalog.cities.vancouver;
  const ids = city.recommendations.map(pick => pick.placeId);
  assert.equal(ids.length, 50, 'check actual shipped data, not a generated UI fixture');
  assert.equal(new Set(ids).size, 50);
  assert.ok(Object.values(catalog.cities).flatMap(value => value.places).length >= 877, 'preserve prior detail/review identities');
  const ratings = json('src/lib/place-external-ratings.json');
  const photos = json('src/lib/city-places.photos.json').cities.vancouver;
  const directory = new URL('assets/images/city-places/', root);
  const assets = new Map(readdirSync(directory).map(name => [
    createHash('sha256').update(readFileSync(new URL(name, directory))).digest('hex'), name,
  ]));
  const bindings = readFileSync(new URL('src/components/city-place-photo.tsx', root), 'utf8');
  for (const id of ids) {
    assert.ok(city.places.some(place => place.id === id), id);
    const rating = ratings.find(row => row.cityId === 'vancouver' && row.placeId === id && row.count > 0 && row.score > 0 && row.score <= row.scale);
    assert.ok(rating, `${id}: actual provider rating and review count`);
    assert.ok(new URL(rating.sourceUrl).protocol === 'https:' && Number.isFinite(Date.parse(rating.checkedAt)));
    const photo = photos.find(row => row.placeId === id);
    assert.ok(photo?.artist && photo.license && photo.licenseUrl && photo.sourceUrl, `${id}: photo attribution`);
    const filename = assets.get(photo.imageSha256);
    assert.ok(filename, `${id}: actual matching photo bytes`);
    assert.ok(bindings.includes(`'${photo.imageSha256}': require('../../assets/images/city-places/${filename}')`), `${id}: static native binding`);
  }
  for (const id of ['osm:way:37063023', 'osm:way:223635729', 'osm:way:86340299']) {
    assert.ok(ids.includes(id) && photos.some(photo => photo.placeId === id), `${id}: reported missing-photo regression`);
  }
});
