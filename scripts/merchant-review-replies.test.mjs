import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as api from '../src/lib/merchant-reviews.ts';

const merchant = '11111111-1111-4111-8111-111111111111';
const reviewId = '22222222-2222-4222-8222-222222222222';
const owner = '33333333-3333-4333-8333-333333333333';
const reply = { body: '이용해 주셔서 감사합니다.', created_at: '2026-10-09T18:00:00Z', updated_at: '2026-10-09T18:00:00Z' };
const review = { id: reviewId, author_id: 'customer', nickname: '이웃', score: 8.5, body: '맛있어요.', receipt_status: 'verified', review_kind: 'usage', created_at: '2026-10-08T18:00:00Z', updated_at: '2026-10-08T18:00:00Z', reply };
const settle = () => new Promise(setImmediate);
const nodes = root => !root || typeof root !== 'object' ? [] : [root, ...Object.values(root).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const text = root => nodes(root).flatMap(node => [node.props?.children].flat().filter(value => typeof value === 'string')).join(' ');
const control = (root, id) => nodes(root).find(node => node.props?.analyticsId === id);

test('reply save trims text, carries company/review and revision, and verifies actual readback', async () => {
  assert.equal(typeof api.replyToMerchantReview, 'function');
  const calls = [], client = { rpc: async (...args) => { calls.push(args); return { data: reply }; } };
  assert.deepEqual(await api.replyToMerchantReview(client, merchant, reviewId, ` ${reply.body} `, null), reply);
  assert.deepEqual(calls, [['reply_to_merchant_review', { p_merchant_id: merchant, p_review_id: reviewId, p_body: reply.body, p_expected_updated_at: null }]]);
  for (const data of [null, true, { ...reply, body: '다른 답변' }, { ...reply, updated_at: null }]) {
    await assert.rejects(api.replyToMerchantReview({ rpc: async () => ({ data }) }, merchant, reviewId, reply.body, null));
  }
});

test('empty/oversize reply and invalid identities/revisions are rejected before any write', async () => {
  assert.equal(typeof api.replyToMerchantReview, 'function');
  let calls = 0;
  const client = { rpc: async () => { calls++; return { data: reply }; } };
  for (const [company, id, body, revision] of [[merchant, reviewId, ' ', null], [merchant, reviewId, '가'.repeat(301), null], ['bad', reviewId, reply.body, null], [merchant, 'bad', reply.body, null], [merchant, reviewId, reply.body, 'bad']]) {
    await assert.rejects(api.replyToMerchantReview(client, company, id, body, revision));
  }
  assert.equal(calls, 0);
  await assert.rejects(api.replyToMerchantReview({ rpc: async () => ({ error: { message: 'MERCHANT_REPLY_CHANGED' } }) }, merchant, reviewId, reply.body, reply.updated_at), /MERCHANT_REPLY_CHANGED/);
});

function screen(file, { save = async () => reply, sessionOwner = owner,
  load = async () => ({ reviews: [review, { ...review, id: 'employment', review_kind: 'employment' }], has_more: false }) } = {}) {
  const state = [], cleanup = new Map(), calls = [], feedback = [], dirty = [];
  let index = 0;
  const imports = {
    react: {
      useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial; return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }]; },
      useRef(initial) { const slot = index++; return state[slot] ??= { current: initial }; },
      useEffect(fn, deps) { const slot = index++; if (!state[slot] || deps.some((value, i) => value !== state[slot][i])) { cleanup.get(slot)?.(); state[slot] = deps; const end = fn(); if (end) cleanup.set(slot, end); } },
    },
    'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'react-native': { View: 'View', TextInput: 'TextInput', StyleSheet: { create: value => value } },
    '@/components/analytics-controls': { Pressable: 'Pressable' }, '@/components/themed-text': { ThemedText: 'Text' }, '@/components/report-sheet': { ReportSheet: 'ReportSheet' },
    '@/components/merchant-reviews': { MerchantReviewCard: 'ReviewCard' },
    '@/hooks/use-theme': { useTheme: () => ({}) }, '@/hooks/use-content-visibility': { useContentVisibility: () => () => false },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true, me: { id: owner } }) }, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: value => feedback.push(value) }) },
    '@/lib/merchant-reviews': { loadMyMerchantReviews: load, replyToMerchantReview: async (...args) => { calls.push(args.slice(1)); return save(...args); } },
    '@/lib/supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: sessionOwner } } } }) } } },
  };
  const exports = {}, source = readFileSync(new URL(file, import.meta.url), 'utf8') + '\nexports.ScopedInbox=typeof ScopedInbox === "function" ? ScopedInbox : undefined;';
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: name => imports[name] ?? {}, Date, Intl, Error });
  return { calls, feedback, dirty, render(name, props = {}) { index = 0; return exports[name]({ merchantId: merchant, onDirty: value => dirty.push(value), ...props }); }, unmount() { cleanup.forEach(fn => fn()); } };
}

