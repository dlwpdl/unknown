import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITIES, TAGS } from '../src/lib/mock.ts';
import {
  CITY_PAGE_SIZE, jsonLd, PUBLIC_SITE, PUBLIC_SOURCE, publicAboutGling, publicAboutGlingEn, publicCitySubpageMeta, publicDisambiguation, publicPostUrl, TOPIC_HUBS,
} from '../src/lib/public-seo.ts';
import { breadcrumbHtml, escapeHtml, isoDate, koreanDate, prerenderPublicPosts, redirectPage, staticPage, topicHubs } from './prerender-public-posts.mjs';

const LINK = 'color:#CBB9FF';
const SECTION = 'max-width:720px;margin:24px auto;padding:20px;color:#F6F3F0;font:16px/1.6 system-ui,sans-serif';
const label = slug => TAGS.find(tag => tag.slug === slug)?.label ?? slug;
const ldScript = value => `<script type="application/ld+json">${jsonLd(value)}</script>`;

// Crawler copy for the home and city hubs; the reader removes #gling-static-home once the live feed renders.
function staticHub(cities, posts, city) {
  const list = (city ? posts.filter(post => post.cityId === city.id) : posts).slice(0, 30);
  return `<section id="gling-static-home" lang="ko" style="${SECTION}">`
    + `<p style="margin:0">${escapeHtml(publicAboutGling)}</p>`
    + `<p style="margin:12px 0 0">${cities.map(item => `<a href="/${item.id}" style="${LINK}">${escapeHtml(item.name)} 한인 커뮤니티</a>`).join(' · ')} · <a href="/faq" style="${LINK}">자주 묻는 질문</a> · <a href="https://apps.apple.com/ca/app/id6809273242" style="${LINK}">iPhone 앱 받기</a></p>`
    + (list.length ? `<h2 style="margin:24px 0 8px;font-size:18px">${escapeHtml(city ? `${city.name} 한인 최근 이야기` : '최근 동네 이야기')}</h2><ul style="margin:0;padding-left:20px">${list.map(post => `<li><a href="/posts/${post.id}" style="${LINK}">${escapeHtml(post.title)}</a>${post.city || post.label ? ` <small>${escapeHtml([post.city, post.label].filter(Boolean).join(' · '))}</small>` : ''}</li>`).join('')}</ul>` : '')
    + '</section>';
}

const activeMeetup = (meetup, now) => !meetup.room?.closed && (meetup.room?.eventKind !== 'once' || !meetup.room?.endsAt || Date.parse(meetup.room.endsAt) > now);

// Plain facts from this build's public data: no figure on the page comes from anywhere else.
export function cityFacts(city, posts, meetups, now = Date.now()) {
  const own = posts.filter(post => post.cityId === city.id);
  const recent = own.filter(post => now - Date.parse(post.createdAt ?? post.lastmod) <= 30 * 864e5).length;
  const tally = values => [...values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);
  const topics = tally(own.map(post => post.tagSlug).filter(slug => TOPIC_HUBS[slug]));
  const places = tally(own.map(post => String(post.neighborhood ?? '').trim()).filter(Boolean)).filter(([, count]) => count >= 3).slice(0, 4).map(([name]) => name);
  return { total: own.length, recent, topics, places, meetups: meetups.filter(item => item.cityId === city.id && activeMeetup(item, now)).length };
}

function factSentence(city, facts) {
  return [
    facts.recent ? `최근 30일 동안 ${city.name} 한인들이 글링에 올린 공개 글은 ${facts.recent}개예요.` : `${city.name} 한인들이 글링에 올린 공개 글은 지금까지 ${facts.total}개예요.`,
    facts.topics.length && `${facts.topics.slice(0, 3).map(([slug]) => label(slug)).join(', ')} 이야기가 많이 올라와요.`,
    facts.places.length && `${facts.places.join('·')}에 사는 분들이 글을 많이 써요.`,
    facts.meetups && `지금 참여 신청을 받는 모임은 ${facts.meetups}개예요.`,
  ].filter(Boolean).join(' ');
}

