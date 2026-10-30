import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { jsonLd, MIN_TOPIC_HUB_POSTS, publicPostDescription, publicPostSchema, publicPostUrl, publicSiteName, PUBLIC_SITE, TOPIC_HUBS } from '../src/lib/public-seo.ts';
import { previewImage } from '../src/lib/shared-link-preview.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const escapeHtml = value => String(value).replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);

// Same public RPCs the guest web reader calls, with the publishable key only.
async function rpc(url, key, name, args, fetcher) {
  const response = await fetcher(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`${name} failed: ${response.status}`);
  return response.json();
}

export async function loadPublicPosts({ url, key, cities, searchToken, fetcher = fetch }) {
  const rows = new Map(), meetups = new Map();
  // Gling-operated character posts stay out of the sitemap and prerender (owner 2026-10-30); a missing token fails the deploy.
  if (!searchToken) throw new Error('GLING_SEARCH_BUILD_TOKEN is required to prerender public posts');
  const excluded = new Set((await rpc(url, key, 'get_search_excluded_post_ids', { p_token: searchToken }, fetcher)).map(id => String(id).toLowerCase()));
  for (const city of cities) {
    let before = null, beforeId = null;
    while (true) {
      const page = await rpc(url, key, 'get_public_feed_page_v2', { p_city_id: city, p_tag_id: null, p_query: null, p_before_sort: before, p_before_id: beforeId, p_limit: 30 }, fetcher);
      // 20000000-… rows are the 0002 seed fixtures, not real posts.
      for (const row of page) {
        if (!UUID.test(row.id) || row.id.startsWith('20000000-0000-0000-0000-') || excluded.has(row.id) || rows.has(row.id) || meetups.has(row.id)) continue;
        // Guests get only the schedule/headcount fields of a meetup (login_required_post_content), never its place or body.
        if (row.room_preview) { meetups.set(row.id, { id: row.id, cityId: city, title: row.title, host: row.author_nickname ?? null, createdAt: row.created_at, room: row.room_preview }); continue; }
        rows.set(row.id, { id: row.id, cityId: city, lastmod: row.sort_at ?? row.created_at, createdAt: row.created_at ?? null, commentCount: row.comment_count ?? null,
          author: row.author_nickname ?? null, tagSlug: row.tag_slug ?? null, neighborhood: row.author_neighborhood ?? null });
      }
      if (page.length < 30 || rows.size >= 45000) break;
      const last = page.at(-1); before = last.sort_at ?? last.created_at; beforeId = last.id;
    }
  }
  const ids = [...rows.keys()], business = new Set();
  // The feed already shows the business name for official business posts; this only tells the schema it is an Organization (50 ids per call, the RPC limit).
  for (let index = 0; index < ids.length; index += 50) {
    for (const item of await rpc(url, key, 'get_public_post_businesses', { p_post_ids: ids.slice(index, index + 50) }, fetcher) ?? []) business.add(String(item.post_id).toLowerCase());
  }
  const posts = [], queue = [...rows.values()];
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      const preview = await rpc(url, key, 'get_shared_link_preview', { p_post_id: row.id }, fetcher);
      // Meetup destinations and invites stay app-only, matching the guest landing's indexable rule.
      if (preview?.id?.toLowerCase() === row.id && preview.kind !== 'meetup') posts.push({ ...row, ...preview, id: row.id, author: row.author, authorIsBusiness: business.has(row.id),
        createdAt: row.createdAt ?? preview.createdAt ?? null, commentCount: row.commentCount ?? preview.commentCount ?? null,
        imageUrl: preview.imagePath ? previewImage(row.id) : undefined });
    }
  }));
  posts.sort((a, b) => String(b.lastmod).localeCompare(String(a.lastmod)));
  return { posts, meetups: [...meetups.values()] };
}

