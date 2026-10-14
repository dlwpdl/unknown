import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { createRoot } from 'react-dom/client';
import ts from 'typescript';
import * as performanceApi from '../src/lib/admin-performance.ts';
import * as analyticsApi from '../src/lib/admin-analytics.ts';
import * as admin from '../src/lib/admin.ts';
import * as labels from '../src/lib/admin-labels.ts';
import * as layout from '../src/lib/admin-layout.ts';
import * as mock from '../src/lib/mock.ts';

// A memory host for real React DOM and hooks; only the native UI/feedback and Supabase boundary are replaced.
class HostNode {
  constructor(name, ownerDocument, nodeType = 1) {
    this.nodeName = name.toUpperCase(); this.tagName = this.nodeName; this.localName = name;
    this.nodeType = nodeType; this.ownerDocument = ownerDocument; this.namespaceURI = 'http://www.w3.org/1999/xhtml';
    this.childNodes = []; this.attributes = {}; this.style = {}; this.parentNode = null; this.value = '';
  }
  appendChild(node) { node.parentNode?.removeChild(node); this.childNodes.push(node); node.parentNode = this; return node; }
  insertBefore(node, before) { node.parentNode?.removeChild(node); this.childNodes.splice(this.childNodes.indexOf(before), 0, node); node.parentNode = this; return node; }
  removeChild(node) { this.childNodes.splice(this.childNodes.indexOf(node), 1); node.parentNode = null; return node; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener() {}
  removeEventListener() {}
  focus() { this.ownerDocument.activeElement = this; }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes.at(-1) ?? null; }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) { this.childNodes = []; if (value) this.appendChild(this.ownerDocument.createTextNode(String(value))); }
}
const document = {
  nodeType: 9, activeElement: null, addEventListener() {}, removeEventListener() {},
  createElement: name => new HostNode(name, document),
  createElementNS: (_, name) => new HostNode(name, document),
  createTextNode(value) { const node = new HostNode('#text', document, 3); node.nodeValue = String(value); return node; },
};
document.documentElement = document.createElement('html');
document.body = document.createElement('body');
const window = { document, HTMLIFrameElement: class {}, HTMLElement: HostNode };
document.defaultView = window;
globalThis.document = document;
globalThis.window = window;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const filters = { days: 30, city: null, tier: 'all', includeInternal: false, offset: 0 };
const stamp = '2026-10-14T12:00:00Z';
function payload() {
  return {
    generatedAt: stamp, periodStart: '2026-09-15T00:00:00Z', collectionStartedAt: '2026-09-20T00:00:00Z', trackingAvailableAt: '2026-10-14T00:00:00Z',
    activity: { dau: 0, wau: 0, mau: 0, activeUsers: 0, visits: 0, visitsPerUser: null,
      daily: [{ day: '2026-09-19', users: null, visits: null, signups: 2 }, { day: '2026-10-14', users: 0, visits: 0, signups: 0 }], platforms: [] },
    growth: { newMembers: 2, activatedMembers: 0, activationRate: 0, sourceStartedAt: null, sources: [], onboarding: [] },
    retention: [{ days: 1, eligible: 2, returned: 0, pending: 0, rate: 0 }, { days: 7, eligible: 0, returned: 0, pending: 2, rate: null }, { days: 30, eligible: 0, returned: 0, pending: 0, rate: null }],
    cohorts: [{ day: '2026-10-13', joined: 2, retention: [{ days: 1, eligible: 2, returned: 0, pending: 0, rate: 0 }, { days: 7, eligible: 0, returned: 0, pending: 2, rate: null }, { days: 30, eligible: 0, returned: 0, pending: 2, rate: null }] }],
    community: { posts: 0, authors: 0, comments: 0, commenters: 0, meetupRequests: 0, approvedRequests: 0, mutualConversations: 0, savedPosts: 0, sharedPosts: 0 },
    discovery: { startedAt: null, legacyEventViews: null, rows: [], eventSaves: null, eventShares: null, placeSaves: null, placeShares: null },
    notifications: { clickStartedAt: null, deliverySince: '2026-10-08T12:00:00Z', generated: 0, providerAccepted: 0, failed: 0, pushOpens: null, inboxOpens: null, clickRate: null, activeAfterOpen: null, optedInMembers: 0, preferenceMembers: 0, rows: [] },
    revenue: { paidMembers: 0, paidConversion: 0, renewals: 0, cancellations: 0, refunds: null, settlement: null, currencies: [] },
    quality: { errorStartedAt: null, versions: [], errorGroups: [], failures: [], openReports: 0, resolvedReports: 0, averageResolutionHours: null },
  };
}
function basePayload() {
  return { generatedAt: stamp, periodStart: stamp, collectionStartedAt: stamp,
    counts: { members: 0, newMembers: 0, posts: 0, activeUsers: 0, screenViews: 0, visits: 0, uniquePostViews: 0 },
    daily: [], memberships: [], cities: [], ages: [], members: [], visits: [], auditSummary: [], audit: [], errors: [], purchases: [], buyers: [], paymentEvents: [], promotions: { connected: false } };
}
const walk = node => [node, ...node.childNodes.flatMap(walk)];
const props = node => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))] ?? {};
const accessibleText = node => node.getAttribute('aria-hidden') === 'true' ? '' : node.nodeType === 3 ? node.nodeValue : node.childNodes.map(accessibleText).join('');
const find = (root, role, label) => walk(root).find(node => (node.getAttribute('role') ?? (node.tagName === 'BUTTON' ? 'button' : null)) === role && (node.getAttribute('aria-label') === label || accessibleText(node) === label));
const area = (root, title) => walk(root).find(node => node.getAttribute('aria-label') === title);
const metric = (root, label) => find(root, 'group', label)?.textContent;
const row = (table, text) => {
  const found = walk(table).find(node => node.getAttribute('role') === 'row' && node.textContent.includes(text));
  assert.ok(found, `${text} row must be rendered`); return found;
};

