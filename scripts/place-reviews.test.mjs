import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { CITIES, TAGS } from '../src/lib/mock.ts';
import * as maps from '../src/lib/post-maps.ts';

const root = new URL('../', import.meta.url);
const user = '11111111-1111-4111-8111-111111111111';
const saved = '22222222-2222-4222-8222-222222222222';
function module(path, imports) {
  if (!existsSync(new URL(path, root))) return {};
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, root), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, { exports, require: name => imports[name], URL, URLSearchParams, Error, Set });
  return exports;
}
const places = module('src/lib/city-places.ts', {
  './city-places.catalog.json': JSON.parse(readFileSync(new URL('src/lib/city-places.catalog.json', root))),
  './city-places.photos.json': JSON.parse(readFileSync(new URL('src/lib/city-places.photos.json', root))),
  '@/lib/mock': { CITIES },
});
const place = places.getCityPlaces('toronto')[0];
const scope = { cityId: place.cityId, placeId: place.id, userId: user };
function fixture({ feed = async () => [], create = async () => ({ id: saved, post: null }), session = () => user } = {}) {
  const calls = { reads: [], writes: [], sessions: 0 };
  const client = { auth: { getSession: async () => { calls.sessions++; const id = session(); return { data: { session: id ? { user: { id } } : null }, error: null }; } } };
  const api = module('src/lib/place-reviews.ts', {
    './city-places.ts': places, './post-maps.ts': maps, './mock.ts': { TAGS },
    './feed-data.ts': { loadPublicFeed: async (...args) => { calls.reads.push(args); return feed(...args); } },
    './community-data.ts': { createCommunityPost: async (...args) => { calls.writes.push(args); return create(...args); } },
  });
  return { ...api, calls, client };
}
function post(id, body, extra = {}) {
  return { id, cityId: place.cityId, kind: 'story', body, createdAt: '2026-10-15T20:00:00Z', sortAt: '2026-10-15T21:00:00Z', author: { id: 'author' }, ...extra };
}

test('trusted catalog IDs work for every supported city; names, prefixes and wrong cities do not identify a place', () => {
  const api = fixture(); assert.equal(typeof api.placeReviewBody, 'function');
  for (const city of CITIES) {
    const selected = places.getCityPlaces(city.id)[0];
    const body = api.placeReviewBody(city.id, selected.id, '직접 남기는 짧은 경험이에요.');
    assert.equal(api.placeReviewReference(body), selected.sourceUrl);
    assert.equal(maps.googleMapsPin(maps.postMapBody(body).url).latitude, selected.latitude);
    assert.equal(maps.googleMapsPin(maps.postMapBody(body).url).longitude, selected.longitude);
  }
  for (const id of [place.name, place.id + '9', place.id.replace('osm:', ''), 'osm:node:0', 'osm:node:1/../../2']) {
    assert.throws(() => api.placeReviewBody(place.cityId, id, 'text'), /PLACE_NOT_FOUND/);
  }
  assert.throws(() => api.placeReviewBody('not-a-city', place.id, 'text'), /PLACE_NOT_FOUND/);
});

