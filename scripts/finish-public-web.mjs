import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITIES, TAGS } from '../src/lib/mock.ts';
import {
  CITY_PAGE_SIZE, jsonLd, PUBLIC_SITE, publicSiteName, PUBLIC_SOURCE, publicAboutGling, publicAboutGlingEn, publicCitySubpageMeta, publicCompanyUrl, publicDisambiguation, publicImmigrationMeta, PUBLIC_PLAY_STORE, publicPostUrl, TOPIC_HUBS,
} from '../src/lib/public-seo.ts';
import { breadcrumbHtml, escapeHtml, isoDate, koreanDate, loadPublicPosts, postCover, prerenderPublicPosts, redirectPage, withStaticPage, topicHubs } from './prerender-public-posts.mjs';
import { prerenderPublicCompanies } from './prerender-public-companies.mjs';
import { prerenderEnglishPosts } from './english-posts.mjs';
import { loadPlaceCatalog, loadPlaceRatings, publicPlaces, writePublicPlaces } from './prerender-public-places.mjs';

const LINK = 'color:#CBB9FF';
const SECTION = 'max-width:720px;margin:24px auto;padding:20px;color:#F6F3F0;font:16px/1.6 system-ui,sans-serif';
const label = slug => TAGS.find(tag => tag.slug === slug)?.label ?? slug;
const ldScript = value => `<script type="application/ld+json">${jsonLd(value)}</script>`;