// City × topic combinations with enough public posts to stand as their own page.
export function topicHubs(posts) {
  const counts = new Map();
  for (const post of posts) if (post.cityId && TOPIC_HUBS[post.tagSlug]) counts.set(`${post.cityId}/${post.tagSlug}`, (counts.get(`${post.cityId}/${post.tagSlug}`) ?? 0) + 1);
  return new Map([...counts].filter(([, count]) => count >= MIN_TOPIC_HUB_POSTS).map(([key, count]) => {
    const [cityId, tagSlug] = key.split('/');
    return [key, { cityId, tagSlug, count, path: `/${cityId}/${TOPIC_HUBS[tagSlug].slug}` }];
  }));
}

// Swap the shell's head tags for the page's own and put the static copy first in <body>.
// The 404 shell carries the reader's "앱에서 이어가세요." heading; demote it so the page has a single H1.
export function staticPage(template, head, body) {
  const stripped = template.replace(/<title[^>]*>[^<]*<\/title>|<meta\b[^>]*\b(?:name="(?:description|robots|twitter:[^"]*)"|property="og:[^"]*")[^>]*\/?>|<link\b[^>]*\brel="canonical"[^>]*\/?>|<script\b[^>]*\btype="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<h1\b/g, '<p').replace(/<\/h1>/g, '</p>');
  if (!/<\/head>/.test(stripped) || !/<body[^>]*>/.test(stripped)) throw new Error('Unexpected web shell for prerendered pages');
  return stripped.replace('</head>', `${head}</head>`).replace(/<body[^>]*>/, match => `${match}${body}`);
}

const LINK = 'color:#CBB9FF';
export const koreanDate = value => { const time = Date.parse(value); return Number.isFinite(time) ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'America/Vancouver', year: 'numeric', month: 'long', day: 'numeric' }).format(time) : ''; };
export const isoDate = value => { const time = Date.parse(value); return Number.isFinite(time) ? new Date(time).toISOString() : ''; };
export const breadcrumbHtml = items => `<nav aria-label="경로" style="margin:0 0 8px;font-size:13px">${items.map(([name, href]) => href ? `<a href="${href}" style="${LINK}">${escapeHtml(name)}</a>` : `<span>${escapeHtml(name)}</span>`).join(' › ')}</nav>`;

