import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import * as publicWeb from '../src/lib/public-web.ts';
import * as ticketmaster from '../supabase/functions/_shared/ticketmaster.ts';

const origin = 'https://example.supabase.co';
test('public festival read uses anonymous credentials and does not permit other functions', async () => {
  const requests = [];
  const request = publicWeb.publicWebFetch(origin, 'public-key', async (url, init) => {
    requests.push({ url, init });
    return new Response('{"events":[]}');
  });
  const controller = new AbortController();
  const body = JSON.stringify({ cityId: 'montreal', category: 'all', page: 0, festival: true });
  await request(`${origin}/functions/v1/ticketmaster-events`, {
    method: 'POST', headers: { Authorization: 'Bearer stored-user-token', apikey: 'wrong-key' },
    body, credentials: 'include', signal: controller.signal,
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.body, body);
  assert.equal(requests[0].init.credentials, 'omit');
  assert.equal(new Headers(requests[0].init.headers).get('Authorization'), 'Bearer public-key');
  assert.equal(new Headers(requests[0].init.headers).get('apikey'), 'public-key');
  controller.abort();
  assert.equal(requests[0].init.signal.aborted, true);
  for (const url of [
    `${origin}/functions/v1/ticketmaster-events-extra`,
    `${origin}/functions/v1/save-admin-merchant`,
    `${origin}/auth/v1/token`,
    'https://other.example/functions/v1/ticketmaster-events',
  ]) await assert.rejects(() => request(url, { method: 'POST', body }), /PUBLIC_WEB_READ_ONLY/);
  await assert.rejects(() => request(`${origin}/functions/v1/ticketmaster-events`, { method: 'GET' }), /PUBLIC_WEB_READ_ONLY/);
  assert.equal(requests.length, 1);
});

test('public festivals request the selected city and distinguish missing data from an empty city', async () => {
  assert.equal(typeof publicWeb.loadPublicFestivals, 'function', 'public festival loader is missing');
  const calls = [];
  let response = { data: { events: [] }, error: null };
  const client = { functions: { invoke: async (name, options) => { calls.push({ name, options }); return response; } } };
  assert.deepEqual((await publicWeb.loadPublicFestivals(client, 'montreal')).events, []);
  assert.deepEqual(calls, [
    { name: 'ticketmaster-events', options: { body: { cityId: 'montreal', category: 'all', page: 0, festival: true } } },
    { name: 'ticketmaster-events', options: { body: { cityId: 'montreal', category: 'all', page: 0 } } },
  ]);
  await assert.rejects(() => publicWeb.loadPublicFestivals(client, 'unknown-city'), /INVALID_INPUT/);
  assert.equal(calls.length, 2);
  for (const failure of [{ data: null, error: new Error('network') }, { data: { error: 'RATE_LIMITED' }, error: null }, { data: {}, error: null }]) {
    response = failure;
    await assert.rejects(() => publicWeb.loadPublicFestivals(client, 'vancouver'));
  }
});

test('an underfilled legacy daily cache is completed from the real whole-view source in all five cities', async t => {
  const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/festival-upcoming-cities.json', import.meta.url), 'utf8'));
  t.mock.method(Date, 'now', () => Date.parse(fixture.now));
  for (const city of fixture.cities) {
    const calls = [];
    const client = { functions: { invoke: async (_, { body }) => {
      calls.push(body);
      return { data: { events: body.festival ? city.events.slice(-2) : city.events, nextRefreshAt: '2026-10-14T04:00:00Z' }, error: null };
    } } };
    const data = await publicWeb.loadPublicFestivals(client, city.cityId);
    assert.deepEqual(data.events.map(event => event.id), city.expectedIds);
    assert.deepEqual(calls, [{ cityId: city.cityId, category: 'all', page: 0, festival: true }, { cityId: city.cityId, category: 'all', page: 0 }]);
    assert.equal(data.nextRefreshAt, '2026-10-14T04:00:00Z');
  }
});

test('a busy daily refresh can still show the selected city from the whole-view source', async t => {
  const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/festival-upcoming-cities.json', import.meta.url), 'utf8'));
  t.mock.method(Date, 'now', () => Date.parse(fixture.now));
  const city = fixture.cities[0];
  for (const daily of [{ data: { error: 'RATE_LIMITED' }, error: new Error('HTTP 429') }, { data: null, error: new Error('network') }, { data: {}, error: null }]) {
    const calls = [];
    const client = { functions: { invoke: async (_, { body }) => {
      calls.push(body);
      return body.festival ? daily : { data: { events: city.events }, error: null };
    } } };
    assert.deepEqual((await publicWeb.loadPublicFestivals(client, city.cityId)).events.map(event => event.id), city.expectedIds);
    assert.deepEqual(calls, [{ cityId: city.cityId, category: 'all', page: 0, festival: true }, { cityId: city.cityId, category: 'all', page: 0 }]);
  }
});

test('a complete daily gallery needs no extra query and a failed fill remains retryable', async () => {
  const events = Array.from({ length: 7 }, (_, index) => ({ id: `e${index}`, name: `Show ${index}`, venue: 'Park', startsAt: '2099-01-01T20:00:00Z', timeUnconfirmed: false, status: 'onsale' }));
  let calls = 0;
  const client = { functions: { invoke: async (_, { body }) => { calls++; return body.festival ? { data: { events }, error: null } : { data: null, error: new Error('network') }; } } };
  assert.equal((await publicWeb.loadPublicFestivals(client, 'vancouver')).events.length, 7);
  assert.equal(calls, 1);
  events.pop();
  await assert.rejects(() => publicWeb.loadPublicFestivals(client, 'vancouver'), /PUBLIC_FESTIVALS_UNAVAILABLE/);
});

test('filling a daily gallery keeps the newest cached record for duplicate event IDs', async () => {
  const event = { id: 'rescheduled', name: 'Live Show', venue: 'Park', startsAt: '2099-01-01T19:00:00Z', timeUnconfirmed: false, status: 'onsale' };
  for (const newer of ['daily', 'full']) {
    const latest = { ...event, startsAt: '2099-01-01T20:00:00Z', status: 'rescheduled' };
    const client = { functions: { invoke: async (_, { body }) => {
      const fresh = (body.festival ? 'daily' : 'full') === newer;
      return { data: { events: [fresh ? latest : event], fetchedAt: fresh ? '2026-10-13T12:05:00Z' : '2026-10-13T12:00:00Z' }, error: null };
    } } };
    assert.deepEqual((await publicWeb.loadPublicFestivals(client, 'vancouver')).events, [latest]);
  }
});

test('the public card shares the native local-time formatter and future event selection', async () => {
  assert.equal(typeof ticketmaster.eventTime, 'function', 'native event time is not available without auth code');
  const event = ticketmaster.normalizeEvent({ id: 'test-fest', name: 'Festival des arts', dates: {
    start: { dateTime: '2099-01-02T04:00:00Z', localDate: '2099-01-01', localTime: '20:00:00' },
    timezone: 'America/Vancouver', status: { code: 'onsale' },
  } }, 'vancouver');
  // Historical timezone rules remain stable across Node and OS timezone-data versions.
  const historical = { ...event, startsAt: '2025-01-02T04:00:00Z', localDate: '2025-01-01' };
  assert.match(ticketmaster.eventTime(historical), /1월 1일/);
  assert.match(ticketmaster.eventTime(historical), /08:00/);
  assert.equal(ticketmaster.eventTime({ ...event, timeUnconfirmed: true }), '2099-01-01 · 시간 확정 전');
  const client = { functions: { invoke: async () => ({ data: { events: [
    { ...event, id: 'past', startsAt: '2000-01-01T00:00:00Z' },
    { ...event, id: 'canceled', status: 'canceled' }, event,
  ] }, error: null }) } };
  assert.deepEqual((await publicWeb.loadPublicFestivals(client, 'vancouver')).events.map(item => item.id), ['test-fest']);
});

test('public festivals preserve the server-assigned position instead of re-sorting it away', async () => {
  const make = (id, day) => ticketmaster.normalizeEvent({ id, name: `${id} Festival`, dates: { start: { dateTime: `2099-01-${day}T20:00:00Z`, localDate: `2099-01-${day}` }, timezone: 'America/Vancouver', status: { code: 'onsale' } } });
  const response = { events: [make('first', '01'), make('assigned', '08'), make('second', '02')], festivalSlots: [{ slot: 2, eventId: 'assigned', endsAt: '2099-01-07T00:00:00Z' }] };
  const client = { functions: { invoke: async () => ({ data: response, error: null }) } };
  assert.deepEqual((await publicWeb.loadPublicFestivals(client, 'vancouver')).events.map(event => event.id), ['first', 'assigned', 'second']);
});