// Crawler copy for the home and city hubs; the reader removes #gling-static-home once the live feed renders.
function staticHub(cities, posts, city) {
  const list = (city ? posts.filter(post => post.cityId === city.id) : posts).slice(0, 30);
  return `<section id="gling-static-home" lang="ko" style="${SECTION}">`
    + `<p style="margin:0">${escapeHtml(publicAboutGling)}</p>`
    + `<p style="margin:12px 0 0">${cities.map(item => `<a href="/${item.id}" style="${LINK}">${escapeHtml(item.name)} 한인 커뮤니티</a>`).join(' · ')} · <a href="/meetups" style="${LINK}">한인 모임·소모임</a> · <a href="/immigration" style="${LINK}">캐나다 이민·유학 길잡이</a> · <a href="/faq" style="${LINK}">자주 묻는 질문</a> · <a href="https://apps.apple.com/ca/app/id6809273242" style="${LINK}">iPhone 앱 받기</a> · <a href="${PUBLIC_PLAY_STORE}" style="${LINK}">Android 앱 받기</a></p>`
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

function collectionSchema(url, name, description, posts, crumbs, lastReviewed) {
  return { '@context': 'https://schema.org', '@graph': [
    { '@type': 'CollectionPage', '@id': url, url, name, description, inLanguage: 'ko', isPartOf: { '@id': `${PUBLIC_SITE}/#website` }, ...(lastReviewed ? { lastReviewed } : {}),
      ...(posts.length ? { mainEntity: { '@type': 'ItemList', numberOfItems: posts.length, itemListElement: posts.map((post, index) => ({ '@type': 'ListItem', position: index + 1, url: publicPostUrl(post.id), name: post.title })) } } : {}) },
    { '@type': 'BreadcrumbList', itemListElement: crumbs.map(([name, path], index) => ({ '@type': 'ListItem', position: index + 1, name, item: `${PUBLIC_SITE}${path}` })) },
  ] };
}

// Kept on the city page (the reader moves it next to the live feed) so the city's own facts and paths stay visible.
function cityBlock(city, facts, hubs, pages, hasPlaces = false) {
  const own = [...hubs.values()].filter(hub => hub.cityId === city.id).sort((a, b) => b.count - a.count);
  const business = own.find(hub => hub.tagSlug === 'business');
  return `<section id="gling-static-city" lang="ko" style="${SECTION}">`
    + breadcrumbHtml([['글링', '/'], [city.name, null]])
    + `<p style="margin:0">${escapeHtml(factSentence(city, facts))}</p>`
    + (own.length ? `<h2 style="margin:20px 0 8px;font-size:17px">${escapeHtml(city.name)} 주제별 이야기</h2><p style="margin:0">${own.map(hub => `<a href="${hub.path}" style="${LINK}">${escapeHtml(label(hub.tagSlug))} ${hub.count}</a>`).join(' · ')}</p>` : '')
    + `<p style="margin:16px 0 0">${[`<a href="/${city.id}/meetups" style="${LINK}">${escapeHtml(city.name)} 모임·소모임</a>`,
      hubs.has(`${city.id}/settlement`) && `<a href="/${city.id}/settlement" style="${LINK}">${escapeHtml(city.name)} 정착 가이드</a>`,
      business && `<a href="${business.path}" style="${LINK}">${escapeHtml(city.name)} 비즈니스 소식</a>`,
      hasPlaces && `<a href="/${city.id}/places" style="${LINK}">${escapeHtml(city.name)} 맛집·카페·가 볼 곳</a>`,
      `<a href="/visited${city.id === 'vancouver' ? '' : `?city=${city.id}`}" style="${LINK}">${escapeHtml(city.name)}에서 글링이 가 본 곳</a>`].filter(Boolean).join(' · ')}</p>`
    + pageList(city, pages, 1)
    + '</section>';
}

const hubHead = (path, meta, cover) => [
  `<title data-rh="true">${escapeHtml(meta.title)}</title>`,
  `<meta name="description" content="${escapeHtml(meta.description)}" data-rh="true"/>`,
  '<meta name="robots" content="index, follow, max-image-preview:large" data-rh="true"/>',
  `<link rel="canonical" href="${PUBLIC_SITE}${path}" data-rh="true"/>`,
  // The shell's smart banner is stripped with the other page tags; hubs open the app's home.
  '<meta name="apple-itunes-app" content="app-id=6809273242"/>',
  // Same share scheme as the posts: the city's (or meetup) 1200×630 cover.
  `<meta property="og:type" content="website" data-rh="true"/><meta property="og:site_name" content="${escapeHtml(publicSiteName())}" data-rh="true"/><meta property="og:locale" content="ko_KR" data-rh="true"/>`,
  `<meta property="og:title" content="${escapeHtml(meta.title)}" data-rh="true"/><meta property="og:description" content="${escapeHtml(meta.description)}" data-rh="true"/><meta property="og:url" content="${PUBLIC_SITE}${path}" data-rh="true"/>`,
  `<meta property="og:image" content="${cover}" data-rh="true"/><meta property="og:image:width" content="1200" data-rh="true"/><meta property="og:image:height" content="630" data-rh="true"/><meta property="og:image:alt" content="${escapeHtml(meta.title)}" data-rh="true"/>`,
  `<meta name="twitter:card" content="summary_large_image" data-rh="true"/><meta name="twitter:title" content="${escapeHtml(meta.title)}" data-rh="true"/><meta name="twitter:description" content="${escapeHtml(meta.description)}" data-rh="true"/>`,
].join('');

// Official facts for a hub's guide box. Only facts checked against the official page, with the date checked.
// Settlement items say what each official page is for; no fees, waiting times or eligibility numbers (they change).
const SIN = ['SIN(사회보장번호)은 캐나다에서 일하거나 정부 혜택을 신청할 때 필요해요.', 'https://www.canada.ca/en/employment-social-development/services/sin.html', 'Service Canada SIN 안내'];
const NEWCOMER_SERVICES = ['영주권자나 영주권 승인을 받은 사람 등은 정부 지원 정착 서비스를 무료로 받을 수 있어요. 내가 대상인지, 가까운 기관이 어디 있는지는 IRCC 페이지에서 찾아볼 수 있어요.', 'https://ircc.canada.ca/english/newcomers/services/index.asp', 'IRCC 무료 정착 서비스 찾기'];
export const HUB_GUIDES = {
  'vancouver/housing': { checked: '2026-10-30', title: '처음 방 구할 때 알아 둘 것', items: [
    ['BC 주 렌트 인상 한도는 2027년 1월 1일부터 2.2%예요. 2026년에는 2.3%였어요.', 'https://news.gov.bc.ca/34197', 'BC 정부 안내'],
    ['시큐리티 디파짓은 첫 달 렌트의 절반까지만 받을 수 있어요.', 'https://www2.gov.bc.ca/gov/content/housing-tenancy/residential-tenancies/starting-a-tenancy/deposits-and-fees', 'BC 정부 안내'],
  ] },
  'vancouver/settlement': { checked: '2026-11-01', title: '밴쿠버에 와서 먼저 챙길 것', items: [
    ['BC에 살면 MSP(BC 의료보험)에 가입하게 돼요. 캐나다에 막 왔다면 도착하자마자 신청하고, 보장이 시작될 때까지는 개인 보험을 따로 들어 두라고 BC 정부가 안내해요.', 'https://www2.gov.bc.ca/gov/content/health/health-drug-coverage/msp/bc-residents/eligibility-and-enrolment/how-to-enrol', 'BC 정부 MSP 신청 안내'],
    SIN,
    ['한국에서 딴 운전면허를 BC 면허로 바꾸는 방법과 운전 경력을 증명할 서류는 ICBC 페이지에 정리돼 있어요.', 'https://www.icbc.com/driver-licensing/moving-bc', 'ICBC 면허 안내'],
    NEWCOMER_SERVICES,
  ] },
  'toronto/settlement': { checked: '2026-11-01', title: '토론토에 와서 먼저 챙길 것', items: [
    ['온타리오 의료보험(OHIP)은 신청해서 승인되면 건강카드가 나오고, 병원에 갈 때마다 이 카드를 보여 줘야 해요. 신청 방법은 온타리오 정부 페이지에 나와 있어요.', 'https://www.ontario.ca/page/apply-ohip-and-get-health-card', '온타리오 정부 OHIP 안내'],
    SIN,
    ['한국 운전면허를 온타리오 면허로 바꾸는 절차와 챙길 서류도 온타리오 정부가 따로 정리해 뒀어요.', 'https://www.ontario.ca/page/exchange-out-province-drivers-licence', '온타리오 정부 면허 교환 안내'],
    NEWCOMER_SERVICES,
  ] },
  'montreal/settlement': { checked: '2026-11-01', title: '몬트리올에 와서 먼저 챙길 것', items: [
    ['퀘벡 의료보험은 RAMQ에 등록해야 받을 수 있어요. 새로 온 사람이 온라인으로 등록하는 방법은 RAMQ 페이지에 있어요.', 'https://www.ramq.gouv.qc.ca/en/newcomers-register-health-insurance-online', 'RAMQ 등록 안내'],
    SIN,
    ['한국 면허로 퀘벡 면허를 받는 절차는 SAAQ 페이지에서 볼 수 있어요.', 'https://saaq.gouv.qc.ca/en/drivers-licences/drivers-licence-issued-outside-quebec', 'SAAQ 면허 안내'],
    ['퀘벡은 주정부가 이민자 정착을 돕는 무료 상담 서비스(Accompagnement Québec)를 따로 운영해요.', 'https://www.quebec.ca/en/immigration/integration-service-for-immigrants', '퀘벡 정부 정착 지원 안내'],
    ['퀘벡 정부가 여는 무료 프랑스어 수업도 있어요. 누가 들을 수 있는지는 수업 안내 페이지에 적혀 있어요.', 'https://www.quebec.ca/en/education/learn-french', '퀘벡 정부 프랑스어 수업 안내'],
  ] },
};

// A guide-only hub (no posts yet) skips the first question: there are no posts to ask about.
function hubFaq(city, hub, hasPosts = true) {
  const topic = label(hub.tagSlug);
  return [
    hasPosts && { question: `이 글들은 누가 썼어요?`, answer: `${city.name}에 사는 글링 이용자가 ${topic} 주제로 직접 올린 공개 글이에요. 미리보기는 누구나 볼 수 있고, 전체 글은 로그인하면 읽을 수 있어요.` },
    { question: `${topic} 글은 어떻게 올려요?`, answer: `글링 앱에서 도시를 ${city.name}로 고르고 ${topic} 주제로 글을 쓰면 돼요. 앱은 App Store와 Google Play에서 무료로 받을 수 있어요.` },
  ].filter(Boolean);
}

function topicHubPage(template, city, hub, posts, hubs, cities) {
  const meta = publicCitySubpageMeta({ kind: 'topic', cityId: city.id, tagSlug: hub.tagSlug }, city.name);
  const name = TOPIC_HUBS[hub.tagSlug].name(city.name), topic = label(hub.tagSlug);
  const list = posts.filter(post => post.cityId === city.id && post.tagSlug === hub.tagSlug);
  const guide = HUB_GUIDES[`${city.id}/${hub.tagSlug}`], faq = hubFaq(city, hub, list.length > 0);
  const crumbs = [['글링', '/'], [city.name, `/${city.id}`], [topic, hub.path]];
  const others = cities.filter(item => item.id !== city.id).map(item => hubs.get(`${item.id}/${hub.tagSlug}`) && [item, hubs.get(`${item.id}/${hub.tagSlug}`)]).filter(Boolean);
  const nearby = [...hubs.values()].filter(item => item.cityId === city.id && item.tagSlug !== hub.tagSlug).sort((a, b) => b.count - a.count).slice(0, 4);
  const body = `<section id="gling-static-hub" lang="ko" style="${SECTION}">`
    + breadcrumbHtml(crumbs.map(([text, path], index) => [text, index === crumbs.length - 1 ? null : path]))
    + `<h1 style="margin:0;font-size:26px;line-height:1.35">${escapeHtml(name)}</h1>`
    + `<p style="margin:8px 0 0">${escapeHtml(list.length ? `${city.name} 한인들이 글링에 올린 ${topic} 이야기를 모았어요. 공개 글 ${list.length}개, 최근 글은 ${koreanDate(list[0]?.createdAt ?? list[0]?.lastmod)}에 올라왔어요.`
      : `${city.name}에 와서 처음 챙길 것들을 정부 공식 페이지 링크로 정리했어요. ${topic} 이야기가 올라오면 이 아래에 모여요.`)}</p>`
    + (guide ? `<aside style="margin:20px 0 0;padding:16px;border:1px solid #343443;border-radius:12px"><h2 style="margin:0 0 8px;font-size:17px">${escapeHtml(guide.title)}</h2><ul style="margin:0;padding-left:20px;display:grid;gap:8px">${guide.items.map(([text, url, name]) => `<li>${escapeHtml(text)} <a href="${url}" style="${LINK}" rel="noopener">${escapeHtml(name)}</a></li>`).join('')}</ul><p style="margin:8px 0 0;font-size:13px;color:#B7B4C3">확인 날짜 ${guide.checked}</p></aside>` : '')
    + (list.length ? `<h2 style="margin:24px 0 8px;font-size:18px">${escapeHtml(`${city.name} ${topic} 이야기`)}</h2>${postItems(list)}` : '')
    + `<h2 style="margin:24px 0 8px;font-size:18px">자주 묻는 질문</h2>${faq.map(item => `<h3 style="margin:12px 0 4px;font-size:16px">${escapeHtml(item.question)}</h3><p style="margin:0">${escapeHtml(item.answer)}</p>`).join('')}`
    + (others.length ? `<p style="margin:20px 0 0">다른 도시 ${escapeHtml(topic)}: ${others.map(([item, other]) => `<a href="${other.path}" style="${LINK}">${escapeHtml(item.name)}</a>`).join(' · ')}</p>` : '')
    + (nearby.length ? `<p style="margin:8px 0 0">${escapeHtml(city.name)} 다른 주제: ${nearby.map(item => `<a href="${item.path}" style="${LINK}">${escapeHtml(label(item.tagSlug))}</a>`).join(' · ')}</p>` : '')
    + (['settlement', 'education'].includes(hub.tagSlug) ? `<p style="margin:8px 0 0"><a href="/immigration" style="${LINK}">캐나다 이민·유학·배우자 비자 길잡이</a></p>` : '')
    + `<p style="margin:8px 0 0"><a href="/${city.id}" style="${LINK}">${escapeHtml(city.name)} 한인 커뮤니티 전체 이야기</a></p>`
    + '</section>';
  const schema = collectionSchema(`${PUBLIC_SITE}${hub.path}`, name, meta.description, list, crumbs, guide?.checked);
  schema['@graph'].push({ '@type': 'FAQPage', '@id': `${PUBLIC_SITE}${hub.path}#faq`, mainEntity: faq.map(item => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })) });
  return withStaticPage(template, hubHead(hub.path, meta, postCover(city.id)) + ldScript(schema), body);
}

