import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { jsonLd, publicPostUrl, publicSiteName, PUBLIC_SITE } from '../src/lib/public-seo.ts';
import { previewImage } from '../src/lib/shared-link-preview.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const escapeHtml = value => String(value).replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);

// Same public RPCs the guest web reader calls, with the publishable key only.
export async function rpc(url, key, name, args, fetcher) {
  const response = await fetcher(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error(`${name} failed: ${response.status}`);
  return response.json();
}

export async function loadPublicPosts({ url, key, cities, searchToken, fetcher = fetch }) {
  const rows = new Map();
  // Gling-operated character posts stay out of the sitemap and prerender (owner 2026-10-30); a missing token fails the deploy.
  if (!searchToken) throw new Error('GLING_SEARCH_BUILD_TOKEN is required to prerender public posts');
  const excluded = new Set((await rpc(url, key, 'get_search_excluded_post_ids', { p_token: searchToken }, fetcher)).map(id => String(id).toLowerCase()));
  for (const city of cities) {
    let before = null, beforeId = null;
    while (true) {
      const page = await rpc(url, key, 'get_public_feed_page_v2', { p_city_id: city, p_tag_id: null, p_query: null, p_before_sort: before, p_before_id: beforeId, p_limit: 30 }, fetcher);
      // 20000000-… rows are the 0002 seed fixtures, not real posts.
      for (const row of page) if (UUID.test(row.id) && !row.id.startsWith('20000000-0000-0000-0000-') && !excluded.has(row.id) && !rows.has(row.id)) rows.set(row.id, { id: row.id, cityId: city, lastmod: row.sort_at ?? row.created_at });
      if (page.length < 30 || rows.size >= 45000) break;
      const last = page.at(-1); before = last.sort_at ?? last.created_at; beforeId = last.id;
    }
  }
  const posts = [], queue = [...rows.values()];
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      const preview = await rpc(url, key, 'get_shared_link_preview', { p_post_id: row.id }, fetcher);
      // Meetup destinations and invites stay app-only, matching the guest landing's indexable rule.
      if (preview?.id?.toLowerCase() === row.id && preview.kind !== 'meetup') posts.push({ ...row, ...preview, id: row.id, imageUrl: preview.imagePath ? previewImage(row.id) : undefined });
    }
  }));
  return posts.sort((a, b) => String(b.lastmod).localeCompare(String(a.lastmod)));
}

// Photo-less posts share their city's 1200×630 cover (public/share-covers/); per-post title cards would need a Korean font and a text renderer in CI.
const CITY_COVERS = new Set(['vancouver', 'toronto', 'montreal']);
export const postCover = cityId => `${PUBLIC_SITE}/share-covers/${CITY_COVERS.has(cityId) ? cityId : 'post'}.png`;

