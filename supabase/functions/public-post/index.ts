// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';
import { postSeo, jsonLd, PUBLIC_SITE, PUBLIC_SOURCE } from '../../../src/lib/public-seo.ts';
import { serveBusinessMedia } from '../_shared/business-media.ts';
import { previewImageCover, servePreviewImage } from '../_shared/preview-image.ts';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  const params = new URL(request.url).searchParams;
  const format = params.get('format');
  if (format === 'business-image') return serveBusinessMedia(request, createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } },
  ));
  if (format === 'preview-image') return servePreviewImage(request, createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  ), createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  ));
  if (request.method !== 'GET') return unavailable(405);
  if (format && !['markdown', 'sitemap'].includes(format)) return unavailable(400);
  const id = (params.get('id') ?? '').toLowerCase();
  const catalog = format === 'sitemap' || (format === 'markdown' && !params.has('id'));
  if (!catalog && !UUID.test(id)) return unavailable(400);
  const city = params.get('city') ?? 'vancouver';
  const before = params.get('before_sort'), beforeId = params.get('before_id');
  if (catalog && (!/^[a-z]+(?:-[a-z]+)*$/.test(city) || city.length > 40
      || params.has('before_sort') !== params.has('before_id')
      || (params.has('before_sort') && (!before || !beforeId || !Number.isFinite(Date.parse(before)) || !UUID.test(beforeId))))) return unavailable(400);
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { auth: { persistSession: false } },
  );
  try {
    if (catalog) {
      let sort = before, cursor = beforeId;
      const ids = new Set<string>(), entries: string[] = [];
      while (true) {
        const result = await supabase.rpc('get_public_feed_page_v2', { p_city_id: city, p_tag_id: null, p_query: null, p_before_sort: sort, p_before_id: cursor, p_limit: 30 });
        if (result.error) return unavailable(503);
        const rows = result.data ?? [];
        for (const row of rows) {
          if (ids.has(row.id) || !UUID.test(row.id) || ids.size === 50000) return unavailable(503);
          ids.add(row.id);
          entries.push(format === 'sitemap' ? `<url><loc>${PUBLIC_SITE}/posts/${row.id}</loc></url>`
            : `- [${String(row.title).replace(/[\\[\]\n\r]/g, ' ')}](${PUBLIC_SITE}/posts/${row.id}) ([마크다운](${PUBLIC_SOURCE}?format=markdown&id=${row.id}))`);
        }
        const last = rows.at(-1);
        if (format === 'markdown') {
          if (rows.length === 30 && last) entries.push(`\n[다음 페이지](${PUBLIC_SOURCE}?${new URLSearchParams({ format: 'markdown', city, before_sort: last.sort_at ?? last.created_at, before_id: last.id })})`);
          return new Response(`# 글링 · ${city} 공개 글\n\n${entries.join('\n')}\n`, { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, follow', 'X-Content-Type-Options': 'nosniff' } });
        }
        if (rows.length < 30) break;
        sort = last.sort_at ?? last.created_at; cursor = last.id;
      }
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join('')}</urlset>`, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=60', 'X-Content-Type-Options': 'nosniff' } });
    }
    const result = await supabase.rpc('get_shared_link_preview', { p_post_id: id });
    const preview = result.data;
    if (result.error) return unavailable(503);
    if (!preview || preview.id !== id) return unavailable(404);
    const metadata = postSeo({ id, title: preview.title, body: '', author: { nickname: '' }, tag: { label: preview.label ?? '글링' } }, preview.city ?? '');
    // The opening paragraph guests may read (preview from 20261030120000, else the one-line teaser); the rest stays behind login.
    const opening = String(preview.preview || preview.teaser || '').trim();
    if (format === 'markdown') return new Response(`# ${preview.title.replace(/[\r\n]/g, ' ')}\n\n원문: ${metadata.canonical}\n도시: ${preview.city ?? ''}\n주제: ${preview.label ?? ''}\n${preview.createdAt ? `작성일: ${String(preview.createdAt).slice(0, 10)}\n` : ''}\n${opening ? `${opening}\n\n` : ''}전체 내용은 글링에서 로그인 후 확인해주세요.\n`, { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store', 'Link': `<${metadata.canonical}>; rel="canonical"`, 'X-Robots-Tag': 'noindex, follow', 'X-Content-Type-Options': 'nosniff' } });
    const imageUrl = previewImageCover(preview.imagePath, id) ? `${PUBLIC_SOURCE}?format=preview-image&id=${id}` : '';
    return page(preview.title, 200, id, imageUrl, metadata);

  } catch { return unavailable(503); }
});

function unavailable(status: number) {
  return new Response(status === 503 ? '잠시 후 다시 시도해 주세요.' : '공개 글을 찾을 수 없어요.', { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff', ...(status === 405 ? { Allow: 'GET' } : {}) } });
}

function page(title: string, status: number, id: string, imageUrl: string, metadata: ReturnType<typeof postSeo>) {
  const safeTitle = escapeHtml(title), destination = `${PUBLIC_SITE}/post?id=${id}`;
  return new Response(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle} · 글링</title><meta name="description" content="${escapeHtml(metadata.description)}"><link rel="canonical" href="${destination}">
<meta property="og:type" content="website"><meta property="og:site_name" content="글링"><meta property="og:title" content="${safeTitle}"><meta property="og:description" content="${escapeHtml(metadata.description)}"><meta property="og:url" content="${destination}">
${imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}">` : ''}<script type="application/ld+json">${jsonLd(metadata.schema)}</script>
<style>body{margin:0;background:#0B0B12;color:#F6F3F0;font:16px/1.5 system-ui,sans-serif}main{max-width:600px;margin:40px auto;padding:20px}article{border:1px solid #343443;border-radius:16px;background:#171722;padding:20px}img{width:100%;border-radius:12px}a{display:flex;min-height:44px;align-items:center;justify-content:center;border-radius:12px;background:#CBB9FF;color:#171123;text-decoration:none;padding:12px}p{color:#B7B4C3}</style></head><body><main><article><h1>${safeTitle}</h1>${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="대표 이미지">` : ''}<p>${escapeHtml(metadata.description)}</p><a href="${destination}">로그인하고 전체 내용 보기</a></article></main></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" } });
}
function escapeHtml(value: string) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
}