function cityPage(template, city, page, pages, posts) {
  const path = `/${city.id}/${page}`, meta = publicCitySubpageMeta({ kind: 'page', cityId: city.id, page }, city.name);
  const crumbs = [['글링', '/'], [city.name, `/${city.id}`], [`${page}쪽`, path]];
  const body = `<section id="gling-static-hub" lang="ko" style="${SECTION}">`
    + breadcrumbHtml([['글링', '/'], [city.name, `/${city.id}`], [`${page}쪽`, null]])
    + `<h1 style="margin:0;font-size:26px;line-height:1.35">${escapeHtml(`${city.name} 한인 커뮤니티 지난 이야기 ${page}쪽`)}</h1>`
    + `<div style="margin:16px 0 0">${postItems(posts)}</div>${pageList(city, pages, page)}`
    + '</section>';
  return withStaticPage(template, hubHead(path, meta, postCover(city.id)) + ldScript(collectionSchema(`${PUBLIC_SITE}${path}`, `${city.name} 한인 커뮤니티 지난 이야기 ${page}쪽`, meta.description, posts, crumbs)), body);
}

export function meetupEvents(city, meetups, now = Date.now()) {
  return meetups.filter(item => item.cityId === city.id && activeMeetup(item, now));
}

// Written for every open city, also with no meetup open right now (owner 2026-11-01): the page explains how meetups work instead of 404.
function meetupPage(template, city, list, hubs, cities) {
  const path = `/${city.id}/meetups`, meta = publicCitySubpageMeta({ kind: 'meetups', cityId: city.id }, city.name);
  const crumbs = [['글링', '/'], [city.name, `/${city.id}`], ['모임', path]];
  const festival = hubs.get(`${city.id}/festival`);
  const when = room => [koreanDate(room.startsAt) || String(room.cadence ?? '').trim(), room.eventKind === 'once' ? '한 번 만나는 모임' : '계속 만나는 모임',
    Number.isSafeInteger(room.memberCount) && `${room.memberCount}명 참여${Number.isSafeInteger(room.capacity) && room.capacity > 0 ? ` / 정원 ${room.capacity}명` : ''}`].filter(Boolean).join(' · ');
  const body = `<section id="gling-static-hub" lang="ko" style="${SECTION}">`
    + breadcrumbHtml([['글링', '/'], [city.name, `/${city.id}`], ['모임', null]])
    + `<h1 style="margin:0;font-size:26px;line-height:1.35">${escapeHtml(`${city.name} 한인 모임·소모임`)}</h1>`
    + `<p style="margin:8px 0 0">${escapeHtml(`${city.name}에 사는 한인들이 운동이나 취미, 여행처럼 마음 맞는 사람끼리 모이는 소모임을 글링에서 열기도 하고 들어가기도 해요. 축제나 공연에 같이 갈 동행도 여기서 구해요.`)}</p>`
    + (list.length
      ? `<h2 style="margin:24px 0 8px;font-size:18px">${escapeHtml(`지금 신청받는 ${city.name} 모임 ${list.length}개`)}</h2><ul style="margin:0;padding-left:20px">${list.map(item => `<li id="m-${item.id}"><a href="/post?id=${item.id}&amp;invite=1" style="${LINK}" rel="nofollow">${escapeHtml(item.title)}</a> <small>${escapeHtml(when(item.room))}</small></li>`).join('')}</ul><p style="margin:8px 0 0">장소와 자세한 안내는 글링 앱에서 볼 수 있어요.</p>`
      : `<div style="margin:20px 0 0;padding:16px;border:1px solid #343443;border-radius:12px"><h2 style="margin:0 0 6px;font-size:17px">${escapeHtml(`지금 신청받는 ${city.name} 모임은 없어요`)}</h2><p style="margin:0">${escapeHtml(`하고 싶은 모임이 있으면 글링 앱에서 직접 열면 돼요. 새 모임은 하루에 한 번 이 페이지에도 올라와요.`)}</p><p style="margin:10px 0 0"><a href="https://apps.apple.com/ca/app/id6809273242" style="${LINK}">iPhone 앱 받기</a> · <a href="${PUBLIC_PLAY_STORE}" style="${LINK}">Android 앱 받기</a></p></div>`)
    + `<h2 style="margin:24px 0 8px;font-size:18px">글링 모임은 이렇게 해요</h2><ul style="margin:0;padding-left:20px;display:grid;gap:6px">`
    + `<li>한 번 만나고 끝나는 모임도 있고, 매주 토요일처럼 정해 둔 날마다 만나는 정기 모임도 있어요.</li>`
    + `<li>모임을 여는 사람이 날짜와 정원을 정하고, 신청이 오면 직접 보고 받아 주고, 그러면 앱에서 모임 대화에 같이 들어가요.</li>`
    + `<li>모임 장소는 로그인한 사람에게만 보여요.</li></ul>`
    + (festival ? `<p style="margin:16px 0 0">${escapeHtml(`축제나 공연에 같이 갈 사람을 구하는 글은`)} <a href="${festival.path}" style="${LINK}">${escapeHtml(TOPIC_HUBS.festival.name(city.name))}</a>${escapeHtml('에 따로 모여 있어요.')}</p>` : '')
    + `<p style="margin:16px 0 0">다른 도시 모임: ${cities.filter(item => item.id !== city.id).map(item => `<a href="/${item.id}/meetups" style="${LINK}">${escapeHtml(item.name)}</a>`).join(' · ')}</p>`
    + `<p style="margin:8px 0 0"><a href="/${city.id}" style="${LINK}">${escapeHtml(city.name)} 한인 커뮤니티로 돌아가기</a></p>`
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
    { '@type': 'CollectionPage', '@id': `${PUBLIC_SITE}${path}`, url: `${PUBLIC_SITE}${path}`, name: `${city.name} 한인 모임·소모임`, description: meta.description, inLanguage: 'ko', isPartOf: { '@id': `${PUBLIC_SITE}/#website` },
      ...(events.length ? { mainEntity: { '@type': 'ItemList', itemListElement: events.map((event, index) => ({ '@type': 'ListItem', position: index + 1, item: event })) } } : {}) },
    { '@type': 'BreadcrumbList', itemListElement: crumbs.map(([name, item], index) => ({ '@type': 'ListItem', position: index + 1, name, item: `${PUBLIC_SITE}${item}` })) },
  ] };
  return withStaticPage(template, hubHead(path, meta, `${PUBLIC_SITE}/share-covers/meetup.png`) + ldScript(schema), body);
}

