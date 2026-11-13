import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finishPublicWeb } from './finish-public-web.mjs';
import { prerenderPublicPosts, withStaticPage } from './prerender-public-posts.mjs';
import { hoursText, loadPlaceCatalog, loadPlaceRatings, publicPlaces } from './prerender-public-places.mjs';
import { PUBLIC_SITE, publicCitySubpage, publicPlaceId, publicPlacePath, publicPlaceSlug } from '../src/lib/public-seo.ts';

const SHELL = '<html><head><meta charSet="utf-8"/><title data-rh="true">글링 | 앱에서 이어가기</title><meta name="robots" content="noindex, nofollow" data-rh="true"/></head><body><div id="root"><section class="reader-hero"><h1>앱에서 이어가세요.</h1></section></div></body></html>';
const NOW = Date.parse('2026-11-12T12:00:00Z');
const uuid = n => `${String(n).padStart(8, '0')}-2222-4222-8222-222222222222`;
const h1s = html => (html.match(/<h1\b/g) ?? []).length;
const graph = html => [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1])).find(item => item['@graph'])['@graph'];
const read = (directory, path) => readFileSync(join(directory, path), 'utf8');
const HANDSON = 'osm:node:4976343547'; // In src/lib/gling-visited.json, so it opens with no post or intro.
const place = (id, name, extra = {}) => ({ id, name, cityId: 'vancouver', category: 'cafe', latitude: 49.2627, longitude: -122.889, address: '581 Clarke Road, Coquitlam, BC, Canada', sourceUrl: `https://www.openstreetmap.org/${id.split(':')[1]}/${id.split(':')[2]}`, ...extra });
const intro = (placeId, reason, extra = {}) => ({ placeId, reason, reasonEn: 'x', sourceUrl: 'https://intro.example/list', verifiedAt: '2026-10-19T04:04:51.412Z', ...extra });
const calgary = Array.from({ length: 31 }, (_, index) => place(`osm:node:${900 + index}`, `Calgary ${index + 1}`, { cityId: 'calgary', category: ['places', 'food', 'cafe'][index % 3], address: `${index + 1} 8 Avenue SE, Calgary, AB` }));
const catalog = {
  attribution: '© OpenStreetMap contributors', attributionUrl: 'https://www.openstreetmap.org/copyright', collectedAt: '2026-11-12T11:12:24Z',
  cities: {
    vancouver: {
      places: [place('osm:way:1', 'Bakery One', { openingHours: 'Mo-Fr 07:00-17:00, Sa-Su 08:00-17:00; PH off', website: 'https://www.bakery.example/', subcategories: ['date', 'bakery'] }),
        place('osm:node:2', 'Quiet Diner', { category: 'food' }),
        place('osm:node:3', 'Twin'), place('osm:node:4', 'Twin'),
        place(HANDSON, 'By Handson', { category: 'food', address: '847 Denman Street', latitude: 49.291, longitude: -123.1365 }),
        place('osm:node:6', 'Intro Spot', { category: 'places', address: '1 Main St, Vancouver, BC V5K 0A1, Canada' }),
        place('osm:node:8', 'Review Only', { address: '' })],
      regionalPlaces: [place('osm:node:5', 'Bad Photo', { category: 'food' })],
      regionalPhotos: [{ placeId: 'osm:node:5', uri: 'https://img.example/5.jpg', sourceUrl: 'https://img.example/', artist: 'Someone', license: 'CC BY 4.0' }],
      recommendations: [intro('osm:node:6', '바다가 보이는 넓은 공원이에요.')],
      diningRecommendations: [intro('osm:node:5', '아침 일찍 여는 식당.')],
      extraRecommendations: [intro('osm:node:3', '이름이 같은 카페.')],
      moreRecommendations: [intro('osm:node:2', '이 목록은 세지 않아요.')],
    },
    toronto: { places: [place('osm:node:9', 'Toronto Cafe', { cityId: 'toronto' })] },
    calgary: { places: calgary, recommendations: calgary.map(item => intro(item.id, `${item.name} 소개.`)) },
  },
  photoCatalog: { cities: { vancouver: [{ placeId: 'osm:way:1', uri: 'https://img.example/1.jpg', sourceUrl: 'https://www.bakery.example/', licenseUrl: 'https://www.bakery.example/', artist: 'Bakery One', license: 'Business-provided photo' }] } },
};
const ratings = new Map([['vancouver|osm:way:1', { count: 1, average: 8 }], ['vancouver|osm:node:8', { count: 1, average: 10 }]]);
const post = (n, extra) => ({ id: uuid(n), cityId: 'vancouver', city: '밴쿠버', kind: 'post', label: '맛집', title: `제목 ${n}`, author: `닉네임${n}`, createdAt: new Date(NOW - n * 3600e3).toISOString(), lastmod: new Date(NOW - n * 3600e3).toISOString(), ...extra });
const posts = [
  post(1, { place: 'Bakery One', preview: '크루아상이 맛있어요' }),
  post(2, { place: 'Bakery One', teaser: '글링 평점: 8.0/10', preview: '글링 평점: 8.0/10\n줄이 길어요' }),
  post(3, { place: 'Twin', preview: '이름이 같은 두 곳' }),
  post(4, { place: 'Nowhere', preview: '카탈로그에 없는 곳' }),
  post(5, { cityId: 'toronto', city: '토론토', place: 'Bakery One', title: "렌트 $' 아끼는 법 $$", preview: '다른 도시의 같은 이름' }),
  post(7, { place: 'Review Only', preview: '글링 평점: 10.0/10\n오 나잇수' }),
];

