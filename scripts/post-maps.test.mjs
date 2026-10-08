import assert from 'node:assert/strict';
import test from 'node:test';
import { googleMapsUrl, postMapBody, withPostMap } from '../src/lib/post-maps.ts';

const place = 'https://www.google.com/maps/search/?api=1&query=Vancouver';

test('Google 지도의 장소·검색·공유 링크를 정규화한다', () => {
  for (const value of [place, 'https://google.ca/maps/place/Vancouver', 'https://www.google.co.kr/maps/place/Vancouver', 'https://maps.google.com/?q=Vancouver', 'https://maps.app.goo.gl/AbCd123', 'https://goo.gl/maps/AbCd123']) {
    assert.equal(googleMapsUrl(`  ${value}  `), new URL(value).href);
  }
});

test('지도 외 주소·가짜 Google 도메인·실행 가능한 주소를 거부한다', () => {
  for (const value of ['', 'Vancouver', 'javascript:alert(1)', 'http://google.com/maps', 'https://google.com/maps.evil', 'https://google.com/', 'https://maps.app.goo.gl.evil.test/123', 'https://user:secret@google.com/maps', 'https://google.com:8443/maps']) {
    assert.equal(googleMapsUrl(value), null, value);
  }
});

test('지도 입력 없이 쓴 글은 그대로 남고 지도 입력은 별도 줄로 저장한다', () => {
  assert.equal(withPostMap('본문', ''), '본문');
  const stored = withPostMap('첫 문단\n\n둘째 문단', place);
  assert.equal(stored, `첫 문단\n\n둘째 문단\n\nGoogle 지도: ${place}`);
  assert.deepEqual(postMapBody(stored), { body: '첫 문단\n\n둘째 문단', url: place });
});

test('본문에 직접 붙인 지도도 표시하고 잘못된 링크를 숨기지 않는다', () => {
  assert.deepEqual(postMapBody(`본문\n\n${place}`), { body: '본문', url: place });
  const body = '안내\nGoogle 지도: https://evil.test/maps';
  assert.deepEqual(postMapBody(body), { body, url: null });
});

test('지도를 바꾸면 이전 지도 줄을 교체하고 중복을 만들지 않는다', () => {
  const stored = withPostMap('본문', place);
  assert.equal(withPostMap(stored, place), stored);
  assert.deepEqual(postMapBody(withPostMap(stored, 'https://maps.app.goo.gl/OtherPlace')), { body: '본문', url: 'https://maps.app.goo.gl/OtherPlace' });
  assert.throws(() => withPostMap('본문', 'https://evil.test/maps'), /INVALID_MAP_LINK/);
});

test('지도와 본문을 합쳐 DB의 4000자 한도를 지키고 이모지를 두 글자로 세지 않는다', () => {
  assert.throws(() => withPostMap('가'.repeat(4000), place), /POST_BODY_TOO_LONG/);
  const body = '😀'.repeat(3900);
  assert.equal(postMapBody(withPostMap(body, place)).body, body);
});
