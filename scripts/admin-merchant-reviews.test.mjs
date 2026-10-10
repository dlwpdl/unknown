import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as labels from '../src/lib/admin.ts';
import { filterReportRows } from '../src/components/admin/admin-report-filter.ts';
import * as sectionFilters from '../src/components/admin/admin-section-filter.ts';
import { count } from '../src/i18n/ko.ts';

function module(file, imports = {}, extra = '') {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8') + extra, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, { exports, require: name => imports[name] ?? {}, Date, Intl,
    fetch: async () => { throw new Error('Local asset unavailable'); } });
  return exports;
}
function view(file, name, { rpc = async () => ({ data: null }), storage = {}, user = { id: 'admin' }, extra = '', imports: extraImports = {} } = {}) {
  const state = [], cleanups = [], calls = [];
  let index = 0;
  const hooks = {
    useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial; return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }]; },
    useRef(initial) { const slot = index++; if (!(slot in state)) state[slot] = { current: initial }; return state[slot]; },
    useEffect(fn, deps) { const slot = index++; if (!deps || !state[slot] || deps.some((value, i) => value !== state[slot][i])) { state[slot] = deps; const cleanup = fn(); if (cleanup) cleanups.push(cleanup); } },
    useMemo(fn) { return fn(); },
  };
  const adminData = module('../src/lib/admin-data.ts');
  const controls = Object.fromEntries(['AdminFilterBar', 'AdminFilterReset', 'AdminMultiFilter', 'AdminSearch', 'AdminTableSummary'].map(name => [name, name]));
  const imports = {
    react: hooks, 'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'react-native': { View: 'View', Pressable: 'Pressable', Modal: 'Modal', TextInput: 'TextInput', ActivityIndicator: 'Loader', StyleSheet: { create: x => x }, useWindowDimensions: () => ({ width: 1200 }) },
    'expo-image': { Image: 'Image' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/components/themed-text': { ThemedText: 'Text' }, '@/constants/theme': { Colors: { admin: {}, dark: {} }, Spacing: {} },
    '@/lib/admin': labels, '@/lib/admin-labels': { displayName: (profile, id) => profile?.nickname ?? id, shortId: id => id.slice(0, 6) },
    '@/lib/admin-layout': { isCompactAdminWidth: () => false }, '@/lib/admin-data': adminData,
    '@/lib/auth': { useAuth: () => ({ me: user, isAuthed: true }) }, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => calls.push(['feedback', kind]) }) },
    '@/hooks/use-theme': { useTheme: () => ({ line: '#343443', card: '#171722', textSecondary: '#B7B4C3' }) },
    '@/lib/supabase': { supabase: { rpc, storage } },
    '@/i18n/ko': { count },
    './admin-table-controls': controls, '@/components/admin/admin-table-controls': controls, '@/components/admin/admin-merchant-review-content': { AdminMerchantReviewContent: 'ReviewContent' },
    '@/components/admin/admin-merchant-review-reply-content': { AdminMerchantReviewReplyContent: 'ReplyContent' },
    './admin-trending-panel': { AdminTrendingPanel: 'Trending' },
    './admin-section-filter': sectionFilters,
    './admin-report-filter': { filterReportRows },
    './admin-merchant-receipt-queue': { AdminMerchantReceiptQueue: 'ReceiptQueue' },
    '@/components/admin/admin-merchant-receipt-queue': { AdminMerchantReceiptQueue: 'ReceiptQueue' },
    ...extraImports,
  };
  const exports = module(file, imports, extra);
  return { render(props) { index = 0; return exports[name](props); }, unmount() { cleanups.splice(0).forEach(fn => fn()); }, calls };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const report = { id: 'report-review', reporter_id: 'reporter', reported_user_id: 'review-author', target_type: 'merchant_review', target_id: 'review-uuid', reason_code: 'harassment', details: '검토 요청', status: 'open', created_at: '2026-10-08T20:00:00Z', resolved_at: null,
  evidence: { merchant_id: 'merchant-uuid', merchant_name: '동네 가게', score: 8.5, body: '접수 당시 후기', status: 'published', created_at: '2026-10-07T20:00:00Z', updated_at: '2026-10-08T18:00:00Z', author_id: 'review-author' } };