test('장소 페이지는 11개 도시에서 소개·글·후기·직접 방문이 있는 곳만 열고, 없는 정보 줄은 빼고, 글 페이지와 도시 페이지에서 이어진다', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gling-place-pages-'));
  try {
    writeFileSync(join(directory, '+not-found.html'), SHELL);
    for (const page of ['index', 'vancouver', 'toronto', 'montreal', 'meetups', 'en']) writeFileSync(join(directory, `${page}.html`), `<html><head></head><body><div id="root"><h1>${page}</h1></div></body></html>`);
    const places = publicPlaces(catalog, posts, ratings);
    assert.deepEqual(places.filter(entry => entry.cityId === 'vancouver').map(entry => entry.place.id), ['osm:way:1', HANDSON, 'osm:node:8', 'osm:node:6', 'osm:node:5', 'osm:node:3'],
      'visited, written-about and reviewed first; then places, food, cafes in turn. moreRecommendations, a name two places share and a place with nothing to read get no page');
    assert.equal(places.filter(entry => entry.cityId === 'calgary').length, 31, 'cities without a web city page get place pages too');
    assert.deepEqual(places[0].posts.map(item => item.id), [uuid(1), uuid(2)]);
    for (const entry of places) for (const item of entry.posts) item.placePath = entry.path;
    await prerenderPublicPosts(directory, {}, { posts, meetups: [] });
    finishPublicWeb(directory, posts, [], { places, catalog, now: NOW });

    const bakery = read(directory, 'vancouver/places/way-1.html');
    assert.equal(h1s(bakery), 1);
    assert.match(bakery, /<h1>Bakery One<\/h1>/);
    assert.match(bakery, new RegExp(`<link rel="canonical" href="${PUBLIC_SITE}/vancouver/places/way-1"`));
    assert.match(bakery, /<title data-rh="true">Bakery One · 밴쿠버 카페 \| 글링<\/title>/);
    assert.match(bakery, /data-title="Bakery One · 밴쿠버 카페 \| 글링"/, 'the reader keeps the same title after load');
    assert.match(bakery, /<meta name="description" content="밴쿠버 카페 Bakery One의 주소와 영업시간, 글링 회원이 남긴 후기, 글링 회원 글, 지도 링크를 볼 수 있어요\."/);
    assert.match(bakery, /index, follow/);
    assert.match(bakery, /<span class="place-tag quiet">글 1개<\/span><span class="place-tag quiet">후기 1개<\/span>/, 'the review post counts as a review, not a post');
    assert.match(bakery, /<dt>종류<\/dt><dd>카페 · 베이커리<\/dd><dt>주소<\/dt><dd>581 Clarke Road, Coquitlam<\/dd>/, 'kind without situation tags; a suburb address keeps its own town');
    assert.match(bakery, /월–금 07:00–17:00, 토–일 08:00–17:00, 공휴일 휴무<small>OpenStreetMap에 등록된 시간<\/small>/);
    assert.match(bakery, />bakery\.example ↗<\/a>/);
    assert.match(bakery, /글링 회원 평점 8\.0 · 후기 1개/);
    assert.match(bakery, /<span class="place-tag quiet">장소 후기<\/span><h3><a href="\/posts\/00000002-2222-4222-8222-222222222222">/);
    assert.match(bakery, /<p class="reader-excerpt">글링 평점: 8\.0\/10 · 줄이 길어요<\/p>/);
    assert.match(bakery, /사진: Bakery One · 비즈니스 웹사이트에 올린 사진<\/p><p><a href="https:\/\/www\.bakery\.example\/"[^>]*>비즈니스 웹사이트 ↗<\/a>/);
    assert.match(bakery, /Google 지도에서 열기 ↗/);
    assert.match(bakery, /href="gling:\/\/map\?cityId=vancouver&amp;placeId=osm:way:1"/);
    assert.match(bakery, /© OpenStreetMap contributors \(ODbL\) · 2026년 11월 12일 확인 · <a href="https:\/\/www\.openstreetmap\.org\/way\/1"/);
    assert.match(bakery, /<a class="reader-secondary place-all" href="\/vancouver\/places">밴쿠버 장소 6곳 모두 보기<\/a>/);
    assert.equal((bakery.match(/<ul class="place-others">(.*?)<\/ul>/)[1].match(/<li>/g) ?? []).length, 5, 'the other places of the city, up to six');
    assert.doesNotMatch(bakery, /정보 없음|가격대|동네/);
    const [cafe, crumbs] = graph(bakery);
    assert.equal(cafe['@type'], 'CafeOrCoffeeShop');
    assert.deepEqual(cafe.openingHours, ['Mo-Fr 07:00-17:00', 'Sa-Su 08:00-17:00'], 'holiday and closed rules stay out of the schema');
    assert.equal(cafe.aggregateRating, undefined, 'no rating markup for a handful of reviews');
    assert.deepEqual(cafe.address, { '@type': 'PostalAddress', streetAddress: '581 Clarke Road, Coquitlam', addressLocality: 'Vancouver', addressRegion: 'BC', addressCountry: 'CA' });
    assert.deepEqual(cafe.sameAs, ['https://www.openstreetmap.org/way/1', 'https://www.bakery.example/']);
    assert.deepEqual(crumbs.itemListElement.map(item => item.item), [`${PUBLIC_SITE}/`, `${PUBLIC_SITE}/vancouver`, `${PUBLIC_SITE}/vancouver/places`, `${PUBLIC_SITE}/vancouver/places/way-1`]);

    const review = read(directory, 'vancouver/places/node-8.html');
    assert.match(review, /<div class="place-signals"><span class="place-tag quiet">후기 1개<\/span><\/div>/, 'a place with only a review says 후기, not 글');
    assert.doesNotMatch(review, /글 1개|글링 회원 글|<dt>주소/);
    assert.match(review, /content="밴쿠버 카페 Review Only의 글링 회원이 남긴 후기와 지도 링크를 볼 수 있어요\."/);

    const handson = read(directory, 'vancouver/places/node-4976343547.html');
    assert.match(handson, /<span class="place-tag">글링 직접 방문<\/span>/);
    assert.match(handson, /글링이 직접 다녀왔어요\.<\/p><a class="place-lead-link" href="https:\/\/www\.instagram\.com\//);
    assert.match(handson, /<dd>847 Denman Street, Vancouver<\/dd>/);
    assert.match(handson, /<img src="https:\/\/static\.wixstatic\.com\//, 'the visit photo with its credit');
    assert.match(handson, /아직 이 장소에 달린 글이 없어요\. 앱에서 열면 첫 후기를 남길 수 있어요\./);
    assert.match(handson, /<meta name="description" content="밴쿠버 맛집 By Handson의 주소와 지도 링크를 볼 수 있어요\."/);
    assert.doesNotMatch(handson, /영업시간|place-rating|소개에 참고한/, 'no hours, rating or intro: those parts are left out');

    const spot = read(directory, 'vancouver/places/node-6.html');
    assert.match(spot, /<p class="place-lead">바다가 보이는 넓은 공원이에요\.<\/p><a class="place-lead-link" href="https:\/\/intro\.example\/list"[^>]*>소개에 참고한 페이지 ↗<\/a>/);
    assert.match(spot, /<dd>1 Main St, Vancouver<\/dd>/, 'province, postal code and country leave the street line');
    assert.match(spot, /볼 수 있어요\. 바다가 보이는 넓은 공원이에요\."/, 'the intro joins the description, word for word');
    assert.equal(graph(spot)[0]['@type'], 'TouristAttraction');
    assert.doesNotMatch(read(directory, 'vancouver/places/node-5.html'), /<img/, 'a photo without its licence link is not shown');
    for (const path of ['vancouver/places/node-2.html', 'vancouver/places/node-4.html', 'toronto/places']) assert.ok(!existsSync(join(directory, path)), path);

    const list = read(directory, 'vancouver/places.html');
    assert.equal(h1s(list), 1);
    assert.match(list, /<title data-rh="true">밴쿠버 맛집·카페·가 볼 곳 6곳 \| 글링<\/title>/);
    assert.match(list, /<h1>밴쿠버 맛집·카페·가 볼 곳<\/h1><p>글링 회원이 글을 남겼거나 글링이 소개를 써 둔 곳만 모았어요\./);
    assert.match(list, /data-cat="all">전체<span>6<\/span><\/button><button type="button" aria-pressed="false" data-cat="food">맛집<span>2<\/span>.*data-cat="cafe">카페<span>3<\/span>.*data-cat="places">가볼 만한 곳<span>1<\/span>/);
    assert.match(list, /<h3><a href="\/vancouver\/places\/way-1">Bakery One<\/a><\/h3><p class="reader-excerpt">“제목 1”<\/p><p class="reader-meta">카페 · 581 Clarke Road, Coquitlam<\/p>/);
    assert.doesNotMatch(list, /place-pager/, 'one page, no pager');
    assert.equal(read(directory, 'vancouver/places/index.html'), list, '/vancouver/places/ serves the same page');
    assert.ok(!existsSync(join(directory, 'toronto', 'places.html')), 'no list without places');

    const first = read(directory, 'calgary/places.html'), second = read(directory, 'calgary/places/2.html');
    assert.match(first, /<nav aria-label="경로" class="place-crumbs"><a href="\/">글링<\/a> › 캘거리 › 장소<\/nav>/, 'no link to a city page that does not exist');
    assert.match(first, /<p class="reader-meta">1 \/ 2쪽<\/p><a class="reader-secondary" href="\/calgary\/places\/2" rel="next">다음 1곳 보기<\/a>/);
    assert.match(second, /<title data-rh="true">캘거리 맛집·카페·가 볼 곳 31곳 · 2쪽 \| 글링<\/title>/);
    assert.match(second, new RegExp(`<link rel="canonical" href="${PUBLIC_SITE}/calgary/places/2"`));
    assert.match(second, /href="\/calgary\/places" rel="prev">이전 30곳 보기<\/a><\/div>/);
    assert.equal((second.match(/<article class="reader-card"/g) ?? []).length, 1);
    assert.equal(graph(second)[0].mainEntity.itemListElement[0].position, 31);
    assert.deepEqual(graph(second)[1].itemListElement.map(item => item.name), ['글링', '장소', '2쪽']);
    assert.ok(existsSync(join(directory, 'calgary', 'places', 'index.html')) && !existsSync(join(directory, 'calgary', 'places', '2', 'index.html')));
    assert.match(read(directory, 'calgary/places/node-900.html'), /<a href="\/">글링<\/a> › 캘거리 › <a href="\/calgary\/places">장소<\/a> › Calgary 1<\/nav>/);
    assert.match(read(directory, 'calgary/places/node-900.html'), /<dd>1 8 Avenue SE, Calgary<\/dd>/);

    assert.match(read(directory, 'vancouver.html'), /href="\/vancouver\/places"[^>]*>밴쿠버 맛집·카페·가 볼 곳<\/a>/);
    assert.doesNotMatch(read(directory, 'toronto.html'), /\/toronto\/places/);
    assert.match(read(directory, `posts/${uuid(1)}.html`), /장소: <a href="\/vancouver\/places\/way-1"[^>]*>Bakery One<\/a>/);
    assert.doesNotMatch(read(directory, `posts/${uuid(3)}.html`), /장소: /);
    assert.match(read(directory, `posts/${uuid(5)}.html`), /<meta property="og:title" content="렌트 \$&#39; 아끼는 법 \$\$"/, 'a $\' in a title does not pull in the rest of the page');

    const sitemap = read(directory, 'sitemap.xml');
    for (const path of ['/vancouver/places', '/vancouver/places/way-1', '/vancouver/places/node-4976343547', '/calgary/places', '/calgary/places/2', '/calgary/places/node-930']) assert.match(sitemap, new RegExp(`<loc>${PUBLIC_SITE}${path}</loc>`), path);
    assert.match(sitemap, new RegExp(`<loc>${PUBLIC_SITE}/vancouver/places/way-1</loc><lastmod>2026-11-12</lastmod>`));
    assert.ok(!sitemap.includes('/toronto/places'));
    assert.match(read(directory, 'llms.txt'), /장소 페이지\(주소·영업시간·지도 링크\): \[밴쿠버 맛집·카페·가 볼 곳\]\(https:\/\/gling\.ej-entertainment\.com\/vancouver\/places\) · \[캘거리 맛집·카페·가 볼 곳\]/);
  } finally { rmSync(directory, { recursive: true }); }
});

test('장소 주소는 지도 장소 번호로 오가고, 영업시간은 읽을 수 있는 것만 바꾸고, 후기 수는 공개 요약에서 25곳씩 읽는다', async () => {
  const ids = ['vancouver', 'toronto'], all = [...ids, 'calgary'];
  assert.equal(publicPlacePath('vancouver', 'osm:node:4976343547'), '/vancouver/places/node-4976343547');
  // The app opens a place page link by turning its slug back into the map id; other ids pass through.
  for (const id of ['osm:node:4976343547', 'osm:way:7', 'osm:relation:12']) assert.equal(publicPlaceId(publicPlaceSlug(id)), id);
  for (const id of ['osm:node:4976343547', 'partner:jimoco', 'node-', 'node-1x', 'tag-1']) assert.equal(publicPlaceId(id), id);
  assert.deepEqual(publicCitySubpage('/vancouver/places/node-4976343547', ids, all), { cityId: 'vancouver', kind: 'place', placeId: 'osm:node:4976343547' });
  assert.deepEqual(publicCitySubpage('/toronto/places/', ids, all), { cityId: 'toronto', kind: 'places', page: 1 });
  assert.deepEqual(publicCitySubpage('/calgary/places/3', ids, all), { cityId: 'calgary', kind: 'places', page: 3 });
  assert.deepEqual(publicCitySubpage('/calgary/places/way-7', ids, all), { cityId: 'calgary', kind: 'place', placeId: 'osm:way:7' });
  for (const path of ['/vancouver/rent/node-1', '/vancouver/places/abc', '/vancouver/places/node-', '/vancouver/places/1', '/calgary/meetups', '/seoul/places', '/vancouver/places/node-1/x', '/vancouver/meetups/2']) assert.equal(publicCitySubpage(path, ids, all), null, path);
  assert.equal(publicCitySubpage('/calgary/places', ids), null, 'without the place cities, only open cities');
  assert.equal(hoursText('Tu-Sa 11:00-23:00; Mo, Su 11:00-22:00'), '화–토 11:00–23:00, 월·일 11:00–22:00');
  assert.equal(hoursText('Mo-Su 11:30-14:30,17:00-22:00'), '월–일 11:30–14:30, 17:00–22:00');
  assert.equal(hoursText('12:00-00:00'), '매일 12:00–00:00');
  assert.equal(hoursText('Mo-Fr 09:00-17:00; Sa off;'), '월–금 09:00–17:00, 토 휴무');
  assert.equal(hoursText('Mar-Oct 09:00-17:00; Nov-Feb We-Su 09:00-17:00'), 'Mar-Oct 09:00-17:00; Nov-Feb We-Su 09:00-17:00', 'anything else is shown as written');
  assert.equal(hoursText(''), null);
  const calls = [];
  const many = { cities: { vancouver: { places: Array.from({ length: 30 }, (_, index) => place(`osm:node:${index + 1}`, `P${index}`)) }, calgary: { places: [place('osm:node:99', 'C')] } } };
  const found = await loadPlaceRatings(many, { url: 'https://db.example', key: 'anon', fetcher: async (url, init) => {
    const body = JSON.parse(init.body); calls.push([body.p_city_id, body.p_place_ids.length, init.headers.apikey]);
    return { ok: true, json: async () => body.p_place_ids.map((placeId, index) => ({ cityId: body.p_city_id, placeId, count: index === 0 ? 2 : 0, average: 7.5 })) };
  } });
  assert.deepEqual(calls.sort(), [['calgary', 1, 'anon'], ['vancouver', 25, 'anon'], ['vancouver', 5, 'anon']]);
  assert.deepEqual([...found.keys()].sort(), ['calgary|osm:node:99', 'vancouver|osm:node:1', 'vancouver|osm:node:26']);
  assert.deepEqual(found.get('vancouver|osm:node:1'), { count: 2, average: 7.5 });
  // A failed catalog call falls back to the copy bundled with the app.
  const fallback = await loadPlaceCatalog({ url: 'https://db.example', key: 'anon', fetcher: async () => ({ ok: false, status: 500 }) });
  assert.ok(fallback.cities.vancouver.places.length > 0 && fallback.photoCatalog.cities);
  assert.equal(withStaticPage(SHELL, "<meta x=\"$'\"/>", '<p>x</p>').match(/<meta x="([^"]*)"/)[1], "$'");
});
