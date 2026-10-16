import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as ticketmaster from '../supabase/functions/_shared/ticketmaster.ts';

test('legacy festival caches refresh once for venue coordinates and then reuse the mapped cache', async () => {
  let handler, upstream = 0, claims = 0, updates = 0;
  const future = new Date(Date.now() + 10 * 86400000).toISOString();
  const raw = { id: 'map-festival', name: 'Map Festival', dates: { start: { dateTime: future, localDate: future.slice(0, 10) }, timezone: 'America/Vancouver', status: { code: 'onsale' } }, _embedded: { venues: [{ name: 'Park', city: { name: 'Vancouver' }, country: { countryCode: 'CA' }, location: { latitude: '49.28', longitude: '-123.12' } }] } };
  const legacy = ticketmaster.normalizeEvent(raw); delete legacy.location;
  let cache = { payload: { events: [legacy], page: 0, hasMore: false }, updated_at: '2026-10-01T00:00:00Z', expires_at: new Date(Date.now() + 3600000).toISOString() };
  const db = {
    from(table) {
      assert.equal(table, 'ticketmaster_event_cache');
      const query = { change: null, equals: {}, select() { return this; }, eq(key, value) { this.equals[key] = value; return this; }, gt() { return this; },
        maybeSingle: async () => ({ data: cache, error: null }),
        update(value) { this.change = value; return this; },
        upsert: async value => { cache = { ...cache, ...value }; return { error: null }; },
        then(resolve) { if (this.change && this.equals.updated_at === cache.updated_at) { updates++; cache = { ...cache, ...this.change }; } return Promise.resolve({ error: null }).then(resolve); },
      };
      return query;
    },
    async rpc(name) {
      if (name === 'get_ticketmaster_festival_slots') return { data: [], error: null };
      if (name === 'claim_ticketmaster_festival_refresh') { claims++; return { data: Date.parse(cache.expires_at) <= Date.now(), error: null }; }
      if (name === 'reserve_ticketmaster_request') return { data: true, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };
  const source = ts.transpileModule(readFileSync(new URL('../supabase/functions/ticketmaster-events/index.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, {
    exports: {}, require: name => name.startsWith('npm:') ? { createClient: () => db } : ticketmaster,
    Deno: { serve: callback => { handler = callback; }, env: { get: () => 'test-only' } },
    fetch: async () => { upstream++; return new Response(JSON.stringify({ page: { totalPages: 1 }, _embedded: { events: [raw] } }), { status: 200 }); },
    Request, Response, URL, Date, AbortSignal, setTimeout, console: { error() {} },
  });
  const request = () => new Request('https://example.invalid/events', { method: 'POST', body: JSON.stringify({ cityId: 'vancouver', category: 'all', page: 0, festival: true }) });
  const first = await handler(request());
  assert.equal(first.status, 200);
  assert.deepEqual((await first.json()).events[0].location, { latitude: 49.28, longitude: -123.12 });
  assert.equal(updates, 1);
  assert.equal(claims, 1);
  const second = await handler(request());
  assert.equal(second.status, 200);
  assert.equal(upstream, 1);
  assert.equal(claims, 1);
});
