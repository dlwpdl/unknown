import assert from 'node:assert/strict';
import test from 'node:test';

import { ADMIN_COMPACT_WIDTH, ADMIN_NARROW_WIDTH, isCompactAdminWidth, isNarrowAdminWidth } from '../src/lib/admin-layout.ts';

test('폰 폭에서는 내비·필터·표를 접고 태블릿부터 데스크톱 배치를 쓴다', () => {
  assert.equal(ADMIN_COMPACT_WIDTH, 700);
  assert.equal(isCompactAdminWidth(390), true, 'iPhone 16 Pro Max 폭');
  assert.equal(isCompactAdminWidth(699), true);
  assert.equal(isCompactAdminWidth(700), false, '경계는 데스크톱 배치');
  assert.equal(isCompactAdminWidth(1024), false);
  assert.equal(isNarrowAdminWidth(ADMIN_NARROW_WIDTH - 1), true);
  assert.equal(isNarrowAdminWidth(ADMIN_NARROW_WIDTH), false);
});