const pendingReview = { authorId: 'review-author', reviewKind: 'usage', text: '동네 가게\n8.5/10\n후기 전체', merchantId: 'merchant-uuid', merchantName: '동네 가게', score: 8.5, body: '후기 전체', status: 'published', createdAt: '2026-10-07T20:00:00Z', updatedAt: '2026-10-08T18:00:00Z', receiptPath: 'review-author/receipt.webp', receiptStatus: 'pending', receiptReviewedAt: null, receiptReviewNote: null };
const press = (tree, label) => { const control = nodes(tree).find(node => node.type === 'Pressable' && node.props.accessibilityLabel === label); assert.ok(control, `Missing control: ${label}`); return control; };

test('a merchant review report is filterable, shows its captured context and hides the review ID', async () => {
  const queue = view('../src/components/admin/admin-report-queue.tsx', 'AdminReportQueue');
  const resolved = [];
  const tree = queue.render({ reports: [report], profiles: new Map(), actions: [], resolving: false, onUser() {}, onResolve: async (...args) => { resolved.push(args); return ['report-review']; } });
  const filters = nodes(tree).find(node => node.type === 'AdminMultiFilter' && node.props.label === '대상');
  assert.ok(filters.props.options.some(option => option.value === 'merchant_review' && option.label === '업체 후기'));
  assert.ok(nodes(tree).some(node => typeof node.props?.value === 'string' && node.props.value.includes('동네 가게') && node.props.value.includes('8.5/10')));
  assert.ok(nodes(tree).some(node => node.props?.value === '접수 당시 후기'));
  const hide = nodes(tree).find(node => node.type === 'Pressable' && nodes(node).some(child => child.props?.children === '콘텐츠 전체 숨김'));
  await hide.props.onPress();
  assert.deepEqual(resolved, [['report-review', 'hidden', '']]);
});

test('administrator review content uses its audited RPC and preserves access denial', async () => {
  const data = module('../src/lib/admin-data.ts');
  assert.equal(typeof data.loadAdminMerchantReviewContent, 'function');
  const content = pendingReview;
  const calls = [];
  assert.equal(await data.loadAdminMerchantReviewContent({ rpc: async (name, args) => { calls.push([name, JSON.parse(JSON.stringify(args))]); return { data: content }; } }, 'review-uuid'), content);
  assert.deepEqual(calls, [['get_admin_merchant_review_content', { p_target_id: 'review-uuid' }]]);
  await assert.rejects(data.loadAdminMerchantReviewContent({ rpc: async () => ({ error: new Error('ADMIN_REQUIRED') }) }, 'review-uuid'), /ADMIN_REQUIRED/);
  assert.equal(await data.loadAdminMerchantReviewContent({ rpc: async () => ({ data: null }) }, 'missing'), null);
});

test('reply review uses audited actor-specific read and appears separately in the report queue', async () => {
  const data = module('../src/lib/admin-data.ts');
  assert.equal(typeof data.loadAdminMerchantReviewReplyContent, 'function');
  const reply = { authorId: 'merchant-operator', text: '답변 원문', status: 'published', updatedAt: report.created_at };
  const calls = [];
  assert.equal(await data.loadAdminMerchantReviewReplyContent({ rpc: async (name, args) => { calls.push([name, JSON.parse(JSON.stringify(args))]); return { data: reply }; } }, 'review-uuid'), reply);
  assert.deepEqual(calls, [['get_admin_merchant_review_reply_content', { p_target_id: 'review-uuid' }]]);
  await assert.rejects(data.loadAdminMerchantReviewReplyContent({ rpc: async () => ({ error: new Error('ADMIN_REQUIRED') }) }, 'private'), /ADMIN_REQUIRED/);
  const queue = view('../src/components/admin/admin-report-queue.tsx', 'AdminReportQueue', { imports: { '@/components/admin/admin-merchant-review-reply-content': { AdminMerchantReviewReplyContent: 'ReplyContent' } } });
  const tree = queue.render({ reports: [{ ...report, target_type: 'merchant_review_reply', reported_user_id: 'merchant-operator' }], profiles: new Map(), actions: [], resolving: false, onUser() {}, onResolve() {} });
  const filters = nodes(tree).find(node => node.type === 'AdminMultiFilter' && node.props.label === '대상');
  assert.ok(filters.props.options.some(option => option.value === 'merchant_review_reply'));
  assert.ok(nodes(tree).some(node => node.type === 'ReplyContent' && node.props.targetId === 'review-uuid'));
});

