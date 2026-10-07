// @ts-nocheck -- Deno Edge runtime (the app TypeScript project does not resolve npm: imports).
// eslint-disable-next-line import/no-unresolved -- Deno resolves npm: imports when deploying the function.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { EVENT_CITIES, EVENT_CATEGORIES, EVENT_TIMEZONES, isFestivalEvent, localDayUtcRange, parseEventQuery, normalizeEvent } from '../_shared/ticketmaster.ts';
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
    const cacheKey = query.eventId ? `tm-event:${query.cityId}:${query.eventId}` : query.month ? `month:${query.cityId}:${query.category}:${query.month}` : query.festival ? `tm-festival:${query.cityId}` : `list:${query.cityId}:${query.category}:${query.date ?? 'upcoming'}:${query.page}`;
    const cached = await db.from('ticketmaster_event_cache').select('payload,updated_at').eq('cache_key', cacheKey).gt('expires_at', new Date().toISOString()).maybeSingle();
    if (cached.error) throw new Error('CACHE_ERROR');
    if (cached.data) return reply({ ...cached.data.payload, fetchedAt: cached.data.updated_at });
    const budget = await db.rpc('reserve_ticketmaster_request');
    if (budget.error) throw new Error('QUOTA_ERROR');
    if (!budget.data) return reply({ error: 'RATE_LIMITED' }, 429);
    const url = new URL(`https://app.ticketmaster.com/discovery/v2/events${query.eventId ? `/${encodeURIComponent(query.eventId)}` : ''}.json`);
    url.searchParams.set('apikey', key);
    if (!query.eventId) {
      url.searchParams.set('countryCode', 'CA'); url.searchParams.set('city', EVENT_CITIES[query.cityId]);
      url.searchParams.set('size', query.month ? '200' : '20'); url.searchParams.set('page', String(query.page)); url.searchParams.set('sort', 'date,asc');
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
    const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (response.status === 404 && query.eventId) return reply({ error: 'NOT_FOUND' }, 404);
    if (response.status === 429) return reply({ error: 'RATE_LIMITED' }, 429);
    if (!response.ok) return reply({ error: 'UPSTREAM_UNAVAILABLE' }, 502);
    const raw = await response.json();
    const expectedCity = EVENT_CITIES[query.cityId].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const inCity = event => event.country === 'CA' && event.city.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === expectedCity;
    let payload;
    if (query.eventId) {
      const event = normalizeEvent(raw);
      if (!inCity(event)) return reply({ error: 'NOT_FOUND' }, 404);
      payload = { event };
    } else {
      if (!raw.page || !Number.isInteger(raw.page.totalPages) || (raw._embedded?.events && !Array.isArray(raw._embedded.events))) throw new Error('INVALID_UPSTREAM');
      const events = (raw._embedded?.events ?? []).map(normalizeEvent).filter(event => inCity(event) && (!query.date || event.localDate === query.date) && (!query.festival || isFestivalEvent(event)));
      payload = query.month
        ? { month: query.month, days: [...new Set(events.map(event => event.localDate).filter(day => day?.startsWith(query.month)))], complete: Number.isInteger(raw.page.totalElements) && raw.page.totalElements <= 200 }
        : { events, page: query.page, hasMore: query.page < Math.min(raw.page.totalPages, 20) - 1 };
    }
    const fetchedAt = new Date().toISOString();
    const saved = await db.from('ticketmaster_event_cache').upsert({ cache_key: cacheKey, payload, updated_at: fetchedAt, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() });
    if (saved.error) throw new Error('CACHE_ERROR');
    return reply({ ...payload, fetchedAt });
  } catch (error) {
    // Never log request URLs, upstream bodies, or secrets.
    console.error('ticketmaster-events failed', error?.name === 'TimeoutError' ? 'timeout' : 'internal');
    return reply({ error: error?.name === 'TimeoutError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE' }, 502);
  }
});