function app(entry = 'performance', initial = {}) {
  const calls = [], feedback = [], modules = new Map();
  const nativeProps = input => {
    const output = { children: input.children, role: input.role ?? input.accessibilityRole, 'aria-label': input.accessibilityLabel };
    for (const key of ['aria-selected', 'aria-checked', 'aria-disabled', 'aria-level', 'tabIndex']) if (key in input) output[key] = input[key];
    return output;
  };
  const native = {
    Platform: { OS: 'web', select: values => values.web ?? values.default },
    StyleSheet: { create: value => value, hairlineWidth: 1 },
    useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
    View: input => React.createElement('div', nativeProps(input)),
    ScrollView: input => React.createElement('div', { ...nativeProps(input), onFocus: input.onFocus, 'data-horizontal': input.horizontal ? 'true' : undefined }, input.children),
    Pressable: input => React.createElement('button', { ...nativeProps(input), type: 'button', disabled: input.disabled, onClick: input.onPress, onKeyDown: input.onKeyDown }, input.children),
    Switch: input => React.createElement('button', { role: 'switch', 'aria-label': input.accessibilityLabel, 'aria-checked': input.value, onClick: () => input.onValueChange(!input.value) }),
  };
  const client = { rpc(name, args) { return new Promise((resolve, reject) => calls.push({ name, args: JSON.parse(JSON.stringify(args)), resolve, reject })); } };
  const imports = {
    react: React, 'react/jsx-runtime': jsxRuntime, 'react-native': native,
    '@/components/themed-text': { ThemedText: input => React.createElement('span', nativeProps(input)) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
    '@/lib/admin-performance': performanceApi, '@/lib/admin-analytics': analyticsApi,
    '@/lib/admin': admin, '@/lib/admin-labels': labels, '@/lib/admin-layout': layout,
    '@/lib/mock': mock, '@/lib/supabase': { supabase: client },
  };
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative);
    const file = new URL(`../src/${relative}`, import.meta.url);
    if (!existsSync(file)) return {};
    const exports = {}; modules.set(relative, exports);
    const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(source, { exports, Error, require(name) {
      if (name in imports) return imports[name];
      if (name.endsWith('.css')) return {};
      if (name === '@/lib/admin-data') return load('lib/admin-data.ts');
      if (name === '@/constants/theme') return load('constants/theme.ts');
      if (name === './admin-performance') return load('components/admin/admin-performance.tsx');
      if (name === './admin-table-controls') return load('components/admin/admin-table-controls.tsx');
      throw new Error(`Unexpected dependency: ${name}`);
    } });
    return exports;
  }
  const Component = entry === 'performance' ? load('components/admin/admin-performance.tsx').AdminPerformanceView : load('components/admin/admin-analytics.tsx').AdminAnalyticsView;
  assert.equal(typeof Component, 'function', 'the approved AdminPerformanceView export must exist');
  let input = { filters, localPreview: false, refreshSignal: 0, onUser() {}, ...initial };
  const container = document.createElement('div'), root = createRoot(container);
  const render = async next => { input = { ...input, ...next }; await React.act(async () => root.render(React.createElement(Component, input))); return container; };
  const press = async (role, label) => {
    const control = find(container, role, label); assert.ok(control, `${role} ${label} must be rendered`);
    assert.ok(!control.disabled, `${label} must be enabled`);
    await React.act(async () => props(control).onClick());
  };
  const answer = async (index, data = payload(), error = null) => { await React.act(async () => calls[index].resolve({ data, error })); };
  const unmount = async () => { await React.act(async () => root.unmount()); };
  return { container, calls, feedback, render, press, answer, unmount };
}
test('real rendering separates loading, valid zero, null collectors and all eight areas', async () => {
  const view = app();
  try {
    await view.render();
    assert.ok(find(view.container, 'progressbar', '성과 데이터 불러오는 중'));
    assert.equal(metric(view.container, 'DAU'), undefined);
    await view.answer(0);
    for (const title of ['성장·유입', '활동', '재방문·코호트', '커뮤니티', '행사·장소', '알림', '수익', '품질']) assert.ok(area(view.container, title), title);
    assert.match(metric(view.container, 'DAU'), /0/);
    assert.match(metric(view.container, '가입 후 활동률'), /0%/);
    assert.match(metric(view.container, '푸시 탭'), /미수집/);
    assert.match(metric(view.container, '환불'), /미연결/);
    assert.match(area(view.container, '행사·장소').textContent, /수집 대기/);
    assert.match(area(view.container, '수익').textContent, /기록이 없습니다/);
  } finally { await view.unmount(); }
});

