// @ts-nocheck -- Deno Edge runtime (the app TypeScript project does not resolve npm: imports).
// eslint-disable-next-line import/no-unresolved -- Deno resolves npm: imports when deploying the function.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { EVENT_CITIES, EVENT_CATEGORIES, EVENT_TIMEZONES, festivalCacheExpiry, isFestivalEvent, localDayUtcRange, parseEventQuery, normalizeEvent, spotlightLocalEvents } from '../_shared/ticketmaster.ts';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    if (Number(request.headers.get('content-length')) > 1024) return reply({ error: 'INVALID_INPUT' }, 400);
    let query;
    try { const text = await request.text(); if (text.length > 1024) throw new Error(); query = parseEventQuery(JSON.parse(text)); }
    catch { return reply({ error: 'INVALID_INPUT' }, 400); }
    const dayRange = query.date ? localDayUtcRange(query.date, EVENT_TIMEZONES[query.cityId]) : null;
    const nextMonth = query.month ? new Date(Date.UTC(Number(query.month.slice(0, 4)), Number(query.month.slice(5)), 1)).toISOString().slice(0, 7) + '-01' : null;
    const monthRange = nextMonth ? [localDayUtcRange(`${query.month}-01`, EVENT_TIMEZONES[query.cityId])[0], localDayUtcRange(nextMonth, EVENT_TIMEZONES[query.cityId])[0]] : null;
    if (dayRange && Date.parse(dayRange[1]) <= Date.now()) return reply({ events: [], page: query.page, hasMore: false, fetchedAt: new Date().toISOString() });
    if (monthRange && Date.parse(monthRange[1]) <= Date.now()) return reply({ month: query.month, days: [], complete: true, fetchedAt: new Date().toISOString() });
    const key = Deno.env.get('TICKETMASTER_API_KEY');
    if (!key) return reply({ error: 'NOT_CONFIGURED' }, 503);
    const db = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    const expectedCity = EVENT_CITIES[query.cityId].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const inCity = event => event.country === 'CA' && event.city.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === expectedCity;
    const cacheKey = query.eventId ? `tm-event:${query.cityId}:${query.eventId}` : query.month ? `month:${query.cityId}:${query.category}:${query.month}` : query.festival ? `tm-festival:${query.cityId}` : `list:${query.cityId}:${query.category}:${query.date ?? 'upcoming'}:${query.page}`;
    const result = async (payload, fetchedAt) => {
      if (!query.festival) return reply({ ...payload, fetchedAt });
      const assigned = await db.rpc('get_ticketmaster_festival_slots', { p_city_id: query.cityId });
      if (assigned.error) throw new Error('CACHE_ERROR');
      const festivalSlots = (assigned.data ?? []).map(slot => ({ slot: slot.slot, eventId: slot.event_id, endsAt: slot.ends_at }));
      const events = new Map(payload.events.map(event => [event.id, event]));
      for (const slot of assigned.data ?? []) if (slot.event && !events.has(slot.event_id)) events.set(slot.event_id, slot.event);
      const selected = spotlightLocalEvents([...events.values()].filter(inCity), Date.now(), festivalSlots);
      const nextRefreshAt = new Date(Math.min(Date.parse(festivalCacheExpiry(query.cityId)),
        ...selected.map(event => Date.parse(event.startsAt)), ...festivalSlots.map(slot => Date.parse(slot.endsAt)).filter(at => at > Date.now()))).toISOString();
      return reply({ events: selected, festivalSlots, nextRefreshAt, page: 0, hasMore: false, fetchedAt });
    };
    const cached = await db.from('ticketmaster_event_cache').select('payload,updated_at').eq('cache_key', cacheKey).gt('expires_at', new Date().toISOString()).maybeSingle();
    if (cached.error) throw new Error('CACHE_ERROR');
    const mapped = payload => query.month || (payload.event ? Object.hasOwn(payload.event, 'location')
      : Array.isArray(payload.events) && payload.events.every(event => Object.hasOwn(event, 'location')));
    if (cached.data && mapped(cached.data.payload) && (!query.festival || Array.isArray(cached.data.payload.events))) {
      if (query.eventId && (!inCity(cached.data.payload.event) || cached.data.payload.event.status === 'unavailable')) return reply({ error: 'NOT_FOUND' }, 404);
      return await result(cached.data.payload, cached.data.updated_at);
    }
    if (query.festival) {
      if (cached.data && !mapped(cached.data.payload)) {
        const expired = await db.from('ticketmaster_event_cache').update({ expires_at: new Date().toISOString() })
          .eq('cache_key', cacheKey).eq('updated_at', cached.data.updated_at);
        if (expired.error) throw new Error('CACHE_ERROR');
      }
      const claim = await db.rpc('claim_ticketmaster_festival_refresh', { p_city_id: query.cityId });
      if (claim.error) throw new Error('CACHE_ERROR');
      if (!claim.data) {
        const ready = await db.from('ticketmaster_event_cache').select('payload,updated_at').eq('cache_key', cacheKey).gt('expires_at', new Date().toISOString()).maybeSingle();
        if (ready.error) throw new Error('CACHE_ERROR');
        if (ready.data && mapped(ready.data.payload) && Array.isArray(ready.data.payload.events)) return await result(ready.data.payload, ready.data.updated_at);
        return reply({ error: 'RATE_LIMITED' }, 429);
      }
    }
    const assigned = query.festival ? await db.rpc('get_ticketmaster_festival_slots', { p_city_id: query.cityId }) : { data: [] };
    if (assigned.error) throw new Error('CACHE_ERROR');
    let lastRequestAt = 0;
    const upstream = async url => {
      const delay = Math.max(0, 550 - (Date.now() - lastRequestAt));
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      const budget = await db.rpc('reserve_ticketmaster_request');
      if (budget.error) throw new Error('QUOTA_ERROR');
      if (!budget.data) throw new Error('RATE_LIMITED');
      lastRequestAt = Date.now();
      const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
      if (response.status === 404) throw new Error('NOT_FOUND');
      if (response.status === 429) throw new Error('RATE_LIMITED');
      if (!response.ok) throw new Error('UPSTREAM_UNAVAILABLE');
      return response.json();
    };
    const url = new URL(`https://app.ticketmaster.com/discovery/v2/events${query.eventId ? `/${encodeURIComponent(query.eventId)}` : ''}.json`);
    url.searchParams.set('apikey', key);
    if (!query.eventId) {
      url.searchParams.set('countryCode', 'CA'); url.searchParams.set('city', EVENT_CITIES[query.cityId]);
      url.searchParams.set('size', query.month ? '200' : query.festival ? '100' : '20'); url.searchParams.set('page', String(query.page)); url.searchParams.set('sort', 'date,asc');
      if (query.month) {
        url.searchParams.set('startDateTime', new Date(Math.max(Date.parse(monthRange[0]), Date.now())).toISOString().replace(/\.\d{3}Z$/, 'Z'));
        url.searchParams.set('endDateTime', monthRange[1]);
      } else if (query.date) {
        const [start, end] = dayRange;
        url.searchParams.set('startDateTime', new Date(Math.max(Date.parse(start), Date.now())).toISOString().replace(/\.\d{3}Z$/, 'Z'));
        url.searchParams.set('endDateTime', end);
      } else url.searchParams.set('startDateTime', new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'));
      if (EVENT_CATEGORIES[query.category]) url.searchParams.set('segmentId', EVENT_CATEGORIES[query.category]);
      if (query.festival) url.searchParams.set('keyword', 'festival');
    }
    const raw = await upstream(url);
    let payload;
    if (query.eventId) {
      const event = normalizeEvent(raw);
      if (!inCity(event)) return reply({ error: 'NOT_FOUND' }, 404);
      payload = { event };
    } else {
      if (!raw.page || !Number.isInteger(raw.page.totalPages) || (raw._embedded?.events && !Array.isArray(raw._embedded.events))) throw new Error('INVALID_UPSTREAM');
      const events = (raw._embedded?.events ?? []).map(normalizeEvent).filter(event => inCity(event) && (!query.date || event.localDate === query.date) && (!query.festival || isFestivalEvent(event)));
      if (query.festival) for (const slot of assigned.data ?? []) {
        if (events.some(event => event.id === slot.event_id)) continue;
        const target = new URL(`https://app.ticketmaster.com/discovery/v2/events/${encodeURIComponent(slot.event_id)}.json`);
        target.searchParams.set('apikey', key);
        let event;
        try { event = normalizeEvent(await upstream(target)); }
        catch (error) {
          if (error.message !== 'NOT_FOUND') throw error;
          event = normalizeEvent({ id: slot.event_id, name: slot.event?.name ?? slot.event_id, dates: { status: { code: 'unavailable' } }, _embedded: { venues: [{ city: { name: EVENT_CITIES[query.cityId] }, country: { countryCode: 'CA' } }] } });
        }
        events.push(event);
      }
      payload = query.month
        ? { month: query.month, days: [...new Set(events.map(event => event.localDate).filter(day => day?.startsWith(query.month)))], complete: Number.isInteger(raw.page.totalElements) && raw.page.totalElements <= 200 }
        : { events, page: query.page, hasMore: query.page < Math.min(raw.page.totalPages, 20) - 1 };
    }
    const fetchedAt = new Date().toISOString();
    const saved = await db.from('ticketmaster_event_cache').upsert({ cache_key: cacheKey, payload, updated_at: fetchedAt,
      expires_at: query.festival ? festivalCacheExpiry(query.cityId) : new Date(Date.now() + 15 * 60_000).toISOString(), refresh_started_at: null });
    if (saved.error) throw new Error('CACHE_ERROR');
    return await result(payload, fetchedAt);
  } catch (error) {
    // Never log request URLs, upstream bodies, or secrets.
    console.error('ticketmaster-events failed', error?.name === 'TimeoutError' ? 'timeout' : 'internal');
    const code = error?.name === 'TimeoutError' ? 'UPSTREAM_TIMEOUT' : ['RATE_LIMITED', 'NOT_FOUND'].includes(error?.message) ? error.message : 'UPSTREAM_UNAVAILABLE';
    return reply({ error: code }, code === 'RATE_LIMITED' ? 429 : code === 'NOT_FOUND' ? 404 : 502);
  }
});
