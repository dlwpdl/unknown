import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pinSubcategory } from '../src/lib/discovery.ts';
import { CITIES } from '../src/lib/mock.ts';
import { jsonLd, publicPlacePath, PUBLIC_SITE } from '../src/lib/public-seo.ts';
import { escapeHtml as e, koreanDate, postCover, rpc, withStaticPage } from './prerender-public-posts.mjs';

const bundled = name => JSON.parse(readFileSync(new URL(`../src/lib/${name}`, import.meta.url), 'utf8'));
const PLACE_FIELDS = ['places', 'regionalPlaces', 'extraPlaces', 'morePlaces'];
// Gling's own intro lines ("추천 이유"); moreRecommendations stays out, as in the 1,112-place scope the owner approved (2026-11-13).
const REASON_FIELDS = ['recommendations', 'diningRecommendations', 'extraRecommendations'];
const KIND = { food: '맛집', cafe: '카페', places: '가볼 만한 곳' };
const SCHEMA_TYPE = { food: 'Restaurant', cafe: 'CafeOrCoffeeShop', places: 'TouristAttraction' };
export const PLACE_PAGE_SIZE = 30;
const OUT = 'target="_blank" rel="noopener noreferrer"';
const https = value => typeof value === 'string' && /^https:\/\/[^\s"<>]+$/.test(value);
const RATING = /^글링 평점: \d+(?:\.\d+)?\/10/;

// The same anon catalog the app map and /visited read; the copy bundled with the app stands in if the call fails.
export async function loadPlaceCatalog({ url, key, fetcher = fetch }) {
  const live = await rpc(url, key, 'get_city_place_catalog', {}, fetcher).catch(() => null);
  return live?.cities ? live : { ...bundled('city-places.catalog.json'), photoCatalog: bundled('city-places.photos.json') };
}

function catalogPlaces(city) {
  const seen = new Map();
  for (const place of PLACE_FIELDS.flatMap(field => city?.[field] ?? [])) {
    if (typeof place?.name === 'string' && /^osm:(node|way|relation):[0-9]+$/.test(place.id ?? '') && !seen.has(place.id)) seen.set(place.id, place);
  }
  return [...seen.values()];
}

// Member review counts per place ("후기"), from the same public summary the app's place screen shows (25 ids per call, the RPC limit).
export async function loadPlaceRatings(catalog, { url, key, fetcher = fetch }) {
  const jobs = Object.entries(catalog.cities ?? {}).flatMap(([cityId, city]) => {
    const ids = catalogPlaces(city).map(place => place.id);
    return Array.from({ length: Math.ceil(ids.length / 25) }, (_, index) => [cityId, ids.slice(index * 25, index * 25 + 25)]);
  });
  const ratings = new Map();
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      for (const row of await rpc(url, key, 'get_place_rating_summaries', { p_city_id: job[0], p_place_ids: job[1] }, fetcher) ?? []) {
        if (Number(row.count) > 0) ratings.set(`${job[0]}|${row.placeId}`, { count: Number(row.count), average: Number(row.average) });
      }
    }
  }));
  return ratings;
}