test('review expansion includes company reply while rejection reason is shown only to its author', () => {
  const view = screen('../src/components/merchant-reviews.tsx');
  let root = view.render('MerchantReviewCard', { review: { ...review, receipt_status: 'rejected', receipt_review_note: '이용 날짜가 보이지 않아요.' }, own: true });
  assert.ok(text(root).includes('업체 답변'));
  control(root, 'merchant.review.detail').props.onPress();
  root = view.render('MerchantReviewCard', { review: { ...review, receipt_status: 'rejected', receipt_review_note: '이용 날짜가 보이지 않아요.' }, own: true });
  assert.ok(text(root).includes(reply.body));
  assert.ok(text(root).includes('이용 날짜가 보이지 않아요.'));
  assert.ok(!text(view.render('MerchantReviewCard', { review: { ...review, receipt_review_note: 'PRIVATE_REASON' }, own: false })).includes('PRIVATE_REASON'));
});

test('merchant inbox limits reply controls to usage, preserves failed draft, and saves with version', async () => {
  let reject = true;
  const view = screen('../src/components/merchant-review-inbox.tsx', { save: async () => { if (reject) throw Error('offline'); return { ...reply, body: '수정 답변' }; } });
  view.render('ScopedInbox'); await settle();
  let root = view.render('ScopedInbox');
  assert.ok(control(root, `merchant.reply.edit.${reviewId}`));
  assert.ok(!control(root, 'merchant.reply.edit.employment'));
  control(root, `merchant.reply.edit.${reviewId}`).props.onPress(); root = view.render('ScopedInbox');
  nodes(root).find(node => node.type === 'TextInput').props.onChangeText('수정 답변'); root = view.render('ScopedInbox');
  control(root, 'merchant.reply.save').props.onPress(); await settle(); root = view.render('ScopedInbox');
  assert.equal(nodes(root).find(node => node.type === 'TextInput').props.value, '수정 답변');
  assert.ok(view.feedback.includes('warning'));
  reject = false; control(root, 'merchant.reply.save').props.onPress(); await settle(); root = view.render('ScopedInbox');
  assert.deepEqual(view.calls.at(-1), [merchant, reviewId, '수정 답변', reply.updated_at]);
  assert.ok(!nodes(root).some(node => node.type === 'TextInput'));
  assert.ok(view.feedback.includes('success'));
});

test('reply save refuses an account change and leaves the draft intact', async () => {
  const view = screen('../src/components/merchant-review-inbox.tsx', { sessionOwner: 'other' });
  view.render('ScopedInbox'); await settle();
  control(view.render('ScopedInbox'), `merchant.reply.edit.${reviewId}`).props.onPress();
  nodes(view.render('ScopedInbox')).find(node => node.type === 'TextInput').props.onChangeText('남겨 둔 답변');
  control(view.render('ScopedInbox'), 'merchant.reply.save').props.onPress(); await settle();
  assert.equal(view.calls.length, 0);
  assert.equal(nodes(view.render('ScopedInbox')).find(node => node.type === 'TextInput').props.value, '남겨 둔 답변');
});

test('dirty and saving replies prevent paging and reporting from hiding their draft', async () => {
  const observed = [];
  for (const phase of ['dirty', 'busy']) {
    const pages = [];
    let finishSave;
    const saving = new Promise(resolve => { finishSave = resolve; });
    const view = screen('../src/components/merchant-review-inbox.tsx', {
      save: () => saving,
      load: async (_client, _merchant, offset) => {
        pages.push(offset);
        if (offset > 0) throw Error('offline');
        return { reviews: [review], has_more: true };
      },
    });
    view.render('ScopedInbox'); await settle();
    let root = view.render('ScopedInbox');
    assert.equal(pages.length, 1);
    nodes(root).find(node => node.type === 'ReviewCard').props.onReport();
    root = view.render('ScopedInbox');
    control(root, `merchant.reply.edit.${reviewId}`).props.onPress();
    root = view.render('ScopedInbox');
    const draftBody = phase === 'dirty' ? '보존해야 할 작성 중 답변' : reply.body;
    if (phase === 'dirty') nodes(root).find(node => node.type === 'TextInput').props.onChangeText(draftBody);
    else { control(root, 'merchant.reply.save').props.onPress(); await settle(); }
    root = view.render('ScopedInbox');
    const more = control(root, 'merchant.reviews.more');
    const pagingDisabled = more.props.disabled;
    const reportUnavailable = typeof nodes(root).find(node => node.type === 'ReviewCard').props.onReport !== 'function';
    if (!pagingDisabled) more.props.onPress();
    view.render('ScopedInbox'); await settle(); root = view.render('ScopedInbox');
    const retainedAfterPaging = nodes(root).find(node => node.type === 'TextInput')?.props.value === draftBody;
    nodes(root).find(node => node.type === 'ReportSheet').props.onClose();
    view.render('ScopedInbox'); await settle(); root = view.render('ScopedInbox');
    observed.push({ phase, pagingDisabled, reportUnavailable, pages, retainedAfterPaging,
      retainedAfterReportClose: nodes(root).find(node => node.type === 'TextInput')?.props.value === draftBody });
    finishSave(reply); await settle(); view.unmount();
  }
  assert.deepEqual(observed, ['dirty', 'busy'].map(phase => ({ phase, pagingDisabled: true, reportUnavailable: true,
    pages: [0], retainedAfterPaging: true, retainedAfterReportClose: true })));
});