test('pending and eligible-zero retention remain different from an observed zero percent', async () => {
  const view = app();
  try {
    await view.render(); await view.answer(0);
    const table = area(view.container, 'D1·D7·D30 재방문');
    assert.match(row(table, 'D1').textContent, /0%/);
    assert.match(row(table, 'D7').textContent, /관측 중/);
    assert.doesNotMatch(row(table, 'D7').textContent, /0%/);
    assert.match(row(table, 'D30').textContent, /대상 없음/);
    assert.doesNotMatch(row(table, 'D30').textContent, /0%/);
    const cohort = row(area(view.container, '가입일별 재방문'), '2026-10-13');
    assert.match(cohort.textContent, /D1.*0%.*D7.*관측 중.*D30.*관측 중/s);
    const scroller = walk(area(view.container, '가입일별 재방문')).find(node => node.getAttribute('data-horizontal') === 'true');
    assert.ok(scroller);
    assert.equal(scroller.getAttribute('tabindex'), '0', 'the wide cohort table must be keyboard focusable');
    await React.act(async () => props(scroller).onFocus());
    assert.equal(view.feedback.at(-1), 'selection');
  } finally { await view.unmount(); }
});

test('source start is independent of visit collection and keeps pending acquisition honest', async () => {
  const view = app();
  try {
    await view.render(); await view.answer(0);
    const growth = area(view.container, '성장·유입');
    assert.match(growth.textContent, /유입 수집 대기/);
    assert.doesNotMatch(growth.textContent, /2026-09-20/);
    const next = payload(); next.growth.sourceStartedAt = '2026-10-12T00:00:00Z';
    next.growth.sources = [{ source: 'instagram', sessions: 4, signupSessions: 1, signupRate: 25 }];
    await view.render({ refreshSignal: 1 }); await view.answer(1, next);
    assert.match(area(view.container, '성장·유입').textContent, /2026.*10.*12/);
    assert.match(area(view.container, '유입 채널').textContent, /Instagram.*25%/);
  } finally { await view.unmount(); }
});