// Every catalog place that has something to read about it: Gling's intro, a public member post or review, or Gling's own visit
// (owner 2026-11-13: all 11 cities). Places without any of these get no page. Each city comes in its list order (see below).
export function publicPlaces(catalog, posts = [], ratings = new Map()) {
  const visited = bundled('gling-visited.json'), photos = catalog.photoCatalog ?? {}, entries = [];
  for (const city of CITIES.filter(item => catalog.cities?.[item.id])) {
    const source = catalog.cities[city.id], places = catalogPlaces(source), byName = new Map(), reasons = new Map(), attached = new Map();
    for (const field of REASON_FIELDS) for (const row of source[field] ?? []) if (typeof row?.reason === 'string' && row.reason.trim() && !reasons.has(row.placeId)) reasons.set(row.placeId, row);
    for (const place of places) byName.set(place.name, [...(byName.get(place.name) ?? []), place]);
    // shortcut: the public preview names the post's place but not its id, so a name two catalog places share links nowhere; add the place id to get_shared_link_preview to link those.
    for (const post of posts) {
      const match = post.cityId === city.id && typeof post.place === 'string' ? byName.get(post.place) : null;
      if (match?.length === 1) attached.set(match[0].id, [...(attached.get(match[0].id) ?? []), post]);
    }
    const photoList = [photos.cities, photos.additionalCatalog?.cities, photos.flickrCatalog?.cities].flatMap(group => group?.[city.id] ?? [])
      .concat(source.regionalPhotos ?? [], source.extraPhotos ?? [], source.morePhotos ?? [], visited.filter(row => row.cityId === city.id && row.photo).map(row => ({ ...row.photo, placeId: row.placeId })));
    // Only a photo whose catalog entry names its maker, licence and source is shown, with that credit.
    const photo = id => photoList.find(item => item?.placeId === id && https(item.uri) && https(item.sourceUrl) && https(item.licenseUrl) && item.artist && item.license) ?? null;
    const own = [];
    for (const place of places) {
      const reason = reasons.get(place.id) ?? null, list = attached.get(place.id) ?? [], reviews = ratings.get(`${city.id}|${place.id}`) ?? null;
      const visit = visited.find(row => row.cityId === city.id && row.placeId === place.id && https(row.sourceUrl)) ?? null;
      if (!reason && !list.length && !reviews && !visit) continue;
      own.push({ cityId: city.id, city, place, kind: KIND[place.category] ? place.category : 'places', reason, posts: list, reviews, visit, photo: photo(place.id),
        path: publicPlacePath(city.id, place.id), lastmod: list.map(post => post.lastmod).filter(Boolean).sort().at(-1) ?? reason?.verifiedAt });
    }
    // Visited, written-about and reviewed places first; then places, food and cafes in turn, each with photos first and then in Gling's intro order.
    const top = own.filter(entry => entry.visit || entry.posts.length || entry.reviews), rest = own.filter(entry => !top.includes(entry)), order = [...reasons.keys()];
    const groups = ['places', 'food', 'cafe'].map(kind => rest.filter(entry => entry.kind === kind).sort((a, b) => Number(!a.photo) - Number(!b.photo) || order.indexOf(a.place.id) - order.indexOf(b.place.id)));
    entries.push(...top, ...Array.from({ length: Math.max(0, ...groups.map(group => group.length)) }, (_, index) => groups.map(group => group[index])).flat().filter(Boolean));
  }
  return entries;
}

const DAY = { Mo: '월', Tu: '화', We: '수', Th: '목', Fr: '금', Sa: '토', Su: '일', PH: '공휴일' };
const DAYS = '(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)', TIMES = '\\d\\d:\\d\\d-\\d\\d:\\d\\d(?:,\\s*\\d\\d:\\d\\d-\\d\\d:\\d\\d)*';
const RULE = new RegExp(`^\\s*(?:(${DAYS}(?:\\s*[-,]\\s*${DAYS})*)\\s+)?(${TIMES}|off)\\s*$`);
const rules = raw => String(raw ?? '').split(/;|(?<=\d)\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)\b)/).filter(part => part.trim()).map(part => part.match(RULE));

// OSM opening_hours as people read it ('화–토 11:00–23:00, 월·일 11:00–22:00'); anything this does not read is shown as written.
export function hoursText(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const parts = rules(raw);
  if (!parts.length || parts.some(match => !match)) return raw.trim();
  return parts.map(([, days, time]) => `${days ? days.replace(/\s*,\s*/g, '·').replace(/\s*-\s*/g, '–').replace(/Mo|Tu|We|Th|Fr|Sa|Su|PH/g, day => DAY[day]) : '매일'} ${time === 'off' ? '휴무' : time.replace(/-/g, '–').replace(/\s*,\s*/g, ', ')}`).join(', ');
}