test('source recognition is exact across URL aliases, escaped suffixes, OSM types and forged prefixes', () => {
  const api = fixture(); const body = api.placeReviewBody(scope.cityId, scope.placeId, '좋았어요.');
  assert.equal(api.placeReviewReference(body), place.sourceUrl);
  for (const url of [place.sourceUrl + '9', place.sourceUrl + '?x=1', place.sourceUrl + '#x', place.sourceUrl + '%2F', place.sourceUrl.replace('www.', ''), place.sourceUrl.replace('https:', 'http:'), place.sourceUrl + '.evil.test']) {
    assert.equal(api.isPlaceReview(post('bad', body.replace(place.sourceUrl, url)), scope.cityId, scope.placeId), false, url);
  }
  assert.equal(api.isPlaceReview(post('other-city', body, { cityId: 'vancouver' }), scope.cityId, scope.placeId), false);
  assert.equal(api.isPlaceReview(post('listing', body, { kind: 'listing' }), scope.cityId, scope.placeId), false);
  assert.equal(api.isPlaceReview(post('room', body, { room: {} }), scope.cityId, scope.placeId), false);
  assert.equal(api.placeReviewReference(body.replace('장소 후기: ', '가짜장소 후기: ')), null);
  const otherType = place.sourceUrl.replace(/\/(node|way|relation)\//, (_, type) => `/${type === 'node' ? 'way' : 'node'}/`);
  assert.equal(api.isPlaceReview(post('other-type', body.replace(place.sourceUrl, otherType)), scope.cityId, scope.placeId), false);
});

test('blank/oversized/control text and forged reserved metadata cannot become a new review', () => {
  const api = fixture();
  for (const body of ['', '  \n ', 'x'.repeat(1001), '\u0000text', 'mine\n장소 후기: ' + place.sourceUrl, 'mine\n 장소 후기 : fake']) {
    assert.throws(() => api.placeReviewBody(scope.cityId, scope.placeId, body), /INVALID_PLACE_REVIEW/);
  }
  assert.ok(api.placeReviewBody(scope.cityId, scope.placeId, '🙂'.repeat(1000)).includes('🙂'));
});

test('guest and switched-account reads never request full review bodies', async () => {
  for (const session of [() => null, () => 'another-account']) {
    const api = fixture({ session });
    await assert.rejects(api.loadPlaceReviews(api.client, scope), /ACCOUNT_CHANGED/);
    assert.equal(api.calls.reads.length, 0);
  }
  const api = fixture();
  await assert.rejects(api.loadPlaceReviews(api.client, { ...scope, userId: '' }), /ACCOUNT_CHANGED/);
  assert.equal(api.calls.reads.length, 0);
});

test('fuzzy server matches are filtered while pagination advances from the last unfiltered row', async () => {
  const api = fixture(); const body = api.placeReviewBody(scope.cityId, scope.placeId, '후기');
  const raw = Array.from({ length: 30 }, (_, i) => post('unrelated-' + i, 'A mention: ' + place.sourceUrl + '9'));
  raw[0] = post('real', body); raw[1] = post('wrong-city', body, { cityId: 'vancouver' }); raw[2] = post('listing', body, { kind: 'listing' });
  const reader = fixture({ feed: async () => raw });
  const page = await reader.loadPlaceReviews(reader.client, scope);
  assert.deepEqual(Array.from(page.posts, p => p.id), ['real']);
  assert.equal(page.hasMore, true);
  assert.equal(page.cursor.id, 'unrelated-29');
  assert.equal(page.cursor.sortAt, raw[29].sortAt);
  assert.equal(reader.calls.reads[0][3], place.sourceUrl);
  assert.equal(reader.calls.reads[0][5].viewerScope, user);
  await reader.loadPlaceReviews(reader.client, scope, page.cursor).catch(error => assert.match(error.message, /PAGE_STALLED/));
  assert.equal(reader.calls.reads.at(-1)[4].id, 'unrelated-29');
});

test('a page with zero exact reviews still exposes its next cursor, while empty end is not an error', async () => {
  const reader = fixture({ feed: async () => Array.from({ length: 30 }, (_, i) => post('p' + i, place.sourceUrl + '99')) });
  const page = await reader.loadPlaceReviews(reader.client, scope);
  assert.equal(page.posts.length, 0); assert.equal(page.hasMore, true); assert.equal(page.cursor.id, 'p29');
  const end = fixture(); const result = await end.loadPlaceReviews(end.client, scope, page.cursor);
  assert.equal(result.posts.length, 0); assert.equal(result.hasMore, false); assert.equal(result.cursor, null);
  const failed = fixture({ feed: async () => { throw new Error('offline'); } });
  await assert.rejects(failed.loadPlaceReviews(failed.client, scope), /offline/);
});

test('late responses for an account that changed during loading are rejected', async () => {
  let current = user;
  const reader = fixture({ session: () => current, feed: async () => { current = 'next-user'; return [post('old', 'old body')]; } });
  await assert.rejects(reader.loadPlaceReviews(reader.client, scope), /ACCOUNT_CHANGED/);
});

test('publication uses the existing story helper with trusted source/coordinates and rechecks session', async () => {
  const api = fixture();
  assert.equal((await api.writePlaceReview(api.client, scope, '  실제로 쓴 후기  ')).id, saved);
  const input = api.calls.writes[0][1];
  assert.equal(input.userId, user); assert.equal(input.cityId, place.cityId); assert.equal(input.kind, 'story');
  assert.equal(input.tag.slug, place.category === 'places' ? 'life' : 'food');
  assert.equal(api.placeReviewReference(input.body), place.sourceUrl);
  assert.equal('images' in input, false); assert.equal('merchantId' in input, false);
  assert.ok(input.body.startsWith('실제로 쓴 후기'));
  const wrong = fixture({ session: () => 'someone-else' });
  await assert.rejects(wrong.writePlaceReview(wrong.client, scope, 'draft'), /ACCOUNT_CHANGED/);
  assert.equal(wrong.calls.writes.length, 0);
  await assert.rejects(api.writePlaceReview(api.client, { ...scope, placeId: 'osm:way:999999999999999' }, 'draft'), /PLACE_NOT_FOUND/);
});

test('an invalidated place screen cannot publish after the asynchronous session check', async () => {
  const api = fixture();
  await assert.rejects(api.writePlaceReview(api.client, scope, 'still a local draft', () => false), /ACCOUNT_CHANGED/);
  assert.equal(api.calls.writes.length, 0);
});

test('failed and unconfirmed story saves do not report review publication success', async () => {
  const failed = fixture({ create: async () => { throw new Error('RATE_LIMITED'); } });
  await assert.rejects(failed.writePlaceReview(failed.client, scope, 'keep this draft'), /RATE_LIMITED/);
  for (const id of ['', null, 'not-a-post-id']) {
    const uncertain = fixture({ create: async () => ({ id, post: null }) });
    await assert.rejects(uncertain.writePlaceReview(uncertain.client, scope, 'keep this draft'), /SAVE_UNCONFIRMED/);
  }
});