test('captions retain city, platform, delivery, revenue and report scope', async () => {
  const view = app();
  try {
    await view.render(); await view.answer(0);
    const text = view.container.textContent;
    for (const meaning of [/현재 저장한 선호 지역/, /일반 멤버십/, /대상 도시/, /플랫폼.*방문.*행동.*행사.*장소.*알림/, /운영 캐릭터/, /가입.*글.*모임.*결제.*신고.*발송/, /APNs.*FCM.*접수/, /단말.*표시/, /최대 7일/, /2026.*10.*08/, /알림.*입구.*기기/, /30분.*고유 회원/, /인과|증가 효과/, /현재.*설정.*스냅샷/, /통화별.*총.*결제/, /정산/, /갱신 해지/, /같은 기간 첫 결제/, /현재.*미처리/, /기간.*해결/, /실패.*회원/, /회원 신고/]) assert.match(text, meaning);
  } finally { await view.unmount(); }
});

test('filters and platform make a new protected request and discard older responses', async () => {
  const view = app();
  try {
    await view.render();
    await view.render({ filters: { days: 7, city: 'vancouver', tier: 'plus', includeInternal: true, offset: 75 } });
    await view.press('radio', 'iOS');
    assert.deepEqual(view.calls[2].args, { p_days: 7, p_city: 'vancouver', p_tier: 'plus', p_include_internal: true, p_platform: 'ios' });
    assert.equal(view.calls[2].name, 'get_admin_performance');
    assert.equal(view.feedback.at(-1), 'selection');
    const current = payload(); current.growth.newMembers = 71;
    await view.answer(2, current);
    const stale = payload(); stale.growth.newMembers = 991;
    await view.answer(0, stale); await view.answer(1, stale);
    assert.match(metric(view.container, '신규 가입'), /71/);
    assert.doesNotMatch(metric(view.container, '신규 가입'), /991/);
    await view.render({ refreshSignal: 1 });
    assert.equal(metric(view.container, '신규 가입'), undefined, 'old scope must disappear during refresh');
  } finally { await view.unmount(); }
});

test('failed and denied RPCs show recovery, and retry can render authenticated data', async () => {
  const view = app();
  try {
    await view.render(); await view.answer(0, null, { message: 'ADMIN_REQUIRED' });
    const denied = walk(view.container).find(node => node.getAttribute('role') === 'alert');
    assert.match(denied.textContent, /관리자.*인증|MFA/);
    assert.equal(metric(view.container, 'DAU'), undefined);
    await view.press('button', '다시 시도');
    assert.equal(view.feedback.at(-1), 'selection');
    assert.ok(find(view.container, 'progressbar', '성과 데이터 불러오는 중'));
    await view.answer(1, null, { message: 'network failed with private detail' });
    assert.match(view.container.textContent, /불러오지 못/);
    assert.doesNotMatch(view.container.textContent, /private detail/);
    await view.press('button', '다시 시도'); await view.answer(2);
    assert.match(metric(view.container, 'DAU'), /0/);
  } finally { await view.unmount(); }
});

test('missing RPC data is an error, not an empty successful report', async () => {
  const view = app();
  try {
    await view.render(); await view.answer(0, null);
    assert.ok(walk(view.container).some(node => node.getAttribute('role') === 'alert'));
    assert.equal(area(view.container, '성장·유입'), undefined);
    assert.equal(metric(view.container, 'DAU'), undefined);
  } finally { await view.unmount(); }
});

test('localPreview never calls the privileged RPC and filters cannot reveal stale server data', async () => {
  const view = app('performance', { localPreview: true });
  try {
    await view.render(); await view.render({ filters: { ...filters, city: 'toronto' }, refreshSignal: 1 });
    assert.equal(view.calls.length, 0);
    assert.match(view.container.textContent, /로컬 미리보기/);
    assert.equal(metric(view.container, 'DAU'), undefined);
    await view.render({ localPreview: false });
    await view.render({ localPreview: true });
    const stale = payload(); stale.growth.newMembers = 889;
    await view.answer(0, stale);
    assert.equal(metric(view.container, '신규 가입'), undefined);
  } finally { await view.unmount(); }
});

test('unmount cancels rendering of a late successful response', async () => {
  const view = app();
  await view.render(); await view.unmount(); await view.answer(0);
  assert.equal(view.container.textContent, '');
});