// schema.org openingHours ("Mo-Fr 09:00-17:00"), only for rules it can state: no holidays, no closed days.
const schemaHours = raw => rules(raw).filter(match => match && match[2] !== 'off' && !match[1]?.includes('PH'))
  .flatMap(([, days, time]) => time.split(/\s*,\s*/).map(range => `${days ? days.replace(/\s+/g, '') : 'Mo-Su'} ${range}`));

const plain = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// "433 Rue Mayor" from "433 Rue Mayor, Montréal, QC H2A 1B2, Canada": the city, province (with postal code) and country are shown elsewhere.
function street(place, city) {
  const province = new RegExp(`^${city.province}(?:\\s+[A-Z]\\d[A-Z]\\s?\\d[A-Z]\\d)?$`, 'i');
  return String(place.address ?? '').split(',').map(part => part.trim()).filter(part => part && !province.test(part) && !['canada', plain(city.englishName)].includes(plain(part))).join(', ');
}

const josa = (word, withFinal, withoutFinal) => { const code = word.charCodeAt(word.length - 1) - 0xAC00; return code >= 0 && code <= 11171 && code % 28 ? withFinal : withoutFinal; };
const memberPosts = entry => entry.posts.filter(post => !RATING.test(String(post.preview || post.teaser || '')));
const hostOf = url => new URL(url).hostname.replace(/^www\./, '');

// Google sets no length but cuts the snippet to fit the screen; the site audit asks for 70–160 characters.
// Whole sentences that fit (if they reach 70), else whole words and "…": Korean and English both break at spaces, so no word is cut in half.
function fit(text, min = 70, max = 160) {
  if (text.length <= max) return text;
  const sentences = text.slice(0, max + 1).match(/^.*[.!?](?=\s)/s)?.[0];
  if (sentences?.length >= min) return sentences;
  const words = text.slice(0, max);
  return `${words.slice(0, words.search(/\s\S*$/)).replace(/[\s,·:;]+$/, '')}…`;
}

export function publicPlaceMeta(entry) {
  const { place, city } = entry, kind = KIND[entry.kind], hours = hoursText(place.openingHours);
  const items = [street(place, city) && '주소', hours && '영업시간', entry.reviews && '글링 회원이 남긴 후기', memberPosts(entry).length && '글링 회원 글', '지도 링크'].filter(Boolean);
  const list = items.length > 1 ? `${items[0]}${josa(items[0], '과', '와')} ${items.slice(1).join(', ')}` : items[0];
  return { title: `${place.name} · ${city.name} ${kind} | 글링`,
    // The intro used to be joined whole (up to 259 characters); now it is cut to fit, while the page and schema keep it whole.
    description: fit([`${city.name} ${kind} ${place.name}의 ${list}를 볼 수 있어요.`, entry.reason?.reason.trim()].filter(Boolean).join(' ')) };
}

const pageHead = (path, meta, cover) => [
  `<title data-rh="true">${e(meta.title)}</title>`,
  `<meta name="description" content="${e(meta.description)}" data-rh="true"/>`,
  '<meta name="robots" content="index, follow, max-image-preview:large" data-rh="true"/>',
  `<link rel="canonical" href="${PUBLIC_SITE}${path}" data-rh="true"/>`,
  '<meta name="apple-itunes-app" content="app-id=6809273242"/>',
  `<meta property="og:type" content="website" data-rh="true"/><meta property="og:site_name" content="글링 | 캐나다 한인 커뮤니티" data-rh="true"/><meta property="og:locale" content="ko_KR" data-rh="true"/>`,
  `<meta property="og:title" content="${e(meta.title)}" data-rh="true"/><meta property="og:description" content="${e(meta.description)}" data-rh="true"/><meta property="og:url" content="${PUBLIC_SITE}${path}" data-rh="true"/>`,
  `<meta property="og:image" content="${e(cover)}" data-rh="true"/>`,
  `<meta name="twitter:card" content="summary_large_image" data-rh="true"/><meta name="twitter:title" content="${e(meta.title)}" data-rh="true"/><meta name="twitter:description" content="${e(meta.description)}" data-rh="true"/>`,
].join('');