export function renderPublicPost(template, post, related = []) {
  const url = publicPostUrl(post.id), title = `${post.title} | 글링`;
  const hub = post.cityId ? `${PUBLIC_SITE}/${post.cityId}` : null;
  const description = post.teaser || [post.city, post.label, '글링에서 로그인하면 전체 글을 읽을 수 있어요.'].filter(Boolean).join(' · ');
  const schema = {
    '@context': 'https://schema.org', '@type': 'WebPage', url, name: post.title, inLanguage: 'ko', description,
    ...(post.imageUrl ? { primaryImageOfPage: post.imageUrl } : {}), ...(post.lastmod ? { dateModified: new Date(post.lastmod).toISOString() } : {}),
    about: [post.city, post.label].filter(Boolean).join(' · '),
    isPartOf: { '@type': 'WebSite', name: publicSiteName(), url: `${PUBLIC_SITE}/` },
    breadcrumb: { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: publicSiteName(), item: `${PUBLIC_SITE}/` },
      ...(hub ? [{ '@type': 'ListItem', position: 2, name: `${post.city || post.cityId} 한인 커뮤니티`, item: hub }] : []),
      { '@type': 'ListItem', position: hub ? 3 : 2, name: post.title, item: url },
    ] },
  };
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
    '<meta property="og:locale" content="ko_KR" data-rh="true"/>',
    `<meta property="og:image" content="${escapeHtml(post.imageUrl ?? postCover(post.cityId))}" data-rh="true"/>`,
    // Photo sizes are unknown here, so only the fixed-size covers declare dimensions.
    ...(post.imageUrl ? [] : ['<meta property="og:image:width" content="1200" data-rh="true"/>', '<meta property="og:image:height" content="630" data-rh="true"/>']),
    `<meta property="og:image:alt" content="${escapeHtml(post.imageUrl ? post.title : `${post.city || '글링'} 동네 이야기`)}" data-rh="true"/>`,
    '<meta name="twitter:card" content="summary_large_image" data-rh="true"/>',
    `<meta name="twitter:title" content="${escapeHtml(post.title)}" data-rh="true"/>`,
    `<meta name="twitter:description" content="${escapeHtml(description)}" data-rh="true"/>`,
    `<script type="application/ld+json" data-rh="true">${jsonLd(schema)}</script>`,
  ].join('');
  // Removed by the shared-post landing once the live preview has rendered.
  const body = `<article id="gling-static-post" lang="ko" style="max-width:640px;margin:24px auto;padding:20px;color:#F6F3F0;font:16px/1.6 system-ui,sans-serif">`
    + `<p style="margin:0 0 8px;color:#CBB9FF;font-size:13px;font-weight:700">${escapeHtml([post.city, post.label].filter(Boolean).join(' · '))}</p>`
    + `<h1 style="margin:0;font-size:24px;line-height:1.35">${escapeHtml(post.title)}</h1>`
    + (post.imageUrl ? `<img src="${escapeHtml(post.imageUrl)}" alt="${escapeHtml(post.title)}" style="display:block;width:100%;margin-top:16px;border-radius:12px" loading="lazy"/>` : '')
    + (post.teaser ? `<p style="margin:16px 0 0;white-space:pre-line">${escapeHtml(post.teaser)}</p>` : '')
    + `<p style="margin:16px 0 0"><a href="/post?id=${post.id}" style="color:#CBB9FF">글링에서 전체 글 읽기</a> · <a href="${hub ? `/${post.cityId}` : '/'}" style="color:#CBB9FF">${escapeHtml(post.city ? `${post.city} 동네 이야기 더 보기` : '동네 이야기 더 보기')}</a></p>`
    + (related.length ? `<h2 style="margin:24px 0 8px;font-size:17px">${escapeHtml(post.city ? `${post.city} 다른 이야기` : '다른 이야기')}</h2><ul style="margin:0;padding-left:20px">${related.map(item => `<li><a href="/posts/${item.id}" style="color:#CBB9FF">${escapeHtml(item.title)}</a></li>`).join('')}</ul>` : '')
    + '</article>';
  return withStaticPage(template, head, body);
}

// Swaps the shell's page metadata for `head` and puts the crawler copy `body` first in <body>.
export function withStaticPage(template, head, body) {
  // Attribute order differs between Expo versions (data-rh may come first), so match the attribute anywhere in the tag.
  const stripped = template.replace(/<title[^>]*>[^<]*<\/title>|<meta\b[^>]*\b(?:name="(?:description|robots|twitter:[^"]*)"|property="og:[^"]*")[^>]*\/?>|<link\b[^>]*\brel="canonical"[^>]*\/?>|<script\b[^>]*\btype="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/g, '');
  if (!/<\/head>/.test(stripped) || !/<body[^>]*>/.test(stripped)) throw new Error('Unexpected web shell for prerendered posts');
  return stripped.replace('</head>', `${head}</head>`).replace(/<body[^>]*>/, match => `${match}${body}`);
}

export async function prerenderPublicPosts(directory, options) {
  const posts = await loadPublicPosts(options);
  // The 404 shell is what static hosts already serve for /posts/:id, so the client router hydrates it unchanged.
  const template = readFileSync(join(directory, '+not-found.html'), 'utf8');
  mkdirSync(join(directory, 'posts'), { recursive: true });
  for (const [index, post] of posts.entries()) {
    // The next few newer-or-older posts from the same city, so every prerendered post links to others.
    const sameCity = posts.filter(item => item.cityId === post.cityId && item.id !== post.id);
    const at = Math.max(0, sameCity.findIndex(item => posts.indexOf(item) > index) - 4);
    writeFileSync(join(directory, 'posts', `${post.id}.html`), renderPublicPost(template, post, sameCity.slice(at, at + 8)));
  }
  return posts;
}
