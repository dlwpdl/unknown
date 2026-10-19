import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const json = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));

for (const [cityId, minimum] of [['vancouver', 50], ['toronto', 28], ['montreal', 20]]) {
test(`the shipped ${cityId} cohort has distinct destinations with counted ratings and attributed offline photos`, () => {
  const catalog = json('src/lib/city-places.catalog.json');
  const city = catalog.cities[cityId];
  const ids = city.recommendations.map(pick => pick.placeId);
  assert.ok(ids.length >= minimum && ids.length <= 50, 'check the actual admitted city cohort');
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(Object.values(catalog.cities).flatMap(value => value.places).length >= 904, 'preserve prior detail/review identities');
  const ratings = json('src/lib/place-external-ratings.json');
  const photos = json('src/lib/city-places.photos.json').cities[cityId];
  const directory = new URL('assets/images/city-places/', root);
  const assets = new Map(readdirSync(directory).map(name => [
    createHash('sha256').update(readFileSync(new URL(name, directory))).digest('hex'), name,
  ]));
  const bindings = readFileSync(new URL('src/components/city-place-photo.tsx', root), 'utf8');
  for (const id of ids) {
    assert.ok(city.places.some(place => place.id === id), id);
    const rating = ratings.find(row => row.cityId === cityId && row.placeId === id && row.count > 0 && row.score > 0 && row.score <= row.scale);
    assert.ok(rating, `${id}: actual provider rating and review count`);
    assert.ok(new URL(rating.sourceUrl).protocol === 'https:' && Number.isFinite(Date.parse(rating.checkedAt)));
    const photo = photos.find(row => row.placeId === id);
    assert.ok(photo?.artist && photo.license && photo.licenseUrl && photo.sourceUrl, `${id}: photo attribution`);
    const filename = assets.get(photo.imageSha256);
    assert.ok(filename, `${id}: actual matching photo bytes`);
    assert.ok(bindings.includes(`'${photo.imageSha256}': require('../../assets/images/city-places/${filename}')`), `${id}: static native binding`);
  }
  assert.equal(new Set(ids.map(id => photos.find(row => row.placeId === id)?.imageSha256)).size, ids.length, 'different place aliases must not pad the list with the same cover');
  if (cityId === 'vancouver') for (const id of ['osm:way:37063023', 'osm:way:223635729', 'osm:way:86340299']) {
    assert.ok(ids.includes(id) && photos.some(photo => photo.placeId === id), `${id}: reported missing-photo regression`);
  }
});
}
