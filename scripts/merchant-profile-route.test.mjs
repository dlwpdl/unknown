import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { appendUniquePosts, getPostImageSource } from '../src/lib/feed-data.ts';

const company = '11111111-1111-4111-8111-111111111111';
const post = { id: '22222222-2222-4222-8222-222222222222', author: { id: 'writer' }, title: '업체가 올린 실제 글', body: '게시글 본문', tag: { slug: 'business', label: '업체' }, createdAtLabel: '2시간 전' };
const content = { merchant_id: company, kind: 'posts', post_count: 3, job_count: 2, posts: [post], has_more: false, nextOffset: 1 };
const settle = () => new Promise(setImmediate);
const nodes = root => !root || typeof root !== 'object' ? [] : [root, ...Object.values(root).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];

function screen({ loadReviews = async (_, __, ___, kind) => ({ review_kind: kind, rating_average: kind === 'usage' ? 8.833333333 : 7, review_count: 3 }), loadPosts = async (_, __, kind) => ({ ...content, kind }) } = {}) {
  const state = [], cleanup = new Map(), calls = [], postCalls = [], routes = [], feedback = [];
  let index = 0, account = 'author', hidden = () => false;
  const imports = {
    react: {
      useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = initial; return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }]; },
      useRef(initial) { const slot = index++; return state[slot] ??= { current: initial }; },
      useEffect(fn, deps) { const slot = index++; if (!state[slot] || deps.some((value, i) => value !== state[slot][i])) { cleanup.get(slot)?.(); state[slot] = deps; const end = fn(); if (end) cleanup.set(slot, end); } },
    },
    'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'react-native': { View: 'View', StyleSheet: { create: value => value } },
    'react-native-reanimated': { useReducedMotion: () => true },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-router': { useLocalSearchParams: () => ({ id: company }), useRouter: () => ({ push: value => routes.push(JSON.parse(JSON.stringify(value))) }) },
    'expo-image': { Image: 'Image' },
    '@/components/analytics-controls': { Pressable: 'Pressable', ScrollView: 'ScrollView' },
    '@/components/themed-text': { ThemedText: 'Text' }, '@/components/themed-view': { ThemedView: 'View' },
    '@/components/merchant-profile-header': { MerchantProfileHeader: 'ProfileHeader' }, '@/components/merchant-reviews': { MerchantReviews: 'Reviews' },
    '@/hooks/use-content-visibility': { useContentVisibility: () => hidden },
    '@/hooks/use-theme': { useTheme: () => ({}) }, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true, isAuthLoading: false, me: { id: account } }) },
    '@/lib/merchant-profile': { loadMerchantProfile: async () => ({ id: company, name: '회사', services: '등록된 소개', address: '실제 주소', review_post_id: 'post' }),
      loadMerchantProfilePosts: async (...args) => { postCalls.push(args); return loadPosts(...args); } },
    '@/lib/feed-data': { getPostImageSource, appendUniquePosts },
    '@/lib/merchant-reviews': { loadMerchantReviews: async (...args) => { calls.push(args); return loadReviews(...args); } },
    '@/lib/supabase': { supabase: {} },
  };
  const exports = {}, source = ts.transpileModule(readFileSync(new URL('../src/app/company/[id].tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, require: name => imports[name] ?? {} });
  return { calls, postCalls, routes, feedback, hidePost(id) { hidden = (type, target, author) => type === 'post' && (target === id || author === 'blocked-writer'); }, setAccount(value) { account = value; }, render() { index = 0; return exports.default(); } };
}

const control = (root, id) => nodes(root).find(node => node.props?.analyticsId === id);
const text = root => nodes(root).flatMap(node => [node.props?.children].flat().filter(value => typeof value === 'string' || typeof value === 'number')).join(' ');

test('company tabs show real counts, select hiring and open a real post detail', async () => {
  const view = screen(); view.render(); await settle(); view.render(); await settle();
  let root = view.render();
  assert.equal(control(root, 'company.tab.posts')?.props.accessibilityState.selected, true);
  assert.match(text(control(root, 'company.tab.posts')), /3/);
  assert.match(text(control(root, 'company.tab.jobs')), /2/);
  assert.match(text(control(root, 'company.tab.reviews')), /6/);
  control(root, `company.post.${post.id}`).props.onPress();
  assert.deepEqual(view.routes, [{ pathname: '/post/[id]', params: { id: post.id } }]);
  control(root, 'company.hiring').props.onPress(); root = view.render(); await settle(); root = view.render();
  assert.equal(control(root, 'company.tab.jobs').props.accessibilityState.selected, true);
  assert.equal(view.postCalls.at(-1)[2], 'jobs');
  nodes(root).find(node => node.type === 'ProfileHeader').props.onReviewPress('employment');
  root = view.render();
  assert.equal(control(root, 'company.tab.reviews').props.accessibilityState.selected, true);
  assert.equal(nodes(root).find(node => node.type === 'Reviews').props.reviewKind, 'employment');
  assert.ok(view.feedback.includes('selection'));
});

test('real zero counts keep all tabs and the no-jobs state removes the hiring badge', async () => {
  const view = screen({ loadPosts: async (_, __, kind) => ({ ...content, kind, post_count: 0, job_count: 0, posts: [], nextOffset: 0 }) });
  view.render(); await settle(); view.render(); await settle();
  let root = view.render();
  assert.equal(control(root, 'company.hiring'), undefined);
  assert.match(text(root), /아직 게시글이 없어요/);
  control(root, 'company.tab.jobs').props.onPress(); view.render(); await settle(); root = view.render();
  assert.match(text(root), /현재 모집 중인 공고가 없어요/);
  assert.equal(nodes(root).filter(node => node.props?.accessibilityRole === 'tab').length, 4);
});

test('late company list responses from the previous account cannot restore its posts or counts', async () => {
  const pending = [];
  const view = screen({ loadPosts: () => new Promise(resolve => pending.push(resolve)) });
  view.render(); await settle(); view.render(); await settle();
  view.setAccount('another'); view.render(); await settle(); view.render(); await settle();
  pending[0](content); await settle();
  assert.ok(!text(view.render()).includes(post.title));
  assert.ok(!text(control(view.render(), 'company.tab.posts')).includes('3'));
  pending[1]({ ...content, post_count: 0, job_count: 0, posts: [] }); await settle();
  assert.match(text(view.render()), /아직 게시글이 없어요/);
});

test('visible retry resumes the failed page and preserves earlier pages without two concurrent reads', async () => {
  let resolve, reject, count = 0;
  const view = screen({ loadPosts: async (_, __, kind, offset) => {
    if (!offset) return { ...content, kind, has_more: true };
    count++; return new Promise((done, fail) => { resolve = done; reject = fail; });
  } });
  view.render(); await settle(); view.render(); await settle();
  let root = view.render(), more = control(root, 'company.posts.more');
  assert.ok(more);
  more.props.onPress(); more.props.onPress(); assert.equal(count, 1);
  const older = { ...post, id: '33333333-3333-4333-8333-333333333333', title: '이전에 불러온 글' };
  resolve({ ...content, posts: [older], has_more: true, nextOffset: 2 });
  await settle(); root = view.render();
  control(root, 'company.posts.more').props.onPress();
  reject(new Error('offline')); await settle(); root = view.render();
  assert.ok(text(root).includes(post.title) && text(root).includes(older.title));
  control(root, 'company.posts.retry').props.onPress(); view.render(); await settle();
  assert.equal(view.postCalls.at(-1)[3], 2);
  resolve({ ...content, posts: [older, { ...post, id: '44444444-4444-4444-8444-444444444444', title: '다음 글' }], has_more: false, nextOffset: 4 });
  await settle(); root = view.render();
  assert.equal(nodes(root).filter(node => node.props?.analyticsId === `company.post.${post.id}`).length, 1);
  assert.equal(nodes(root).filter(node => node.props?.analyticsId === `company.post.${older.id}`).length, 1);
  assert.ok(text(root).includes(older.title) && text(root).includes('다음 글'));
});

test('profile ratings select the matching review list and refresh both independent server means after saving', async () => {
  const view = screen(); view.render(); await settle(); view.render(); await settle();
  const header = nodes(view.render()).find(node => node.type === 'ProfileHeader');
  assert.equal(header.props.ratings.usage.rating_average, 8.833333333);
  assert.equal(header.props.ratings.employment.rating_average, 7);
  header.props.onReviewPress('employment');
  const reviews = nodes(view.render()).find(node => node.type === 'Reviews');
  assert.equal(reviews.props.reviewKind, 'employment');
  const before = view.calls.length;
  reviews.props.onChanged(); view.render(); await settle();
  assert.equal(view.calls.length, before + 2);
});

test('a late rating response from a previous account cannot populate the next account header', async () => {
  const pending = [];
  const view = screen({ loadReviews: () => new Promise(resolve => pending.push(resolve)) });
  view.render(); await settle(); view.render(); await settle();
  view.setAccount('another'); view.render(); await settle(); view.render(); await settle();
  pending.slice(0, 2).forEach(resolve => resolve({ rating_average: 10, review_count: 99 })); await settle();
  assert.equal(nodes(view.render()).find(node => node.type === 'ProfileHeader').props.ratings, undefined);
  pending.slice(2).forEach(resolve => resolve({ rating_average: 6, review_count: 1 })); await settle();
  assert.equal(nodes(view.render()).find(node => node.type === 'ProfileHeader').props.ratings.employment.rating_average, 6);
});

test('hidden posts disappear immediately and stale reads cannot restore the previous visibility counts', async () => {
  const pending = [];
  const view = screen({ loadPosts: () => new Promise(resolve => pending.push(resolve)) });
  view.render(); await settle(); view.render(); await settle();
  view.hidePost(post.id); view.render(); await settle(); view.render(); await settle();
  assert.equal(pending.length, 2, 'a visibility change revalidates the public counts');
  pending[0](content); await settle();
  assert.equal(control(view.render(), `company.post.${post.id}`), undefined);
  assert.ok(!text(control(view.render(), 'company.tab.posts')).includes('3'));
  pending[1]({ ...content, post_count: 1, job_count: 0, posts: [post] }); await settle();
  assert.equal(control(view.render(), `company.post.${post.id}`), undefined, 'the house overlay filters late rows too');
  assert.match(text(control(view.render(), 'company.tab.posts')), /1/);
});
