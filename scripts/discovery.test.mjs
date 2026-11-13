import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { discoveryPost, discoveryEvent, discoveryDays, discoveryKind, discoveryMatches, mapAppUrl, DISCOVERY_CATEGORIES } from '../src/lib/discovery.ts';

const post = { id: 'p1', cityId: 'vancouver', author: { id: 'u1' }, tag: { slug: 'used' }, kind: 'listing', listingStatus: 'open', expiresAt: '2027-01-01T00:00:00Z', price: 20, title: '책상', body: '거래 장소\n\nGoogle 지도: https://www.google.com/maps/search/?api=1&query=49.28%2C-123.12\n위치: 도서관 앞' };
test('a Google Maps attachment does not turn an unrelated community topic into a discovery listing', () => {
  for (const slug of ['life', 'settlement', 'jobs', 'education', 'meetup', 'business']) {
    assert.equal(discoveryPost({ ...post, kind: 'story', tag: { slug }, hashtags: ['카페'], title: '일반 질문' }), null, slug);
  }
  for (const slug of ['food', 'travel', 'festival', 'shopping']) {
    assert.ok(discoveryPost({ ...post, kind: 'story', tag: { slug } }), slug);
  }
});
test('지도에는 공개 첨부 핀만 쓰며 거래 종료·만료 위치는 제외한다', () => {
  const item = discoveryPost(post, Date.parse('2026-10-15T00:00:00Z'));
  assert.equal(item.category, 'used');
  // 중고거래·부동산 pins snap to the neighborhood centre and never repeat the writer's spot label.
  assert.equal(item.label, '다운타운');
  assert.deepEqual([item.latitude, item.longitude], [49.282, -123.12]);
  assert.equal(discoveryPost({ ...post, body: '위치 없는 글', location_snapshot: { latitude: 49, longitude: -123 } }, Date.parse('2026-10-15')), null);
  assert.equal(discoveryPost({ ...post, listingStatus: 'closed' }, Date.parse('2026-10-15')), null);
  assert.equal(discoveryPost({ ...post, expiresAt: '2020-01-01T00:00:00Z' }, Date.parse('2026-10-15')), null);
  const unresolved = discoveryPost({ ...post, body: 'Google 지도: https://www.google.com/maps/search/?api=1&query=Kitsilano%2C+Vancouver' }, Date.parse('2026-10-15T00:00:00Z'));
  assert.equal(unresolved.latitude, null);
  assert.equal(unresolved.label, '이 근처');
  assert.equal(discoveryPost({ ...post, kind: 'story', tag: { slug: 'food' }, body: post.body }).label, '도서관 앞');
});
test('릴스 카테고리 색을 바꾸지 않고 장소 유형을 구분한다', () => {
  const colors = JSON.parse(readFileSync(new URL('./fixtures/discovery-category-colors.json', import.meta.url))).categoryPointColors;
  for (const category of DISCOVERY_CATEGORIES.filter(item => colors[item.label])) assert.equal(category.color, colors[category.label]);
  assert.equal(discoveryPost({ ...post, kind: 'story', tag: { slug: 'food' }, hashtags: ['카페'] }).category, 'cafe');
  assert.equal(discoveryPost({ ...post, tag: { slug: 'housing' } }, Date.parse('2026-10-15')).category, 'housing');
});
test('a festival topic stays in the festival filter even when its venue is a cafe or park', () => {
  for (const hashtags of [['카페', '페스티벌'], ['산책', 'festival'], ['전시', '도서관']]) {
    const item = discoveryPost({ ...post, kind: 'story', tag: { slug: 'festival' }, hashtags });
    assert.equal(item.category, 'festival');
    assert.equal(discoveryMatches(item, 'festival', ''), true);
    assert.equal(discoveryMatches(item, 'events', ''), true);
    assert.equal(discoveryMatches(item, 'cafe', ''), false);
  }
});
test('본문과 해시태그로 찾은 장소·리스팅을 다시 숨기지 않는다', () => {
  const item = discoveryPost({ ...post, body: `UBC 학생 환영\n${post.body}`, hashtags: ['가구정리'] }, Date.parse('2026-10-15T00:00:00Z'));
  assert.equal(discoveryMatches(item, 'used', 'ubc'), true);
  assert.equal(discoveryMatches(item, 'used', '가구정리'), true);
  assert.equal(discoveryMatches(item, 'housing', 'ubc'), false);
});
test('지도 화면·장소 화면의 Google Maps·Waze 버튼은 길안내를 바로 시작하지 않고 장소부터 연다 (QA C19-1)', () => {
  const at = { latitude: 49.28, longitude: -123.12, cityId: 'toronto' };
  const place = new URL(mapAppUrl({ ...at, place: { name: 'Anewen Greenbelt', address: '17 Anewen Drive, North York' } }, 'google'));
  assert.equal(place.pathname, '/maps/search/');
  assert.equal(place.searchParams.get('query'), 'Anewen Greenbelt, 17 Anewen Drive, North York, Toronto, ON, Canada');
  assert.equal(place.searchParams.has('destination'), false);
  assert.equal(place.searchParams.has('dir_action'), false);
  // 번지 없는 장소·행사·글은 이름 검색이 다른 지점을 열 수 있어 정확한 좌표 핀으로 연다.
  for (const item of [{ ...at, place: { name: 'Tim Hortons', address: '' } }, { ...at, place: { name: 'Tim Hortons', address: 'Toronto' } },
    { ...at, event: { venue: 'Rogers Arena', city: 'Vancouver' } }, at]) {
    const url = new URL(mapAppUrl(item, 'google'));
    assert.equal(url.pathname, '/maps/search/');
    assert.equal(url.searchParams.get('query'), '49.28,-123.12');
  }
  // Apple Maps: a pin named after the place at its spot, never a route (daddr).
  const apple = new URL(mapAppUrl({ ...at, place: { name: 'Science World', address: '1455 Quebec St' } }, 'apple'));
  assert.equal(apple.origin, 'https://maps.apple.com');
  assert.equal(apple.searchParams.get('q'), 'Science World');
  assert.equal(apple.searchParams.get('ll'), '49.28,-123.12');
  assert.equal(apple.searchParams.has('daddr'), false);
  assert.equal(new URL(mapAppUrl(at, 'apple')).searchParams.has('q'), false, 'without a name it is the exact pin');
  assert.throws(() => mapAppUrl({ latitude: 91, longitude: 0 }, 'apple'));
  const waze = new URL(mapAppUrl(at, 'waze'));
  assert.equal(waze.searchParams.get('ll'), '49.28,-123.12');
  assert.equal(waze.searchParams.has('navigate'), false);
  for (const bad of [{ latitude: NaN, longitude: 0 }, { latitude: 0, longitude: 181 }, { latitude: '49', longitude: 0 }]) assert.throws(() => mapAppUrl(bad, 'google'));
  assert.equal(new URL(mapAppUrl(at, 'google')).searchParams.has('key'), false, 'no API key or origin leaves the app');
  assert.doesNotMatch(readFileSync(new URL('../src/app/places/[id].tsx', import.meta.url), 'utf8'), /maps\/dir|dir_action|directionsUrl|daddr/);
  const map = readFileSync(new URL('../src/app/map.tsx', import.meta.url), 'utf8');
  assert.match(map, /Linking\.openURL\(mapAppUrl\(item, app\)\)/);
  assert.doesNotMatch(map, /directionsUrl/);
});
test('도시 시간대의 오늘·이번 주말 날짜를 계산한다', () => {
  const now = Date.parse('2026-10-17T02:00:00Z'); // 밴쿠버 금요일, 토론토 금요일
  assert.deepEqual(discoveryDays('today', 'vancouver', '', now), ['2026-10-16']);
  assert.deepEqual(discoveryDays('weekend', 'vancouver', '', now), ['2026-10-17', '2026-10-18']);
  assert.deepEqual(discoveryDays('weekend', 'toronto', '', Date.parse('2026-10-18T16:00:00Z')), ['2026-10-18']);
  assert.deepEqual(discoveryDays('date', 'vancouver', '2026-10-22', now), ['2026-10-22']);
  assert.throws(() => discoveryDays('date', 'vancouver', '2026-02-30', now));
});
test('행사 좌표를 만들어내지 않고 취소·종료 일정은 숨긴다', () => {
  const event = { id: 'e1', name: 'Fall Festival', venue: 'Park', startsAt: '2026-10-15T19:00:00Z', endsAt: '2026-10-16T04:00:00Z', localDate: '2026-10-15', status: 'onsale', country: 'CA', location: { latitude: 49.28, longitude: -123.12 } };
  assert.equal(discoveryEvent(event, 'vancouver', Date.parse('2026-10-15T20:00:00Z'), true).category, 'festival');
  assert.equal(discoveryEvent(event, 'vancouver', Date.parse('2026-10-15T20:00:00Z')).category, 'event', 'a festival name alone no longer decides the 페스티벌 chip');
  assert.equal(discoveryEvent({ ...event, location: null }, 'vancouver', Date.parse('2026-10-15T20:00:00Z')).latitude, null);
  assert.equal(discoveryEvent({ ...event, status: 'cancelled' }, 'vancouver'), null);
  assert.equal(discoveryEvent({ ...event, endsAt: '2020-01-01T00:00:00Z' }, 'vancouver'), null);
});

test('QA C22-2: a game in the festival row is named 스포츠 on its card and pin, other events keep their category', () => {
  const event = { id: 'e1', name: 'UBC Soccer Championship', venue: 'Thunderbird Stadium', startsAt: '2026-11-14T03:00:00Z', localDate: '2026-11-13', status: 'onsale', country: 'CA', location: { latitude: 49.25, longitude: -123.24 } };
  assert.equal(discoveryKind(discoveryEvent({ ...event, segment: 'Sports' }, 'vancouver', Date.parse('2026-11-13T20:00:00Z'), true)), '스포츠');
  assert.equal(discoveryKind(discoveryEvent({ ...event, segment: 'Music' }, 'vancouver', Date.parse('2026-11-13T20:00:00Z'), true)), '페스티벌');
  assert.equal(discoveryKind({ category: 'cafe' }), DISCOVERY_CATEGORIES.find(value => value.id === 'cafe').label);
});
