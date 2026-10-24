import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const json = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const displays = new Map(json('assets/images/city-places-display/manifest.json').images.map(row => [row.original.sha256, row]));

for (const [cityId, minimum] of [['vancouver', 50], ['toronto', 38], ['montreal', 21], ['calgary', 14], ['edmonton', 14], ['winnipeg', 15]]) {
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
    const display = displays.get(photo.imageSha256);
    assert.equal(display?.original.path, `assets/images/city-places/${filename}`, `${id}: derivative retains exact original`);
    assert.ok(bindings.includes(`'${photo.imageSha256}': require('../../${display.display.path}')`), `${id}: static display binding`);
    assert.equal(createHash('sha256').update(readFileSync(new URL(display.display.path, root))).digest('hex'), display.display.sha256, `${id}: actual display bytes`);
  }
  assert.equal(new Set(ids.map(id => photos.find(row => row.placeId === id)?.imageSha256)).size, ids.length, 'different place aliases must not pad the list with the same cover');
  if (cityId === 'vancouver') for (const id of ['osm:way:37063023', 'osm:way:223635729', 'osm:way:86340299']) {
    assert.ok(ids.includes(id) && photos.some(photo => photo.placeId === id), `${id}: reported missing-photo regression`);
  }
});
}

// A city Top list and separately reviewed dining must both retain exact offline proof.
test('reviewed dining supplements have counted venue sources and the exact attributed image bytes', () => {
  const catalog = json('src/lib/city-places.catalog.json');
  const photos = json('src/lib/city-places.photos.json');
  const ratings = json('src/lib/place-external-ratings.json');
  const component = readFileSync(new URL('src/components/city-place-photo.tsx', root), 'utf8');
  const directory = new URL('assets/images/city-places/', root);
  const assets = new Map(readdirSync(directory).map(name => [createHash('sha256').update(readFileSync(new URL(name, directory))).digest('hex'), name]));
  for (const [cityId, placeId] of [['calgary', 'osm:way:221143394'], ['winnipeg', 'osm:way:97925809'], ['halifax', 'osm:node:475876928']]) {
    const city = catalog.cities[cityId];
    assert.ok(city.diningRecommendations?.some(pick => pick.placeId === placeId), `${placeId}: reviewed dining supplement`);
    assert.ok(city.places.some(place => place.id === placeId && ['food', 'cafe'].includes(place.category)));
    const image = photos.cities[cityId].find(photo => photo.placeId === placeId);
    assert.ok(image?.artist && image.licenseUrl && image.sourceUrl);
    const file = assets.get(image.imageSha256);
    const display = displays.get(image.imageSha256);
    assert.ok(file && display?.original.path === `assets/images/city-places/${file}`);
    assert.ok(component.includes(`'${image.imageSha256}': require('../../${display.display.path}')`));
    assert.ok(ratings.some(row => row.cityId === cityId && row.placeId === placeId && row.count > 0 && row.score > 0));
  }
  assert.equal(catalog.cities.vancouver.recommendations.length, 50);
});

test('the attested HANDSON visit binds to the actual847Denman venue without inventing a date or a photo license', () => {
  const catalog = json('src/lib/city-places.catalog.json');
  const visits = json('src/lib/gling-visited.json');
  const place = catalog.cities.vancouver.places.find(item => item.id === 'osm:node:4976343547');
  assert.ok(place?.address.includes('847 Denman'));
  assert.equal(place.website, 'https://www.handsonyvr.ca');
  const visit = visits.find(item => item.placeId === place.id);
  assert.deepEqual({ cityId: visit.cityId, placeId: visit.placeId, sourceUrl: visit.sourceUrl },
    { cityId: 'vancouver', placeId: place.id, sourceUrl: 'https://www.instagram.com/reel/DeoQKPNgYLe/' });
  assert.equal(visit.visitedAt, undefined, 'attestation does not invent a visit date');
  assert.equal(visit.photo.artist, 'HANDSON Steak & Frites');
  assert.equal(visit.photo.license, 'Business-provided photo');
  assert.equal(visit.photo.sourceUrl, place.website);
  assert.equal(visit.photo.licenseUrl, place.website);
  assert.equal(visit.photo.uri, 'https://static.wixstatic.com/media/948858_69a5a669d22f4899bcc75a73d1fdf1f3~mv2.jpg');
  assert.equal(visit.photo.imageSha256, 'ab97597dc75451b08525c8142688cb1649d8f375e9a40fe25f8ad6203a3e3d8a');
});
