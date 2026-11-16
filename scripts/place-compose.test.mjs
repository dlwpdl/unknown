import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { CITIES } from '../src/lib/mock.ts';
import { googleMapsPin, postMapBody, withPlacePin } from '../src/lib/post-maps.ts';

const root = new URL('../', import.meta.url);
const json = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
function module(path, imports) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, root), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, { exports, require: name => imports[name] ?? {}, URL, URLSearchParams, Error, Set, Map });
  return exports;
}
const places = module('src/lib/city-places.ts', {
  './city-places.catalog.json': json('src/lib/city-places.catalog.json'), './gling-visited.json': json('src/lib/gling-visited.json'),
  './city-places.photos.json': json('src/lib/city-places.photos.json'), '@/lib/mock': { CITIES },
});
// The button's hook with a recording router and event bus, signed in or not.
function press(place, { authed = true, os = 'ios' } = {}) {
  const pushed = [], prompts = [], feedback = [], emitted = [];
  const exports = module('src/hooks/use-place-compose.ts', {
    'expo-router': { useRouter: () => ({ push: route => pushed.push(route) }) }, react: { useMemo: fn => fn() },
    'react-native': { Platform: { OS: os }, DeviceEventEmitter: { emit: (name, value) => emitted.push([name, value]) } },
    '@/hooks/use-language': { useLanguage: () => ({ t: { auth: { reasonWrite: 'login to write' } } }) },
    '@/lib/auth': { useAuth: () => ({ isAuthed: authed, promptLogin: reason => prompts.push(reason) }) },
    '@/lib/city-places': places, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
  });
  const hook = exports.usePlaceCompose(place);
  hook?.();
  return { shown: !!hook, pushed, prompts, feedback, emitted, event: exports.PLACE_WRITE_EVENT };
}

test('a map place goes to the writer and comes back as the same pin and name the place search attaches', () => {
  const place = places.getCityDiscoveryPlaces('vancouver')[0];
  for (const os of ['ios', 'android']) {
    const app = press(place, { os });
    assert.deepEqual(app.feedback, ['selection']);
    assert.deepEqual(app.pushed, [], 'the app stays on the place; the writer floats over it (QA B10-2)');
    assert.equal(app.emitted.length, 1);
    assert.equal(app.emitted[0][0], app.event);
    assert.equal(app.emitted[0][1].id, place.id, 'the place writer gets the place the writer search would attach');
  }
  const web = press(place, { os: 'web' });
  assert.deepEqual(web.emitted, []);
  assert.deepEqual(JSON.parse(JSON.stringify(web.pushed)), [{ pathname: '/compose', params: { compose: '1', place: place.id, placeCity: 'vancouver' } }]);
  const { place: id, placeCity } = web.pushed[0].params;
  const parsed = places.composePlace(placeCity, id);
  assert.equal(parsed.id, place.id);
  const body = withPlacePin('', parsed), mapped = postMapBody(body);
  assert.deepEqual(googleMapsPin(mapped.url), { latitude: place.latitude, longitude: place.longitude });
  assert.equal(mapped.label, place.name);
  assert.equal(postMapBody(withPlacePin(withPlacePin('쓰던 글', places.getCityDiscoveryPlaces('vancouver')[1]), parsed)).body, '쓰던 글', 'a second place replaces the first and keeps the text');
});

test('only places the writer can attach show the button, and a guest gets the login prompt instead', () => {
  const listed = new Set(places.getCityDiscoveryPlaces('vancouver').map(place => place.id));
  const unlisted = places.getCityPlaces('vancouver').find(place => !listed.has(place.id));
  assert.ok(unlisted, 'the catalog has places outside the map');
  assert.equal(press(unlisted).shown, false, 'the place search would not list it');
  assert.equal(CITIES.find(city => city.id === 'calgary').state, 'soon');
  assert.equal(press(places.getCityDiscoveryPlaces('calgary')[0]).shown, false, 'the map shows Calgary, but posts there are not open yet');
  for (const [cityId, id] of [['vancouver', 'osm:way:0'], ['toronto', [...listed][0]], [undefined, [...listed][0]], ['vancouver', 7]]) assert.equal(places.composePlace(cityId, id), null);
  const guest = press(places.getCityDiscoveryPlaces('vancouver')[0], { authed: false });
  assert.deepEqual(guest.prompts, ['login to write']);
  assert.deepEqual(guest.pushed, []);
  assert.deepEqual(guest.emitted, [], 'a guest gets no writer');
});
