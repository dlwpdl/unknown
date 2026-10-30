import { decodeSharedUuid } from '../src/lib/shared-uuid.ts';
import { previewImageCover } from '../supabase/functions/_shared/preview-image.ts';

export type SharePreviewEnv = {
  APP_URL: string;
  SHARE_ORIGIN?: string;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const kinds = { post: '글링 이야기', festival: '페스티벌', meetup: '모임 초대' } as const;
type Kind = keyof typeof kinds;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const text = (value: unknown, max = 100) => typeof value === 'string' ? value.trim().slice(0, max) : '';

function origin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || url.port || !url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')
    || /\.(localhost|local|internal)$/.test(url.hostname)) throw new Error('Invalid origin');
  return url.origin;
}

function publicHeaders(key: string): Record<string, string> {
  if (/^sb_publishable_[a-zA-Z0-9_-]+$/.test(key)) return { apikey: key, 'Content-Type': 'application/json' };
  const parts = key.split('.');
  if (parts.length === 3 && JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon') {
    return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  }
  throw new Error('Publishable key required');
}

function scheduleLabel(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const schedule = value as Record<string, unknown>;
  if (schedule.eventKind === 'group') return text(schedule.cadence);
  const start = new Date(text(schedule.startsAt));
  if (!Number.isFinite(start.getTime())) return '';
  try {
    const format = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: text(schedule.timezone) || 'UTC' });
    const end = new Date(text(schedule.endsAt));
    return format.format(start) + (Number.isFinite(end.getTime()) ? ` – ${format.format(end)}` : '');
  } catch { return ''; }
}

