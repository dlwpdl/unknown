import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canUseLocalAdminPreview,
  canResolveReport,
  filterAdminReports,
  isAdminRole,
  reportReasonLabel,
  reportStatusLabel,
  reportTargetLabel,
} from '../src/lib/admin.ts';

test('관리자 로그인 우회는 개발 중 localhost에서만 허용한다', () => {
  assert.equal(canUseLocalAdminPreview(true, 'localhost'), true);
  assert.equal(canUseLocalAdminPreview(true, '127.0.0.1'), true);
  assert.equal(canUseLocalAdminPreview(true, 'gling.app'), false);
  assert.equal(canUseLocalAdminPreview(false, 'localhost'), false);
});

test('서버 app_metadata의 명시적인 admin 역할만 관리자다', () => {
  assert.equal(isAdminRole({ role: 'admin' }), true);
  assert.equal(isAdminRole({ role: 'Admin' }), false);
  assert.equal(isAdminRole({ role: 'user', admin: true }), false);
  assert.equal(isAdminRole(null), false);
});

test('열린 신고만 처리할 수 있다', () => {
  assert.equal(canResolveReport('open'), true);
  assert.equal(canResolveReport('actioned'), false);
  assert.equal(canResolveReport('dismissed'), false);
});

test('신고 상태를 운영자가 바로 이해할 수 있는 한국어로 표시한다', () => {
  assert.equal(reportStatusLabel('open'), '미처리');
  assert.equal(reportStatusLabel('actioned'), '조치함');
  assert.equal(reportStatusLabel('dismissed'), '기각');
});

test('신고 큐는 미처리를 먼저 보여주고 상태별로 필터링한다', () => {
  const reports = [
    { id: 'handled', status: 'actioned' },
    { id: 'open', status: 'open' },
    { id: 'dismissed', status: 'dismissed' },
  ];

  assert.deepEqual(filterAdminReports(reports, 'all').map(({ id }) => id), ['open', 'handled', 'dismissed']);
  assert.deepEqual(filterAdminReports(reports, 'actioned').map(({ id }) => id), ['handled']);
  assert.deepEqual(reports.map(({ id }) => id), ['handled', 'open', 'dismissed']);
});

test('신고 내부 코드를 한국어 운영 용어로 표시한다', () => {
  assert.equal(reportReasonLabel('harassment'), '괴롭힘');
  assert.equal(reportReasonLabel('privacy'), '개인정보 침해');
  assert.equal(reportTargetLabel('message'), '메시지');
});
