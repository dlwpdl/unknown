import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { uiEnglish } from '../src/i18n/ui-en.ts';
import { CITIES } from '../src/lib/mock.ts';
import { jsonLd, PUBLIC_CHANNELS, PUBLIC_SITE, publicPostUrl, publicSiteName } from '../src/lib/public-seo.ts';
import { escapeHtml, isoDate, postCover, rpc } from './prerender-public-posts.mjs';

// English copies of business posts at /en/posts/:id (owner 2026-11-13 "OK, 이대로 만들기", "영어글페이지는 그냥 올리면됨").
// Only businesses that agreed to be public (the ones in the public business directory, the same as /company/<id>) ever get one.
// On from the day this merges; when the owner names a business to leave out, add its id to businessIds:
//   startsOn    'YYYY-MM-DD' (the build's UTC date) from which the daily build makes the pages, or null for off.
//   mode        'exclude' = every public business except businessIds, 'include' = only the businesses in businessIds.
//   businessIds business ids, the same id as the business's public page /company/<id>.
export const ENGLISH_POSTS = { startsOn: '2026-11-13', mode: 'exclude', businessIds: [] };

export const englishPostUrl = id => `${PUBLIC_SITE}/en/posts/${encodeURIComponent(id.toLowerCase())}`;

export function englishPostsOn(config, now = Date.now()) {
  if (!['include', 'exclude'].includes(config.mode) || !Array.isArray(config.businessIds)) throw new Error('ENGLISH_POSTS needs mode include|exclude and a businessIds list');
  return typeof config.startsOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(config.startsOn) && new Date(now).toISOString().slice(0, 10) >= config.startsOn;
}

// Exactly the text the Korean page prints (renderPublicPost), so the translation never shows more than the original does.
const shownText = post => post.preview || post.teaser || '';

// Posts of public businesses (`publicIds`, lowercase ids) that the owner's list allows.
// #160/#161 add businessId to each post; until then it is looked up here (50 per call, the RPC limit).
export async function englishCandidates(posts, { url, key, fetcher = fetch }, config, publicIds) {
  const listed = new Set(config.businessIds.map(id => String(id).toLowerCase()));
  if (!publicIds.size || config.mode === 'include' && !listed.size) return [];
  const business = posts.filter(post => post.authorIsBusiness && post.title && shownText(post).trim());
  const owners = new Map(business.filter(post => post.businessId).map(post => [post.id, String(post.businessId).toLowerCase()]));
  const missing = business.filter(post => !owners.has(post.id)).map(post => post.id);
  for (let index = 0; index < missing.length; index += 50) {
    for (const item of await rpc(url, key, 'get_public_post_businesses', { p_post_ids: missing.slice(index, index + 50) }, fetcher) ?? []) owners.set(String(item.post_id).toLowerCase(), String(item.business_id).toLowerCase());
  }
  return business.filter(post => publicIds.has(owners.get(post.id)) && (config.mode === 'include') === listed.has(owners.get(post.id)));
}

const HANGUL = /[\u1100-\u11ff\u3131-\u318e\uac00-\ud7a3]/g;
// Names stay as written, so some Hangul is expected; a reply that is unchanged or still mostly Korean is not an English page.
export function usableTranslation(value, source) {
  const title = typeof value?.title === 'string' ? value.title.trim() : '', body = typeof value?.body === 'string' ? value.body.trim() : '';
  if (!title || !body || `${title}\n${body}` === `${source.title.trim()}\n${source.body.trim()}`) return null;
  const letters = `${title}${body}`.replace(/[^\p{L}]/gu, '');
  return (letters.match(HANGUL)?.length ?? 0) <= letters.length * 0.3 ? { title, body } : null;
}

// The server translator with the build's token: cached rows come back as is, a new or edited post is translated once.
export async function translateEnglishPost(post, { url, key, searchToken, fetcher = fetch }) {
  const source = { title: post.title, body: shownText(post) };
  try {
    const response = await fetcher(`${url}/functions/v1/translate-content`, {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json', 'x-gling-search-token': searchToken },
      body: JSON.stringify({ kind: 'post', id: post.id, language: 'en', source }),
    });
    return response.ok ? usableTranslation((await response.json())?.translation, source) : null;
  } catch {
    return null;
  }
}

export const languageLinks = id => `<link rel="alternate" hreflang="ko" href="${publicPostUrl(id)}"/><link rel="alternate" hreflang="en" href="${englishPostUrl(id)}"/><link rel="alternate" hreflang="x-default" href="${publicPostUrl(id)}"/>`;

