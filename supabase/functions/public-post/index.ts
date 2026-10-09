// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';
import { postLinksHtml } from '../_shared/post-links.ts';
import { postSeo, jsonLd, PUBLIC_SITE, PUBLIC_SOURCE } from '../../../src/lib/public-seo.ts';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method !== 'GET') return unavailable(405);
  const params = new URL(request.url).searchParams;
  const format = params.get('format');
  if (format && !['markdown', 'sitemap'].includes(format)) return unavailable(400);
  const id = params.get('id') ?? '';
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
          entries.push(format === 'sitemap' ? `<url><loc>${PUBLIC_SITE}/post?id=${row.id}</loc></url>`
            : `- [${String(row.title).replace(/[\\[\]\n\r]/g, ' ')}](${PUBLIC_SOURCE}?format=markdown&id=${row.id})`);
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
    const result = await supabase.rpc('get_public_post', { p_post_id: id });
    const post = result.data?.[0];
    if (result.error) return unavailable(503);
    if (!post) return unavailable(404);
    const metadata = postSeo({ id, title: post.title, body: post.body, author: { nickname: post.author_nickname }, tag: { label: post.tag_label ?? '공개 글' }, createdAt: post.created_at, room: post.room_preview });
    if (format === 'markdown') return new Response(`# ${post.title.replace(/[\r\n]/g, ' ')}\n\n원문: ${metadata.canonical}\n작성자: ${post.author_nickname.replace(/[\r\n]/g, ' ')}\n${metadata.published ? `발행일: ${metadata.published}\n` : ''}도시: ${post.city_id ?? ''}\n주제: ${post.tag_label ?? ''}\n\n${metadata.body}\n${metadata.mapUrl ? `\n지도: ${metadata.mapUrl}\n` : ''}`, { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store', 'Link': `<${metadata.canonical}>; rel="canonical"`, 'X-Robots-Tag': 'noindex, follow', 'X-Content-Type-Options': 'nosniff' } });

    let imageUrl = '';
    const imagePath = post.image_paths?.[0];
    if (imagePath) {
      const signed = await supabase.storage.from('post-images').createSignedUrl(imagePath, 3600);
      imageUrl = signed.data?.signedUrl ?? '';
    }

    return page(post.title, post.body, post.author_nickname, 200, id, imageUrl, metadata);
  } catch { return unavailable(503); }
});

function unavailable(status: number) {
  return new Response(status === 503 ? '잠시 후 다시 시도해 주세요.' : '공개 글을 찾을 수 없어요.', { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff', ...(status === 405 ? { Allow: 'GET' } : {}) } });
}

function page(title: string, body: string, author: string, status: number, id = '', imageUrl = '', metadata?: ReturnType<typeof postSeo>) {
  const safeTitle = escapeHtml(title);
  const safeBody = postLinksHtml(body);
  const safeAuthor = escapeHtml(author);
  const deepLink = id ? `gling://post/${encodeURIComponent(id)}` : 'gling://';
  const imageMeta = imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}">` : '';
  const image = imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="게시글 사진">` : '';
  return new Response(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle} · gling</title><meta name="description" content="${escapeHtml(body.slice(0, 160))}">
${metadata ? `<link rel="canonical" href="${metadata.canonical}"><link rel="alternate" type="text/markdown" href="${metadata.source}"><meta property="og:url" content="${metadata.canonical}"><script type="application/ld+json">${jsonLd(metadata.schema)}</script>` : ''}
<meta property="og:type" content="article"><meta property="og:site_name" content="gling"><meta property="og:title" content="${safeTitle}"><meta property="og:description" content="${escapeHtml(body.slice(0, 160))}">${imageMeta}
<style>body{margin:0;background:#f7f5ef;color:#17233f;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif}main{max-width:680px;margin:0 auto;padding:32px 20px 72px}.logo{font-weight:800;color:#ef5b45;font-size:24px}article{margin-top:28px;background:#fff;border:1px solid #e3dfd5;border-radius:18px;padding:24px}h1{font-size:26px;line-height:1.3;margin:10px 0 14px}p{font-size:16px;line-height:1.7;white-space:pre-wrap}.author{color:#687085;font-size:14px}img{width:100%;max-height:520px;object-fit:cover;border-radius:12px;margin:14px 0}a{display:block;margin-top:24px;text-align:center;background:#ef5b45;color:#fff;text-decoration:none;padding:15px;border-radius:999px;font-weight:700}
/* Inline destinations remain visible and use the same night accent as the app. */
p{overflow-wrap:anywhere}p a.post-body-link{display:inline;margin:0;padding:0;border-radius:0;background:none;color:#CBB9FF;text-decoration:underline;font-weight:inherit}body{background:#0B0B12;color:#F6F3F0}article{background:#171722;border-color:#343443}.logo{color:#CBB9FF}.author{color:#B7B4C3}a{background:#CBB9FF;color:#171123}img{object-fit:contain;max-height:none;height:auto}
</style></head><body><main><div class="logo">gling</div><article><div class="author">${safeAuthor}</div><h1>${safeTitle}</h1>${image}<p>${safeBody}</p><a href="${deepLink}">앱에서 대화·참여하기</a><a href="https://gling.ej-entertainment.com/post?id=${encodeURIComponent(id)}">웹에서 이야기와 모임 둘러보기</a></article></main></body></html>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      ...(metadata ? { Link: `<${metadata.canonical}>; rel="canonical"` } : {}),
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src https:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" },
  });
}

function escapeHtml(value: string) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}
