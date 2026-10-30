import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finishPublicWeb } from './finish-public-web.mjs';
import { prerenderPublicPosts, topicHubs } from './prerender-public-posts.mjs';
import { PUBLIC_SITE, publicCitySubpage, publicPostDescription } from '../src/lib/public-seo.ts';

// The real 404 shell carries the reader's own H1; prerendered pages must not inherit it.
const SHELL = '<html><head><meta charSet="utf-8"/><title data-rh="true">글링 | 앱에서 이어가기</title><meta name="robots" content="noindex, nofollow" data-rh="true"/></head><body><div id="root"><section class="reader-hero"><h1>앱에서 이어가세요.</h1></section></div></body></html>';
const NOW = Date.parse('2026-10-30T12:00:00Z');
const uuid = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const h1s = html => (html.match(/<h1\b/g) ?? []).length;
const graphs = html => [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]));

// 6 Vancouver housing posts (hub), 3 Vancouver jobs posts (no hub), 31 Vancouver life posts (2 city pages), 1 Toronto post, 1 meetup.
function fixture() {
  const feed = { vancouver: [], toronto: [] }, previews = new Map();
  const add = (city, n, tag, label, extra = {}) => {
    const id = uuid(n), created = new Date(NOW - n * 3600e3).toISOString();
    feed[city].push({ id, created_at: created, sort_at: created, comment_count: n % 4, author_nickname: `닉네임${n}`, tag_slug: tag, author_neighborhood: n % 2 ? '버나비' : '써리' });
    previews.set(id, { id, kind: 'post', title: `제목 ${n}`, teaser: '짧은 소개', city: city === 'vancouver' ? '밴쿠버' : '토론토', label, imagePath: null, ...extra });
  };
  for (let n = 1; n <= 6; n++) add('vancouver', n, 'housing', '부동산', n === 1 ? { preview: '첫 문단 '.repeat(60).trim() } : {});
  for (let n = 7; n <= 9; n++) add('vancouver', n, 'jobs', '구인구직');
  for (let n = 10; n <= 40; n++) add('vancouver', n, 'life', '라이프');
  add('toronto', 41, 'life', '라이프');
  feed.vancouver.push({ id: uuid(99), title: '주말 등산 모임', created_at: new Date(NOW - 3600e3).toISOString(), author_nickname: '모임장',
    room_preview: { eventKind: 'once', startsAt: '2026-11-07T17:00:00Z', endsAt: '2026-11-07T20:00:00Z', memberCount: 3, capacity: 8, closed: false } });
  feed.vancouver.push({ id: uuid(98), title: '트레킹 모임', created_at: new Date(NOW - 7200e3).toISOString(), author_nickname: '걷는사람',
    room_preview: { eventKind: 'group', startsAt: null, cadence: '매주 토요일 오전', memberCount: 1, capacity: 50 } });
  feed.vancouver.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const fetcher = async (url, init) => {
    const name = url.split('/rpc/')[1], args = JSON.parse(init.body);
    let data = null;
    if (name === 'get_search_excluded_post_ids') data = [];
    else if (name === 'get_public_feed_page_v2') {
      const rows = feed[args.p_city_id] ?? [], start = args.p_before_id ? rows.findIndex(row => row.id === args.p_before_id) + 1 : 0;
      data = rows.slice(start, start + 30);
    } else if (name === 'get_public_post_businesses') data = [];
    else if (name === 'get_shared_link_preview') { assert.ok(![uuid(98), uuid(99)].includes(args.p_post_id), 'meetup bodies are never fetched'); data = previews.get(args.p_post_id) ?? null; }
    return { ok: true, json: async () => data };
  };
  return fetcher;
}