// Both pages name the same three versions, each canonical to itself, so search engines read them as one post in two languages.
export function languagePairProblems(korean, english, id) {
  const links = html => [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map(match => `${match[1]} ${match[2]}`).sort().join('\n');
  const want = [`en ${englishPostUrl(id)}`, `ko ${publicPostUrl(id)}`, `x-default ${publicPostUrl(id)}`].join('\n');
  const canonical = html => html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  return [
    links(korean) !== want && `Korean page ${id} lists ${links(korean) || 'no'} language versions`,
    links(english) !== want && `English page ${id} lists ${links(english) || 'no'} language versions`,
    canonical(korean) !== publicPostUrl(id) && `Korean page ${id} is canonical to ${canonical(korean)}`,
    canonical(english) !== englishPostUrl(id) && `English page ${id} is canonical to ${canonical(english)}`,
    !/<html lang="en"/.test(english) && `English page ${id} is not lang="en"`,
    !english.includes(`href="/posts/${id}"`) && `English page ${id} does not link its Korean original`,
    !korean.includes(`href="/en/posts/${id}"`) && `Korean page ${id} does not link its English version`,
  ].filter(Boolean);
}

// The Korean page lists both language versions and links the English one inside the crumbs the landing keeps after hydration.
export function withEnglishVersion(html, id) {
  const crumbs = /(<div id="gling-static-crumbs">[\s\S]*?<\/nav>)/;
  if (!crumbs.test(html) || !html.includes('</head>')) throw new Error(`Unexpected Korean post page for ${id}`);
  return html.replace('</head>', `${languageLinks(id)}</head>`)
    .replace(crumbs, `$1<p lang="ko" style="margin:4px 0 0;font-size:13px">자동 번역한 영어로도 읽을 수 있어요 · <a href="/en/posts/${id}" hreflang="en" lang="en" style="color:#CBB9FF">Read in English</a></p>`);
}

// Stylesheets, night palette and wordmark of the exported web shell, so the English page looks like the reader without its app script.
export function shellParts(template) {
  const styles = template.match(/<link rel="stylesheet" href="\/_expo\/static\/css\/(?:global|reader)-[^"]+"\/?>/g) ?? [];
  const palette = template.match(/class="reader" style="([^"]*--accent:[^"]*)"/)?.[1];
  const wordmark = template.match(/\/assets\/[^"]*gling-night-wordmark\.[0-9a-f]+\.png/)?.[0];
  if (styles.length !== 2 || !palette || !wordmark) throw new Error('Web shell is missing the reader stylesheet, palette or wordmark');
  return { styles: styles.join(''), palette, wordmark };
}

// Page parts the reader CSS has no class for (the approved mockup's additions).
const STYLE = '.en-translated{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 16px;background:var(--backgroundElement);border-radius:15px;padding:10px 18px;margin:0 0 20px}'
  + '.en-translated p{margin:0}.en-tag{display:inline-flex;align-items:center;font-size:12px;font-weight:700;line-height:1.5;color:#171123;background:#CBB9FF;border-radius:6px;padding:2px 8px}'
  + '.en-translated a{color:#CBB9FF;display:inline-flex;align-items:center;min-height:44px;font-size:14px;font-weight:650}'
  + '.en-crumbs{font-size:13px;color:var(--textSecondary);margin:0}.en-crumbs a{color:#CBB9FF;text-decoration:none;display:inline-flex;align-items:center;min-height:44px}'
  + '.en-kicker{color:#CBB9FF;font-size:13px;font-weight:700;margin:0}.reader-post h1{margin:6px 0 12px}.en-photo{display:block;width:100%;margin:16px 0;border-radius:14px}'
  + 'a:active{opacity:.82}@media (prefers-reduced-motion:reduce){.reader-primary,.reader-secondary{transition:none!important}}';
const englishDate = value => { const time = Date.parse(value); return Number.isFinite(time) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: 'long', day: 'numeric' }).format(time) : ''; };
const MORE = { housing: 'rentals', jobs: 'jobs', business: 'business news' };

export function renderEnglishPost(shell, post, translation, hubPath = null) {
  const id = post.id, url = englishPostUrl(id), city = CITIES.find(item => item.id === post.cityId);
  const cityName = city?.englishName ?? '', topic = post.label ? uiEnglish[post.label] ?? '' : '';
  const cityPath = city ? `/${city.id}` : '/', topicPath = hubPath ?? cityPath;
  const suffix = ' Auto-translated from a Korean post on Gling.', lead = translation.body.replace(/\s+/g, ' ').trim();
  const description = (lead.length > 160 - suffix.length ? `${lead.slice(0, 159 - suffix.length).trimEnd()}…` : lead) + suffix;
  const image = post.imageUrl ?? postCover(post.cityId), published = isoDate(post.createdAt);
  const comments = Number.isSafeInteger(post.commentCount) ? `${post.commentCount} comment${post.commentCount === 1 ? '' : 's'}` : '';
  const schema = {
    '@context': 'https://schema.org', '@type': 'DiscussionForumPosting', '@id': `${url}#post`, url, mainEntityOfPage: url,
    headline: translation.title, text: translation.body, inLanguage: 'en', translationOfWork: { '@id': `${publicPostUrl(id)}#post` },
    ...(published ? { datePublished: published } : {}), ...(post.author ? { author: { '@type': 'Organization', name: post.author } } : {}),
    ...(post.imageUrl ? { image: post.imageUrl } : {}), ...(topic ? { articleSection: topic } : {}),
    ...(city ? { isPartOf: { '@type': 'CollectionPage', '@id': `${PUBLIC_SITE}${cityPath}` } } : {}),
  };
  const head = [
    '<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>',
    `<title>${escapeHtml(`${translation.title} | Gling`)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}"/>`,
    '<meta name="robots" content="index, follow, max-image-preview:large"/>',
    `<meta name="apple-itunes-app" content="app-id=6809273242, app-argument=gling://post/${id}"/>`,
    `<link rel="canonical" href="${url}"/>`, languageLinks(id), '<link rel="icon" href="/favicon.ico"/>',
    '<meta property="og:type" content="article"/>', `<meta property="og:site_name" content="${escapeHtml(publicSiteName('en'))}"/>`,
    `<meta property="og:title" content="${escapeHtml(translation.title)}"/>`, `<meta property="og:description" content="${escapeHtml(description)}"/>`,
    `<meta property="og:url" content="${url}"/>`, '<meta property="og:locale" content="en_CA"/><meta property="og:locale:alternate" content="ko_KR"/>',
    `<meta property="og:image" content="${escapeHtml(image)}"/>`,
    ...(post.imageUrl ? [] : ['<meta property="og:image:width" content="1200"/><meta property="og:image:height" content="630"/>']),
    `<meta property="og:image:alt" content="${escapeHtml(translation.title)}"/>`,
    '<meta name="twitter:card" content="summary_large_image"/>', `<meta name="twitter:title" content="${escapeHtml(translation.title)}"/>`,
    `<meta name="twitter:description" content="${escapeHtml(description)}"/>`,
    shell.styles, `<style>${STYLE}</style>`, `<script type="application/ld+json">${jsonLd(schema)}</script>`,
  ].join('');
  const meta = [post.author && escapeHtml(post.author), published && `<time datetime="${published}">${escapeHtml(englishDate(post.createdAt))}</time>`, comments].filter(Boolean).join(' · ');
  const crumbs = [['Gling', '/en', ''], ...(city ? [[cityName, cityPath, ' hreflang="ko"']] : []), ...(topic ? [[topic, topicPath, ' hreflang="ko"']] : [])]
    .map(([name, href, lang]) => `<a href="${href}"${lang}>${escapeHtml(name)}</a>`).join(' › ');
  const more = `More ${cityName ? `${cityName} ` : ''}${MORE[post.tagSlug] ?? 'posts'} (in Korean)`;
  const body = `<div class="reader" style="${shell.palette}" lang="en">`
    + '<a class="reader-skip" href="#reader-main">Skip to content</a>'
    + `<header class="reader-header"><a class="reader-brand" href="/en" aria-label="Gling home"><img src="${shell.wordmark}" alt="gling" width="144" height="60"/></a>`
    + `<nav aria-label="Main navigation"><a href="${cityPath}" hreflang="ko">Today</a><a href="/meetups${city ? `?city=${city.id}` : ''}" hreflang="ko">Meetups</a><a href="/?city=${city?.id ?? 'vancouver'}&amp;tag=festival#stories" hreflang="ko">Festivals</a><a href="/visited">Gling Visited</a></nav>`
    + '<a class="reader-header-account" href="/merchant/" rel="nofollow">Business sign-in</a></header>'
    + '<main id="reader-main" class="reader-main" tabindex="-1"><div class="reader-content">'
    + `<div class="en-translated"><p><span class="en-tag">Auto-translated from Korean</span></p><a href="/posts/${id}" hreflang="ko">Read the original in Korean</a></div>`
    + `<article class="reader-post"><nav aria-label="Breadcrumb" class="en-crumbs">${crumbs}</nav>`
    + (cityName || topic ? `<p class="en-kicker">${escapeHtml([cityName, topic].filter(Boolean).join(' · '))}</p>` : '')
    + `<h1>${escapeHtml(translation.title)}</h1>${meta ? `<p class="reader-meta">${meta}</p>` : ''}`
    + (post.imageUrl ? `<img class="en-photo" src="${escapeHtml(post.imageUrl)}" alt="${escapeHtml(translation.title)}" fetchpriority="high" decoding="async"/>` : '')
    + `<p class="reader-body">${escapeHtml(translation.body)}</p>`
    + `<div class="reader-actions"><a class="reader-primary" href="/post?id=${id}" rel="nofollow">Read the full post on Gling</a><a class="reader-secondary" href="${topicPath}" hreflang="ko">${escapeHtml(more)}</a></div>`
    + '</article></div>'
    + '<aside id="app"><section class="reader-invitation" aria-label="Get the app"><h2>Get the Gling app</h2>'
    + '<p>Koreans in Vancouver, Toronto and Montreal post rentals, jobs, food spots and meetups on Gling. Most posts are in Korean, and the app translates them for you.</p>'
    + '<a class="reader-primary" href="https://apps.apple.com/ca/app/id6809273242" target="_blank" rel="noopener noreferrer">Get it free on the App Store</a>'
    + '<a class="reader-secondary" style="width:100%" href="https://play.google.com/store/apps/details?id=com.dlwpdl.gling" target="_blank" rel="noopener noreferrer">View on Google Play</a>'
    + `<a class="reader-secondary reader-open-app" href="gling://post/${id}">Already have the app? Open it ↗</a></section></aside>`
    + '</main>'
    + '<footer class="reader-footer"><div class="reader-footer-brand"><span>gling · People to go with, stories to share</span>'
    + `<nav aria-label="Contact and social links"><a href="mailto:gling@ej-entertainment.com">gling@ej-entertainment.com</a>${PUBLIC_CHANNELS.map(channel => `<a href="${channel.url}" rel="me noopener">${escapeHtml(channel.name)}</a>`).join('')}</nav></div>`
    + '<nav aria-label="Policies"><a href="/immigration">Immigration guide (Korean)</a><a href="/business">List or manage your business</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/account-deletion">Delete account</a></nav></footer>'
    + '</div>';
  return `<!doctype html><html lang="en" style="background-color:#0D0C10;color-scheme:dark"><head>${head}</head><body style="background-color:#0D0C10;margin:0">${body}</body></html>\n`;
}

// After finishPublicWeb: writes /en/posts/:id, links each Korean page to it and adds the English pages to the sitemap.
// A post whose translation is missing or failed gets no English page at all.
// `businesses` are the public business profiles the build just loaded (loadPublicCompanies); none means no English pages.
export async function prerenderEnglishPosts(directory, posts, options, { config = ENGLISH_POSTS, now = Date.now(), hubs = new Map(), businesses = [] } = {}) {
  if (!englishPostsOn(config, now) || !options.searchToken) return [];
  const candidates = await englishCandidates(posts, options, config, new Set(businesses.map(business => String(business.id).toLowerCase())));
  if (!candidates.length) return [];
  const shell = shellParts(readFileSync(join(directory, '+not-found.html'), 'utf8'));
  const done = [], queue = [...candidates];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let post = queue.shift(); post; post = queue.shift()) {
      const translation = await translateEnglishPost(post, options);
      if (translation) done.push({ post, translation });
    }
  }));
  mkdirSync(join(directory, 'en', 'posts'), { recursive: true });
  for (const { post, translation } of done) {
    writeFileSync(join(directory, 'en', 'posts', `${post.id}.html`), renderEnglishPost(shell, post, translation, hubs.get(`${post.cityId}/${post.tagSlug}`)?.path));
    const korean = join(directory, 'posts', `${post.id}.html`);
    writeFileSync(korean, withEnglishVersion(readFileSync(korean, 'utf8'), post.id));
  }
  const sitemap = join(directory, 'sitemap.xml');
  const day = value => { const time = Date.parse(value); return Number.isFinite(time) ? `<lastmod>${new Date(time).toISOString().slice(0, 10)}</lastmod>` : ''; };
  writeFileSync(sitemap, readFileSync(sitemap, 'utf8').replace('</urlset>', `${done.map(({ post }) => `<url><loc>${englishPostUrl(post.id)}</loc>${day(post.lastmod)}</url>`).join('')}</urlset>`));
  return done.map(({ post }) => post.id);
}