const pageList = (city, pages, current) => pages > 1
  ? `<nav aria-label="쪽 넘김" style="margin:16px 0 0">${Array.from({ length: pages }, (_, index) => index + 1).map(page => page === current ? `<strong>${page}</strong>` : `<a href="/${city.id}${page === 1 ? '' : `/${page}`}" style="${LINK}">${page}</a>`).join(' ')}${current < pages ? ` <a href="/${city.id}/${current + 1}" rel="next" style="${LINK}">다음 ›</a>` : ''}</nav>` : '';

const postItems = posts => `<ul style="margin:0;padding-left:20px">${posts.map(post => `<li><a href="/posts/${post.id}" style="${LINK}">${escapeHtml(post.title)}</a> <small>${escapeHtml([post.label, koreanDate(post.createdAt ?? post.lastmod), Number.isSafeInteger(post.commentCount) && `댓글 ${post.commentCount}개`].filter(Boolean).join(' · '))}</small></li>`).join('')}</ul>`;

function collectionSchema(url, name, description, posts, crumbs) {
  return { '@context': 'https://schema.org', '@graph': [
    { '@type': 'CollectionPage', '@id': url, url, name, description, inLanguage: 'ko', isPartOf: { '@id': `${PUBLIC_SITE}/#website` },
      mainEntity: { '@type': 'ItemList', numberOfItems: posts.length, itemListElement: posts.map((post, index) => ({ '@type': 'ListItem', position: index + 1, url: publicPostUrl(post.id), name: post.title })) } },
    { '@type': 'BreadcrumbList', itemListElement: crumbs.map(([name, path], index) => ({ '@type': 'ListItem', position: index + 1, name, item: `${PUBLIC_SITE}${path}` })) },
  ] };
}

// Kept on the city page (the reader moves it next to the live feed) so the city's own facts and paths stay visible.
function cityBlock(city, facts, hubs, pages, meetupPage) {
  const own = [...hubs.values()].filter(hub => hub.cityId === city.id).sort((a, b) => b.count - a.count);
  const business = own.find(hub => hub.tagSlug === 'business');
  return `<section id="gling-static-city" lang="ko" style="${SECTION}">`
    + breadcrumbHtml([['글링', '/'], [city.name, null]])
    + `<p style="margin:0">${escapeHtml(factSentence(city, facts))}</p>`
    + (own.length ? `<h2 style="margin:20px 0 8px;font-size:17px">${escapeHtml(city.name)} 주제별 이야기</h2><p style="margin:0">${own.map(hub => `<a href="${hub.path}" style="${LINK}">${escapeHtml(label(hub.tagSlug))} ${hub.count}</a>`).join(' · ')}</p>` : '')
    + `<p style="margin:16px 0 0">${[meetupPage && `<a href="/${city.id}/meetups" style="${LINK}">${escapeHtml(city.name)} 모임 보기</a>`,
      business && `<a href="${business.path}" style="${LINK}">${escapeHtml(city.name)} 비즈니스 소식</a>`,
      `<a href="/visited${city.id === 'vancouver' ? '' : `?city=${city.id}`}" style="${LINK}">${escapeHtml(city.name)}에서 글링이 가 본 곳</a>`].filter(Boolean).join(' · ')}</p>`
    + pageList(city, pages, 1)
    + '</section>';
}

const hubHead = (path, meta) => [
  `<title data-rh="true">${escapeHtml(meta.title)}</title>`,
  `<meta name="description" content="${escapeHtml(meta.description)}" data-rh="true"/>`,
  '<meta name="robots" content="index, follow, max-image-preview:large" data-rh="true"/>',
  `<link rel="canonical" href="${PUBLIC_SITE}${path}" data-rh="true"/>`,
  // Base share tags for the new hub pages; the share-image work owns their final shape.
  `<meta property="og:type" content="website" data-rh="true"/><meta property="og:title" content="${escapeHtml(meta.title)}" data-rh="true"/><meta property="og:description" content="${escapeHtml(meta.description)}" data-rh="true"/><meta property="og:url" content="${PUBLIC_SITE}${path}" data-rh="true"/><meta property="og:image" content="${PUBLIC_SITE}/share-covers/post.png" data-rh="true"/>`,
].join('');

