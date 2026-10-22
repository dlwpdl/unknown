import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const author = '11111111-1111-4111-8111-111111111111';
const page = { merchant_id: 'company', merchant_name: '가게', can_review: true, my_review: null, reviews: [], rating_average: null, review_count: 0, has_more: false };
const settle = () => new Promise(setImmediate);
const nodes = root => !root || typeof root !== 'object' ? [] : [root, ...Object.values(root).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const control = (root, id) => nodes(root).find(node => node.props?.analyticsId === id);

function editor({ write = async () => 'review', sessionAuthor = author, upload, reviewKind = 'usage', response = page } = {}) {
  const state = [], cleanup = new Map(), calls = { uploaded: [], removed: [], writes: [], reads: [] };
  let index = 0;
  const hooks = {
    useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial; return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }]; },
    useRef(initial) { const slot = index++; return state[slot] ??= { current: initial }; },
    useEffect(fn, deps) { const slot = index++; if (!state[slot] || deps.some((value, i) => value !== state[slot][i])) { cleanup.get(slot)?.(); state[slot] = deps; const end = fn(); if (end) cleanup.set(slot, end); } },
  };
  const imports = {
    react: hooks, 'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'react-native': { View: 'View', TextInput: 'TextInput', StyleSheet: { create: value => value } }, 'expo-image': { Image: 'Image' },
    'expo-image-picker': { UIImagePickerPreferredAssetRepresentationMode: {}, launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: 'local-photo', mimeType: 'image/jpeg' }] }) },
    '@/components/analytics-controls': { Pressable: 'Pressable' }, '@/components/themed-text': { ThemedText: 'Text' }, '@/components/report-sheet': { ReportSheet: 'ReportSheet' },
    '@/hooks/use-theme': { useTheme: () => ({}) }, '@/hooks/use-content-visibility': { useContentVisibility: () => () => false },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true, isAuthLoading: false, me: { id: author }, promptLogin() {} }) }, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
    '@/lib/post-image-picker': { isSupportedImage: () => true, preparePostImage: async () => ({ uri: 'prepared-local', base64: 'AQI=', mimeType: 'image/webp' }) },
    '@/lib/merchant-reviews': {
      loadMerchantReviews: async (...args) => { calls.reads.push(args); return response; },
      uploadMerchantReviewReceipt: async (...args) => { calls.uploaded.push(args); return upload ? upload(...args) : `${author}/receipt.webp`; },
      writeMerchantReview: async (...args) => { calls.writes.push(args); return write(...args); },
    },
    '@/lib/supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: sessionAuthor } } } }) }, storage: { from: bucket => ({ remove: async paths => { calls.removed.push({ bucket, paths }); return { error: null }; } }) } } },
  };
  const exports = {}, source = ts.transpileModule(readFileSync(new URL('../src/components/merchant-reviews.tsx', import.meta.url), 'utf8') + '\nexports.ScopedMerchantReviews=ScopedMerchantReviews;', { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, require: name => imports[name] ?? {}, Date, Intl, Set, Error });
  return { calls, render() { index = 0; return exports.ScopedMerchantReviews({ postId: 'post', reviewKind }); }, unmount() { cleanup.forEach(fn => fn()); cleanup.clear(); } };
}
async function open(view) {
  view.render(); await settle();
  control(view.render(), 'merchant.review.edit').props.onPress();
  control(view.render(), 'merchant.review.score.8.5').props.onPress();
  control(view.render(), 'merchant.review.receipt.pick').props.onPress(); await settle();
}

test('receipt selection and cancellation keep private photos on-device without an orphan upload', async () => {
  const view = editor(); await open(view);
  assert.equal(view.calls.uploaded.length, 0);
  assert.equal(nodes(view.render()).find(node => node.type === 'Image').props.source.uri, 'prepared-local');
  control(view.render(), 'merchant.review.cancel').props.onPress(); view.unmount();
  assert.equal(view.calls.uploaded.length, 0);
});

test('an uncertain save keeps the uploaded receipt and retry reuses it; cleanup uses protected storage deletion', async () => {
  let attempts = 0;
  const view = editor({ write: async () => { if (++attempts === 1) throw new Error('offline'); return 'review'; } });
  await open(view); control(view.render(), 'merchant.review.save').props.onPress(); await settle();
  assert.equal(view.calls.uploaded.length, 1);
  assert.equal(view.calls.writes[0][4], `${author}/receipt.webp`);
  assert.ok(control(view.render(), 'merchant.review.save'));
  control(view.render(), 'merchant.review.save').props.onPress(); await settle();
  assert.equal(view.calls.uploaded.length, 1);
  assert.equal(view.calls.writes.length, 2);
  view.unmount();
  assert.ok(view.calls.removed.some(call => call.bucket === 'merchant-review-receipts' && call.paths.includes(`${author}/receipt.webp`)));
});

test('an account change blocks receipt upload and review writes and preserves the draft', async () => {
  const view = editor({ sessionAuthor: 'other-account' }); await open(view);
  control(view.render(), 'merchant.review.save').props.onPress(); await settle();
  assert.equal(view.calls.uploaded.length, 0);
  assert.equal(view.calls.writes.length, 0);
  assert.ok(control(view.render(), 'merchant.review.save'));
});

test('an upload finishing after unmount never writes a review and cleans only its unbound path', async () => {
  let done;
  const view = editor({ upload: () => new Promise(resolve => { done = resolve; }) }); await open(view);
  control(view.render(), 'merchant.review.save').props.onPress(); await settle(); view.unmount();
  assert.equal(typeof done, 'function'); done(`${author}/late.webp`); await settle();
  assert.equal(view.calls.writes.length, 0);
  assert.ok(view.calls.removed.some(call => call.paths.includes(`${author}/late.webp`)));
});

test('work review uses its domain and explains pending proof privacy after a successful save', async () => {
  const view = editor({ reviewKind: 'employment', response: { ...page, review_kind: 'employment' } });
  await open(view);
  assert.equal(view.calls.reads[0][3], 'employment');
  assert.ok(nodes(view.render()).flatMap(node => node.props?.children ?? []).includes('근무 증빙 인증'));
  control(view.render(), 'merchant.review.save').props.onPress(); await settle();
  assert.equal(view.calls.writes[0][5], 'employment');
  assert.ok(nodes(view.render()).some(node => typeof node.props?.children === 'string' && node.props.children.includes('근무 증빙 확인 전에는 나에게만')));
});

test('work review without evidence remains a private saved review and an incorrect usage row is not shown', async () => {
  const leaked = { id: 'usage-row', author_id: 'someone', review_kind: 'usage', receipt_status: 'verified', nickname: 'wrong-domain', body: 'usage body', score: 10 };
  const view = editor({ reviewKind: 'employment', response: { ...page, review_kind: 'employment', reviews: [leaked] } });
  view.render(); await settle();
  assert.equal(nodes(view.render()).some(node => node.type?.name === 'MerchantReviewCard' && node.props.review.id === 'usage-row'), false);
  control(view.render(), 'merchant.review.edit').props.onPress();
  control(view.render(), 'merchant.review.score.8.5').props.onPress();
  control(view.render(), 'merchant.review.save').props.onPress(); await settle();
  assert.equal(view.calls.uploaded.length, 0);
  assert.equal(view.calls.writes[0][4], '');
  assert.equal(view.calls.writes[0][5], 'employment');
  assert.ok(nodes(view.render()).some(node => typeof node.props?.children === 'string' && node.props.children.includes('나에게만 저장')));
});
