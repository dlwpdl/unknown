// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const id = new URL(request.url).searchParams.get('id') ?? '';
  if (!UUID.test(id)) return page('글을 찾을 수 없어요', '올바르지 않은 공유 주소예요.', '', 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
  const result = await supabase.rpc('get_public_post', { p_post_id: id });
  const post = result.data?.[0];
  if (result.error || !post) return page('글을 찾을 수 없어요', '삭제되었거나 공개되지 않은 글이에요.', '', 404);

  let imageUrl = '';
  const imagePath = post.image_paths?.[0];
  if (imagePath) {
    const signed = await supabase.storage.from('post-images').createSignedUrl(imagePath, 3600);
    imageUrl = signed.data?.signedUrl ?? '';
  }

  return page(post.title, post.body, post.author_nickname, 200, id, imageUrl);
});

function page(title: string, body: string, author: string, status: number, id = '', imageUrl = '') {
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(body);
  const safeAuthor = escapeHtml(author);
  const deepLink = id ? `gling://post/${encodeURIComponent(id)}` : 'gling://';
  const imageMeta = imageUrl ? `<meta property="og:image" content="${escapeHtml(imageUrl)}">` : '';
  const image = imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="게시글 사진">` : '';
  return new Response(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle} · gling</title><meta name="description" content="${escapeHtml(body.slice(0, 160))}">
<meta property="og:type" content="article"><meta property="og:site_name" content="gling"><meta property="og:title" content="${safeTitle}"><meta property="og:description" content="${escapeHtml(body.slice(0, 160))}">${imageMeta}
<style>body{margin:0;background:#f7f5ef;color:#17233f;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif}main{max-width:680px;margin:0 auto;padding:32px 20px 72px}.logo{font-weight:800;color:#ef5b45;font-size:24px}article{margin-top:28px;background:#fff;border:1px solid #e3dfd5;border-radius:18px;padding:24px}h1{font-size:26px;line-height:1.3;margin:10px 0 14px}p{font-size:16px;line-height:1.7;white-space:pre-wrap}.author{color:#687085;font-size:14px}img{width:100%;max-height:520px;object-fit:cover;border-radius:12px;margin:14px 0}a{display:block;margin-top:24px;text-align:center;background:#ef5b45;color:#fff;text-decoration:none;padding:15px;border-radius:999px;font-weight:700}</style>
</head><body><main><div class="logo">gling</div><article><div class="author">${safeAuthor}</div><h1>${safeTitle}</h1>${image}<p>${safeBody}</p><a href="${deepLink}">카카오 로그인하고 참여하기</a></article></main></body></html>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
  });
}

function escapeHtml(value: string) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}
