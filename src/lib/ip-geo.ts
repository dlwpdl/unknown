// Admin-only IP location lookup. Public endpoint: HTTPS, CORS, no key.
// ponytail: third-party lookup from the admin browser; move server-side with a stored
// result if we ever need durable history or must stop sending member IPs out.
const ENDPOINT = 'https://ipwho.is';
const cache = new Map<string, IpGeo>();
const pending = new Map<string, Promise<IpGeo | null>>();
const MAX_IN_FLIGHT = 4;
let inFlight = 0;
const waiting: (() => void)[] = [];

async function acquire() {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((resolve) => waiting.push(resolve));
  inFlight += 1;
}

function release() {
  inFlight -= 1;
  waiting.shift()?.();
}

export type IpGeo = { country: string; countryCode: string | null; city: string | null; region: string | null; isp: string | null };

export function parseIpGeo(value: unknown): IpGeo | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.success === false) return null;
  const text = (key: string) => (typeof raw[key] === 'string' && raw[key].trim() ? (raw[key] as string).trim() : null);
  const country = text('country');
  if (!country) return null;
  const connection = (raw.connection && typeof raw.connection === 'object' ? raw.connection : {}) as Record<string, unknown>;
  const isp = typeof connection.isp === 'string' && connection.isp.trim() ? connection.isp.trim()
    : typeof connection.org === 'string' && connection.org.trim() ? connection.org.trim() : null;
  return { country, countryCode: text('country_code'), city: text('city'), region: text('region'), isp };
}

export function formatIpGeo(geo: IpGeo) {
  return [geo.country, [geo.city, geo.region].filter(Boolean).join(', '), geo.isp].filter(Boolean).join(' · ');
}

export function formatIpGeoShort(geo: IpGeo) {
  return [[geo.country, geo.city].filter(Boolean).join(', '), geo.isp].filter(Boolean).join(' · ');
}

export async function lookupIpGeo(ip: string | null | undefined): Promise<IpGeo | null> {
  const value = ip?.trim();
  if (!value) return null;
  const cached = cache.get(value);
  if (cached) return cached;
  const running = pending.get(value);
  if (running) return running;
  const request = (async () => {
    await acquire();
    try {
      const response = await fetch(`${ENDPOINT}/${encodeURIComponent(value)}`, { signal: AbortSignal.timeout(6000) });
      const geo = response.ok ? parseIpGeo(await response.json()) : null;
      if (geo) cache.set(value, geo);
      return geo;
    } catch {
      return null;
    } finally {
      release();
    }
  })();
  pending.set(value, request);
  try {
    return await request;
  } finally {
    pending.delete(value);
  }
}
