import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { ticketmasterReference } from '../supabase/functions/_shared/ticketmaster.ts';

const place = { id: 'osm:node:123', cityId: 'vancouver', name: 'Test café', category: 'cafe', latitude: 49.28, longitude: -123.12, sourceUrl: 'https://www.openstreetmap.org/node/123' };
function api(places = [place]) {
  const file = new URL('../src/lib/meetup-destination.ts', import.meta.url);
  assert.ok(existsSync(file), 'Destination reference helper is not implemented');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, URL, require(name) {
      if (name.includes('city-places')) return { getCityPlaces: city => places.filter(p => p.cityId === city) };
      if (name.includes('mock')) return { CITIES: [{ id: 'vancouver', state: 'open' }, { id: 'toronto', state: 'open' }] };
      if (name.includes('ticketmaster')) return { ticketmasterReference };
      throw Error('Unexpected import ' + name);
    },
  });
  return exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const route = { placeId: place.id, placeCityId: place.cityId };

test('destination resolution requires an exact existing canonical city, positive identity and source URL', () => {
  const a = api(), valid = a.resolveMeetupDestination(route);
  assert.equal(valid.invalid, false); assert.equal(valid.destination.kind, 'place');
  assert.equal(valid.destination.place.id, place.id);
  for (const bad of [{ ...route, placeId: 'osm:node:999' }, { ...route, placeCityId: 'toronto' }, { ...route, placeId: ['osm:node:123'] }, { ...route, placeId: 'osm:node:0123' }, { ...route, ticketmasterEventId: 'ev1' }]) assert.equal(a.resolveMeetupDestination(bad).invalid, true);
  for (const sourceUrl of ['http://www.openstreetmap.org/node/123', 'https://www.openstreetmap.org/node/123?x=1', 'https://www.openstreetmap.org/node/1234']) assert.equal(api([{ ...place, sourceUrl }]).resolveMeetupDestination(route).invalid, true);
  assert.deepEqual(plain(a.resolveMeetupDestination({})), { destination: null, invalid: false });
});

test('event routes require a valid explicit city and reject conflicting or malformed source parameters', () => {
  const a = api();
  assert.deepEqual(plain(a.resolveMeetupDestination({ ticketmasterEventId: 'EV_1', ticketmasterCityId: 'toronto' })), { destination: { kind: 'event', eventId: 'EV_1', cityId: 'toronto' }, invalid: false });
  for (const params of [{ ticketmasterEventId: 'EV_1' }, { ticketmasterEventId: 'EV%1', ticketmasterCityId: 'toronto' }, { placeCityId: 'vancouver' }, { ...route, ticketmasterCityId: 'toronto' }]) assert.equal(a.resolveMeetupDestination(params).invalid, true);
});

test('readable canonical place tails round trip without exposing the source in prose', () => {
  const a = api(), d = a.resolveMeetupDestination(route).destination;
  const tail = a.placeMeetupTail(d), body = 'Join us.\nA small group.' + tail;
  assert.equal(tail, '\n\n장소: Test café\n장소 정보: https://www.openstreetmap.org/node/123');
  const split = a.splitPlaceMeetupBody(body, 'vancouver');
  assert.equal(split.intro, 'Join us.\nA small group.'); assert.equal(split.details, tail); assert.equal(split.place.id, place.id);
  assert.equal(a.splitPlaceMeetupBody(body).place.id, place.id);
  assert.equal(a.splitPlaceMeetupBody(body, 'toronto'), null);
  assert.equal(a.splitPlaceMeetupBody(body + '\nUntrusted suffix'), null);
  assert.equal(a.splitPlaceMeetupBody(body.replace('/node/123', '/node/1234')), null);
  assert.equal(a.splitPlaceMeetupBody('행사 ID: EV_1' + tail), null);
  assert.equal(a.splitPlaceMeetupBody(body + tail), null);
});

test('same destination matching is exact and city scoped, including node1 versus node10 and event ID substrings', () => {
  const other = { ...place, id: 'osm:node:1234', sourceUrl: 'https://www.openstreetmap.org/node/1234' }, a = api([place, other]), d = a.resolveMeetupDestination(route).destination;
  const good = { cityId: 'vancouver', body: 'Hello' + a.placeMeetupTail(d) };
  assert.equal(a.matchesMeetupDestination(good, d), true);
  assert.equal(a.matchesMeetupDestination({ ...good, cityId: 'toronto' }, d), false);
  assert.equal(a.matchesMeetupDestination({ ...good, body: 'Mention ' + place.sourceUrl }, d), false);
  assert.equal(a.matchesMeetupDestination({ ...good, body: 'Hello\n\n장소: Other\n장소 정보: ' + other.sourceUrl }, d), false);
  const event = a.resolveMeetupDestination({ ticketmasterEventId: 'EV_1', ticketmasterCityId: 'vancouver' }).destination;
  assert.equal(a.matchesMeetupDestination({ ...good, body: 'Join\n\n행사 ID: EV_1' }, event), true);
  assert.equal(a.matchesMeetupDestination({ ...good, body: 'Join\n\n행사 ID: EV_10' }, event), false);
  assert.equal(a.matchesMeetupDestination({ ...good, body: '행사 ID: EV_1\n행사 ID: EV_2' }, event), false);
  assert.equal(a.matchesMeetupDestination({ ...good, body: '행사 ID: EV_1' + a.placeMeetupTail(d) }, event), false);
});

test('server queries escape literal ILIKE wildcards while retaining exact source identity', () => {
  const a = api(), d = a.resolveMeetupDestination(route).destination;
  assert.equal(a.meetupDestinationQuery(d), place.sourceUrl);
  const event = a.resolveMeetupDestination({ ticketmasterEventId: 'EV_1', ticketmasterCityId: 'vancouver' }).destination;
  assert.equal(a.meetupDestinationQuery(event), 'EV\\_1');
});
