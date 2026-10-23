const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const DESTINATION = /^https:\/\/(www\.)?order\.store\/ca\/store\/[a-z0-9-]+(%26[a-z0-9-]+)*\/[A-Za-z0-9_-]{20,80}$/;
const PLATFORMS = new Set(['ios', 'android', 'web']);
const SOURCES = new Set(['business_profile', 'comparison_sheet', 'map', 'place_detail']);
const FIELDS = new Set(['merchantId', 'eventId', 'session', 'platform', 'source']);
const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export function trackedWebshopUrl(destination: unknown, merchantId: string): string | null {
  if (typeof destination !== 'string' || destination.length > 2048 || !DESTINATION.test(destination) || !UUID.test(merchantId)) return null;
  return `${destination}?utm_source=gling&utm_medium=referral&utm_campaign=webshop&utm_content=${merchantId.toLowerCase()}`;
}

type RedirectInput = { merchantId: string; eventId: string; session: string; platform: string; source: string };
type Dependencies = {
  descriptor: (merchantId: string) => Promise<{ url?: unknown } | null>;
  resolve: (input: RedirectInput) => Promise<{ url?: unknown } | null>;
};

export async function handleWebshopRedirect(request: Request, dependencies: Dependencies): Promise<Response> {
  const fail = (status: number) => new Response(request.method === 'HEAD' ? null : 'Webshop unavailable.', {
    status, headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...(status === 405 ? { Allow: 'GET, HEAD' } : {}) },
  });
  if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405);
  const query = new URL(request.url).searchParams;
  if (request.url.length > 1500 || [...query.keys()].some((key) => !FIELDS.has(key) || query.getAll(key).length !== 1)) return fail(400);
  const merchantId = query.get('merchantId') ?? '';
  if (!UUID.test(merchantId)) return fail(400);
  const eventId = query.get('eventId') ?? '', session = query.get('session') ?? '';
  const platform = query.get('platform') ?? '', source = query.get('source') ?? '';
  const complete = UUID.test(eventId) && /^[A-Za-z0-9_-]{20,80}$/.test(session) && PLATFORMS.has(platform) && SOURCES.has(source);
  if ((request.method === 'GET' || query.size > 1) && !complete) return fail(400);
  try {
    if (request.method === 'HEAD') {
      const descriptor = await dependencies.descriptor(merchantId.toLowerCase());
      const destination = trackedWebshopUrl(descriptor?.url, merchantId);
      return destination ? new Response(null, { status: 302, headers: { ...HEADERS, Location: destination } }) : fail(404);
    }
    const resolved = await dependencies.resolve({ merchantId: merchantId.toLowerCase(), eventId: eventId.toLowerCase(), session, platform, source });
    if (!resolved) return fail(404);
    const destination = typeof resolved.url === 'string' ? resolved.url : '';
    if (trackedWebshopUrl(destination.split('?')[0], merchantId) !== destination) return fail(503);
    return new Response(null, { status: 302, headers: { ...HEADERS, Location: destination } });
  } catch {
    return fail(503);
  }
}