function headers(app = '', supabase = ''): Record<string, string> {
  return {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000',
    'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': `default-src 'none'; script-src ${app || "'none'"}; style-src 'unsafe-inline'; img-src ${app || "'none'"} ${supabase}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  };
}

function unavailable(status: number, head = false): Response {
  const message = status === 503 ? '잠시 후 다시 시도해 주세요.' : status === 405 ? '지원하지 않는 요청이에요.' : '공유 링크를 찾을 수 없어요.';
  return new Response(head ? null : message, { status, headers: { ...headers(), 'Content-Type': 'text/plain; charset=utf-8', ...(status === 405 ? { Allow: 'GET, HEAD' } : {}) } });
}

// get_shared_link_preview returns the city display name; photo-less stories use that city's 1200×630 cover.
const cityCovers: Record<string, string> = { 밴쿠버: 'vancouver', 토론토: 'toronto', 몬트리올: 'montreal' };

function coverUrl(path: unknown, id: string, kind: Kind, city: string, app: string): string | null {
  if (previewImageCover(path, id)) return null;
  return `${app}/share-covers/${kind === 'post' && Object.hasOwn(cityCovers, city) ? cityCovers[city] : kind}.png`;
}

export async function handleSharePreview(request: Request, env: SharePreviewEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  const head = request.method === 'HEAD';
  if (request.method !== 'GET' && !head) return unavailable(405);
  const route = new URL(request.url).pathname.match(/^\/(share|s)\/([^/]+)\/?$/);
  const id = route?.[1] === 's' ? decodeSharedUuid(route[2]) : route && UUID.test(route[2]) ? route[2].toLowerCase() : null;
  if (!route || !id) return unavailable(404, head);
  let stage = 'APP_ORIGIN';
  let signal: AbortSignal | undefined;
  try {
    const app = origin(env.APP_URL);
    stage = 'SHARE_ORIGIN';
    const share = origin(env.SHARE_ORIGIN ?? env.APP_URL);
    stage = 'SUPABASE_ORIGIN';
    const supabase = origin(env.SUPABASE_URL);
    stage = 'PUBLISHABLE_KEY';
    const auth = publicHeaders(env.SUPABASE_PUBLISHABLE_KEY);
    stage = 'PREVIEW_TIMEOUT';
    signal = AbortSignal.timeout(5000);
    stage = 'PREVIEW_FETCH';
    const result = await fetcher(`${supabase}/rest/v1/rpc/get_shared_link_preview`, { method: 'POST', headers: auth, body: JSON.stringify({ p_post_id: id }), redirect: 'error', signal });
    if (!result.ok) { console.warn(JSON.stringify({ event: 'share_preview_unavailable', stage: 'UPSTREAM_STATUS', status: result.status })); return unavailable(503, head); }
    stage = 'PREVIEW_JSON';
    const preview = await result.json() as Record<string, unknown> | null;
    if (preview === null) return unavailable(404, head);
    if (!preview || typeof preview !== 'object' || Array.isArray(preview) || preview.id !== id
      || typeof preview.title !== 'string' || !preview.title.trim() || typeof preview.closed !== 'boolean'
      || typeof preview.kind !== 'string' || !Object.hasOwn(kinds, preview.kind)) {
      console.warn(JSON.stringify({ event: 'share_preview_unavailable', stage: 'PREVIEW_SCHEMA' })); return unavailable(503, head);
    }
    stage = 'PREVIEW_HTML';
    const kind = preview.kind as Kind;
    const title = text(preview.title, 300);
    const city = text(preview.city);
    const label = text(preview.label);
    const schedule = scheduleLabel(preview.schedule);
    const closed = kind === 'meetup' && preview.closed;
    const teaser = kind !== 'meetup' && typeof preview.teaser === 'string'
      ? Array.from(preview.teaser.replace(/\s+/gu, ' ').trim()).slice(0, 120).join('') : '';
    const cardTitle = kind === 'meetup' ? `${closed ? '모집 마감' : '글링 모임 초대'} · ${title}` : title;
    const description = kind === 'meetup'
      ? [closed ? '모집이 마감된 모임이에요.' : '함께할 모임에 초대됐어요!', city, schedule].filter(Boolean).join(' · ')
      : teaser || [kinds[kind], city, schedule, '로그인한 뒤 자세한 내용을 볼 수 있어요.'].filter(Boolean).join(' · ');
    const canonical = `${share}/${route[1]}/${route[1] === 's' ? route[2] : id}`;
    const destination = `${app}/post?id=${id}&shared=1${kind === 'meetup' ? '&invite=1' : ''}`;
    const cover = coverUrl(preview.imagePath, id, kind, city, app);
    const image = cover ?? `${supabase}/functions/v1/public-post?format=preview-image&id=${id}`;
    const safeTitle = escapeHtml(title);
    const safeCardTitle = escapeHtml(cardTitle);
    const safeDescription = escapeHtml(description);
    const safeImage = escapeHtml(image);
    const cta = closed ? '로그인하고 모임 보기' : kind === 'meetup' ? '로그인하고 초대 확인' : kind === 'festival' ? '로그인하고 같이 가기' : '로그인하고 글 읽기';
    const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeCardTitle} · 글링</title><meta name="description" content="${safeDescription}"><link rel="canonical" href="${canonical}">
<meta property="og:type" content="website"><meta property="og:site_name" content="글링"><meta property="og:locale" content="ko_KR">
<meta property="og:url" content="${canonical}"><meta property="og:title" content="${safeCardTitle}"><meta property="og:description" content="${safeDescription}">
<meta property="og:image" content="${safeImage}">${cover ? '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' : ''}<meta property="og:image:alt" content="${escapeHtml(kinds[kind])} 미리보기">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${safeCardTitle}"><meta name="twitter:description" content="${safeDescription}"><meta name="twitter:image" content="${safeImage}">
<style>
:root{color-scheme:dark;font:100%/1.5 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",system-ui,sans-serif;background:#0B0B12;color:#F6F3F0}*{box-sizing:border-box}body{margin:0}main{width:min(100%,36rem);margin:auto;padding:2rem 1.25rem 3rem}.brand{color:#CBB9FF;font-size:1.5rem;font-weight:800;letter-spacing:-.04em}.intro{margin:1.75rem 0 .75rem;color:#B7B4C3;font-size:.875rem}article{overflow:hidden;border:1px solid #343443;border-radius:1.5rem;background:#171722}.hero{position:relative;aspect-ratio:16/10;overflow:hidden;background:#222231}.hero img{width:100%;height:100%;object-fit:cover}.hero:after{content:"";position:absolute;inset:50% 0 0;background:linear-gradient(transparent,#171722)}.details{position:relative;padding:1.5rem}.kind{display:inline-block;color:#CBB9FF;font-size:.8125rem;font-weight:700}h1{font-size:clamp(1.75rem,5vw,2.25rem);line-height:1.25;letter-spacing:-.025em;margin:.625rem 0 1rem;overflow-wrap:anywhere}.meta{margin:.35rem 0;color:#B7B4C3;font-size:.9375rem;overflow-wrap:anywhere}.closed{color:#CBB9FF;font-weight:700}.login{margin:1.5rem 0 .875rem;color:#B7B4C3;font-size:.875rem}.cta{display:flex;align-items:center;justify-content:center;min-height:3.25rem;padding:.875rem 1rem;background:#CBB9FF;color:#171123;border-radius:1rem;font-weight:750;text-decoration:none;text-align:center;transition:opacity .15s,transform .15s}.cta:hover{opacity:.9}.cta:active{transform:scale(.98);opacity:.75}.cta:focus-visible{outline:3px solid #F6F3F0;outline-offset:4px}.privacy{text-align:center;color:#B7B4C3;font-size:.75rem;margin:1rem 0 0}@media(prefers-reduced-motion:reduce){.cta{transition:none}.cta:active{transform:none}}
</style></head><body><main><div class="brand" aria-label="글링">gling</div>
<p class="intro">${kind === 'meetup' ? closed ? '모집이 마감된 모임이에요.' : '함께할 모임이 도착했어요' : kind === 'festival' ? '같이 즐길 페스티벌을 만나보세요' : '글링에서 나누고 싶은 이야기'}</p>
<article><div class="hero"><img src="${safeImage}" alt="${escapeHtml(kinds[kind])} 표지"></div><div class="details"><span class="kind">${escapeHtml(label || kinds[kind])}</span><h1>${safeTitle}</h1>
${teaser ? `<p class="meta teaser">${escapeHtml(teaser)}</p>` : ''}
${city ? `<p class="meta">${escapeHtml(city)}</p>` : ''}${schedule ? `<p class="meta">${escapeHtml(schedule)}</p>` : ''}${closed ? '<p class="meta closed">모집 마감</p>' : ''}
<p class="login">Google 또는 소셜 계정으로 로그인하면 자세한 내용을 확인할 수 있어요.</p><a id="share-primary-cta" class="cta" href="${escapeHtml(destination)}">${cta}</a></div></article>
<p class="privacy">이야기 전문과 대화는 로그인한 글링 멤버에게만 보여요.</p></main><script src="${app}/share-redirect.js" defer></script></body></html>`;
    return new Response(head ? null : html, { headers: headers(app, supabase) });
  } catch (error) {
    const name = error && typeof error === 'object' && 'name' in error ? error.name : undefined;
    const error_kind = signal?.aborted || name === 'TimeoutError' || name === 'AbortError' ? 'TIMEOUT' : name === 'TypeError' ? 'NETWORK' : 'OTHER';
    console.warn(JSON.stringify({ event: 'share_preview_unavailable', stage, ...(stage === 'PREVIEW_FETCH' ? { error_kind } : {}) }));
    return unavailable(503, head);
  }
}

export default {
  fetch(request: Request, env: SharePreviewEnv): Promise<Response> {
    return handleSharePreview(request, env);
  },
};
