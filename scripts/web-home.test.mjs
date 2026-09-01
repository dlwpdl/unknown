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

test('listWebHomeCities keeps the live launch cities with real content counts', () => {
  const cities = listWebHomeCities();
  const openCities = cities.filter((city) => city.state === 'open');
  const vancouver = getWebHomeCitySummary('vancouver');
  const toronto = getWebHomeCitySummary('toronto');

  assert.equal(openCities.length, 2);
  assert.deepEqual(openCities.map((city) => city.id), ['vancouver', 'toronto']);
  assert.ok(vancouver.postCount > 0);
  assert.ok(vancouver.neighborhoodCount > 0);
  assert.ok(toronto.postCount > 0);
});

test('WEB_POLICY_ITEMS keeps every required trust disclosure', () => {
  assert.deepEqual(
    WEB_POLICY_ITEMS.map((item) => item.id),
    ['privacy', 'retention', 'admin-review', 'ai-review', 'appeal', 'contact'],
  );
});

test('legal pages expose the required public documents and safety disclosures', () => {
  assert.deepEqual(Object.keys(LEGAL_DOCUMENTS), ['terms', 'privacy', 'account-deletion']);
  assert.match(LEGAL_DOCUMENTS.privacy.summary, /게시글.*댓글.*대화/);
  assert.match(LEGAL_DOCUMENTS.privacy.summary, /자동 안전 분석/);
  assert.match(LEGAL_DOCUMENTS.privacy.summary, /관리자/);
  assert.match(LEGAL_DOCUMENTS['account-deletion'].summary, /앱을 사용할 수 없어도/);
});
