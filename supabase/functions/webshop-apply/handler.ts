// 웹샵 제휴 신청 from /business (owner 2026-11-12). POST only, so nothing typed lands in a URL or a request log.
import { APPLICATION_KEYS, applicationProblems, type WebshopApplication } from '../_shared/webshop-application.ts';
// The same origin check, salted SHA-256 and IPv4 or IPv6 /64 cap key as the event pages.
import { ipCapKey, PUBLIC_ORIGIN, sha256 } from '../event-link/handler.ts';

export { PUBLIC_ORIGIN };
// A hidden field people never see; a filled one gets the same answer as a real application and is dropped.
export const HONEYPOT = 'website';
const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
};
const WEBSHOP = { yes: '있어요', no: '없어요', unknown: '모르겠어요' } as const;
const DISCOUNT = { '5': '5% 싸게', '10': '10% 싸게', '15_plus': '15% 이상 싸게', unknown: '잘 모르겠어요' } as const;
const CITY = { vancouver: '밴쿠버', toronto: '토론토', montreal: '몬트리올' } as Record<string, string>;

type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;
type Options = { rpc: Rpc; sendMail: (subject: string, text: string) => Promise<void>; ipSalt: string; origins?: string[] };

// Contact details stay in the admin list; the mail only says which business applied.
export function applicationMail(value: WebshopApplication) {
  const city = value.cityId ? CITY[value.cityId] ?? value.cityId : null;
  return {
    subject: `[글링] 웹샵 제휴 신청 · ${value.placeName}`,
    text: [
      '웹샵 제휴 신청이 새로 들어왔어요.', '',
      `가게: ${value.placeName}${city ? ` (${city})` : ' (직접 적음)'}`,
      `웹샵: ${WEBSHOP[value.webshop]}${value.webshopUrl ? ' · 링크 있음' : ''}`,
      `앱보다: ${DISCOUNT[value.discount]}`,
      `들어온 곳: ${value.source === 'place' ? '앱 장소 화면' : '웹 /business'}`, '',
      '이름과 연락처는 글링 관리자 → 웹샵 성과 → 신청에서 볼 수 있어요.',
    ].join('\n'),
  };
}

export async function handleWebshopApply(request: Request, { rpc, sendMail, ipSalt, origins = [PUBLIC_ORIGIN] }: Options): Promise<Response> {
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
    if (text.length > 6000) throw new Error('TOO_LARGE');
    body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('NOT_OBJECT');
  } catch { return reply(400, { error: 'invalid' }); }
  const keys = Object.keys(body);
  if (!keys.every(key => key === HONEYPOT || (APPLICATION_KEYS as readonly string[]).includes(key))) return reply(400, { error: 'invalid' });
  if (body[HONEYPOT] !== undefined && body[HONEYPOT] !== '') return reply(200, { ok: true });
  const { [HONEYPOT]: _ignored, ...application } = body;
  if (applicationProblems(application).length) return reply(400, { error: 'invalid' });

  try {
    // Only a salted hash of the caller's address reaches the database, for the hourly cap. CF-Connecting-IP is set by Cloudflare in
    // front of Supabase; X-Forwarded-For's first value is whatever the caller wrote (event-link security review 2026-11-03).
    const ip = request.headers.get('cf-connecting-ip')?.trim();
    if (!ip || !ipSalt) console.warn('webshop-apply: no caller address hash, only the site-wide hourly cap applies');
    const result = await rpc('submit_webshop_application', {
      p_application: application, p_ip_sha256: ip && ipSalt ? await sha256(`webshop-apply:${ipSalt}:${ipCapKey(ip)}`) : null,
    }) as { ok?: boolean; id?: string; error?: string } | null;
    if (result?.ok !== true || typeof result.id !== 'string') {
      return result?.error === 'rate_limited' ? reply(429, { error: 'rate_limited' }) : result?.error === 'invalid' ? reply(400, { error: 'invalid' }) : reply(503, { error: 'unavailable' });
    }
    // The application is saved; a missing or failed mail only changes its mail status.
    let mail: 'sent' | 'failed' | 'not_configured' = 'sent';
    try {
      const { subject, text } = applicationMail(application as WebshopApplication);
      await sendMail(subject, text);
    } catch (error) { mail = error instanceof Error && error.message === 'ADMIN_EMAIL_NOT_CONFIGURED' ? 'not_configured' : 'failed'; }
    if (mail !== 'sent') console.warn(`webshop-apply: admin mail ${mail}`);
    await rpc('set_webshop_application_email', { p_id: result.id, p_status: mail }).catch(() => console.warn('webshop-apply: mail status not saved'));
    return reply(200, { ok: true });
  } catch {
    return reply(503, { error: 'unavailable' });
  }
}