test('daily chart and table distinguish uncollected values and zero, with selection feedback', async () => {
  const view = app();
  try {
    await view.render(); await view.answer(0);
    assert.match(area(view.container, '일별 활동 추이').textContent, /미수집/);
    await view.press('button', '수치 표 보기');
    assert.equal(view.feedback.at(-1), 'selection');
    const table = area(view.container, '일별 활동 수치');
    assert.match(row(table, '2026-09-19').textContent, /미수집/);
    assert.doesNotMatch(row(table, '2026-10-14').textContent, /미수집/);
    await view.press('button', '차트 보기');
    assert.ok(area(view.container, '일별 활동 추이'));
  } finally { await view.unmount(); }
});

test('legacy lifetime errors appear only for internal-inclusive all-city and all-tier views', async () => {
  const view = app();
  try {
    await view.render();
    const data = payload(); data.quality.errorGroups = [{ platform: 'ios', version: '1.2.3', groups: 2, lifetimeReports: 9999 }];
    await view.answer(0, data);
    assert.doesNotMatch(area(view.container, '품질').textContent, /9,999/);
    await view.render({ filters: { ...filters, includeInternal: true } }); await view.answer(1, data);
    assert.match(area(view.container, '품질').textContent, /운영 누적 참고/);
    assert.match(area(view.container, '품질').textContent, /9,999/);
    await view.render({ filters: { ...filters, includeInternal: true, city: 'vancouver' } }); await view.answer(2, data);
    assert.doesNotMatch(area(view.container, '품질').textContent, /9,999/);
    await view.render({ filters: { ...filters, includeInternal: true, tier: 'pro' } }); await view.answer(3, data);
    assert.doesNotMatch(area(view.container, '품질').textContent, /9,999/);
  } finally { await view.unmount(); }
});

test('a platform-specific report cannot infer delivery click rate or attributed legacy clicks', async () => {
  const view = app();
  try {
    await view.render(); await view.press('radio', 'iOS');
    const data = payload(); data.notifications.clickStartedAt = stamp; data.notifications.pushOpens = 0;
    data.notifications.inboxOpens = 0; data.notifications.activeAfterOpen = 0;
    await view.answer(1, data);
    assert.match(metric(view.container, '푸시 탭'), /0/);
    assert.doesNotMatch(metric(view.container, '푸시 탭'), /미수집/);
    assert.match(metric(view.container, '푸시 클릭률'), /플랫폼.*산출 불가/);
    assert.doesNotMatch(metric(view.container, '푸시 클릭률'), /0%/);
    assert.match(metric(view.container, '기존 행사 클릭'), /범위.*확인 불가/);
  } finally { await view.unmount(); }
});

test('default performance loads independently, and all original tabs still use the base RPC', async () => {
  const view = app('analytics');
  try {
    await view.render();
    assert.equal(find(view.container, 'tab', '전체 성과')?.getAttribute('aria-selected'), 'true');
    assert.deepEqual(view.calls.map(call => call.name), ['get_admin_performance']);
    await view.answer(0);
    for (const tab of ['요약', '회원', '트래픽', '행동 분석', '결제·홍보', '운영 로그']) assert.ok(find(view.container, 'tab', tab));
    await view.press('tab', '회원');
    assert.equal(view.feedback.at(-1), 'selection');
    assert.equal(view.calls[1].name, 'get_admin_analytics');
    await view.press('tab', '전체 성과');
    assert.equal(view.calls[2].name, 'get_admin_performance');
    await view.answer(1, null, { message: 'base failed' });
    await view.answer(2);
    assert.ok(area(view.container, '품질'));
    assert.doesNotMatch(view.container.textContent, /분석 데이터를 불러오지 못/);
    await view.press('tab', '회원'); await view.answer(3, basePayload());
    assert.equal(view.calls[4].name, 'get_admin_behavior');
    await view.answer(4, { screens: [], steps: [], actions: [], recent: [] });
    assert.match(view.container.textContent, /회원 목록/);
    for (const [tab, content] of [['요약', '전체 회원'], ['트래픽', '최근 접속'], ['행동 분석', '완료한 작업'], ['결제·홍보', '구독 구매 회원'], ['운영 로그', '관리자 접근 기록']]) {
      await view.press('tab', tab);
      assert.ok(view.container.textContent.includes(content), `${tab} must still render its existing content`);
      assert.equal(view.feedback.at(-1), 'selection');
    }
    assert.equal(view.calls.length, 5, 'switching between original tabs reuses their base report');
  } finally { await view.unmount(); }
});