// Official facts for a hub's guide box. Only facts checked against the official page, with the date checked.
const HUB_GUIDES = {
  'vancouver/housing': { checked: '2026-10-30', items: [
    ['BC 주 렌트 인상 한도는 2027년 1월 1일부터 2.2%예요. 2026년에는 2.3%였어요.', 'https://news.gov.bc.ca/34197'],
    ['시큐리티 디파짓은 첫 달 렌트의 절반까지만 받을 수 있어요.', 'https://www2.gov.bc.ca/gov/content/housing-tenancy/residential-tenancies/starting-a-tenancy/deposits-and-fees'],
  ] },
};

function hubFaq(city, hub) {
  const topic = label(hub.tagSlug);
  return [
    { question: `이 글들은 누가 썼어요?`, answer: `${city.name}에 사는 글링 이용자가 ${topic} 주제로 직접 올린 공개 글이에요. 미리보기는 누구나 볼 수 있고, 전체 글은 로그인하면 읽을 수 있어요.` },
    { question: `${topic} 글은 어떻게 올려요?`, answer: `글링 앱에서 도시를 ${city.name}로 고르고 ${topic} 주제로 글을 쓰면 돼요. iPhone 앱은 App Store에서 무료로 받을 수 있고, Android는 비공개 테스트 중이에요.` },
  ];
}

function topicHubPage(template, city, hub, posts, hubs, cities) {
  const meta = publicCitySubpageMeta({ kind: 'topic', cityId: city.id, tagSlug: hub.tagSlug }, city.name);
  const name = TOPIC_HUBS[hub.tagSlug].name(city.name), topic = label(hub.tagSlug);
  const list = posts.filter(post => post.cityId === city.id && post.tagSlug === hub.tagSlug);
  const guide = HUB_GUIDES[`${city.id}/${hub.tagSlug}`], faq = hubFaq(city, hub);
  const crumbs = [['글링', '/'], [city.name, `/${city.id}`], [topic, hub.path]];
  const others = cities.filter(item => item.id !== city.id).map(item => hubs.get(`${item.id}/${hub.tagSlug}`) && [item, hubs.get(`${item.id}/${hub.tagSlug}`)]).filter(Boolean);
  const nearby = [...hubs.values()].filter(item => item.cityId === city.id && item.tagSlug !== hub.tagSlug).sort((a, b) => b.count - a.count).slice(0, 4);
  const body = `<section id="gling-static-hub" lang="ko" style="${SECTION}">`
    + breadcrumbHtml(crumbs.map(([text, path], index) => [text, index === crumbs.length - 1 ? null : path]))
    + `<h1 style="margin:0;font-size:26px;line-height:1.35">${escapeHtml(name)}</h1>`
    + `<p style="margin:8px 0 0">${escapeHtml(`${city.name} 한인들이 글링에 올린 ${topic} 이야기를 모았어요. 공개 글 ${list.length}개, 최근 글은 ${koreanDate(list[0]?.createdAt ?? list[0]?.lastmod)}에 올라왔어요.`)}</p>`
    + (guide ? `<aside style="margin:20px 0 0;padding:16px;border:1px solid #343443;border-radius:12px"><h2 style="margin:0 0 8px;font-size:17px">처음 방 구할 때 알아 둘 것</h2><ul style="margin:0;padding-left:20px">${guide.items.map(([text, source]) => `<li>${escapeHtml(text)} <a href="${source}" style="${LINK}" rel="noopener">BC 정부 안내</a></li>`).join('')}</ul><p style="margin:8px 0 0;font-size:13px;color:#B7B4C3">확인 날짜 ${guide.checked}</p></aside>` : '')
    + `<h2 style="margin:24px 0 8px;font-size:18px">${escapeHtml(`${city.name} ${topic} 이야기`)}</h2>${postItems(list)}`
    + `<h2 style="margin:24px 0 8px;font-size:18px">자주 묻는 질문</h2>${faq.map(item => `<h3 style="margin:12px 0 4px;font-size:16px">${escapeHtml(item.question)}</h3><p style="margin:0">${escapeHtml(item.answer)}</p>`).join('')}`
    + (others.length ? `<p style="margin:20px 0 0">다른 도시 ${escapeHtml(topic)}: ${others.map(([item, other]) => `<a href="${other.path}" style="${LINK}">${escapeHtml(item.name)}</a>`).join(' · ')}</p>` : '')
    + (nearby.length ? `<p style="margin:8px 0 0">${escapeHtml(city.name)} 다른 주제: ${nearby.map(item => `<a href="${item.path}" style="${LINK}">${escapeHtml(label(item.tagSlug))}</a>`).join(' · ')}</p>` : '')
    + `<p style="margin:8px 0 0"><a href="/${city.id}" style="${LINK}">${escapeHtml(city.name)} 한인 커뮤니티 전체 이야기</a></p>`
    + '</section>';
  const schema = collectionSchema(`${PUBLIC_SITE}${hub.path}`, name, meta.description, list, crumbs);
  schema['@graph'].push({ '@type': 'FAQPage', '@id': `${PUBLIC_SITE}${hub.path}#faq`, mainEntity: faq.map(item => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })) });
  return staticPage(template, hubHead(hub.path, meta) + ldScript(schema), body);
}