// Only the open cities have a city page; the others show their name without a link.
const cityCrumb = city => city.state === 'open' ? `<a href="/${city.id}">${e(city.name)}</a>` : e(city.name);
const crumbSchema = (city, items) => ({ '@type': 'BreadcrumbList', itemListElement: [['글링', '/'], city.state === 'open' && [`${city.name} 한인 커뮤니티`, `/${city.id}`], ...items].filter(Boolean)
  .map(([name, path], index) => ({ '@type': 'ListItem', position: index + 1, name, item: `${PUBLIC_SITE}${path}` })) });
const fineprint = (catalog, osm) => `<div class="place-fineprint"><p>방문 전 운영 여부와 시간을 확인해 주세요.</p><p>장소 정보 ${e(catalog?.attribution || '© OpenStreetMap contributors')} (ODbL)${koreanDate(catalog?.collectedAt) ? ` · ${e(koreanDate(catalog.collectedAt))} 확인` : ''}${osm ? ` · <a href="${e(osm)}" ${OUT}>OpenStreetMap에서 보기 ↗</a>` : ''} · <a href="${e(https(catalog?.attributionUrl) ? catalog.attributionUrl : 'https://www.openstreetmap.org/copyright')}" ${OUT}>자료 이용 조건 ↗</a></p></div>`;
// A business's own site photo carries its site as the credit; a CC photo its author, licence and original.
const credit = photo => photo.license === 'Business-provided photo'
  ? [`사진: ${e(photo.artist)} · 비즈니스 웹사이트에 올린 사진`, `<a href="${e(photo.sourceUrl)}" ${OUT}>비즈니스 웹사이트 ↗</a>`]
  : [`사진: ${e(photo.artist)} · ${e(photo.license)}`, `<a href="${e(photo.sourceUrl)}" ${OUT}>원본 사진 ↗</a> · <a href="${e(photo.licenseUrl)}" ${OUT}>이용 조건 ↗</a>`];
const PHOTO_NOTE = '<p>사진은 촬영 시점의 모습이며 현재와 다를 수 있어요.</p>';

function tags(entry) {
  const posts = memberPosts(entry).length;
  const list = [entry.visit && '<span class="place-tag">글링 직접 방문</span>', posts && `<span class="place-tag quiet">글 ${posts}개</span>`, entry.reviews && `<span class="place-tag quiet">후기 ${entry.reviews.count}개</span>`].filter(Boolean);
  return list.length ? `<div class="place-signals">${list.join('')}</div>` : '';
}

const kindLine = entry => [KIND[entry.kind], street(entry.place, entry.city)].filter(Boolean).join(' · ');