export function renderPublicPost(template, post, related = [], hub = null) {
  const url = publicPostUrl(post.id), title = `${post.title} | 글링`;
  const hubUrl = post.cityId ? `/${post.cityId}` : null, topicPath = hub?.path ?? hubUrl;
  const text = post.preview || post.teaser || '';
  const description = publicPostDescription({ ...post, text });
  const schema = publicPostSchema({ ...post, text }, hub ? `${PUBLIC_SITE}${hub.path}` : null);
  const head = [
    `<title data-rh="true">${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" data-rh="true"/>`,
    '<meta name="robots" content="index, follow, max-image-preview:large" data-rh="true"/>',
    `<link rel="canonical" href="${url}" data-rh="true"/>`,
    '<meta property="og:type" content="article" data-rh="true"/>',
    `<meta property="og:site_name" content="${escapeHtml(publicSiteName())}" data-rh="true"/>`,
    `<meta property="og:title" content="${escapeHtml(post.title)}" data-rh="true"/>`,
    `<meta property="og:description" content="${escapeHtml(description)}" data-rh="true"/>`,
    `<meta property="og:url" content="${url}" data-rh="true"/>`,
    `<meta property="og:image" content="${escapeHtml(post.imageUrl ?? `${PUBLIC_SITE}/share-covers/post.png`)}" data-rh="true"/>`,
    `<meta name="twitter:card" content="${post.imageUrl ? 'summary_large_image' : 'summary'}" data-rh="true"/>`,
    // No data-rh: the hydrated landing leaves this block alone instead of swapping in a thinner copy.
    `<script type="application/ld+json">${jsonLd(schema)}</script>`,
  ].join('');
  const published = isoDate(post.createdAt);
  const meta = [post.city, post.label, published && `<time datetime="${published}">${escapeHtml(koreanDate(post.createdAt))}</time>`,
    Number.isSafeInteger(post.commentCount) && `댓글 ${post.commentCount}개`, post.author].filter(Boolean).map(item => String(item).startsWith('<time') ? item : escapeHtml(item)).join(' · ');
  // The landing adopts #gling-static-crumbs into its own layout and removes #gling-static-post once the live preview renders.
  const crumbs = `<div id="gling-static-crumbs">${breadcrumbHtml([['글링', '/'], ...(hubUrl ? [[post.city || post.cityId, hubUrl]] : []), ...(post.label ? [[post.label, topicPath]] : [])])}</div>`;
  const body = `<article id="gling-static-post" lang="ko" style="max-width:640px;margin:24px auto;padding:20px;color:#F6F3F0;font:16px/1.6 system-ui,sans-serif">`
    + crumbs
    + `<h1 style="margin:0;font-size:24px;line-height:1.35">${escapeHtml(post.title)}</h1>`
    + `<p style="margin:8px 0 0;color:#B7B4C3;font-size:13px">${meta}</p>`
    + (post.imageUrl ? `<img src="${escapeHtml(post.imageUrl)}" alt="${escapeHtml(post.title)}" style="display:block;width:100%;margin-top:16px;border-radius:12px" loading="lazy"/>` : '')
    + (text ? `<p style="margin:16px 0 0;white-space:pre-line">${escapeHtml(text)}</p>` : '')
    + `<p style="margin:16px 0 0"><a href="/post?id=${post.id}" style="${LINK}">글링에서 전체 글 읽기</a> · <a href="${topicPath ?? '/'}" style="${LINK}">${escapeHtml(hub ? `${post.city} ${post.label} 이야기 더 보기` : post.city ? `${post.city} 동네 이야기 더 보기` : '동네 이야기 더 보기')}</a></p>`
    + (related.length ? `<h2 style="margin:24px 0 8px;font-size:17px">${escapeHtml(post.city ? `${post.city} 다른 이야기` : '다른 이야기')}</h2><ul style="margin:0;padding-left:20px">${related.map(item => `<li><a href="/posts/${item.id}" style="${LINK}">${escapeHtml(item.title)}</a></li>`).join('')}</ul>` : '')
    + '</article>';
  return staticPage(template, head, body);
}

// Old addresses (/post/<id>, /share/<id>, /posts/<id>/) as tiny pages pointing at the canonical post.
// GitHub Pages cannot send a 301; Google treats an immediate meta refresh plus canonical as a permanent move.
export function redirectPage(target, title = '글링') {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><meta name="robots" content="noindex, follow"><link rel="canonical" href="${escapeHtml(target)}"><meta http-equiv="refresh" content="0; url=${escapeHtml(target)}"></head><body><p><a href="${escapeHtml(target)}">${escapeHtml(title)}</a></p></body></html>\n`;
}

export async function prerenderPublicPosts(directory, options) {
  const { posts, meetups } = await loadPublicPosts(options);
  const hubs = topicHubs(posts);
  // The 404 shell is what static hosts already serve for /posts/:id, so the client router hydrates it unchanged.
  const template = readFileSync(join(directory, '+not-found.html'), 'utf8');
  for (const folder of ['posts', 'post', 'share']) mkdirSync(join(directory, folder), { recursive: true });
  for (const [index, post] of posts.entries()) {
    // The next few newer-or-older posts from the same city, so every prerendered post links to others.
    const sameCity = posts.filter(item => item.cityId === post.cityId && item.id !== post.id);
    const at = Math.max(0, sameCity.findIndex(item => posts.indexOf(item) > index) - 4);
    writeFileSync(join(directory, 'posts', `${post.id}.html`), renderPublicPost(template, post, sameCity.slice(at, at + 8), hubs.get(`${post.cityId}/${post.tagSlug}`)));
    const moved = redirectPage(publicPostUrl(post.id), post.title);
    writeFileSync(join(directory, 'post', `${post.id}.html`), moved);
    writeFileSync(join(directory, 'share', `${post.id}.html`), moved);
    mkdirSync(join(directory, 'posts', post.id), { recursive: true });
    writeFileSync(join(directory, 'posts', post.id, 'index.html'), moved);
  }
  return { posts, meetups };
}
