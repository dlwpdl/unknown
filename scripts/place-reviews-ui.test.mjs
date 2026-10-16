import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { tr, setActiveLanguage } from '../src/i18n/index.ts';

const author = '11111111-1111-4111-8111-111111111111';
const settle = () => new Promise(setImmediate);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...Object.values(node).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const find = (tree, id) => nodes(tree).find(node => (node.props?.analyticsId ?? node.props?.testID) === id);
const cards = tree => nodes(tree).filter(node => node.type === 'PostCard');
const statuses = tree => nodes(tree).filter(node => node.type === 'StateCard');
const row = id => ({ id, author: { id: 'writer-' + id }, body: '후기', cityId: 'toronto', kind: 'story' });
function view({ load = async () => ({ posts: [], cursor: null, hasMore: false }), write = async () => ({ id: 'saved' }), guest = false, language = 'ko' } = {}) {
  const path = new URL('../src/components/place-reviews.tsx', import.meta.url);
  const calls = { reads: [], writes: [], feedback: [], routes: [], logins: [] };
  let state = [], index = 0, lastKey, account = guest ? null : author, scope = { cityId: 'toronto', placeId: 'osm:node:1' };
  const cleanup = new Map(), effects = [], hidden = new Set();
  const hooks = {
    useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial; return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }]; },
    useRef(initial) { const slot = index++; return state[slot] ??= { current: initial }; },
    useCallback(fn, deps) { const slot = index++; if (!state[slot] || deps.some((v, i) => v !== state[slot].deps[i])) state[slot] = { fn, deps }; return state[slot].fn; },
    useEffect(fn, deps) { const slot = index++; if (!state[slot] || deps.some((v, i) => v !== state[slot][i])) { state[slot] = deps; effects.push(() => { cleanup.get(slot)?.(); const end = fn(); if (end) cleanup.set(slot, end); }); } },
  };
  hooks.useLayoutEffect = hooks.useEffect;
  const imports = {
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'react-native': { View: 'View', TextInput: 'TextInput', StyleSheet: { create: v => v } },
    'expo-router': { useRouter: () => ({ push: route => calls.routes.push(route) }) },
    '@/components/analytics-controls': { Pressable: 'Pressable' }, '@/components/themed-text': { ThemedText: 'Text' },
    '@/components/post-card': { PostCard: 'PostCard' }, '@/components/state-card': { StateCard: 'StateCard' }, '@/components/raised-action-button': { RaisedActionButton: 'RaisedActionButton' },
    '@/hooks/use-theme': { useTheme: () => ({ line: '#343443', card: '#171722', text: '#F6F3F0', accent: '#CBB9FF' }) },
    '@/hooks/use-language': { useLanguage: () => ({ language, tr }) }, '@/i18n': { tr },
    '@/hooks/use-content-visibility': { useContentVisibility: () => (_type, id, writer) => hidden.has(id) || hidden.has(writer) },
    '@/lib/auth': { useAuth: () => ({ isAuthed: !!account, isAuthLoading: false, me: { id: account ?? 'guest' }, promptLogin: reason => calls.logins.push(reason) }) },
    '@/lib/supabase': { supabase: {} }, '@/lib/feed-data': { appendUniquePosts: (a, b) => [...a, ...b.filter(p => !a.some(x => x.id === p.id))] },
    '@/lib/place-reviews': { PLACE_REVIEW_MAX_LENGTH: 1000,
      loadPlaceReviews: async (...args) => { calls.reads.push(args); return load(...args); },
      writePlaceReview: async (...args) => { calls.writes.push(args); return write(...args); } },
    '@/lib/community-data': { isContentRejected: () => false },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => calls.feedback.push(kind) }) },
    '@/constants/theme': { Spacing: { one: 4, two: 8, three: 16, four: 24 } },
  };
  const exports = {};
  if (existsSync(path)) vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, require: name => imports[name] ?? {}, Error, Set });
  function unmount() { cleanup.forEach(fn => fn()); cleanup.clear(); state = []; effects.length = 0; }
  return {
    calls, hidden, unmount,
    account(value) { account = value; }, place(value) { scope = { ...scope, ...value }; }, language(value) { language = value; },
    render() {
      setActiveLanguage(language); assert.equal(typeof exports.PlaceReviews, 'function', 'place review UI is missing');
      index = 0; const outer = exports.PlaceReviews(scope);
      if (outer.key !== lastKey) { unmount(); lastKey = outer.key; }
      index = 0; const tree = typeof outer.type === 'function' ? outer.type(outer.props) : outer;
      while (effects.length) effects.shift()();
      return tree;
    },
  };
}
async function open(ui, text = '초안은 남아 있어야 해요.') {
  ui.render(); await settle(); const tree = ui.render(); find(tree, 'places.reviews.write').props.onPress();
  const editor = ui.render(); find(editor, 'places.reviews.body').props.onChangeText(text); return ui.render();
}

test('guest gets a login gate without any review-body request; account keys clear old rows and drafts', async () => {
  const ui = view({ guest: true }); let tree = ui.render(); await settle();
  assert.equal(ui.calls.reads.length, 0); assert.equal(statuses(tree)[0].props.kind, 'blocked');
  statuses(tree)[0].props.onAction(); assert.equal(ui.calls.logins.length, 1);
  ui.account(author); await open(ui); assert.ok(find(ui.render(), 'places.reviews.body').props.value);
  ui.account('next-account'); ui.render(); await settle(); tree = ui.render();
  assert.equal(find(tree, 'places.reviews.body'), undefined);
  find(tree, 'places.reviews.write').props.onPress(); assert.equal(find(ui.render(), 'places.reviews.body').props.value, '');
});

