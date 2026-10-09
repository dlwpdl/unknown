import assert from 'node:assert/strict';
import test from 'node:test';
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
  assert.deepEqual(await publicWeb.loadPublicFestivals(client, 'montreal'), []);
  assert.deepEqual(calls, [{ name: 'ticketmaster-events', options: { body: { cityId: 'montreal', category: 'all', page: 0, festival: true } } }]);
  await assert.rejects(() => publicWeb.loadPublicFestivals(client, 'unknown-city'), /INVALID_INPUT/);
  assert.equal(calls.length, 1);
  for (const failure of [{ data: null, error: new Error('network') }, { data: { error: 'RATE_LIMITED' }, error: null }, { data: {}, error: null }]) {
    response = failure;
    await assert.rejects(() => publicWeb.loadPublicFestivals(client, 'vancouver'));
  }
});

test('the public card shares the native local-time formatter and future event selection', async () => {
  assert.equal(typeof ticketmaster.eventTime, 'function', 'native event time is not available without auth code');
  const event = ticketmaster.normalizeEvent({ id: 'test-fest', name: 'Festival des arts', dates: {
    start: { dateTime: '2099-01-02T04:00:00Z', localDate: '2099-01-01', localTime: '20:00:00' },
    timezone: 'America/Vancouver', status: { code: 'onsale' },
  } }, 'vancouver');
  assert.match(ticketmaster.eventTime(event), /1월 1일/);
  assert.match(ticketmaster.eventTime(event), /08:00/);
  assert.equal(ticketmaster.eventTime({ ...event, timeUnconfirmed: true }), '2099-01-01 · 시간 확정 전');
  const client = { functions: { invoke: async () => ({ data: { events: [
    { ...event, id: 'past', startsAt: '2000-01-01T00:00:00Z' },
    { ...event, id: 'canceled', status: 'canceled' }, event,
  ] }, error: null }) } };
  assert.deepEqual((await publicWeb.loadPublicFestivals(client, 'vancouver')).map(item => item.id), ['test-fest']);
});
