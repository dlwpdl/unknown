// Public event links: the apply page (/apply?event=<slug>), the store page (/partner#<token>) and the campaign report page
// (/report#<token>). POST only, so no token and nothing typed lands in a URL or a request log.
export const PUBLIC_ORIGIN = 'https://gling.ej-entertainment.com';
const SLUG = /^[a-z0-9][a-z0-9-]{2,59}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
};
const APPLY_STATUS: Record<string, number> = { not_found: 404, invalid: 400, rate_limited: 429 };
const APPLY_KEYS = ['apply', 'handle', 'slots', 'party', 'allergies', 'reel_days', 'language'];

type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;
type Options = { rpc: Rpc; ipSalt: string; origins?: string[] };

/** The hourly cap counts an IPv4 address, or an IPv6 address cut to its /64: one home or phone gets a whole /64 and can change
 * the rest of the address at will (security re-review 2026-11-03). */
export function ipCapKey(ip: string) {
  if (!ip.includes(':')) return ip;
  if (ip.includes('.')) return ip.slice(ip.lastIndexOf(':') + 1); // ::ffff:203.0.113.9 is that IPv4 address
  const [head, tail] = ip.split('::');
  const left = head ? head.split(':') : [], right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups.slice(0, 4).map(group => parseInt(group, 16).toString(16)).join(':')}::/64`;
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function handleEventLink(request: Request, { rpc, ipSalt, origins = [PUBLIC_ORIGIN] }: Options): Promise<Response> {
  const origin = request.headers.get('origin');
  const allowed = origin && origins.includes(origin) ? origin : null;
  const headers = {
    ...HEADERS,
    ...(allowed ? { 'Access-Control-Allow-Origin': allowed, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
  if (origin && !allowed) return reply(403, { error: 'origin' });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...headers, Allow: 'POST, OPTIONS' } });

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > 2000) throw new Error('TOO_LARGE');
    body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('NOT_OBJECT');
  } catch { return reply(400, { error: 'invalid' }); }
  const keys = Object.keys(body);
  const only = (...allowedKeys: string[]) => keys.every(key => allowedKeys.includes(key));
  const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;
  const whole = (value: unknown, max: number) => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= max;
  // Shape only; the database checks each pick against the campaign's own dates, times and limits.
  const slot = (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => key === 'date' || key === 'time') && text((value as { date?: unknown }).date, 10) && text((value as { time?: unknown }).time, 5);
  const notFound = () => reply(404, { error: 'not_found' });

  try {
    if (keys.length === 1 && typeof body.apply === 'string') {
      if (!SLUG.test(body.apply)) return notFound();
      const event = await rpc('event_apply_info', { p_slug: body.apply });
      return event ? reply(200, { event }) : notFound();
    }
    if ('apply' in body) {
      const { apply, handle, slots, party, allergies, reel_days, language } = body;
      // allergies: null means "none", so it must be sent either way.
      if (!only(...APPLY_KEYS) || !('allergies' in body) || !text(apply, 60) || !text(handle, 64)
        || !Array.isArray(slots) || slots.length < 1 || slots.length > 2 || !slots.every(slot) || !whole(party, 10) || !whole(reel_days, 7)
        || (allergies !== null && !text(allergies, 200)) || (language !== 'en' && language !== 'ko')) return reply(400, { error: 'invalid' });
      if (!SLUG.test(apply as string)) return notFound();
      if (!ipSalt) return reply(503, { error: 'unavailable' });
      // Only a salted hash of the caller's IP reaches the database, for the hourly cap. Cloudflare, in front of Supabase, sets
      // CF-Connecting-IP to the address that connected to it; the first X-Forwarded-For value is whatever the caller wrote
      // (security review 2026-11-03). Without it the database applies only the per-event cap.
      const ip = request.headers.get('cf-connecting-ip')?.trim();
      if (!ip) console.warn('event-link: no CF-Connecting-IP, only the per-event hourly cap applies');
      const result = await rpc('event_apply', {
        p_slug: apply, p_handle: handle, p_slots: slots, p_party: party, p_allergies: allergies, p_reel_days: reel_days, p_language: language,
        p_ip_sha256: ip ? await sha256(`${ipSalt}:${ipCapKey(ip)}`) : null,
      }) as { ok?: boolean; error?: string } | null;
      if (result?.ok === true) return reply(200, { ok: true });
      const status = APPLY_STATUS[result?.error ?? ''];
      return status ? reply(status, { error: result!.error }) : reply(503, { error: 'unavailable' });
    }
    if (typeof body.store === 'string' && only('store', 'handle', 'undo') && keys.length <= 2) {
      if (!TOKEN.test(body.store)) return notFound();
      const token = await sha256(body.store);
      if (keys.length === 1) {
        const view = await rpc('event_store_view', { p_token_sha256: token });
        return view ? reply(200, { view }) : notFound();
      }
      if ('undo' in body) {
        if (typeof body.undo !== 'string' || !UUID.test(body.undo)) return reply(400, { error: 'invalid' });
        const undone = await rpc('event_store_undo', { p_token_sha256: token, p_use_id: body.undo }) as { ok?: boolean } | null;
        return undone ? reply(200, { undone: undone.ok === true }) : notFound();
      }
      if (!text(body.handle, 64)) return reply(400, { error: 'invalid' });
      // A check that finds the person is recorded as one use; the same person again within 3 hours is the same use.
      const found = await rpc('event_store_check', { p_token_sha256: token, p_handle: body.handle }) as
        { status?: string; use_id?: string; uses?: number; meal_used?: boolean } | null;
      return found?.status ? reply(200, { status: found.status, use_id: found.use_id, uses: found.uses, meal_used: found.meal_used }) : notFound();
    }
    if (keys.length === 1 && typeof body.report === 'string') {
      if (!TOKEN.test(body.report)) return notFound();
      const report = await rpc('event_report_view', { p_token_sha256: await sha256(body.report) });
      return report ? reply(200, { report }) : notFound();
    }
    return reply(400, { error: 'invalid' });
  } catch {
    return reply(503, { error: 'unavailable' });
  }
}
