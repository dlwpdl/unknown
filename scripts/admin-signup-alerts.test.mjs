import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

import * as adminLabels from '../src/lib/admin-labels.ts';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
const textContent = tree => nodes(tree).filter(node => node.type === 'Text').flatMap(node => node.props.children).join('');
const compile = name => ts.transpileModule(readFileSync(new URL(`../src/components/admin/${name}.tsx`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

test('real admin dashboard mounts signup alerts for its own admin identity only', () => {
  for (const isAdmin of [true, false]) {
    const exports = {};
    vm.runInNewContext(compile('admin-screen'), { exports, require(name) {
      if (name === 'react') return { useState: value => [typeof value === 'function' ? value() : value, () => {}], useRef: value => ({ current: value }), useEffect() {}, useMemo: fn => fn(), useCallback: fn => fn };
      if (name === 'react/jsx-runtime') return jsx;
      if (name === 'expo-router') return { useLocalSearchParams: () => ({}) };
      if (name === 'react-native') return { Platform: { OS: 'web' }, StyleSheet: { create: x => x } };
      if (name === '@/lib/auth') return { useAuth: () => ({ isAdmin, isAuthed: true, isAuthLoading: false, me: { id: 'admin-id' } }) };
      if (name === '@/lib/admin') return { initialAdminSection: () => 'analytics' };
      if (name === '@/constants/theme') return { Colors: { admin: {}, dark: {} }, Spacing: {} };
      if (name === '@/components/admin/admin-signup-alerts') return { AdminSignupAlerts: 'SignupAlerts' };
      return {};
    } });
    const alerts = nodes(exports.AdminScreen()).filter(node => node.type === 'SignupAlerts');
    assert.equal(alerts.length, isAdmin ? 1 : 0);
    if (isAdmin) assert.equal(alerts[0].props.userId, 'admin-id');
  }
});

const signup = id => ({ id, kind: 'admin_signup', body: `새 회원 가입 · 회원${id} · 밴쿠버`, target_id: `user-${id}`, created_at: new Date().toISOString() });
const firstPost = (id, minutesAgo = 12) => ({ id, kind: 'admin_first_post', body: `회원${id}님이 가입하고 하루 만에 밴쿠버에서 첫 글을 올렸어요.`, target_id: `post-${id}`, created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString() });
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function signupPanel() {
  const state = [], refs = [], effects = [], calls = [], opened = [], links = [], feedback = [];
  let cursor = 0, refCursor = 0, mounted = false, rows = [signup('one')], queryError = null, readError = null, replyError = null, live, focus, foreground, poll, cleanup, removed = 0, cleared = 0, delayed = null;
  let posts = [], comments = [];
  // Each from() gets its own thenable builder; results follow the filters the component actually sent.
  const query = table => {
    const filters = {}, builder = {};
    for (const name of ['select', 'eq', 'in', 'is', 'order', 'limit']) builder[name] = (...args) => { calls.push([name, ...args]); if (name === 'eq' || name === 'in') filters[args[0]] = args[1]; return builder; };
    builder.then = (resolve, reject) => {
      const result = table === 'user_notifications' ? { data: rows.filter(row => row.kind === filters.kind), error: queryError }
        : table === 'posts' ? { data: posts.filter(row => filters.id.includes(row.id)), error: replyError }
        : { data: comments.filter(row => filters.post_id.includes(row.post_id)), error: replyError };
      return (delayed ? new Promise(done => delayed.push(() => done(result))) : Promise.resolve(result)).then(resolve, reject);
    };
    return builder;
  };
  const channel = { on: (_name, filter, fn) => { calls.push(['realtime', filter]); live = fn; return channel; }, subscribe: () => channel };
  const exports = {};
  vm.runInNewContext(compile('admin-signup-alerts'), { exports, setInterval: (fn, ms) => { calls.push(['interval', ms]); poll = fn; return 7; }, clearInterval: () => { cleared++; }, window: { addEventListener: (_name, fn) => { focus = fn; }, removeEventListener: () => { focus = null; } }, require(name) {
    if (name === 'react') return {
      useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
      useRef(initial) { return refs[refCursor++] ??= { current: initial }; },
      useEffect(fn) { if (!mounted) effects.push(fn); },
    };
    if (name === 'react/jsx-runtime') return jsx;
    if (name === 'react-native') return { Platform: { OS: 'web' }, View: 'View', Pressable: 'Pressable', StyleSheet: { create: x => x }, Linking: { openURL: async url => { links.push(url); } }, AppState: { addEventListener: (_name, fn) => { foreground = fn; return { remove() { foreground = null; } }; } } };
    if (name === '@/components/themed-text') return { ThemedText: 'Text' };
    if (name === '@/constants/theme') return { Colors: { admin: {}, dark: {} }, Spacing: {} };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) };
    if (name === '@/lib/community-data') return { markNotificationsRead: async (_client, ids) => { calls.push(['read', ...ids]); if (readError) throw readError; rows = rows.filter(row => !ids.includes(row.id)); } };
    if (name === '@/lib/sharing') return { buildSharedPostUrl: id => `https://share.example.test/${id}` };
    if (name === '@/lib/admin-labels') return adminLabels;
    if (name === '@/lib/supabase') return { supabase: { from: table => { calls.push(['from', table]); return query(table); }, channel: () => channel, removeChannel: async () => { removed++; } } };
    throw new Error(`Unexpected dependency ${name}`);
  } });
  const render = () => { cursor = refCursor = 0; return exports.AdminSignupAlerts({ userId: 'admin-id', onUser: id => opened.push(id) }); };
  return {
    render, calls, opened, links, feedback,
    async mount() { render(); mounted = true; cleanup = effects[0](); await settle(); },
    button(label) { return nodes(render()).find(node => node.type === 'Pressable' && node.props.accessibilityLabel === label); },
    setRows(value) { rows = value; }, setQueryError(value) { queryError = value; }, setReadError(value) { readError = value; },
    setReplies(nextPosts, nextComments) { posts = nextPosts; comments = nextComments; }, setReplyError(value) { replyError = value; },
    async live() { live({ new: { kind: 'admin_signup' } }); await settle(); },
    async poll() { await poll(); await settle(); }, async focus() { focus(); await settle(); },
    defer() { delayed = []; return () => { const waiting = delayed; delayed = null; waiting.forEach(done => done()); }; },
    cleanup() { cleanup(); return { removed, cleared, foreground, focus }; },
  };
}

test('dashboard shows unread signups and reloads through realtime, polling and focus without duplicating rows', async () => {
  const ui = signupPanel(); await ui.mount();
  assert.match(JSON.stringify(ui.render()), /회원one/);
  assert.ok(ui.calls.some(call => call[0] === 'from' && call[1] === 'user_notifications'));
  assert.ok(ui.calls.some(call => call[0] === 'eq' && call[1] === 'user_id' && call[2] === 'admin-id'));
  for (const kind of ['admin_signup', 'admin_first_post']) assert.ok(ui.calls.some(call => call[0] === 'eq' && call[1] === 'kind' && call[2] === kind), kind);
  ui.setRows([signup('one'), signup('two')]); await ui.live();
  assert.match(textContent(ui.render()), /2건/);
  await ui.poll(); await ui.focus(); assert.match(textContent(ui.render()), /2건/);
  assert.ok(ui.calls.some(call => call[0] === 'interval' && call[1] === 30000));
  ui.cleanup();
});

test('member action opens the exact profile, and failed confirmation retains the alert until persistence succeeds', async () => {
  const ui = signupPanel(); await ui.mount();
  ui.button('가입 회원 보기').props.onPress(); assert.deepEqual(ui.opened, ['user-one']);
  ui.setReadError(new Error('offline')); await ui.button('가입 알림 확인').props.onPress(); await settle();
  assert.match(JSON.stringify(ui.render()), /회원one/);
  assert.match(JSON.stringify(ui.render()), /확인.*못/);
  ui.setReadError(null); await ui.button('가입 알림 확인').props.onPress(); await settle();
  assert.equal(ui.render(), null); assert.ok(ui.feedback.includes('selection')); ui.cleanup();
});

test('query failures keep existing alerts visible and show an error that clears on reconnection', async () => {
  const ui = signupPanel(); await ui.mount(); ui.setQueryError(new Error('offline')); await ui.poll();
  assert.match(JSON.stringify(ui.render()), /회원one/); assert.match(JSON.stringify(ui.render()), /불러오지 못/);
  ui.setQueryError(null); await ui.focus(); assert.doesNotMatch(JSON.stringify(ui.render()), /불러오지 못/); ui.cleanup();
});

test('late query cannot resurrect an acknowledged signup and unmount removes every listener', async () => {
  const ui = signupPanel(); await ui.mount(); const resolve = ui.defer();
  void ui.poll(); await settle(); await ui.button('가입 알림 확인').props.onPress(); await settle();
  resolve(); await settle(); assert.equal(ui.render(), null);
  assert.deepEqual(ui.cleanup(), { removed: 1, cleared: 1, foreground: null, focus: null });
});

test('a newcomer first post gets its own red box and count, with how long it has waited and whether anyone commented', async () => {
  const ui = signupPanel();
  ui.setRows([signup('one'), signup('two'), firstPost('three', 42)]);
  ui.setReplies([{ id: 'post-three', author_id: 'newcomer' }], [{ post_id: 'post-three', author_id: 'newcomer' }]);
  await ui.mount();
  const text = textContent(ui.render());
  assert.match(text, /새 회원 첫 글 · 1건 미확인/); assert.match(text, /가입 알림 · 2건 미확인/);
  assert.ok(text.indexOf('새 회원 첫 글') < text.indexOf('가입 알림'));
  assert.match(text, /회원three님이 가입하고 하루 만에 밴쿠버에서 첫 글을 올렸어요/);
  assert.match(text, /올린 지 42분 · 아직 댓글 없음/, 'the author answering their own post is not a reply');
  ui.button('첫 글 새 창에서 보기').props.onPress(); await settle();
  assert.deepEqual(ui.links, ['https://share.example.test/post-three']); assert.deepEqual(ui.opened, []);
  assert.ok(ui.feedback.includes('selection'));
  ui.button('가입 회원 보기').props.onPress(); assert.deepEqual(ui.opened, ['user-one']);
  ui.setReplies([{ id: 'post-three', author_id: 'newcomer' }], [{ post_id: 'post-three', author_id: 'newcomer' }, { post_id: 'post-three', author_id: 'admin' }]);
  await ui.poll(); assert.match(textContent(ui.render()), /올린 지 42분 · 댓글 1개/);
  ui.setReplyError(new Error('offline')); await ui.poll();
  assert.match(textContent(ui.render()), /올린 지 42분/); assert.doesNotMatch(textContent(ui.render()), /댓글|불러오지 못/);
  await ui.button('첫 글 알림 확인').props.onPress(); await settle();
  assert.doesNotMatch(textContent(ui.render()), /새 회원 첫 글/); assert.match(textContent(ui.render()), /가입 알림 · 2건/);
  ui.cleanup();
});

test('twenty unread signups cannot hide a waiting first post', async () => {
  const ui = signupPanel();
  ui.setRows([...Array.from({ length: 20 }, (_, i) => signup(`s${i}`)), firstPost('late', 600)]);
  await ui.mount();
  assert.match(textContent(ui.render()), /새 회원 첫 글 · 1건/); assert.match(textContent(ui.render()), /가입 알림 · 20\+건/);
  assert.match(textContent(ui.render()), /올린 지 10시간 · 아직 댓글 없음/);
  ui.cleanup();
});