// GitHub Pages serves 404.html (HTTP 404) for unknown paths: send old post links and trailing slashes to the real page.
const LEGACY_REDIRECT = '<script>(function(l){var p=l.pathname,m=p.match(/^\\/(?:posts?|share)\\/([0-9a-fA-F-]{36})\\/?$/),t=m?"/posts/"+m[1].toLowerCase():p.length>1&&/\\/$/.test(p)?p.replace(/\\/+$/,""):null;if(t&&t!==p)l.replace(t+l.search+l.hash)})(location)</script>';

export function finishPublicWeb(directory = 'dist', posts = [], companies = [], { meetups = [], places = [], catalog = null, now = Date.now() } = {}) {
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
    if (shell) {
      mkdirSync(join(directory, city.id), { recursive: true });
      writeFileSync(join(directory, city.id, 'meetups.html'), meetupPage(template, city, events, hubs, cities));
      entries.push([`/${city.id}/meetups`, events.map(item => item.createdAt).filter(Boolean).sort().at(-1)]);
    }
  }
  // Every catalog city's places with an intro, post, review or Gling visit (scripts/prerender-public-places.mjs).
  if (shell) entries.push(...writePublicPlaces(directory, template, places, catalog));
  const home = `<meta name="naver-site-verification" content="3840dfdac2db5fd4f65e9c9160c31225d7e05db5"/><link rel="alternate" type="application/rss+xml" title="글링 새 글" href="${PUBLIC_SITE}/rss.xml"/>`;
  const languages = `<link rel="alternate" hreflang="ko" href="${PUBLIC_SITE}/"/><link rel="alternate" hreflang="en" href="${PUBLIC_SITE}/en"/><link rel="alternate" hreflang="x-default" href="${PUBLIC_SITE}/"/>`;
  for (const [file, city] of [['index.html', null], ...cities.map(city => [`${city.id}.html`, city])]) {
    const target = join(directory, file);
    if (!existsSync(target)) continue;
    const own = city ? posts.filter(post => post.cityId === city.id) : [];
    const kept = city ? cityBlock(city, cityFacts(city, posts, meetups, now), hubs, Math.ceil(own.length / CITY_PAGE_SIZE), shell && places.some(entry => entry.cityId === city.id)) : '';
    const schema = city ? ldScript(collectionSchema(`${PUBLIC_SITE}/${city.id}`, `${city.name} 한인 커뮤니티`, publicAboutGling, own.slice(0, CITY_PAGE_SIZE), [['글링', '/'], [city.name, `/${city.id}`]])) : '';
    const html = readFileSync(target, 'utf8')
      .replace('</head>', () => `${home}${city ? '' : languages}${schema}</head>`)
      .replace(/<body[^>]*>/, match => `${match}${kept}${staticHub(cities, posts, city)}`);
    writeFileSync(target, html);
    // /vancouver/ (with the slash) now hits the folder above; serve the same page there, canonical to /vancouver.
    if (city && existsSync(join(directory, city.id))) writeFileSync(join(directory, city.id, 'index.html'), html);
  }
  // /en lists the same language versions as the home page (its client Head only runs after hydration).
  const english = join(directory, 'en.html');
  if (existsSync(english)) writeFileSync(english, readFileSync(english, 'utf8').replace('</head>', `${languages}</head>`));
  // /posts redirects to /posts/ (a folder); there is no list page, so point it home.
  if (existsSync(join(directory, 'posts'))) writeFileSync(join(directory, 'posts', 'index.html'), redirectPage(`${PUBLIC_SITE}/`, '글링 | 캐나다 한인 커뮤니티'));
  const meetupsFile = join(directory, 'meetups.html');
  if (existsSync(meetupsFile)) {
    const copy = `<section id="gling-static-home" lang="ko" style="${SECTION}"><p style="margin:0">밴쿠버·토론토·몬트리올 한인들이 글링에서 연 모임과 소모임을 도시별로 모았어요. 취미가 맞는 사람끼리 만나는 소모임도 있고, 축제·공연에 같이 갈 사람을 구하는 글도 있어요. 마음에 드는 모임이 있으면 글링 앱에서 신청하면 돼요.</p>${cities.map(city => [city, cityMeetups.get(city.id)]).map(([city, list]) => `<h2 style="margin:20px 0 8px;font-size:18px"><a href="/${city.id}/meetups" style="${LINK}">${escapeHtml(`${city.name} 한인 모임·소모임`)}</a></h2>${list.length
      ? `<ul style="margin:0;padding-left:20px">${list.slice(0, 10).map(item => `<li>${escapeHtml(item.title)} <small>${escapeHtml(koreanDate(item.room.startsAt) || String(item.room.cadence ?? '').trim())}</small></li>`).join('')}</ul>`
      : `<p style="margin:0">${escapeHtml(`지금 신청받는 ${city.name} 모임은 없어요. 하고 싶은 모임이 있으면 글링 앱에서 직접 열면 돼요.`)}</p>`}`).join('')}</section>`;
    writeFileSync(meetupsFile, readFileSync(meetupsFile, 'utf8').replace(/<body[^>]*>/, match => `${match}${copy}`));
  }
  const day = value => { const time = Date.parse(value); return Number.isFinite(time) ? `<lastmod>${new Date(time).toISOString().slice(0, 10)}</lastmod>` : ''; };
  // `/?city=` pages canonicalize to `/`, so only distinct pages are listed. /visited canonicalizes to itself for the first city.
  const paths = [...entries, ['/meetups', newest(meetups.map(item => ({ lastmod: item.createdAt })))], ['/visited'], ['/immigration', publicImmigrationMeta.checked], ['/faq'], ['/business'], ['/en'], ['/terms'], ['/privacy'], ['/account-deletion'], ['/child-safety']];
  writeFileSync(join(directory, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(([path, lastmod]) => `<url><loc>${PUBLIC_SITE}${path}</loc>${day(lastmod)}</url>`).join('')}${posts.map(post => `<url><loc>${publicPostUrl(post.id)}</loc>${day(post.lastmod)}</url>`).join('')}${companies.map(company => `<url><loc>${publicCompanyUrl(company.id)}</loc></url>`).join('')}</urlset>\n`);
  const protectedPaths = ['/merchant/', '/auth/', '/admin', '/chat', '/compose', '/profile', '/notifications', '/user/', '/meetup-create', '/meetup-join', '/meetup-application', '/meetup-profile'];
  // Owner 2026-11-13: block AI-training crawlers only; search and answer crawlers (Googlebot, Bingbot, Yeti, OAI-SearchBot, Claude-SearchBot, PerplexityBot, Google-Extended) stay allowed.
  const trainingBots = ['GPTBot', 'ClaudeBot', 'CCBot', 'Applebot-Extended', 'meta-externalagent', 'Bytespider'];
  writeFileSync(join(directory, 'robots.txt'), `${trainingBots.map(bot => `User-agent: ${bot}`).join('\n')}\nDisallow: /\n\nUser-agent: *\nAllow: /\n${protectedPaths.map(path => `Disallow: ${path}`).join('\n')}\n\nSitemap: ${PUBLIC_SITE}/sitemap.xml\n`);
  const recent = city => posts.filter(post => post.cityId === city.id).slice(0, 20)
    .map(post => `- [${String(post.title).replace(/[\\[\]\n\r]/g, ' ')}](${publicPostUrl(post.id)})${post.teaser ? `: ${String(post.teaser).replace(/[\n\r]/g, ' ')}` : ''}`).join('\n');
  const facts = [
    `- 열린 도시: ${cities.map(city => `${city.name}(${city.englishName})`).join(', ')}`,
    '- 할 수 있는 것: 동네 이야기, 맛집·가 볼 곳 지도, 렌트·구인·중고 거래, 축제·공연 동행, 소모임 만들기와 참여, 한국어↔영어 번역 보기',
    '- 요금: 무료, 일부 기능은 인앱 구매',
    '- 앱: iPhone은 App Store에서, Android는 Google Play에서 받을 수 있어요',
    `- 도시 페이지: ${cities.map(city => `[${city.name} 한인 커뮤니티](${PUBLIC_SITE}/${city.id})`).join(' · ')}`,
    `- 모임·소모임 페이지: ${cities.map(city => `[${city.name} 한인 모임·소모임](${PUBLIC_SITE}/${city.id}/meetups)`).join(' · ')}`,
    `- 이민·유학 길잡이: [${publicImmigrationMeta.heading}](${PUBLIC_SITE}/immigration) (IRCC·주정부 공식 페이지 링크 모음, 확인 날짜 ${publicImmigrationMeta.checked})`,
    ...(shell && places.length ? [`- 장소 페이지(주소·영업시간·지도 링크): ${CITIES.filter(city => places.some(entry => entry.cityId === city.id)).map(city => `[${city.name} 맛집·카페·가 볼 곳](${PUBLIC_SITE}/${city.id}/places)`).join(' · ')}`] : []),
    ...(hubs.size ? [`- 주제별 페이지: ${[...hubs.values()].map(hub => `[${TOPIC_HUBS[hub.tagSlug].name(CITIES.find(city => city.id === hub.cityId).name)}](${PUBLIC_SITE}${hub.path})`).join(' · ')}`] : []),
    `- 비즈니스: 가게 프로필, 소식·채용 글, 영수증 인증 후기를 글링에서 관리할 수 있어요. 등록과 요금제는 ${PUBLIC_SITE}/business 에서 볼 수 있어요.`,
  ].join('\n');
  // Core answers from the /faq page (src/components/public-web/metadata.ts FAQ_ITEMS), kept short for AI answers.
  const faq = [
    ['글링이 뭐예요?', '밴쿠버·토론토·몬트리올에 사는 한인을 위한 커뮤니티 앱이에요. 동네 이야기를 나누고, 축제나 콘서트에 같이 갈 사람을 찾고, 모임을 만들고 참여할 수 있어요.'],
    ['가입하지 않고도 볼 수 있나요?', '공개 게시판은 웹에서 미리보기로 둘러볼 수 있어요. 글 전체를 읽으려면 로그인하고, 댓글과 모임 참여는 앱에서 해요.'],
    ['어떤 도시에서 쓸 수 있나요?', '지금은 밴쿠버, 토론토, 몬트리올에서 쓸 수 있어요.'],
    ['글링은 무료인가요?', '무료로 쓸 수 있어요. 일부 기능은 인앱 구매가 있어요.'],
  ].map(([question, answer]) => `- **${question}** ${answer}`).join('\n');
  const updated = new Date(now).toISOString().slice(0, 10);
  writeFileSync(join(directory, 'llms.txt'), `# 글링 Gling: 캐나다 한인 커뮤니티 (${cities.map(city => city.name).join('·')})\n\n마지막 갱신 ${updated}\n\n> ${publicAboutGlingEn}\n\n${publicDisambiguation}\n\n${publicAboutGling}\n\n${facts}\n\n## 자주 묻는 질문\n\n${faq}\n\n공개 미리보기는 작성자의 게시물 정보이며 글링의 공식 사실 확인이나 비즈니스 소유 인증을 뜻하지 않습니다. 게스트는 허용된 대표 이미지 한 장과 짧은 소개를 볼 수 있습니다. 로그인하거나 정상 가입을 마치면 현재 공개 상태와 열람 권한을 확인한 뒤 공개 글의 전체 본문을 웹에서 읽을 수 있습니다. 댓글 작성·대화·모임 참여는 앱에서 이용합니다. 아래 원문은 현재 공개 상태를 조회합니다. 삭제·비공개 글의 내용, 개인 대화와 계정 정보는 제공하지 않습니다. 공개 미리보기를 전체 원문으로 간주하지 마세요.\n\n## 공개 이야기\n\n- [글링 공개 게시판](${PUBLIC_SITE}/)\n${cities.map(city => `- [${city.name} 공개 미리보기 · 다음 페이지](${PUBLIC_SOURCE}?format=markdown&city=${city.id})`).join('\n')}\n${cities.map(city => recent(city) && `\n## ${city.name} 최근 글\n\n${recent(city)}\n`).filter(Boolean).join('')}\n## 이용 안내\n\n- [자주 묻는 질문](${PUBLIC_SITE}/faq)\n- [${publicImmigrationMeta.heading}](${PUBLIC_SITE}/immigration)\n- [비즈니스 등록·요금제](${PUBLIC_SITE}/business)\n- [English](${PUBLIC_SITE}/en)\n- [iPhone 앱](https://apps.apple.com/ca/app/id6809273242)\n- [Android 앱](${PUBLIC_PLAY_STORE})\n- [이용약관](${PUBLIC_SITE}/terms)\n- [개인정보처리방침](${PUBLIC_SITE}/privacy)\n- [계정 삭제](${PUBLIC_SITE}/account-deletion)\n`);
  // Naver Search Advisor and other feed readers pick up new pages from this (post previews only, same as the post pages).
  const date = value => { const time = Date.parse(value); return Number.isFinite(time) ? `<pubDate>${new Date(time).toUTCString()}</pubDate>` : ''; };
  const item = ({ title, link, description, lastmod }) => `<item><title>${escapeHtml(title)}</title><link>${link}</link><guid isPermaLink="true">${link}</guid><description>${escapeHtml(description)}</description>${date(lastmod)}</item>`;
  writeFileSync(join(directory, 'rss.xml'), `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>글링 | 캐나다 한인 커뮤니티</title><link>${PUBLIC_SITE}/</link><description>${escapeHtml(publicAboutGling)}</description><language>ko</language>${[
    ...cities.map(city => ({ title: `${city.name} 한인 커뮤니티 · 동네 이야기와 모임`, link: `${PUBLIC_SITE}/${city.id}`, description: `${city.name}에 사는 한인들이 나누는 동네 이야기, 맛집, 렌트·구인·중고, 소모임을 글링에서 둘러보세요.`, lastmod: posts.find(post => post.cityId === city.id)?.lastmod })),
    // City × topic pages and the immigration guide, so Naver picks them up as well as single posts (owner 2026-11-01).
    ...[...hubs.values()].filter(hub => cities.some(city => city.id === hub.cityId)).map(hub => {
      const city = cities.find(item => item.id === hub.cityId), meta = publicCitySubpageMeta({ kind: 'topic', cityId: city.id, tagSlug: hub.tagSlug }, city.name);
      return { title: meta.title, link: `${PUBLIC_SITE}${hub.path}`, description: meta.description, lastmod: newest(posts.filter(post => post.cityId === city.id && post.tagSlug === hub.tagSlug)) ?? HUB_GUIDES[`${city.id}/${hub.tagSlug}`]?.checked };
    }),
    { title: publicImmigrationMeta.title, link: `${PUBLIC_SITE}/immigration`, description: publicImmigrationMeta.description, lastmod: publicImmigrationMeta.checked },
    ...posts.slice(0, 100).map(post => ({ title: post.title, link: publicPostUrl(post.id), description: post.preview || post.teaser || [post.city, post.label].filter(Boolean).join(' · '), lastmod: post.lastmod })),
  ].map(item).join('')}</channel></rss>\n`);
  return { hubs, sitemap: paths.length + posts.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2] ?? 'dist';
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL, key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // Only the Pages deploy prerenders (CI exports against a stub project); there a failed fetch fails the deploy and keeps the previous site live.
  const prerender = process.env.GLING_PRERENDER_POSTS === '1';
  if (prerender && (!url || !key)) throw new Error('Supabase public env is required to prerender public posts');
  const options = prerender ? { url: url.replace(/\/+$/, ''), key, cities: CITIES.filter(city => city.state === 'open').map(city => city.id), searchToken: process.env.GLING_SEARCH_BUILD_TOKEN } : null;
  const loaded = options ? await loadPublicPosts(options) : { posts: [], meetups: [] };
  // Places first, so each post page can link the page of its place.
  const catalog = options ? await loadPlaceCatalog(options) : null;
  const places = catalog ? publicPlaces(catalog, loaded.posts, await loadPlaceRatings(catalog, options)) : [];
  for (const entry of places) for (const post of entry.posts) post.placePath = entry.path;
  const { posts, meetups } = options ? await prerenderPublicPosts(directory, options, loaded) : loaded;
  const companies = options ? await prerenderPublicCompanies(directory, { ...options, posts }) : [];
  const { hubs } = finishPublicWeb(directory, posts, companies, { meetups, places, catalog });
  const english = options ? await prerenderEnglishPosts(directory, posts, options, { hubs, businesses: companies }) : [];
  console.log(`Prerendered ${posts.length} public posts (${english.length} in English), ${hubs.size} topic hubs, ${places.length} place pages and ${companies.length} business profiles.`);
}