function cityPage(template, city, page, pages, posts) {
  const path = `/${city.id}/${page}`, meta = publicCitySubpageMeta({ kind: 'page', cityId: city.id, page }, city.name);
  const crumbs = [['글링', '/'], [city.name, `/${city.id}`], [`${page}쪽`, path]];
  const body = `<section id="gling-static-hub" lang="ko" style="${SECTION}">`
    + breadcrumbHtml([['글링', '/'], [city.name, `/${city.id}`], [`${page}쪽`, null]])
    + `<h1 style="margin:0;font-size:26px;line-height:1.35">${escapeHtml(`${city.name} 한인 커뮤니티 지난 이야기 ${page}쪽`)}</h1>`
    + `<div style="margin:16px 0 0">${postItems(posts)}</div>${pageList(city, pages, page)}`
    + '</section>';
  return staticPage(template, hubHead(path, meta) + ldScript(collectionSchema(`${PUBLIC_SITE}${path}`, `${city.name} 한인 커뮤니티 지난 이야기 ${page}쪽`, meta.description, posts, crumbs)), body);
}

export function meetupEvents(city, meetups, now = Date.now()) {
  return meetups.filter(item => item.cityId === city.id && activeMeetup(item, now));
}

function meetupPage(template, city, list) {
  const path = `/${city.id}/meetups`, meta = publicCitySubpageMeta({ kind: 'meetups', cityId: city.id }, city.name);
  const crumbs = [['글링', '/'], [city.name, `/${city.id}`], ['모임', path]];
  const when = room => [koreanDate(room.startsAt) || String(room.cadence ?? '').trim(), room.eventKind === 'once' ? '한 번 만나는 모임' : '계속 만나는 모임',
    Number.isSafeInteger(room.memberCount) && `${room.memberCount}명 참여${Number.isSafeInteger(room.capacity) && room.capacity > 0 ? ` / 정원 ${room.capacity}명` : ''}`].filter(Boolean).join(' · ');
  const body = `<section id="gling-static-hub" lang="ko" style="${SECTION}">`
    + breadcrumbHtml([['글링', '/'], [city.name, `/${city.id}`], ['모임', null]])
    + `<h1 style="margin:0;font-size:26px;line-height:1.35">${escapeHtml(`${city.name} 한인 모임`)}</h1>`
    + `<p style="margin:8px 0 0">${escapeHtml(`지금 참여 신청을 받는 ${city.name} 모임 ${list.length}개예요. 장소와 자세한 안내는 글링 앱에서 볼 수 있어요.`)}</p>`
    + `<ul style="margin:16px 0 0;padding-left:20px">${list.map(item => `<li id="m-${item.id}"><a href="/post?id=${item.id}&amp;invite=1" style="${LINK}" rel="nofollow">${escapeHtml(item.title)}</a> <small>${escapeHtml(when(item.room))}</small></li>`).join('')}</ul>`
    + `<p style="margin:16px 0 0"><a href="/${city.id}" style="${LINK}">${escapeHtml(city.name)} 한인 커뮤니티로 돌아가기</a></p>`
    + '</section>';
  // Guests never see a meetup's venue, so the location is the city itself.
  // Only dated meetups are Events (startDate is required); recurring groups without a date stay plain list items.
  const events = list.map(item => !isoDate(item.room.startsAt) ? { '@type': 'Thing', name: item.title, url: `${PUBLIC_SITE}${path}#m-${item.id}` } : ({ '@type': 'Event', name: item.title, url: `${PUBLIC_SITE}${path}#m-${item.id}`, startDate: isoDate(item.room.startsAt),
    ...(item.room.endsAt && isoDate(item.room.endsAt) ? { endDate: isoDate(item.room.endsAt) } : {}),
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode', eventStatus: 'https://schema.org/EventScheduled',
    location: { '@type': 'Place', name: city.englishName, address: { '@type': 'PostalAddress', addressLocality: city.englishName, addressRegion: city.province, addressCountry: 'CA' } },
    ...(item.host ? { organizer: { '@type': 'Person', name: item.host } } : {}),
    ...(Number.isSafeInteger(item.room.capacity) && item.room.capacity > 0 ? { maximumAttendeeCapacity: item.room.capacity } : {}) }));
  const schema = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'CollectionPage', '@id': `${PUBLIC_SITE}${path}`, url: `${PUBLIC_SITE}${path}`, name: `${city.name} 한인 모임`, inLanguage: 'ko', mainEntity: { '@type': 'ItemList', itemListElement: events.map((event, index) => ({ '@type': 'ListItem', position: index + 1, item: event })) } },
    { '@type': 'BreadcrumbList', itemListElement: crumbs.map(([name, item], index) => ({ '@type': 'ListItem', position: index + 1, name, item: `${PUBLIC_SITE}${item}` })) },
  ] };
  return staticPage(template, hubHead(path, meta) + ldScript(schema), body);
}

