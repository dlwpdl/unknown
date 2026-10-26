import assert from 'node:assert/strict';
import test from 'node:test';
import { googleMapsUrl, postMapBody, withPostMap } from '../src/lib/post-maps.ts';
import * as maps from '../src/lib/post-maps.ts';
import { splitPostPhotoCredits } from '../src/lib/post-photo-credits.ts';

const place = 'https://www.google.com/maps/search/?api=1&query=Vancouver';

test('선택한 핀은 좌표와 place ID로 Google Maps에 연결하고 표시 이름으로 다시 검색하지 않는다', () => {
  assert.equal(typeof maps.googlePinUrl, 'function', '좌표 핀 공유가 아직 없다');
  const pin = { latitude: 49.2712, longitude: -123.134, placeId: 'ChIJ_example' };
  const url = maps.googlePinUrl(pin);
  assert.equal(new URL(url).searchParams.get('query'), '49.2712,-123.134');
  assert.equal(new URL(url).searchParams.get('query_place_id'), 'ChIJ_example');
  assert.deepEqual(maps.googleMapsPin(url), pin);
  assert.equal(maps.googleMapsPin(place), null);
  for (const latitude of [-91, 91, NaN, Infinity]) assert.throws(() => maps.googlePinUrl({ latitude, longitude: 0 }), /INVALID_MAP_PIN/);
  assert.throws(() => maps.googlePinUrl({ latitude: 0, longitude: 181 }), /INVALID_MAP_PIN/);
  assert.equal(maps.googleMapsPin('https://evil.test/maps?query=0,0'), null);
  assert.equal(maps.googleMapsPin('https://google.com/maps/search/?api=1&query=91,0'), null);
});

test('위치 이름을 바꿔도 핀은 같고 본문 편집·사진 출처·기존 첨부를 보존한다', () => {
  assert.equal(typeof maps.googlePinUrl, 'function', '좌표 핀 공유가 아직 없다');
  const url = maps.googlePinUrl({ latitude: 49.2712, longitude: -123.134 });
  const body = '장보기 메모\n\n첨부 링크\nhttps://www.instagram.com/gling.app/\n\n사진 출처·이용 조건\n사진: https://commons.wikimedia.org/wiki/File:Example.jpg · CC BY';
  const stored = withPostMap(body, url, '그랜빌마켓');
  assert.equal(postMapBody(stored).label, '그랜빌마켓');
  assert.equal(postMapBody(stored).body, body);
  assert.equal(postMapBody(withPostMap(stored, url, 'Granville Market')).url, url);
  assert.equal(postMapBody(withPostMap(stored, url, 'Granville Market')).label, 'Granville Market');
  assert.equal(postMapBody(withPostMap(stored, url)).label, '그랜빌마켓');
  const photo = splitPostPhotoCredits(stored);
  assert.ok(photo.credits.includes('CC BY'));
  assert.equal(postMapBody(photo.body).label, '그랜빌마켓');
  assert.throws(() => withPostMap('본문', url, '위치\n가짜 정보'), /INVALID_MAP_LABEL/);
  assert.throws(() => withPostMap('가'.repeat(3970), url, '선택 위치'), /POST_BODY_TOO_LONG/);
});

test('장소명이나 주소는 게시 도시와 함께 Google Maps 검색으로 연결한다', () => {
  assert.equal(typeof maps.postLocationUrl, 'function', '장소 입력 연결이 아직 없다');
  for (const input of ['그랜빌아일랜드 퍼블릭마켓', '1100 Chestnut Street', 'Museum of Vancouver & garden']) {
    const url = maps.postLocationUrl(` ${input} `, 'Vancouver');
    assert.equal(googleMapsUrl(url), url);
    assert.equal(new URL(url).searchParams.get('query'), `${input}, Vancouver`);
    assert.equal(new URL(url).searchParams.get('api'), '1');
  }
  assert.equal(maps.postLocationUrl('  ', 'Vancouver'), null);
});

test('위치 입력의 공유 링크는 보존하고 위험하거나 잘못된 URL을 장소로 바꾸지 않는다', () => {
  assert.equal(typeof maps.postLocationUrl, 'function', '장소 입력 연결이 아직 없다');
  assert.equal(maps.postLocationUrl('https://maps.app.goo.gl/AbCd123', 'Vancouver'), 'https://maps.app.goo.gl/AbCd123');
  for (const input of ['https://evil.test/maps', 'http://google.com/maps', 'javascript:alert(1)', 'www.google.com/maps', 'google.com/maps', '밴쿠버\n토론토', '가'.repeat(2048)]) {
    assert.equal(maps.postLocationUrl(input, 'Vancouver'), null, input.slice(0, 50));
  }
});

test('위치 교체와 삭제가 본문과 SNS 첨부를 보존한다', () => {
  const body = '시장 메모\n\n첨부 링크\nhttps://www.instagram.com/gling.app/';
  const stored = withPostMap(body, place);
  const replaced = withPostMap(stored, 'https://maps.app.goo.gl/NewPlace');
  assert.equal(postMapBody(replaced).body, body);
  assert.equal(postMapBody(replaced).url, 'https://maps.app.goo.gl/NewPlace');
  assert.equal(postMapBody(stored).body, body);
});

test('위치 첨부가 사진 출처 뒤로 들어가 지도 버튼이나 사진 이용 조건을 숨기지 않는다', () => {
  const credit = '사진: https://commons.wikimedia.org/wiki/File:Example.jpg · CC BY';
  const stored = withPostMap(`전시 메모\n\n사진 출처·이용 조건\n${credit}`, place);
  const photographed = splitPostPhotoCredits(stored);
  assert.equal(photographed.credits, credit);
  assert.deepEqual(postMapBody(photographed.body), { body: '전시 메모', url: place });
});

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

test('draft map round-trips opt into whitespace preservation while public readers retain their existing formatting', () => {
  for (const body of ['  첫 줄\n\n', '\n', '\n\n', '😀\n다음 줄  ']) {
    const stored = withPostMap(body, place, '선택 장소', { preserveWhitespace: true });
    assert.equal(postMapBody(stored, { preserveWhitespace: true }).body, body);
    assert.equal(postMapBody(stored).body, body.trim());
    assert.equal(postMapBody(stored).label, '선택 장소');
  }
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

test('지도와 본문을 합쳐 DB의 1000자 한도를 지키고 이모지를 두 글자로 세지 않는다', () => {
  assert.throws(() => withPostMap('가'.repeat(1000), place), /POST_BODY_TOO_LONG/);
  const body = '😀'.repeat(900);
  assert.equal(postMapBody(withPostMap(body, place)).body, body);
});