test('native safety, alerts and reports retain review labels and an audited full-content control', () => {
  const dashboard = { profiles: [], safetyReviews: [{ id: 1, target_type: 'merchant_review', target_id: 'review-uuid', status: 'reviewed', risk_level: 'high', risk_reasons: ['위협'], created_at: report.created_at }],
    safetyAlerts: [{ id: 2, target_type: 'merchant_review', target_id: 'review-uuid', category: 'violence', severity: 'high', excerpt: '후기 일부', status: 'open', author_id: 'review-author', created_at: report.created_at }], reports: [report] };
  for (const section of ['safety', 'alerts', 'reports']) {
    const screen = view('../src/components/admin/admin-section.native.tsx', 'AdminSectionView');
    const tree = screen.render({ section, data: dashboard, onUser() {}, onLoadMore() {}, noMore: true, loadingMore: false });
    assert.ok(nodes(tree).some(node => typeof node.props?.children === 'string' && node.props.children.includes('업체 후기')), section);
    assert.ok(nodes(tree).some(node => node.type === 'ReviewContent' && node.props.targetId === 'review-uuid'), section);
  }
});
test('web and native safety, alerts and reports route company replies to their own audited preview', () => {
  const dashboard = { profiles: [], posts: [], counts: { safetyPending: 0, safetyHigh: 1 }, safetyReviews: [{ id: 1, target_type: 'merchant_review_reply', target_id: 'reply-id', status: 'reviewed', risk_level: 'high', risk_reasons: ['위협'], created_at: report.created_at }],
    safetyAlerts: [{ id: 2, target_type: 'merchant_review_reply', target_id: 'reply-id', category: 'violence', severity: 'high', excerpt: '답변 일부', matched_terms: ['위협'], status: 'open', author_id: 'merchant-operator', created_at: report.created_at }], reports: [{ ...report, target_type: 'merchant_review_reply', target_id: 'reply-id' }] };
  for (const file of ['../src/components/admin/admin-section.tsx', '../src/components/admin/admin-section.native.tsx']) {
    for (const section of file.includes('.native') ? ['safety', 'alerts', 'reports'] : ['safety', 'alerts']) {
      const alertsPanel = !file.includes('.native') && section === 'alerts';
      const screen = view(file, alertsPanel ? 'AdminAlertsPanel' : 'AdminSectionView', alertsPanel ? { extra: '\nexports.AdminAlertsPanel = AdminAlertsPanel;' } : {});
      const tree = screen.render({ section, data: dashboard, alerts: dashboard.safetyAlerts, profiles: new Map(), onUser() {}, onLoadMore() {}, noMore: true, loadingMore: false });
      assert.ok(nodes(tree).some(node => node.type === 'ReplyContent' && node.props.targetId === 'reply-id'), `${file}:${section}`);
      assert.ok(!nodes(tree).some(node => node.type === 'ReviewContent'), `${file}:${section} must not expose receipt controls`);
    }
  }
});
test('company reply preview shows the audited actor and ignores duplicate or late protected reads', async () => {
  let resolve, calls = 0;
  const screen = view('../src/components/admin/admin-merchant-review-reply-content.tsx', 'ReplyContent', {
    rpc: () => { calls++; return new Promise(done => { resolve = done; }); }, extra: '\nexports.ReplyContent = ReplyContent;',
  });
  const users = [], props = { targetId: 'reply-id', localPreview: true, onUser: id => users.push(id) };
  await press(screen.render(props), '업체 답변 원문 보기').props.onPress();
  assert.equal(calls, 0);
  props.localPreview = false;
  const control = press(screen.render(props), '업체 답변 원문 보기');
  const pending = control.props.onPress(), duplicate = control.props.onPress();
  assert.equal(calls, 1);
  resolve({ data: { authorId: 'merchant-operator', text: '업체 답변 전체', status: 'removed' } });
  await pending; await duplicate;
  const tree = screen.render(props);
  assert.ok(nodes(tree).some(node => node.props?.children === '업체 답변 전체'));
  press(tree, '답변 작성자 이력 보기').props.onPress();
  assert.deepEqual(users, ['merchant-operator']);
  const late = press(tree, '업체 답변 원문 보기').props.onPress();
  screen.unmount(); resolve({ data: { authorId: 'old-operator', text: 'late private reply', status: 'published' } }); await late;
  assert.ok(!nodes(screen.render(props)).some(node => node.props?.children === 'late private reply'));
});