// GitHub Pages serves 404.html (HTTP 404) for unknown paths: send old post links and trailing slashes to the real page.
const LEGACY_REDIRECT = '<script>(function(l){var p=l.pathname,m=p.match(/^\\/(?:posts?|share)\\/([0-9a-fA-F-]{36})\\/?$/),t=m?"/posts/"+m[1].toLowerCase():p.length>1&&/\\/$/.test(p)?p.replace(/\\/+$/,""):null;if(t&&t!==p)l.replace(t+l.search+l.hash)})(location)</script>';

export function finishPublicWeb(directory = 'dist', posts = [], meetups = [], now = Date.now()) {
  // GitHub Pages serves this for app-only paths and existing /post/:id links.
  copyFileSync(join(directory, '+not-found.html'), join(directory, '404.html'));
  writeFileSync(join(directory, '404.html'), readFileSync(join(directory, '404.html'), 'utf8').replace(/<head[^>]*>/, match => `${match}${LEGACY_REDIRECT}`));
  const cities = CITIES.filter(city => city.state === 'open');
  const hubs = topicHubs(posts);
  const template = existsSync(join(directory, '+not-found.html')) ? readFileSync(join(directory, '+not-found.html'), 'utf8') : '';
  const shell = /<\/head>/.test(template) && /<body[^>]*>/.test(template);
  const newest = list => list.map(post => post.lastmod).filter(Boolean).sort().at(-1);
  const entries = [['/', newest(posts)]];
  const cityMeetups = new Map(cities.map(city => [city.id, meetupEvents(city, meetups, now)]));
  for (const city of cities) {
    const own = posts.filter(post => post.cityId === city.id), pages = Math.max(1, Math.ceil(own.length / CITY_PAGE_SIZE));
    entries.push([`/${city.id}`, newest(own)]);
    for (let page = 2; page <= pages && shell; page++) {
      const slice = own.slice((page - 1) * CITY_PAGE_SIZE, page * CITY_PAGE_SIZE);
      mkdirSync(join(directory, city.id), { recursive: true });
      writeFileSync(join(directory, city.id, `${page}.html`), cityPage(template, city, page, pages, slice));
      entries.push([`/${city.id}/${page}`, newest(slice)]);
    }
    for (const hub of [...hubs.values()].filter(item => item.cityId === city.id && shell)) {
      mkdirSync(join(directory, city.id), { recursive: true });
      writeFileSync(join(directory, city.id, `${TOPIC_HUBS[hub.tagSlug].slug}.html`), topicHubPage(template, city, hub, posts, hubs, cities));
      entries.push([hub.path, newest(own.filter(post => post.tagSlug === hub.tagSlug))]);
    }
    const events = cityMeetups.get(city.id);
    if (events.length && shell) {
      mkdirSync(join(directory, city.id), { recursive: true });
      writeFileSync(join(directory, city.id, 'meetups.html'), meetupPage(template, city, events));
      entries.push([`/${city.id}/meetups`, events.map(item => item.createdAt).filter(Boolean).sort().at(-1)]);
    }
  }
  const home = `<meta name="naver-site-verification" content="3840dfdac2db5fd4f65e9c9160c31225d7e05db5"/><link rel="alternate" type="application/rss+xml" title="글링 새 글" href="${PUBLIC_SITE}/rss.xml"/>`;
  const languages = `<link rel="alternate" hreflang="ko" href="${PUBLIC_SITE}/"/><link rel="alternate" hreflang="en" href="${PUBLIC_SITE}/en"/><link rel="alternate" hreflang="x-default" href="${PUBLIC_SITE}/"/>`;
  for (const [file, city] of [['index.html', null], ...cities.map(city => [`${city.id}.html`, city])]) {
    const target = join(directory, file);
    if (!existsSync(target)) continue;
    const own = city ? posts.filter(post => post.cityId === city.id) : [];
    const kept = city ? cityBlock(city, cityFacts(city, posts, meetups, now), hubs, Math.ceil(own.length / CITY_PAGE_SIZE), cityMeetups.get(city.id).length > 0) : '';
    const schema = city ? ldScript(collectionSchema(`${PUBLIC_SITE}/${city.id}`, `${city.name} 한인 커뮤니티`, publicAboutGling, own.slice(0, CITY_PAGE_SIZE), [['글링', '/'], [city.name, `/${city.id}`]])) : '';
    const html = readFileSync(target, 'utf8')
      .replace('</head>', `${home}${city ? '' : languages}${schema}</head>`)
      .replace(/<body[^>]*>/, match => `${match}${kept}${staticHub(cities, posts, city)}`);
    writeFileSync(target, html);
    // /vancouver/ (with the slash) now hits the folder above; serve the same page there, canonical to /vancouver.
    if (city && existsSync(join(directory, city.id))) writeFileSync(join(directory, city.id, 'index.html'), html);
  }
  // /posts redirects to /posts/ (a folder); there is no list page, so point it home.
  if (existsSync(join(directory, 'posts'))) writeFileSync(join(directory, 'posts', 'index.html'), redirectPage(`${PUBLIC_SITE}/`, '글링 | 캐나다 한인 커뮤니티'));
  const meetupsFile = join(directory, 'meetups.html');
  if (existsSync(meetupsFile)) {
    const all = cities.map(city => [city, cityMeetups.get(city.id)]).filter(([, list]) => list.length);
    const copy = `<section id="gling-static-home" lang="ko" style="${SECTION}"><p style="margin:0">밴쿠버·토론토·몬트리올 한인들이 글링에서 여는 모임이에요. 참여 신청과 대화는 글링 앱에서 해요.</p>${all.map(([city, list]) => `<h2 style="margin:20px 0 8px;font-size:18px"><a href="/${city.id}/meetups" style="${LINK}">${escapeHtml(city.name)} 한인 모임 ${list.length}개</a></h2><ul style="margin:0;padding-left:20px">${list.slice(0, 10).map(item => `<li>${escapeHtml(item.title)} <small>${escapeHtml(koreanDate(item.room.startsAt) || String(item.room.cadence ?? '').trim())}</small></li>`).join('')}</ul>`).join('')}</section>`;
    writeFileSync(meetupsFile, readFileSync(meetupsFile, 'utf8').replace(/<body[^>]*>/, match => `${match}${copy}`));
  }
  const day = value => { const time = Date.parse(value); return Number.isFinite(time) ? `<lastmod>${new Date(time).toISOString().slice(0, 10)}</lastmod>` : ''; };
  // `/?city=` pages canonicalize to `/`, so only distinct pages are listed. /visited canonicalizes to itself for the first city.
  const paths = [...entries, ['/meetups', newest(meetups.map(item => ({ lastmod: item.createdAt })))], ['/visited'], ['/faq'], ['/en'], ['/terms'], ['/privacy'], ['/account-deletion'], ['/child-safety']];
  writeFileSync(join(directory, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(([path, lastmod]) => `<url><loc>${PUBLIC_SITE}${path}</loc>${day(lastmod)}</url>`).join('')}${posts.map(post => `<url><loc>${publicPostUrl(post.id)}</loc>${day(post.lastmod)}</url>`).join('')}</urlset>\n`);
  const protectedPaths = ['/merchant/', '/auth/', '/admin', '/chat', '/compose', '/profile', '/notifications', '/user/', '/meetup-create', '/meetup-join', '/meetup-application', '/meetup-profile'];
  writeFileSync(join(directory, 'robots.txt'), `User-agent: *\nAllow: /\n${protectedPaths.map(path => `Disallow: ${path}`).join('\n')}\n\nSitemap: ${PUBLIC_SITE}/sitemap.xml\n`);
  const recent = city => posts.filter(post => post.cityId === city.id).slice(0, 20)
    .map(post => `- [${String(post.title).replace(/[\\[\]\n\r]/g, ' ')}](${publicPostUrl(post.id)})${post.teaser ? `: ${String(post.teaser).replace(/[\n\r]/g, ' ')}` : ''}`).join('\n');
  const facts = [
    `- 열린 도시: ${cities.map(city => `${city.name}(${city.englishName})`).join(', ')}`,
    '- 할 수 있는 것: 동네 이야기, 맛집·가 볼 곳 지도, 렌트·구인·중고 거래, 축제·공연 동행, 소모임 만들기와 참여, 한국어↔영어 번역 보기',
    '- 요금: 무료, 일부 기능은 인앱 구매',
    '- 앱: iPhone은 App Store에서 받을 수 있고, Android는 비공개 테스트 중',
    `- 도시 페이지: ${cities.map(city => `[${city.name} 한인 커뮤니티](${PUBLIC_SITE}/${city.id})`).join(' · ')}`,
    ...(hubs.size ? [`- 주제별 페이지: ${[...hubs.values()].map(hub => `[${TOPIC_HUBS[hub.tagSlug].name(CITIES.find(city => city.id === hub.cityId).name)}](${PUBLIC_SITE}${hub.path})`).join(' · ')}`] : []),
    `- 비즈니스: 가게 프로필, 소식·채용 글, 영수증 인증 후기를 글링에서 관리할 수 있어요. 비즈니스 로그인은 ${PUBLIC_SITE}/merchant/ 에서 해요.`,
  ].join('\n');
  // Core answers from the /faq page (src/components/public-web/metadata.ts FAQ_ITEMS), kept short for AI answers.
  const faq = [
    ['글링이 뭐예요?', '밴쿠버·토론토·몬트리올에 사는 한인을 위한 커뮤니티 앱이에요. 동네 이야기를 나누고, 축제나 콘서트에 같이 갈 사람을 찾고, 모임을 만들고 참여할 수 있어요.'],
    ['가입하지 않고도 볼 수 있나요?', '공개 게시판은 웹에서 미리보기로 둘러볼 수 있어요. 글 전체를 읽으려면 로그인하고, 댓글과 모임 참여는 앱에서 해요.'],
    ['어떤 도시에서 쓸 수 있나요?', '지금은 밴쿠버, 토론토, 몬트리올에서 쓸 수 있어요.'],
    ['글링은 무료인가요?', '무료로 쓸 수 있어요. 일부 기능은 인앱 구매가 있어요.'],
  ].map(([question, answer]) => `- **${question}** ${answer}`).join('\n');
  const updated = new Date(now).toISOString().slice(0, 10);
  writeFileSync(join(directory, 'llms.txt'), `# 글링 Gling: 캐나다 한인 커뮤니티 (${cities.map(city => city.name).join('·')})\n\n마지막 갱신 ${updated}\n\n> ${publicAboutGlingEn}\n\n${publicDisambiguation}\n\n${publicAboutGling}\n\n${facts}\n\n## 자주 묻는 질문\n\n${faq}\n\n공개 미리보기는 작성자의 게시물 정보이며 글링의 공식 사실 확인이나 비즈니스 소유 인증을 뜻하지 않습니다. 게스트는 허용된 대표 이미지 한 장과 짧은 소개를 볼 수 있습니다. 로그인하거나 정상 가입을 마치면 현재 공개 상태와 열람 권한을 확인한 뒤 공개 글의 전체 본문을 웹에서 읽을 수 있습니다. 댓글 작성·대화·모임 참여는 앱에서 이용합니다. 아래 원문은 현재 공개 상태를 조회합니다. 삭제·비공개 글의 내용, 개인 대화와 계정 정보는 제공하지 않습니다. 공개 미리보기를 전체 원문으로 간주하지 마세요.\n\n## 공개 이야기\n\n- [글링 공개 게시판](${PUBLIC_SITE}/)\n${cities.map(city => `- [${city.name} 공개 미리보기 · 다음 페이지](${PUBLIC_SOURCE}?format=markdown&city=${city.id})`).join('\n')}\n${cities.map(city => recent(city) && `\n## ${city.name} 최근 글\n\n${recent(city)}\n`).filter(Boolean).join('')}\n## 이용 안내\n\n- [자주 묻는 질문](${PUBLIC_SITE}/faq)\n- [English](${PUBLIC_SITE}/en)\n- [iPhone 앱](https://apps.apple.com/ca/app/id6809273242)\n- [이용약관](${PUBLIC_SITE}/terms)\n- [개인정보처리방침](${PUBLIC_SITE}/privacy)\n- [계정 삭제](${PUBLIC_SITE}/account-deletion)\n`);
  // Naver Search Advisor and other feed readers pick up new public posts from this (teasers only, same as the post pages).
  const date = value => { const time = Date.parse(value); return Number.isFinite(time) ? `<pubDate>${new Date(time).toUTCString()}</pubDate>` : ''; };
  const item = ({ title, link, description, lastmod }) => `<item><title>${escapeHtml(title)}</title><link>${link}</link><guid isPermaLink="true">${link}</guid><description>${escapeHtml(description)}</description>${date(lastmod)}</item>`;
  writeFileSync(join(directory, 'rss.xml'), `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>글링 | 캐나다 한인 커뮤니티</title><link>${PUBLIC_SITE}/</link><description>${escapeHtml(publicAboutGling)}</description><language>ko</language>${[
    ...cities.map(city => ({ title: `${city.name} 한인 커뮤니티 · 동네 이야기와 모임`, link: `${PUBLIC_SITE}/${city.id}`, description: `${city.name}에 사는 한인들이 나누는 동네 이야기, 맛집, 렌트·구인·중고, 소모임을 글링에서 둘러보세요.`, lastmod: posts.find(post => post.cityId === city.id)?.lastmod })),
    ...posts.slice(0, 100).map(post => ({ title: post.title, link: publicPostUrl(post.id), description: post.teaser || [post.city, post.label].filter(Boolean).join(' · '), lastmod: post.lastmod })),
  ].map(item).join('')}</channel></rss>\n`);
  return { hubs, sitemap: paths.length + posts.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2] ?? 'dist';
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL, key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // Only the Pages deploy prerenders (CI exports against a stub project); there a failed fetch fails the deploy and keeps the previous site live.
  const prerender = process.env.GLING_PRERENDER_POSTS === '1';
  if (prerender && (!url || !key)) throw new Error('Supabase public env is required to prerender public posts');
  const { posts, meetups } = prerender ? await prerenderPublicPosts(directory, { url: url.replace(/\/+$/, ''), key, cities: CITIES.filter(city => city.state === 'open').map(city => city.id), searchToken: process.env.GLING_SEARCH_BUILD_TOKEN }) : { posts: [], meetups: [] };
  const { hubs } = finishPublicWeb(directory, posts, meetups);
  console.log(`Prerendered ${posts.length} public posts and ${hubs.size} topic hubs.`);
}
