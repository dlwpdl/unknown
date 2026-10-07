import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  adminOptionKeys,
  adminTotpQrUri,
  canUseLocalAdminPreview,
  canResolveReport,
  filterAdminReports,
  initialAdminSection,
  isAdminRole,
  reportReasonLabel,
  reportStatusLabel,
  reportTargetLabel,
} from '../src/lib/admin.ts';

test('Supabase TOTP QR remains one readable SVG image without URL fragment truncation', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#000" d="M0 0h10v10H0z"/></svg>';
  for (const qr of [svg, `data:image/svg+xml;utf-8,${svg}`]) {
    const uri = adminTotpQrUri(qr);
    assert.equal(new URL(uri).hash, '');
    assert.equal(decodeURIComponent(uri.slice(uri.indexOf(',') + 1)), svg);
  }
});

test('MFA auth listener preserves an open editor on token refresh and clears factor material on logout', () => {
  const source = readFileSync(new URL('../src/components/admin/admin-mfa-gate.tsx', import.meta.url), 'utf8');
  const body = source.match(/onAuthStateChange\(\(event\) => \{([\s\S]*?)\n    \}\)/)?.[1];
  assert.ok(body, 'Locate the actual SDK listener so this checks the mounted gate behavior.');
  const listen = new Function('event', 'setResult', 'setRevision', 'setEnrollment', 'setCode', 'setShowKey', body);
  const verified = { id: 'admin', ready: true };
  let result = verified, revision = 0, enrollment = 'pending-factor', code = '123456', showKey = true;
  const event = (name) => listen(name, (v) => { result = v; }, (f) => { revision = f(revision); },
    (v) => { enrollment = v; }, (v) => { code = v; }, (v) => { showKey = v; });
  event('TOKEN_REFRESHED');
  assert.equal(result, verified, 'A refresh must not unmount and erase an unsaved merchant/report editor.');
  assert.equal(revision, 1, 'The refreshed session is still rechecked.');
  event('SIGNED_OUT');
  assert.equal(result, null); assert.equal(enrollment, null); assert.equal(code, ''); assert.equal(showKey, false);
});

test('관리자 알림의 목적지 섹션을 열고 알 수 없는 섹션은 무시한다', () => {
  assert.equal(initialAdminSection('users'), 'users');
  assert.equal(initialAdminSection('merchants'), 'merchants');
  assert.equal(initialAdminSection('errors'), 'errors');
  assert.equal(initialAdminSection(undefined, '1'), 'alerts');
  assert.equal(initialAdminSection(undefined, undefined, '12'), 'safety');
  assert.equal(initialAdminSection('unknown'), 'analytics');
});

test('관리자 필터와 탭은 화살표로 순환하고 Space로 선택한다', () => {
  const actions = [];
  const options = [0, 1, 2].map((index) => ({
    focus: () => actions.push(`focus:${index}`),
    click: () => actions.push(`click:${index}`),
    closest: () => ({ querySelectorAll: () => options }),
  }));
  const event = (key, index) => ({ key, currentTarget: options[index], preventDefault: () => actions.push('prevent') });
  adminOptionKeys(event('ArrowRight', 2));
  assert.deepEqual(actions.splice(0), ['prevent', 'focus:0', 'click:0']);
  adminOptionKeys(event('ArrowLeft', 0));
  assert.deepEqual(actions.splice(0), ['prevent', 'focus:2', 'click:2']);
  adminOptionKeys(event('Home', 2));
  assert.deepEqual(actions.splice(0), ['prevent', 'focus:0', 'click:0']);
  adminOptionKeys(event('End', 0));
  assert.deepEqual(actions.splice(0), ['prevent', 'focus:2', 'click:2']);
  adminOptionKeys(event(' ', 1));
  assert.deepEqual(actions.splice(0), ['prevent', 'click:1']);
  adminOptionKeys(event('Tab', 1));
  assert.deepEqual(actions, []);
});

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
