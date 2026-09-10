import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WEB_POLICY_ITEMS,
  getWebHomeCitySummary,
  listWebHomeCities,
} from '../src/lib/web-home.ts';
import { LEGAL_DOCUMENTS } from '../src/lib/legal-documents.ts';

test('getWebHomeCitySummary falls back to Vancouver', () => {
  assert.equal(getWebHomeCitySummary(undefined).id, 'vancouver');
  assert.equal(getWebHomeCitySummary('missing').id, 'vancouver');
});

test('launch cities stay in order without presenting mock counts as live activity', () => {
  const cities = listWebHomeCities();
  const openCities = cities.filter((city) => city.state === 'open');
  const vancouver = getWebHomeCitySummary('vancouver');
  const toronto = getWebHomeCitySummary('toronto');

  assert.equal(openCities.length, 2);
  assert.deepEqual(openCities.map((city) => city.id), ['vancouver', 'toronto']);
  for (const city of [vancouver, toronto]) {
    assert.equal(city.launchNote, '출시 준비 중');
    assert.equal(city.stateLabel, '출시 준비 중');
    assert.ok(!('postCount' in city));
    assert.ok(!('meetupCount' in city));
    assert.ok(!('neighborhoodCount' in city));
  }
});

test('WEB_POLICY_ITEMS lists the home policy summaries', () => {
  assert.deepEqual(
    WEB_POLICY_ITEMS.map((item) => item.id),
    ['privacy', 'retention', 'ai-review', 'appeal', 'contact'],
  );
});

test('legal pages expose the required public documents and safety disclosures', () => {
  assert.deepEqual(Object.keys(LEGAL_DOCUMENTS), ['terms', 'privacy', 'account-deletion']);
  assert.match(LEGAL_DOCUMENTS.privacy.summary, /게시글.*댓글.*대화/);
  assert.match(LEGAL_DOCUMENTS.privacy.summary, /자동 안전 분석/);
  assert.match(LEGAL_DOCUMENTS.privacy.summary, /관리자/);
  assert.match(LEGAL_DOCUMENTS['account-deletion'].summary, /앱을 사용할 수 없어도/);
});
