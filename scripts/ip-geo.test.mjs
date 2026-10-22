import assert from 'node:assert/strict';
import test from 'node:test';
import { formatIpGeo, formatIpGeoShort, lookupIpGeo, parseIpGeo } from '../src/lib/ip-geo.ts';

test('IP 위치 응답에서 국가·도시를 읽는다', () => {
  const geo = parseIpGeo({ ip: '168.126.63.1', success: true, country: 'South Korea', country_code: 'KR', city: 'Seoul', region: 'Seoul', connection: { isp: 'Korea Telecom' } });
  assert.deepEqual(geo, { country: 'South Korea', countryCode: 'KR', city: 'Seoul', region: 'Seoul', isp: 'Korea Telecom' });
  assert.equal(formatIpGeo(geo), 'South Korea · Seoul, Seoul · Korea Telecom');
  assert.equal(formatIpGeoShort(geo), 'South Korea, Seoul · Korea Telecom');
});

test('도시가 비면 국가·지역만 보여주고 통신사는 org로 대체한다', () => {
  assert.equal(formatIpGeo(parseIpGeo({ country: 'Canada', country_code: 'CA', region: 'Quebec', connection: { org: 'Rogers Communications' } })), 'Canada · Quebec · Rogers Communications');
  assert.equal(formatIpGeo(parseIpGeo({ country: 'United States', country_code: 'US' })), 'United States');
  assert.equal(parseIpGeo({ country: 'South Korea', connection: { isp: '   ' } }).isp, null);
});

test('국가가 없는 응답은 추정 결과 없음으로 다룬다', () => {
  assert.equal(parseIpGeo({ country: '  ', city: 'Seoul' }), null);
  assert.equal(parseIpGeo({ success: false, message: 'Invalid IP address' }), null);
  assert.equal(parseIpGeo(null), null);
  assert.equal(parseIpGeo('blocked'), null);
});

test('IP가 없으면 조회하지 않는다', async () => {
  assert.equal(await lookupIpGeo(null), null);
  assert.equal(await lookupIpGeo('   '), null);
});