// One place: Gling's intro, what the catalog knows (rows it lacks are left out, never "unknown"), and the public posts about it.
export function renderPublicPlace(template, entry, others, total, catalog) {
  const { place, city, path } = entry, meta = publicPlaceMeta(entry), address = street(place, city), hours = hoursText(place.openingHours);
  const sub = pinSubcategory(place.subcategories)?.label, website = https(place.website) ? place.website : null;
  const rows = [['종류', e([KIND[entry.kind], sub].filter(Boolean).join(' · '))], address && ['주소', e(address.includes(',') ? address : `${address}, ${city.englishName}`)],
    hours && ['영업시간', `${e(hours)}<small>OpenStreetMap에 등록된 시간</small>`], website && ['웹사이트', `<a href="${e(website)}" ${OUT}>${e(hostOf(website))} ↗</a>`]].filter(Boolean);
  const query = [place.name, address, city.englishName, city.province, 'Canada'].filter(Boolean).join(', ');
  const posts = entry.posts.map(post => `<article class="reader-card"><div>${RATING.test(String(post.preview || post.teaser || '')) ? '<span class="place-tag quiet">장소 후기</span>' : ''}<h3><a href="/posts/${post.id}">${e(post.title)}</a></h3>`
    + `${String(post.preview || post.teaser || '').trim() ? `<p class="reader-excerpt">${e(String(post.preview || post.teaser).trim().replace(/\s*\n+\s*/g, ' · '))}</p>` : ''}`
    + `<p class="reader-meta">${e([post.label, koreanDate(post.createdAt ?? post.lastmod), post.author].filter(Boolean).join(' · '))}</p></div></article>`).join('');
  const body = `<section id="gling-static-hub" class="place-page" lang="ko" data-title="${e(meta.title)}" data-description="${e(meta.description)}"><article class="reader-post">`
    + `<nav aria-label="경로" class="place-crumbs"><a href="/">글링</a> › ${cityCrumb(city)} › <a href="/${city.id}/places">장소</a> › ${e(place.name)}</nav>`
    + `<p class="place-kicker">${e(city.name)} · ${KIND[entry.kind]}</p><h1>${e(place.name)}</h1>${tags(entry)}`
    + (entry.visit ? `<p class="place-lead">글링이 직접 다녀왔어요.</p><a class="place-lead-link" href="${e(entry.visit.sourceUrl)}" ${OUT}>방문 영상 보기 ↗</a>` : '')
    + (entry.reason ? `<p class="place-lead">${e(entry.reason.reason.trim())}</p>${https(entry.reason.sourceUrl) ? `<a class="place-lead-link" href="${e(entry.reason.sourceUrl)}" ${OUT}>소개에 참고한 페이지 ↗</a>` : ''}` : '')
    + `<div class="place-facts"><dl>${rows.map(([term, value]) => `<dt>${term}</dt><dd>${value}</dd>`).join('')}</dl></div>`
    + `<div class="place-actions"><a class="reader-primary" href="https://www.google.com/maps/search/?${e(new URLSearchParams({ api: '1', query }).toString())}" ${OUT}>Google 지도에서 열기 ↗</a>`
    + `<a class="reader-secondary" href="gling://map?cityId=${e(city.id)}&amp;placeId=${e(place.id)}">글링 앱 지도에서 보기</a></div>`
    + (entry.photo ? `<figure class="place-photo"><img src="${e(entry.photo.uri)}" alt="${e(place.name)} 사진" loading="lazy" decoding="async" referrerpolicy="no-referrer"/><details><summary>사진 저작자·이용 조건</summary>${credit(entry.photo).map(line => `<p>${line}</p>`).join('')}${PHOTO_NOTE}</details></figure>` : '')
    + `<section class="place-section" aria-labelledby="posts-h"><h2 id="posts-h">이 장소에 달린 글</h2>`
    + (entry.reviews ? `<p class="place-rating">${e([Number.isFinite(entry.reviews.average) && `글링 회원 평점 ${entry.reviews.average.toFixed(1)}`, `후기 ${entry.reviews.count}개`].filter(Boolean).join(' · '))}</p>` : '')
    + (posts || '<div class="place-empty"><p>아직 이 장소에 달린 글이 없어요. 앱에서 열면 첫 후기를 남길 수 있어요.</p></div>') + '</section>'
    + (others.length ? `<section class="place-section" aria-labelledby="others-h"><h2 id="others-h">${e(`${city.name} 다른 장소`)}</h2><ul class="place-others">${others.map(other => `<li><a href="${other.path}"><strong>${e(other.place.name)}</strong><small>${e(kindLine(other))}</small></a></li>`).join('')}</ul>`
      + `<a class="reader-secondary place-all" href="/${city.id}/places">${e(`${city.name} 장소 ${total}곳 모두 보기`)}</a></section>` : '')
    + fineprint(catalog, https(place.sourceUrl) ? place.sourceUrl : null)
    + '</article></section>';
  const url = `${PUBLIC_SITE}${path}`, openingHours = schemaHours(place.openingHours);
  const schema = { '@context': 'https://schema.org', '@graph': [
    { '@type': SCHEMA_TYPE[entry.kind], '@id': `${url}#place`, name: place.name, url, ...(entry.reason ? { description: entry.reason.reason.trim() } : {}),
      address: { '@type': 'PostalAddress', ...(address ? { streetAddress: address } : {}), addressLocality: city.englishName, addressRegion: city.province, addressCountry: 'CA' },
      ...(Number.isFinite(place.latitude) && Number.isFinite(place.longitude) ? { geo: { '@type': 'GeoCoordinates', latitude: place.latitude, longitude: place.longitude } } : {}),
      ...(openingHours.length ? { openingHours } : {}), ...(entry.photo ? { image: entry.photo.uri } : {}), sameAs: [place.sourceUrl, website].filter(https) },
    crumbSchema(city, [['장소', `/${city.id}/places`], [place.name, path]]),
  ] };
  return withStaticPage(template, pageHead(path, meta, postCover(city.id)) + `<script type="application/ld+json">${jsonLd(schema)}</script>`, body);
}

