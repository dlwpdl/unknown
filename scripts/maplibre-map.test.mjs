import assert from 'node:assert/strict';
import test from 'node:test';
import { mapMessage, mapHtml, mapPinScript, mapPreviews, rememberMapPreview } from '../src/lib/post-map-html.ts';
import { LEGAL_DOCUMENTS } from '../src/lib/legal-documents.ts';

test('지도 브리지에서 잘못된 형식·좌표·과도한 데이터와 임의 링크를 거부한다', () => {
  for (const raw of ['oops', '{}', JSON.stringify({ type: 'pick', pin: { latitude: 91, longitude: 0 } }), JSON.stringify({ type: 'pick', pin: { latitude: '49', longitude: 0 } }), JSON.stringify({ type: 'credit', url: 'https://evil.test' }), JSON.stringify({ type: 'snapshot', uri: 'javascript:alert(1)' }), 'x'.repeat(300001)]) assert.equal(mapMessage(raw), null);
  assert.deepEqual(mapMessage(JSON.stringify({ type: 'pick', pin: { latitude: 49.2, longitude: -123.1 }, label: '  카페\n이름  ' })), { type: 'pick', pin: { latitude: 49.2, longitude: -123.1 }, label: '카페 이름' });
  assert.deepEqual(mapMessage('{"type":"ready"}'), { type: 'ready' });
  assert.deepEqual(mapMessage('{"type":"credit","url":"https://www.openstreetmap.org/copyright"}'), { type: 'credit', url: 'https://www.openstreetmap.org/copyright' });
});

test('숫자 핀만 스크립트에 들어가고 지도 코드는 로컬 번들·무료 지도 서버를 사용한다', () => {
  const html = mapHtml({ pin: { latitude: 49.2, longitude: -123.1 }, accent: '#CBB9FF', preview: false, cityName: 'Vancouver' });
  assert.ok(html.includes('https://tiles.openfreemap.org/styles/liberty'));
  assert.ok(html.includes('connect-src https://tiles.openfreemap.org'));
  assert.ok(!html.includes('<script src='));
  assert.ok(html.includes("script-src 'nonce-gling-map' blob:"));
  assert.ok(!html.includes('new maplibregl.AttributionControl'));
  assert.throws(() => mapPinScript(null, NaN));
  assert.ok(!html.includes('maps.googleapis.com'));
  assert.ok(html.includes('OpenStreetMap'));
  assert.throws(() => mapHtml({ pin: null, accent: '</style><script>alert(1)</script>' }));
  assert.throws(() => mapPinScript({ latitude: NaN, longitude: 0 }));
  assert.ok(mapPinScript({ latitude: 49.2, longitude: -123.1 }).includes('49.2'));
  assert.ok(!mapHtml({ pin: null, cityName: '</script>', accent: '#CBB9FF' }).includes('cityName":"</script>'));
});

test('미리보기 이미지는 메모리에24개까지만 유지하고 외부 이미지 주소를 저장하지 않는다', () => {
  mapPreviews.clear();
  for (let i = 0; i < 25; i++) rememberMapPreview(String(i), 'data:image/jpeg;base64,/9j/AA==');
  assert.equal(mapPreviews.size, 24);
  assert.equal(mapPreviews.has('0'), false);
  assert.equal(mapPreviews.get('24'), 'data:image/jpeg;base64,/9j/AA==');
  assert.throws(() => rememberMapPreview('bad', 'https://evil.test/tracking.jpg'));
  assert.equal(mapPreviews.size, 24);
  mapPreviews.clear();
});

test('직접 게시한 지도 핀과 도시 추천용 비공개 위치 기록을 구분해 안내한다', () => {
  const privacy = JSON.stringify(LEGAL_DOCUMENTS.privacy);
  assert.ok(privacy.includes('첨부한 장소명과 좌표'));
  assert.ok(privacy.includes('OpenFreeMap'));
  assert.ok(privacy.includes('도시 추천용 위치 기록'));
  assert.ok(privacy.includes('30일'));
  assert.ok(!privacy.includes('공개되는 위치 정보는 사용자가 선택한 도시뿐입니다'));
});