test('검색용 글·허브·옛 주소 페이지는 H1 하나, 70자 이상 설명, 같은 구조화 데이터를 가진다', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gling-search-pages-'));
  try {
    writeFileSync(join(directory, '+not-found.html'), SHELL);
    for (const page of ['index', 'vancouver', 'toronto', 'montreal', 'meetups']) writeFileSync(join(directory, `${page}.html`), `<html><head></head><body><div id="root"><h1>${page}</h1></div></body></html>`);
    const { posts, meetups } = await prerenderPublicPosts(directory, { url: 'https://db.example', key: 'anon', cities: ['vancouver', 'toronto'], searchToken: 'token', fetcher: fixture() });
    assert.equal(posts.length, 41);
    assert.deepEqual(meetups.map(item => item.id).sort(), [uuid(98), uuid(99)]);

    for (const post of posts) {
      const html = readFileSync(join(directory, 'posts', `${post.id}.html`), 'utf8');
      assert.equal(h1s(html), 1, 'one H1 per post page');
      assert.ok(!html.includes('<h1>앱에서 이어가세요.'));
      const description = html.match(/<meta name="description" content="([^"]*)"/)[1];
      assert.ok(description.length >= 70, `description ≥70: ${description}`);
      assert.match(html, /<time datetime="2026-10-/);
    }
    const first = readFileSync(join(directory, 'posts', `${uuid(1)}.html`), 'utf8');
    const [graph] = graphs(first);
    const [forum, crumbs] = graph['@graph'];
    assert.equal(forum['@type'], 'DiscussionForumPosting');
    assert.equal(forum.headline, '제목 1');
    assert.equal(forum.text, '첫 문단 '.repeat(60).trim());
    assert.deepEqual(forum.author, { '@type': 'Person', name: '닉네임1' });
    assert.equal(forum.interactionStatistic.userInteractionCount, 1);
    assert.equal(forum.isPartOf['@id'], `${PUBLIC_SITE}/vancouver`);
    assert.ok(forum.datePublished.startsWith('2026-10-30T'));
    assert.deepEqual(crumbs.itemListElement.map(item => item.item), [`${PUBLIC_SITE}/`, `${PUBLIC_SITE}/vancouver`, `${PUBLIC_SITE}/vancouver/rent`]);
    assert.match(first, /href="\/vancouver\/rent"[^>]*>부동산<\/a>/, 'visible breadcrumb links the topic hub');
    assert.match(first, /첫 문단 첫 문단/, 'the longer public preview is shown');
    assert.match(readFileSync(join(directory, 'posts', `${uuid(7)}.html`), 'utf8'), /href="\/vancouver"[^>]*>구인구직<\/a>/, 'no hub: topic links the city');

    for (const old of [join('post', `${uuid(1)}.html`), join('share', `${uuid(1)}.html`), join('posts', uuid(1), 'index.html')]) {
      const html = readFileSync(join(directory, old), 'utf8');
      assert.match(html, new RegExp(`<link rel="canonical" href="${PUBLIC_SITE}/posts/${uuid(1)}">`));
      assert.match(html, /noindex/);
      assert.match(html, new RegExp(`http-equiv="refresh" content="0; url=${PUBLIC_SITE}/posts/${uuid(1)}"`));
    }

    const { hubs } = finishPublicWeb(directory, posts, [], { meetups, now: NOW });
    assert.deepEqual([...hubs.keys()].sort(), ['vancouver/housing', 'vancouver/life'], 'only city × topic with 5+ posts');
    assert.ok(!existsSync(join(directory, 'vancouver', 'jobs.html')) && !existsSync(join(directory, 'toronto', 'life.html')));
    const rent = readFileSync(join(directory, 'vancouver', 'rent.html'), 'utf8');
    assert.equal(h1s(rent), 1);
    assert.match(rent, /<h1[^>]*>밴쿠버 한인 렌트·방 구하기<\/h1>/);
    assert.match(rent, /공개 글 6개/);
    assert.match(rent, /https:\/\/news\.gov\.bc\.ca\/34197/);
    assert.match(rent, new RegExp(`<link rel="canonical" href="${PUBLIC_SITE}/vancouver/rent"`));
    const rentTypes = graphs(rent)[0]['@graph'].map(item => item['@type']);
    assert.deepEqual(rentTypes, ['CollectionPage', 'BreadcrumbList', 'FAQPage']);
    assert.equal(graphs(rent)[0]['@graph'][0].mainEntity.numberOfItems, 6);
    assert.ok(!readFileSync(join(directory, 'vancouver', 'life.html'), 'utf8').includes('news.gov.bc.ca'), 'the official guide box is only on its own hub');

    const page2 = readFileSync(join(directory, 'vancouver', '2.html'), 'utf8');
    assert.equal(h1s(page2), 1);
    assert.match(page2, new RegExp(`<link rel="canonical" href="${PUBLIC_SITE}/vancouver/2"`));
    assert.equal((page2.match(/href="\/posts\//g) ?? []).length, 10, '40 Vancouver posts: 30 on page 1, 10 on page 2');
    assert.ok(!existsSync(join(directory, 'vancouver', '3.html')));

    const vancouver = readFileSync(join(directory, 'vancouver.html'), 'utf8');
    assert.equal(h1s(vancouver), 1);
    assert.match(vancouver, /id="gling-static-city"/);
    assert.match(vancouver, /최근 30일 동안 밴쿠버 한인들이 글링에 올린 공개 글은 40개예요/);
    assert.match(vancouver, /라이프, 부동산, 구인구직 이야기가 많이 올라와요/);
    assert.match(vancouver, /버나비·써리|써리·버나비/);
    assert.match(vancouver, /지금 참여 신청을 받는 모임은 2개예요/);
    assert.match(vancouver, /href="\/vancouver\/rent"[^>]*>부동산 6<\/a>/);
    assert.match(vancouver, /href="\/vancouver\/2"/);
    assert.equal(graphs(vancouver)[0]['@graph'][0]['@type'], 'CollectionPage');
    assert.equal(readFileSync(join(directory, 'vancouver', 'index.html'), 'utf8'), vancouver, '/vancouver/ serves the same page');
    const toronto = readFileSync(join(directory, 'toronto.html'), 'utf8');
    assert.doesNotMatch(toronto.match(/id="gling-static-city"[\s\S]*?<\/section>/)[0], /최근 30일 동안 밴쿠버/, 'city copy differs per city');

    const meetupPage = readFileSync(join(directory, 'vancouver', 'meetups.html'), 'utf8');
    assert.match(meetupPage, /<h1[^>]*>밴쿠버 한인 모임<\/h1>/);
    assert.match(meetupPage, /<title data-rh="true">밴쿠버 한인 모임 \| 글링<\/title>/);
    const event = graphs(meetupPage)[0]['@graph'][0].mainEntity.itemListElement[0].item;
    assert.equal(event['@type'], 'Event');
    assert.equal(event.startDate, '2026-11-07T17:00:00.000Z');
    assert.equal(event.location.address.addressLocality, 'Vancouver');
    assert.deepEqual(event.organizer, { '@type': 'Person', name: '모임장' });
    assert.match(meetupPage, /트레킹 모임<\/a> <small>매주 토요일 오전 · 계속 만나는 모임/);
    assert.equal(graphs(meetupPage)[0]['@graph'][0].mainEntity.itemListElement.filter(item => item.item['@type'] === 'Event').length, 1, 'an undated group is not an Event');

    const sitemap = readFileSync(join(directory, 'sitemap.xml'), 'utf8');
    for (const path of ['/', '/vancouver', '/vancouver/2', '/vancouver/rent', '/vancouver/life', '/vancouver/meetups', '/meetups', '/visited', '/en', '/faq']) {
      assert.match(sitemap, new RegExp(`<loc>${PUBLIC_SITE}${path === '/' ? '/' : path}</loc>`), path);
    }
    assert.match(sitemap, new RegExp(`<loc>${PUBLIC_SITE}/vancouver/rent</loc><lastmod>2026-10-30</lastmod>`));
    assert.ok(!sitemap.includes('?city=') && !sitemap.includes('/vancouver/jobs'));
    assert.equal((sitemap.match(/<url>/g) ?? []).length, 41 + 17, '41 posts + home, 3 cities, page 2, 2 hubs, city meetups, meetups, visited, faq, business, en, 4 legal');

    const notFound = readFileSync(join(directory, '404.html'), 'utf8');
    assert.match(notFound, /l\.replace\(t\+l\.search\+l\.hash\)/, 'the 404 page sends old links to the canonical address');
    assert.match(readFileSync(join(directory, 'posts', 'index.html'), 'utf8'), /url=https:\/\/gling\.ej-entertainment\.com\//);
    const home = readFileSync(join(directory, 'index.html'), 'utf8');
    assert.match(home, /hreflang="en" href="https:\/\/gling\.ej-entertainment\.com\/en"/);
    const llms = readFileSync(join(directory, 'llms.txt'), 'utf8');
    assert.match(llms, /^# .*\n\n마지막 갱신 2026-10-30\n/);
    assert.ok(llms.includes('not the Gling AI video editor') && llms.includes('## 자주 묻는 질문') && llms.includes('- 비즈니스:'));
    assert.ok(llms.includes(`${PUBLIC_SITE}/vancouver/rent`));
    for (const file of ['index.html', 'vancouver.html', join('vancouver', 'rent.html'), join('vancouver', '2.html'), join('vancouver', 'meetups.html'), join('posts', `${uuid(3)}.html`)]) graphs(readFileSync(join(directory, file), 'utf8'));
  } finally { rmSync(directory, { recursive: true }); }
});

test('설명은 짧은 미리보기에 도시·주제를 붙여 70자 이상으로 만들고, 허브 주소는 정해진 모양만 받는다', () => {
  const short = publicPostDescription({ id: uuid(1), title: '방 구해요', city: '밴쿠버', label: '부동산', text: '버나비 1베드' });
  assert.ok(short.startsWith('밴쿠버 · 부동산 | 방 구해요 · 버나비 1베드') && short.length >= 70, short);
  assert.ok(publicPostDescription({ id: uuid(1), title: '제목', text: '가'.repeat(400) }).length <= 160);
  const ids = ['vancouver', 'toronto'];
  assert.deepEqual(publicCitySubpage('/vancouver/rent', ids), { cityId: 'vancouver', kind: 'topic', tagSlug: 'housing' });
  assert.deepEqual(publicCitySubpage('/toronto/3/', ids), { cityId: 'toronto', kind: 'page', page: 3 });
  assert.deepEqual(publicCitySubpage('/vancouver/meetups', ids), { cityId: 'vancouver', kind: 'meetups' });
  for (const path of ['/vancouver/1', '/vancouver/housing', '/calgary/rent', '/vancouver', '/merchant/rent', '/vancouver/rent/x']) assert.equal(publicCitySubpage(path, ids), null, path);
  assert.equal(topicHubs([{ cityId: 'vancouver', tagSlug: 'meetup' }, ...Array(5).fill({ cityId: 'vancouver', tagSlug: 'meetup' })]).size, 0, 'meetup posts never form a hub');
});
