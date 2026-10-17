import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { discoveryPost, discoveryEvent, discoveryDays, discoveryMatches, directionsUrl, DISCOVERY_CATEGORIES } from '../src/lib/discovery.ts';

const post = { id: 'p1', cityId: 'vancouver', author: { id: 'u1' }, tag: { slug: 'used' }, kind: 'listing', listingStatus: 'open', expiresAt: '2027-01-01T00:00:00Z', price: 20, title: '책상', body: '거래 장소\n\nGoogle 지도: https://www.google.com/maps/search/?api=1&query=49.28%2C-123.12\n위치: 도서관 앞' };
test('a Google Maps attachment does not turn an unrelated community topic into a discovery listing', () => {
  for (const slug of ['life', 'settlement', 'jobs', 'education', 'transport', 'meetup', 'business']) {
    assert.equal(discoveryPost({ ...post, kind: 'story', tag: { slug }, hashtags: ['카페'], title: '일반 질문' }), null, slug);
  }
  for (const slug of ['food', 'travel', 'festival', 'shopping']) {
    assert.ok(discoveryPost({ ...post, kind: 'story', tag: { slug } }), slug);
  }
});
test('지도에는 공개 첨부 핀만 쓰며 거래 종료·만료 위치는 제외한다', () => {
  const item = discoveryPost(post, Date.parse('2026-10-15T00:00:00Z'));
  assert.equal(item.category, 'used');
  assert.equal(item.label, '도서관 앞');
  assert.equal(item.latitude, 49.28);
  assert.equal(discoveryPost({ ...post, body: '위치 없는 글', location_snapshot: { latitude: 49, longitude: -123 } }, Date.parse('2026-10-15')), null);
  assert.equal(discoveryPost({ ...post, listingStatus: 'closed' }, Date.parse('2026-10-15')), null);
  assert.equal(discoveryPost({ ...post, expiresAt: '2020-01-01T00:00:00Z' }, Date.parse('2026-10-15')), null);
  const unresolved = discoveryPost({ ...post, body: 'Google 지도: https://www.google.com/maps/search/?api=1&query=Kitsilano%2C+Vancouver' }, Date.parse('2026-10-15T00:00:00Z'));
  assert.equal(unresolved.latitude, null);
  assert.equal(unresolved.label, 'Kitsilano, Vancouver');
});
test('릴스 카테고리 색을 바꾸지 않고 장소 유형을 구분한다', () => {
  const colors = JSON.parse(readFileSync(new URL('./fixtures/discovery-category-colors.json', import.meta.url))).categoryPointColors;
  for (const category of DISCOVERY_CATEGORIES.filter(item => colors[item.label])) assert.equal(category.color, colors[category.label]);
  assert.equal(discoveryPost({ ...post, kind: 'story', tag: { slug: 'food' }, hashtags: ['카페'] }).category, 'cafe');
  assert.equal(discoveryPost({ ...post, tag: { slug: 'housing' } }, Date.parse('2026-10-15')).category, 'housing');
});
test('본문과 해시태그로 찾은 장소·리스팅을 다시 숨기지 않는다', () => {
  const item = discoveryPost({ ...post, body: `UBC 학생 환영\n${post.body}`, hashtags: ['가구정리'] }, Date.parse('2026-10-15T00:00:00Z'));
  assert.equal(discoveryMatches(item, 'used', 'ubc'), true);
  assert.equal(discoveryMatches(item, 'used', '가구정리'), true);
  assert.equal(discoveryMatches(item, 'housing', 'ubc'), false);
});
test('길찾기는 검증한 좌표만 전달하고 출발지나 별도 API 키는 보내지 않는다', () => {
  const google = new URL(directionsUrl({ latitude: 49.28, longitude: -123.12 }, 'google'));
  assert.equal(google.pathname, '/maps/dir/');
  assert.equal(google.searchParams.get('destination'), '49.28,-123.12');
  assert.equal(google.searchParams.has('origin'), false);
  assert.equal(google.searchParams.has('key'), false);
  const waze = new URL(directionsUrl({ latitude: 49.28, longitude: -123.12 }, 'waze'));
  assert.equal(waze.host, 'waze.com');
  assert.equal(waze.searchParams.get('navigate'), 'yes');
  for (const bad of [{ latitude: NaN, longitude: 0 }, { latitude: 0, longitude: 181 }, { latitude: '49', longitude: 0 }]) assert.throws(() => directionsUrl(bad, 'google'));
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
  assert.equal(discoveryEvent(event, 'vancouver', Date.parse('2026-10-15T20:00:00Z')).category, 'festival');
  assert.equal(discoveryEvent({ ...event, location: null }, 'vancouver', Date.parse('2026-10-15T20:00:00Z')).latitude, null);
  assert.equal(discoveryEvent({ ...event, status: 'cancelled' }, 'vancouver'), null);
  assert.equal(discoveryEvent({ ...event, endsAt: '2020-01-01T00:00:00Z' }, 'vancouver'), null);
});