test('publication discloses community visibility, ignores a double tap and preserves text on failure', async () => {
  const pending = deferred(), ui = view({ write: () => pending.promise });
  let tree = await open(ui); assert.ok(JSON.stringify(tree).includes('커뮤니티'));
  const button = find(tree, 'places.reviews.publish'); button.props.onPress(); button.props.onPress(); await settle();
  assert.equal(ui.calls.writes.length, 1);
  pending.reject(new Error('offline')); await settle(); tree = ui.render();
  assert.equal(find(tree, 'places.reviews.body').props.value, '초안은 남아 있어야 해요.');
  assert.equal(nodes(tree).some(n => n.props?.accessibilityRole === 'alert'), true);
  assert.ok(ui.calls.feedback.includes('warning'));
});

test('successful save clears only this local draft and refreshes; input focus and cancel give feedback', async () => {
  const ui = view(); let tree = await open(ui, '저장할 경험');
  find(tree, 'places.reviews.body').props.onFocus();
  find(tree, 'places.reviews.publish').props.onPress(); await settle(); tree = ui.render();
  assert.equal(find(tree, 'places.reviews.body'), undefined); assert.ok(ui.calls.feedback.includes('success'));
  assert.ok(ui.calls.reads.length >= 2);
  find(tree, 'places.reviews.write').props.onPress(); tree = ui.render();
  assert.equal(find(tree, 'places.reviews.body').props.value, '');
  find(tree, 'places.reviews.cancel').props.onPress(); assert.ok(ui.calls.feedback.includes('selection'));
});

test('late reads after place/account changes cannot show old review bodies', async () => {
  const old = deferred(), next = deferred(); let count = 0;
  const ui = view({ load: () => (++count === 1 ? old.promise : next.promise) });
  ui.render(); ui.place({ cityId: 'vancouver', placeId: 'osm:way:2' }); ui.account('new-account'); ui.render();
  old.resolve({ posts: [row('old')], cursor: null, hasMore: false }); await settle();
  assert.equal(cards(ui.render()).length, 0);
  assert.equal(ui.calls.reads.at(-1)[1].cityId, 'vancouver');
  assert.equal(ui.calls.reads.at(-1)[1].userId, 'new-account');
  next.resolve({ posts: [row('current')], cursor: null, hasMore: false }); await settle();
  assert.deepEqual(cards(ui.render()).map(n => n.props.post.id), ['current']);
  ui.account(null); const tree = ui.render(); assert.equal(cards(tree).length, 0);
});

test('failed more keeps earlier rows and retry uses the same next cursor; hidden authors disappear immediately', async () => {
  let attempt = 0;
  const cursor = { id: 'raw-last', createdAt: '2026-10-15T00:00:00Z' };
  const ui = view({ load: async () => { attempt++; if (attempt === 2) throw new Error('offline'); return { posts: [row(attempt === 1 ? 'one' : 'two')], cursor, hasMore: attempt === 1 }; } });
  ui.render(); await settle(); let tree = ui.render(); assert.equal(cards(tree).length, 1);
  find(tree, 'places.reviews.more').props.onPress(); await settle(); tree = ui.render();
  assert.equal(cards(tree).length, 1); assert.equal(statuses(tree).some(n => n.props.kind === 'error'), true);
  statuses(tree).find(n => n.props.kind === 'error').props.onAction(); await settle(); tree = ui.render();
  assert.equal(ui.calls.reads.at(-1)[2].id, 'raw-last'); assert.equal(cards(tree).length, 2);
  ui.hidden.add('writer-one'); tree = ui.render(); assert.deepEqual(cards(tree).map(n => n.props.post.id), ['two']);
  cards(tree)[0].props.onPress(); assert.equal(ui.calls.routes.at(-1).params.id, 'two');
});

test('read failure is distinct from empty and language changes update the editor without clearing the draft', async () => {
  const failed = view({ load: async () => { throw new Error('offline'); } }); failed.render(); await settle();
  assert.equal(statuses(failed.render()).some(n => n.props.kind === 'error'), true);
  assert.equal(statuses(failed.render()).some(n => n.props.kind === 'empty'), false);
  const ui = view(); let tree = await open(ui, 'draft'); ui.language('en'); tree = ui.render();
  assert.equal(find(tree, 'places.reviews.body').props.value, 'draft');
  assert.equal(find(tree, 'places.reviews.publish').props.label, 'Publish review');
  assert.equal(find(tree, 'places.reviews.body').props.accessibilityLabel, 'Your place review');
});

test('late save completion cannot erase the next account draft or refresh it with old data', async () => {
  const pending = deferred(), ui = view({ write: () => pending.promise });
  let tree = await open(ui, 'old account draft'); find(tree, 'places.reviews.publish').props.onPress(); await settle();
  ui.account('new-account'); ui.render(); await settle(); tree = ui.render();
  find(tree, 'places.reviews.write').props.onPress(); tree = ui.render();
  find(tree, 'places.reviews.body').props.onChangeText('new account draft');
  const reads = ui.calls.reads.length;
  pending.resolve({ id: 'old-saved' }); await settle(); tree = ui.render();
  assert.equal(find(tree, 'places.reviews.body').props.value, 'new account draft');
  assert.equal(ui.calls.reads.length, reads);
});