test('populated rows use server values without inventing funnels, activity uplift or currency totals', async () => {
  const view = app();
  try {
    await view.render();
    const data = payload();
    data.growth.sourceStartedAt = stamp;
    data.growth.sources = [{ source: 'unknown', sessions: 12, signupSessions: 3, signupRate: 25 }];
    data.growth.onboarding = [{ target: 'consent_complete', sessions: 13, members: 9 }];
    data.activity.platforms = [{ platform: 'web', users: 7, visits: 21 }];
    data.community.approvedRequests = 8; data.community.savedPosts = 11; data.community.sharedPosts = 6;
    data.discovery.startedAt = stamp;
    data.discovery.rows = [{ kind: 'place', cityId: 'toronto', targetId: 'node/101', title: '실제 서버 대상', views: 41, directions: 7, websites: 3 }];
    data.notifications.clickStartedAt = stamp; data.notifications.pushOpens = 12; data.notifications.inboxOpens = 7;
    data.notifications.clickRate = 20; data.notifications.activeAfterOpen = 3;
    data.notifications.rows = [{ kind: 'admin_signup', generated: 20, providerAccepted: 10, failed: 1, pushOpens: 2, inboxOpens: 1, clickRate: 20 }];
    data.revenue.currencies = [{ currency: 'CAD', amount: 12.45, purchases: 2, buyers: 1, renewals: 1 }, { currency: 'USD', amount: 9.99, purchases: 1, buyers: 1, renewals: 0 }];
    data.quality.errorStartedAt = stamp;
    data.quality.failures = [{ kind: 'photo_upload_error', members: 5 }];
    data.quality.versions = [{ platform: 'ios', version: '1.2.3', members: 8, visits: 24 }];
    await view.answer(0, data);
    assert.match(row(area(view.container, '유입 채널'), '미분류').textContent, /12.*3.*25%/);
    assert.match(row(area(view.container, '가입·온보딩 완료 행동'), '필수 동의 완료').textContent, /13.*9/);
    assert.match(row(area(view.container, '플랫폼별 활동'), 'Web').textContent, /7.*21/);
    assert.match(row(area(view.container, '커뮤니티 참여'), '현재 승인된 신청').textContent, /8건/);
    assert.match(row(area(view.container, '커뮤니티 참여'), '글 저장').textContent, /11건/);
    assert.match(row(area(view.container, '커뮤니티 참여'), '글 공유·복사').textContent, /6건/);
    assert.match(row(area(view.container, '대상별 행동'), '실제 서버 대상').textContent, /토론토.*41.*7.*3/);
    assert.match(metric(view.container, '열기 뒤 활동 회원'), /3/);
    assert.doesNotMatch(metric(view.container, '열기 뒤 활동 회원'), /12/);
    assert.match(row(area(view.container, '알림 종류별 반응'), '새 회원 가입').textContent, /20.*10.*1.*2.*1.*20%/);
    assert.match(row(area(view.container, '통화별 결제 발생액'), 'CAD').textContent, /12\.45/);
    assert.match(row(area(view.container, '통화별 결제 발생액'), 'USD').textContent, /9\.99/);
    assert.doesNotMatch(area(view.container, '수익').textContent, /22\.44/);
    assert.match(row(area(view.container, '실패를 겪은 회원'), '사진 업로드 실패').textContent, /5명/);
    assert.match(row(area(view.container, '앱 버전별 활동'), 'iOS').textContent, /1\.2\.3.*8.*24/);
  } finally { await view.unmount(); }
});

test('parent local preview and changed common filters preserve the private RPC boundary', async () => {
  const view = app('analytics', { localPreview: true });
  try {
    await view.render(); await view.press('tab', '회원'); await view.press('tab', '전체 성과');
    assert.equal(view.calls.length, 0);
    await view.render({ localPreview: false }); await view.answer(0);
    await view.press('button', '필터 · 전체');
    await view.press('radio', '7일'); await view.press('radio', '밴쿠버'); await view.press('radio', '플러스');
    assert.deepEqual(view.calls.at(-1).args, { p_days: 7, p_city: 'vancouver', p_tier: 'plus', p_include_internal: false, p_platform: 'all' });
    assert.ok(view.calls.every(call => call.name === 'get_admin_performance'));
    assert.equal(view.feedback.at(-1), 'selection');
  } finally { await view.unmount(); }
});