// /<city>/places, /<city>/places/2 …: 30 places a page, each page canonical to itself. The kind buttons filter within the page (reader.tsx).
export function renderCityPlaces(template, city, list, page, catalog) {
  const pages = Math.ceil(list.length / PLACE_PAGE_SIZE), shown = list.slice((page - 1) * PLACE_PAGE_SIZE, page * PLACE_PAGE_SIZE);
  const base = `/${city.id}/places`, path = page === 1 ? base : `${base}/${page}`, at = number => number === 1 ? base : `${base}/${number}`;
  const heading = `${city.name} 맛집·카페·가 볼 곳`;
  const from = (page - 1) * PLACE_PAGE_SIZE + 1, to = from + shown.length - 1;
  const meta = { title: `${heading} ${list.length}곳${page > 1 ? ` · ${page}쪽` : ''} | 글링`,
    // Pages 2+ name their page and range, as the title does, so no two list pages share a description.
    description: `${city.name}에서 글링 회원 글이나 소개가 있는 장소 ${list.length}곳을 골랐어요.${page > 1 ? ` ${page}쪽에는 ${from === to ? from : `${from}~${to}`}번째 곳이 있어요.` : ''} 맛집·카페·가 볼 곳마다 지도 링크가 있어요.` };
  const count = kind => list.filter(entry => entry.kind === kind).length;
  const chips = [['all', '전체', list.length], ['food', '맛집', count('food')], ['cafe', '카페', count('cafe')], ['places', '가볼 만한 곳', count('places')]]
    .map(([kind, label, number]) => `<button type="button" aria-pressed="${kind === 'all'}" data-cat="${kind}">${label}<span>${number}</span></button>`).join('');
  const cards = shown.map(entry => {
    const excerpt = entry.reason?.reason.trim() || (entry.posts[0] ? `“${entry.posts[0].title}”` : '');
    return `<article class="reader-card" data-cat="${entry.kind}"><div>${tags(entry)}<h3><a href="${entry.path}">${e(entry.place.name)}</a></h3>${excerpt ? `<p class="reader-excerpt">${e(excerpt)}</p>` : ''}<p class="reader-meta">${e(kindLine(entry))}</p></div>`
      + (entry.photo ? `<img class="reader-thumbnail" src="${e(entry.photo.uri)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"/>` : '') + '</article>';
  }).join('');
  const credits = shown.filter(entry => entry.photo).map(entry => `<li>${e(entry.place.name)} — ${credit(entry.photo).join(' · ')}</li>`).join('');
  const next = list.length - page * PLACE_PAGE_SIZE;
  const note = `${page}쪽 ${shown.length}곳을 보고 있어요.`;
  const body = `<section id="gling-static-hub" class="place-page" lang="ko" data-title="${e(meta.title)}" data-description="${e(meta.description)}">`
    + `<nav aria-label="경로" class="place-crumbs"><a href="/">글링</a> › ${cityCrumb(city)} › ${page === 1 ? '장소' : `<a href="${base}">장소</a>`}</nav>`
    + `<div class="reader-section-heading"><div><h1>${e(heading)}</h1><p>글링 회원이 글을 남겼거나 글링이 소개를 써 둔 곳만 모았어요. 누르면 주소와 영업시간, 지도 링크가 나와요.</p></div><span>${list.length}곳</span></div>`
    + `<div class="place-chips" role="group" aria-label="종류로 거르기">${chips}</div>`
    + `<p class="place-list-note" id="place-list-note" aria-live="polite" data-page="${page}" data-all="${e(note)}">${e(note)}</p>`
    // A screen-reader h2 between the page h1 and the card h3s keeps the heading levels in order; the page looks the same.
    + `<section class="place-list" aria-labelledby="place-list-h"><h2 id="place-list-h" class="place-sr-only">${e(`${city.name} 장소 목록`)}</h2>${cards}</section>`
    + (pages > 1 ? `<div class="place-pager"><p class="reader-meta">${page} / ${pages}쪽</p>${page > 1 ? `<a class="reader-secondary" href="${at(page - 1)}" rel="prev">이전 30곳 보기</a>` : ''}${next > 0 ? `<a class="reader-secondary" href="${at(page + 1)}" rel="next">${e(`다음 ${Math.min(next, PLACE_PAGE_SIZE)}곳 보기`)}</a>` : ''}</div>` : '')
    + (credits ? `<details class="place-credits"><summary>이 페이지 사진 저작자·이용 조건</summary><ul>${credits}</ul>${PHOTO_NOTE}</details>` : '')
    + fineprint(catalog, null)
    + '</section>';
  const url = `${PUBLIC_SITE}${path}`;
  const schema = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'CollectionPage', '@id': url, url, name: heading, description: meta.description, inLanguage: 'ko', isPartOf: { '@id': `${PUBLIC_SITE}/#website` },
      mainEntity: { '@type': 'ItemList', numberOfItems: list.length, itemListElement: shown.map((entry, index) => ({ '@type': 'ListItem', position: (page - 1) * PLACE_PAGE_SIZE + index + 1, url: `${PUBLIC_SITE}${entry.path}`, name: entry.place.name })) } },
    crumbSchema(city, [['장소', base], ...(page > 1 ? [[`${page}쪽`, path]] : [])]),
  ] };
  return withStaticPage(template, pageHead(path, meta, postCover(city.id)) + `<script type="application/ld+json">${jsonLd(schema)}</script>`, body);
}