function reviewView(options) {
  assert.ok(existsSync(new URL('../src/components/admin/admin-merchant-review-content.tsx', import.meta.url)), 'Audited merchant review preview control has not been implemented.');
  return view('../src/components/admin/admin-merchant-review-content.tsx', 'ReviewContent', { ...options, extra: '\nexports.ReviewContent = ReviewContent;' });
}
test('review full-content preview shows the whole audited response and opens the returned author', async () => {
  let calls = 0;
  const screen = reviewView({ rpc: async () => { calls++; return { data: { ...pendingReview, status: 'removed' } }; } });
  const users = [];
  const props = { targetId: 'review-uuid', onUser: id => users.push(id) };
  const control = nodes(screen.render(props)).find(node => node.type === 'Pressable');
  await control.props.onPress();
  const tree = screen.render(props);
  assert.equal(calls, 1);
  assert.ok(nodes(tree).some(node => node.props?.children === '동네 가게\n8.5/10\n후기 전체'));
  assert.ok(nodes(tree).some(node => [node.props?.children].flat().includes('숨김')));
  const history = nodes(tree).find(node => node.type === 'Pressable' && node.props.accessibilityLabel === '후기 작성자 이력 보기');
  history.props.onPress();
  assert.deepEqual(users, ['review-author']);
  assert.ok(screen.calls.some(([name]) => name === 'feedback'));
});
test('review previews make no local-preview reads and late reads cannot reveal content after unmount', async () => {
  let resolve, calls = 0;
  const screen = reviewView({ rpc: () => { calls++; return new Promise(done => { resolve = done; }); } });
  let props = { targetId: 'review-uuid', localPreview: true, onUser() {} };
  await nodes(screen.render(props)).find(node => node.type === 'Pressable').props.onPress();
  assert.equal(calls, 0);
  props = { ...props, localPreview: false };
  const control = nodes(screen.render(props)).find(node => node.type === 'Pressable');
  const pending = control.props.onPress();
  const duplicate = control.props.onPress();
  assert.equal(calls, 1);
  screen.unmount();
  resolve({ data: { ...pendingReview, authorId: 'old-admin-author', text: 'late private review' } });
  await pending; await duplicate;
  assert.ok(!nodes(screen.render(props)).some(node => node.props?.children === 'late private review'));
});
test('failed audited review reads show an error and retry without cached content', async () => {
  let fail = true;
  const screen = reviewView({ rpc: async () => fail ? { error: new Error('ADMIN_REQUIRED') } : { data: null } });
  const props = { targetId: 'review-uuid', onUser() {} };
  await nodes(screen.render(props)).find(node => node.type === 'Pressable').props.onPress();
  assert.ok(nodes(screen.render(props)).some(node => node.props?.accessibilityRole === 'alert'));
  fail = false;
  await nodes(screen.render(props)).find(node => node.type === 'Pressable').props.onPress();
  assert.ok(nodes(screen.render(props)).some(node => node.props?.children === '후기를 찾을 수 없습니다.'));
});

test('web safety reviews and keyword alerts both offer an audited merchant review content read', () => {
  const safety = view('../src/components/admin/admin-section.tsx', 'AdminSectionView');
  const review = { id: 1, target_type: 'merchant_review', target_id: 'review-uuid', status: 'reviewed', risk_level: 'high', risk_reasons: ['위협'], attempts: 1, created_at: report.created_at };
  const tree = safety.render({ section: 'safety', data: { profiles: [], posts: [], counts: { safetyPending: 0, safetyHigh: 1 }, safetyReviews: [review] }, onUser() {} });
  assert.ok(nodes(tree).some(node => node.type === 'ReviewContent' && node.props.targetId === 'review-uuid'));
  const alerts = view('../src/components/admin/admin-section.tsx', 'AdminAlertsPanel', { extra: '\nexports.AdminAlertsPanel = AdminAlertsPanel;' });
  const alert = { id: 2, target_type: 'merchant_review', target_id: 'review-uuid', category: 'violence', severity: 'high', excerpt: '후기 일부', status: 'open', author_id: 'review-author', matched_terms: ['위협'], created_at: report.created_at };
  const alertsTree = alerts.render({ alerts: [alert], profiles: new Map(), onUser() {} });
  assert.ok(nodes(alertsTree).some(node => node.type === 'ReviewContent' && node.props.targetId === 'review-uuid'));
});

