import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as ticketmaster from '../supabase/functions/_shared/ticketmaster.ts';

const now = Date.parse('2026-10-11T12:00:00Z');
const raw = (id, day = 12) => ({ id, name: `${id} Festival`, dates: { start: { dateTime: `2026-10-${day}T20:00:00Z`, localDate: `2026-10-${day}`, localTime: '13:00:00' }, timezone: 'America/Vancouver', status: { code: 'onsale' } }, _embedded: { venues: [{ name: 'Park', city: { name: 'Vancouver' }, country: { countryCode: 'CA' } }] } });
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }

function endpoint({ cached = null, slots = [], slotsAfterRead, readyCache, claim = true, upstreamStatus = 200, budget = true } = {}) {
  const calls = [], writes = [], requests = [];
  let cacheReads = 0;
  const rows = new Map(cached ? [['tm-festival:vancouver', cached]] : []);
  const db = {
    from: () => {
      let key, expiry;
      const query = {
        select() { return query; }, eq(_, value) { key = value; return query; }, gt(_, value) { expiry = value; return query; },
        async maybeSingle() { cacheReads++; const row = rows.get(key); return { data: row && (!expiry || Date.parse(row.expires_at) > Date.parse(expiry)) ? row : null, error: null }; },
        async upsert(value) { writes.push(value); rows.set(value.cache_key, value); return { error: null }; },
      };
      return query;
    },
    async rpc(name) {
      calls.push(name);
      if (name === 'claim_ticketmaster_festival_refresh' && readyCache) rows.set('tm-festival:vancouver', readyCache);
      return { data: name === 'get_ticketmaster_festival_slots' ? cacheReads && slotsAfterRead ? slotsAfterRead : slots : name === 'claim_ticketmaster_festival_refresh' ? claim : budget, error: null };
    },
  };
  const source = ts.transpileModule(fs.readFileSync(new URL('../supabase/functions/ticketmaster-events/index.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  let handle;
  vm.runInNewContext(source, {
    exports: {}, require: name => name.includes('supabase-js') ? { createClient: () => db }
      : { ...ticketmaster, festivalCacheExpiry: (cityId, at = now) => ticketmaster.festivalCacheExpiry(cityId, at) },
    Deno: { env: { get: name => ({ TICKETMASTER_API_KEY: 'test-key', SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-service' })[name] }, serve: value => { handle = value; } },
    URL, Response, Date: Clock, AbortSignal, setTimeout, console: { error() {} },
    fetch: async url => {
      const target = new URL(url); requests.push(target);
      const eventId = target.pathname.match(/\/events\/([^/]+)\.json$/)?.[1];
      return new Response(JSON.stringify(eventId ? raw(eventId, 25) : { page: { totalPages: 1, totalElements: 10 }, _embedded: { events: Array.from({ length: 10 }, (_, index) => raw(`f${index}`, index + 12)) } }), { status: upstreamStatus });
    },
  });
  return {
    calls, writes, requests,
    invoke: body => handle(new Request('https://example.invalid/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),
  };
}
const query = { cityId: 'vancouver', festival: true };

test('a daily cache serves seven server-selected positions with no new Ticketmaster request', async () => {
  const events = Array.from({ length: 10 }, (_, index) => ticketmaster.normalizeEvent(raw(`f${index}`, index + 12)));
  const api = endpoint({ cached: { payload: { events, page: 0, hasMore: false }, updated_at: new Date(now).toISOString(), expires_at: ticketmaster.festivalCacheExpiry('vancouver', now) }, slots: [{ slot: 2, event_id: 'f9', ends_at: '2026-10-20T00:00:00Z', event: events[9] }] });
  const response = await api.invoke(query); const data = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(data.events.map(event => event.id), ['f0', 'f9', 'f1', 'f2', 'f3', 'f4', 'f5']);
  assert.equal(api.requests.length, 0); assert.equal(api.writes.length, 0);
  assert.deepEqual(data.festivalSlots, [{ slot: 2, eventId: 'f9', endsAt: '2026-10-20T00:00:00Z' }]);
});
test('one shared collection stores candidates until the next city day and repeated reads use that cache', async () => {
  const api = endpoint();
  const first = await api.invoke(query); const data = await first.json();
  assert.equal(first.status, 200); assert.equal(data.events.length, 7);
  assert.equal(api.requests.length, 1); assert.equal(api.requests[0].searchParams.get('size'), '100');
  assert.equal(api.requests[0].searchParams.get('sort'), 'date,asc');
  assert.equal(api.writes[0].expires_at, '2026-10-12T07:00:00Z');
  assert.equal(api.writes[0].payload.events.length, 10);
  assert.equal((await api.invoke(query)).status, 200); assert.equal(api.requests.length, 1);
});
test('a competing collection cannot start another upstream request', async () => {
  const api = endpoint({ claim: false });
  const response = await api.invoke(query);
  assert.equal(response.status, 429); assert.equal(api.requests.length, 0); assert.equal(api.writes.length, 0);
});
test('a failed collection is never saved as an empty successful day', async () => {
  const api = endpoint({ upstreamStatus: 502 });
  assert.equal((await api.invoke(query)).status, 502); assert.equal(api.writes.length, 0);
});
test('normal event details retain the fifteen-minute cache and upstream error behavior', async () => {
  const api = endpoint();
  const response = await api.invoke({ cityId: 'vancouver', eventId: 'fixture' });
  assert.equal(response.status, 200); assert.equal(api.writes[0].expires_at, new Date(now + 15 * 60000).toISOString());
  assert.equal(api.requests.length, 1);
});
test('a pinned festival outside the candidate page is collected within the same shared daily snapshot', async () => {
  const api = endpoint({ slots: [{ slot: 1, event_id: 'outside', ends_at: '2026-10-20T00:00:00Z', event: null }] });
  const response = await api.invoke(query); const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.events[0].id, 'outside');
  assert.equal(api.requests.length, 2); assert.equal(api.writes[0].payload.events.length, 11);
  assert.equal((await api.invoke(query)).status, 200); assert.equal(api.requests.length, 2);
});

test('fresh cancellations cannot be overwritten by a pin snapshot read before the cache', async () => {
  const event = ticketmaster.normalizeEvent(raw('cancelled-pin'));
  const cancelled = { ...event, status: 'canceled' };
  const cache = { payload: { events: [cancelled, ticketmaster.normalizeEvent(raw('replacement'))] }, updated_at: new Date(now).toISOString(), expires_at: ticketmaster.festivalCacheExpiry('vancouver', now) };
  const pin = { slot: 1, event_id: event.id, ends_at: '2026-10-12T00:00:00Z', event };
  for (const options of [{ cached: cache }, { claim: false, readyCache: cache }]) {
    const api = endpoint({ ...options, slots: [pin], slotsAfterRead: [{ ...pin, event: cancelled }] });
    const response = await api.invoke(query); const data = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(data.events.map(event => event.id), ['replacement']);
    assert.equal(api.requests.length, 0);
  }
});

test('a festival feed reports the next manual exposure expiry for open clients', async () => {
  const event = ticketmaster.normalizeEvent(raw('assigned', 25));
  const api = endpoint({ cached: { payload: { events: [event] }, updated_at: new Date(now).toISOString(), expires_at: ticketmaster.festivalCacheExpiry('vancouver', now) }, slots: [{ slot: 1, event_id: event.id, ends_at: '2026-10-11T20:00:00Z', event }] });
  const data = await (await api.invoke(query)).json();
  assert.equal(data.nextRefreshAt, '2026-10-11T20:00:00.000Z');
});