// Writes every list page and place page (GitHub Pages serves /x from x.html, and /x/ from x/index.html) and returns their sitemap rows.
export function writePublicPlaces(directory, template, places, catalog) {
  const rows = [], write = (path, html) => { mkdirSync(dirname(join(directory, path)), { recursive: true }); writeFileSync(join(directory, path), html); };
  for (const city of CITIES) {
    const list = places.filter(entry => entry.cityId === city.id);
    if (!list.length) continue;
    const newest = list.map(entry => entry.lastmod).filter(Boolean).sort().at(-1);
    for (let page = 1; page <= Math.ceil(list.length / PLACE_PAGE_SIZE); page++) {
      const html = renderCityPlaces(template, city, list, page, catalog), path = page === 1 ? `${city.id}/places` : `${city.id}/places/${page}`;
      write(`${path}.html`, html);
      if (page === 1) write(`${path}/index.html`, html);
      rows.push([`/${path}`, newest]);
    }
    // The next six in list order (wrapping), so every place is linked from other place pages as well as from its list page.
    list.forEach((entry, index) => {
      const others = Array.from({ length: Math.min(6, list.length - 1) }, (_, step) => list[(index + step + 1) % list.length]);
      write(`${entry.path.slice(1)}.html`, renderPublicPlace(template, entry, others, list.length, catalog));
      rows.push([entry.path, entry.lastmod]);
    });
  }
  return rows;
}