test('receipt approval uses the private saved path, revision and a required audited note', async () => {
  const data = module('../src/lib/admin-data.ts');
  assert.equal(typeof data.setAdminMerchantReviewReceipt, 'function');
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push([name, JSON.parse(JSON.stringify(args))]); return { data: { ...pendingReview, receiptStatus: 'verified' } }; } };
  await data.setAdminMerchantReviewReceipt(client, 'review-uuid', pendingReview, true, ' 업체·이용일 확인 ');
  assert.deepEqual(calls, [['set_admin_merchant_review_receipt', { p_target_id: 'review-uuid', p_receipt_path: 'review-author/receipt.webp', p_updated_at: '2026-10-08T18:00:00Z', p_verified: true, p_note: '업체·이용일 확인' }]]);
  await assert.rejects(data.setAdminMerchantReviewReceipt(client, 'review-uuid', pendingReview, false, '  '), /CONFIRMATION_REQUIRED/);
  await assert.rejects(data.setAdminMerchantReviewReceipt(client, 'review-uuid', pendingReview, true, ' 확인 '), /CONFIRMATION_REQUIRED/);
  await assert.rejects(data.setAdminMerchantReviewReceipt(client, 'review-uuid', pendingReview, true, '👍👍👍👍'), /CONFIRMATION_REQUIRED/);
  await assert.rejects(data.setAdminMerchantReviewReceipt(client, 'review-uuid', pendingReview, true, 'a'.repeat(1001)), /CONFIRMATION_REQUIRED/);
  assert.equal(calls.length, 1);
});
test('receipt image reads sign only the private bucket and signing failures remain failures', async () => {
  const data = module('../src/lib/admin-data.ts');
  assert.equal(typeof data.loadAdminMerchantReceiptUrl, 'function');
  const calls = [];
  const client = { storage: { from: bucket => { calls.push(bucket); return { createSignedUrl: async (path, ttl) => { calls.push([path, ttl]); return { data: { signedUrl: 'https://storage.example/signed-private-receipt' } }; } }; } } };
  assert.equal(await data.loadAdminMerchantReceiptUrl(client, 'review-author/receipt.webp'), 'https://storage.example/signed-private-receipt');
  assert.deepEqual(calls, ['merchant-review-receipts', ['review-author/receipt.webp', 300]]);
  await assert.rejects(data.loadAdminMerchantReceiptUrl({ storage: { from: () => ({ createSignedUrl: async () => ({ error: new Error('ADMIN_REQUIRED') }) }) } }, pendingReview.receiptPath), /ADMIN_REQUIRED/);
});
test('manual verification requires a loaded private receipt and reads back the verified state', async () => {
  let content = pendingReview;
  const rpcCalls = [];
  const screen = reviewView({ rpc: async (name, args) => {
    rpcCalls.push([name, JSON.parse(JSON.stringify(args))]);
    if (name === 'set_admin_merchant_review_receipt') content = { ...pendingReview, receiptStatus: 'verified', receiptReviewNote: args.p_note };
    return { data: content };
  }, storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://storage.example/signed-private-receipt' } }) }) } });
  const props = { targetId: 'review-uuid', onUser() {} };
  await press(screen.render(props), '후기 원문 보기').props.onPress();
  assert.equal(press(screen.render(props), '영수증 인증').props.disabled, true);
  await press(screen.render(props), '영수증 보기').props.onPress();
  const image = nodes(screen.render(props)).find(node => node.type === 'Image');
  assert.equal(image.props.source.uri, 'https://storage.example/signed-private-receipt');
  image.props.onLoad();
  const note = nodes(screen.render(props)).find(node => node.type === 'TextInput' && node.props.accessibilityLabel === '영수증 검토 메모');
  note.props.onChangeText('업체·이용일·금액 확인');
  const verify = press(screen.render(props), '영수증 인증');
  assert.equal(verify.props.disabled, false);
  await verify.props.onPress();
  assert.deepEqual(rpcCalls.map(([name]) => name), ['get_admin_merchant_review_content', 'set_admin_merchant_review_receipt', 'get_admin_merchant_review_content']);
  assert.ok(nodes(screen.render(props)).some(node => node.props?.children === '영수증 인증을 확인했습니다.'));
});

test('employment certification requires loaded private proof and a meaningful note before public state', async () => {
  let content = { ...pendingReview, reviewKind: 'employment', receiptPath: 'review-author/employment.webp' };
  const calls = [];
  const screen = reviewView({ rpc: async (name, args) => {
    calls.push([name, JSON.parse(JSON.stringify(args))]);
    if (name === 'set_admin_merchant_review_receipt') content = { ...content, receiptStatus: 'verified', receiptReviewNote: args.p_note };
    return { data: content };
  }, storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://storage.example/signed-private-employment' } }) }) } });
  const props = { targetId: 'employment-review', onUser() {} };
  await press(screen.render(props), '후기 원문 보기').props.onPress();
  let tree = screen.render(props);
  assert.ok(nodes(tree).some(node => typeof node.props?.children === 'string' && node.props.children.includes('회사·근무자·근무 이력')));
  assert.ok(nodes(tree).some(node => [node.props?.children].flat().includes('비공개')));
  const note = nodes(tree).find(node => node.type === 'TextInput' && node.props.accessibilityLabel === '근무 증빙 검토 메모');
  note.props.onChangeText('회사와 근무 이력 확인');
  assert.equal(press(screen.render(props), '근무 증빙 인증').props.disabled, true);
  await press(screen.render(props), '근무 증빙 보기').props.onPress();
  const proof = nodes(screen.render(props)).find(node => node.type === 'Image');
  assert.equal(proof.props.accessibilityLabel, '검토용 비공개 근무 증빙');
  assert.equal(press(screen.render(props), '근무 증빙 인증').props.disabled, true);
  proof.props.onError();
  assert.equal(press(screen.render(props), '근무 증빙 인증').props.disabled, true);
  await press(screen.render(props), '근무 증빙 보기').props.onPress();
  nodes(screen.render(props)).find(node => node.type === 'Image').props.onLoad();
  note.props.onChangeText('확인');
  assert.equal(press(screen.render(props), '근무 증빙 인증').props.disabled, true);
  note.props.onChangeText('회사·작성자와 근무자·실제 근무 이력 확인');
  const verify = press(screen.render(props), '근무 증빙 인증');
  assert.equal(verify.props.disabled, false);
  await verify.props.onPress();
  assert.deepEqual(calls.map(([name]) => name), ['get_admin_merchant_review_content', 'set_admin_merchant_review_receipt', 'get_admin_merchant_review_content']);
  assert.deepEqual(calls[1][1], { p_target_id: 'employment-review', p_receipt_path: 'review-author/employment.webp', p_updated_at: pendingReview.updatedAt, p_verified: true, p_note: '회사·작성자와 근무자·실제 근무 이력 확인' });
  tree = screen.render(props);
  assert.ok(nodes(tree).some(node => node.props?.children === '근무 증빙 인증을 확인했습니다.'));
  assert.ok(nodes(tree).some(node => [node.props?.children].flat().includes('공개')));
});

test('a certification readback for another review kind never reports successful employment certification', async () => {
  let verifying = false;
  const content = { ...pendingReview, reviewKind: 'employment' };
  const screen = reviewView({ rpc: async name => {
    if (name === 'set_admin_merchant_review_receipt') verifying = true;
    return { data: verifying ? { ...content, reviewKind: 'usage', receiptStatus: 'verified' } : content };
  }, storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://storage.example/signed-private-employment' } }) }) } });
  const props = { targetId: 'employment-review', onUser() {} };
  await press(screen.render(props), '후기 원문 보기').props.onPress();
  await press(screen.render(props), '근무 증빙 보기').props.onPress();
  nodes(screen.render(props)).find(node => node.type === 'Image').props.onLoad();
  nodes(screen.render(props)).find(node => node.type === 'TextInput').props.onChangeText('회사·근무 이력 확인');
  await press(screen.render(props), '근무 증빙 인증').props.onPress();
  const tree = screen.render(props);
  assert.ok(nodes(tree).some(node => node.props?.accessibilityRole === 'alert'));
  assert.equal(nodes(tree).find(node => node.type === 'TextInput').props.value, '회사·근무 이력 확인');
  assert.ok(!nodes(tree).some(node => node.props?.children === '근무 증빙 인증을 확인했습니다.'));
});

test('the pending receipt queue discovers unreported reviews and pages through the audited RPC', async () => {
  assert.ok(existsSync(new URL('../src/components/admin/admin-merchant-receipt-queue.tsx', import.meta.url)), 'Receipt review queue has not been implemented.');
  const calls = [];
  const screen = view('../src/components/admin/admin-merchant-receipt-queue.tsx', 'ReceiptQueue', { extra: '\nexports.ReceiptQueue = ReceiptQueue;', rpc: async (name, args) => {
    calls.push([name, JSON.parse(JSON.stringify(args))]);
    return { data: args.p_offset ? { reviews: [{ ...pendingReview, reviewKind: 'employment', id: 'second-review', nickname: '이웃 2' }], has_more: false }
      : { reviews: [{ ...pendingReview, id: 'unreported-review', nickname: '이웃 1' }], has_more: true } };
  } });
  const props = { refreshSignal: 0, onUser() {} };
  screen.render(props); await new Promise(setImmediate);
  assert.ok(nodes(screen.render(props)).some(node => node.type === 'ReviewContent' && node.props.targetId === 'unreported-review'));
  await press(screen.render(props), '검토 대기 후기 더 보기').props.onPress();
  assert.deepEqual(calls, [['get_admin_merchant_receipt_reviews', { p_offset: 0 }], ['get_admin_merchant_receipt_reviews', { p_offset: 1 }]]);
  assert.equal(nodes(screen.render(props)).filter(node => node.type === 'ReviewContent').length, 2);
  assert.ok(nodes(screen.render(props)).some(node => node.props?.children === '근무 후기'));
  assert.ok(nodes(screen.render(props)).some(node => node.props?.children === '상품·서비스 후기'));
  assert.ok(nodes(screen.render(props)).some(node => typeof node.props?.children === 'string' && node.props.children.includes('미인증 근무 후기는 작성자와 관리자만')));
});

test('a changed receipt or failed readback preserves the audit note and never claims approval', async () => {
  const screen = reviewView({ rpc: async () => ({ data: pendingReview }), storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://storage.example/signed-private-receipt' } }) }) } });
  const props = { targetId: 'review-uuid', onUser() {} };
  await press(screen.render(props), '후기 원문 보기').props.onPress();
  await press(screen.render(props), '영수증 보기').props.onPress();
  nodes(screen.render(props)).find(node => node.type === 'Image').props.onLoad();
  nodes(screen.render(props)).find(node => node.type === 'TextInput').props.onChangeText('이용일 재확인 필요');
  await press(screen.render(props), '영수증 인증').props.onPress();
  const tree = screen.render(props);
  assert.ok(nodes(tree).some(node => node.props?.accessibilityRole === 'alert'));
  assert.equal(nodes(tree).find(node => node.type === 'TextInput').props.value, '이용일 재확인 필요');
  assert.ok(!nodes(tree).some(node => node.props?.children === '영수증 인증을 확인했습니다.'));
});

test('merchant admin entrypoints keep receipt queries disabled during local preview', async () => {
  const props = { refreshSignal: 0, localPreview: true, onUser() {} };
  const native = view('../src/components/admin/admin-merchants.native.tsx', 'AdminMerchantsView');
  assert.equal(nodes(native.render(props)).find(node => node.type === 'ReceiptQueue').props.localPreview, true);
  const web = view('../src/components/admin/admin-merchants.tsx', 'AdminMerchantsView', { imports: {
    'expo-asset': { Asset: { fromModule: () => ({ uri: 'preview-logo' }) } },
    '@/lib/mock': { CITIES: [], TAGS: [] },
    '@/lib/admin-merchants': { loadMerchants: async () => ({ merchants: [], more: false }) },
  } });
  const root = web.render(props);
  const disclosure = nodes(root).find(node => node.type === 'details' && nodes(node).some(child => child.props?.children === '후기 증빙 검토'));
  disclosure.props.onToggle({ currentTarget: { open: true } });
  assert.equal(nodes(web.render(props)).find(node => node.type === 'ReceiptQueue').props.localPreview, true);
  let calls = 0;
  const queue = view('../src/components/admin/admin-merchant-receipt-queue.tsx', 'ReceiptQueue', { extra: '\nexports.ReceiptQueue = ReceiptQueue;', rpc: async () => { calls++; return { data: { reviews: [], has_more: false } }; } });
  queue.render(props); await new Promise(setImmediate);
  assert.equal(calls, 0);
});
