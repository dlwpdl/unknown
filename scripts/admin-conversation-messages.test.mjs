import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as labels from '../src/lib/admin-labels.ts';

function module(file, imports = {}) {
  const exports = {};
  const path = new URL(file, import.meta.url);
  if (!existsSync(path)) return exports;
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require: name => imports[name] ?? {}, Date, Intl });
  return exports;
}
const adminData = () => module('../src/lib/admin-data.ts', { '@/lib/admin-labels': labels });
const api = () => module('../src/lib/admin-conversation-messages.ts', { '@/lib/admin-data': adminData(), '@/lib/admin-labels': labels });
function client(results, denied = false) {
  const calls = [];
  return { calls, async rpc(name, args) { calls.push([name, args]); return { error: denied ? { message: 'ADMIN_REQUIRED' } : null }; },
    from(table) {
      calls.push(['from', table]);
      const chain = { then(resolve, reject) { return Promise.resolve(results[table]).then(resolve, reject); } };
      for (const method of ['select', 'eq', 'in', 'order', 'range']) chain[method] = (...args) => { calls.push([table, method, ...args]); return chain; };
      return chain;
    } };
}
function view(name, extra = {}, file = '../src/components/admin/admin-conversations.tsx') {
  const state = [], cleanups = [], feedback = [];
  let index = 0;
  const hooks = {
    useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial; return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }]; },
    useRef(initial) { const slot = index++; if (!(slot in state)) state[slot] = { current: initial }; return state[slot]; },
    useEffect(fn, deps) { const slot = index++; if (!state[slot] || deps.some((value, i) => value !== state[slot][i])) { cleanups[slot]?.(); state[slot] = deps; cleanups[slot] = fn(); } },
    useMemo(fn) { return fn(); },
  };
  const imports = {
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    '@/components/admin/admin-table-controls': Object.fromEntries(['AdminSearch', 'AdminSelect', 'AdminFilterBar', 'AdminFilterReset', 'AdminTableSummary'].map(name => [name, name])),
    '@/lib/admin-labels': labels,
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
    '@/lib/supabase': { supabase: {} }, ...extra,
  };
  const exports = module(file, imports);
  return { render(props) { index = 0; assert.equal(typeof exports[name], 'function', 'conversation view exists'); return exports[name](props); }, feedback };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const tick = () => new Promise(setImmediate);

test('the global conversations section routes to room monitoring with its own pagination callbacks', () => {
  const screen = view('AdminSectionView', {
    'react-native': { StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width: 1200 }) },
    '@/constants/theme': { Colors: { admin: {} }, Spacing: {} },
    '@/lib/admin-layout': { isCompactAdminWidth: () => false },
    '@/components/admin/admin-conversations': { AdminConversationWorkspace: 'RoomMonitoring' },
  }, '../src/components/admin/admin-section.tsx');
  const props = { section: 'conversations', data: { profiles: [], posts: [], conversations: [{ id: 'room-a' }], messages: [] }, loadingMore: false, noMore: false, onUser() {}, onLoadMore() {} };
  const tree = screen.render(props);
  assert.equal(tree.type, 'RoomMonitoring');
  assert.equal(tree.props.data.conversations[0].id, 'room-a');
  assert.equal(tree.props.onLoadMore, props.onLoadMore);
});

test('global conversations open as one review screen and the local preview keeps the room monitor', () => {
  const screen = view('AdminConversationWorkspace', {
    '@/components/admin/admin-conversation-review': { AdminConversationReviewView: 'RiskReview' },
  });
  const props = { data: { profiles: [], posts: [], conversations: [], messages: [] }, onUser() {}, onLoadMore() {}, noMore: true, loadingMore: false, refreshSignal: 3 };
  let tree = screen.render(props);
  assert.equal(tree.type, 'RiskReview', 'the deciding review screen is not folded behind a disclosure');
  assert.equal(tree.props.onUser, props.onUser);
  assert.equal(tree.props.refreshSignal, 3);
  assert.equal(nodes(tree).some(node => node.type === 'details'), false);
  tree = screen.render({ ...props, localPreview: true });
  assert.equal(nodes(tree).some(node => node.type === 'RiskReview'), false, 'preview never reads server conversations');
  assert.equal(tree.type?.name, 'AdminConversationsView');
});

test('conversation pagination reads room rows, hydrates members and preserves older meetup titles', async () => {
  const c = client({ conversations: { data: [{ id: 'room', user_low_id: 'a', user_high_id: 'b', group_post_id: 'meetup' }], error: null },
    profiles: { data: [{ id: 'a', nickname: '이웃' }, { id: 'b', nickname: '산책' }], error: null },
    posts: { data: [{ id: 'meetup', title: '동네 산책' }], error: null }, messages: { data: [{ id: 'wrong-global-message', sender_id: 'x' }], error: null } });
  const result = await adminData().loadMoreAdminData(c, 'conversations', 50);
  assert.equal(result.rows[0].id, 'room');
  assert.equal(result.profiles[0].nickname, '이웃');
  assert.equal(result.contextPosts[0].title, '동네 산책');
  assert.equal(c.calls[0][1].scope, 'conversations');
  assert.ok(c.calls.some(call => call[0] === 'conversations' && call[1] === 'range' && call[2] === 50 && call[3] === 99));
  assert.equal(c.calls.some(call => call[0] === 'from' && call[1] === 'messages'), false);
});

test('conversation detail reads only its exact room and audits before any private read', async () => {
  const { loadAdminConversationMessages } = api();
  assert.equal(typeof loadAdminConversationMessages, 'function');
  const c = client({ messages: { data: [{ id: 'older', conversation_id: 'room-b', sender_id: 'a', body: '이 대화의 이전 기록' }], count: 81, error: null }, profiles: { data: [{ id: 'a', nickname: '이웃' }], error: null } });
  const page = await loadAdminConversationMessages(c, 'room-b', 50);
  assert.equal(page.rows[0].body, '이 대화의 이전 기록');
  assert.equal(page.total, 81);
  assert.equal(page.profiles[0].nickname, '이웃');
  assert.equal(c.calls[0][1].resource_id, 'room-b');
  assert.ok(c.calls.some(call => call[0] === 'messages' && call[1] === 'eq' && call[2] === 'conversation_id' && call[3] === 'room-b'));
  assert.ok(c.calls.some(call => call[1] === 'range' && call[2] === 50 && call[3] === 99));
  const denied = client({}, true);
  await assert.rejects(loadAdminConversationMessages(denied, 'room-b'), /ADMIN_REQUIRED/);
  assert.equal(denied.calls.some(call => call[0] === 'from'), false);
  await assert.rejects(loadAdminConversationMessages(c, '', 0), /INVALID/);
  await assert.rejects(loadAdminConversationMessages(c, 'room-b', -1), /INVALID/);
  await assert.rejects(loadAdminConversationMessages(client({ messages: { data: [], count: null, error: null } }), 'room-b'), /MISSING/);
});

test('meetup conversations stay tied to the selected meetup and never fall back after an empty result or denial', async () => {
  const { loadAdminMeetupConversations } = api();
  assert.equal(typeof loadAdminMeetupConversations, 'function');
  const c = client({ conversations: { data: [{ id: 'group-a', group_post_id: 'meetup-a', user_low_id: null, user_high_id: null }], error: null } });
  assert.equal((await loadAdminMeetupConversations(c, 'meetup-a')).conversations[0].id, 'group-a');
  assert.equal(c.calls[0][1].resource_id, 'meetup-a');
  assert.ok(c.calls.some(call => call[0] === 'conversations' && call[1] === 'eq' && call[2] === 'group_post_id' && call[3] === 'meetup-a'));
  const empty = client({ conversations: { data: [], error: null } });
  assert.equal((await loadAdminMeetupConversations(empty, 'meetup-a')).conversations.length, 0);
  assert.equal(empty.calls.some(call => call[0] === 'from' && call[1] === 'messages'), false);
  const denied = client({}, true);
  await assert.rejects(loadAdminMeetupConversations(denied, 'meetup-a'), /ADMIN_REQUIRED/);
  assert.equal(denied.calls.some(call => call[0] === 'from'), false);
});

test('clicking a conversation opens that room detail instead of the member history and restores the list', () => {
  const users = [];
  let focused = 0;
  const screen = view('AdminConversationsView');
  const props = { data: { profiles: [{ id: 'a', nickname: '이웃' }, { id: 'b', nickname: '산책' }], posts: [], conversations: [{ id: 'room-a', user_low_id: 'a', user_high_id: 'b', created_at: '2026-10-14T10:00:00Z' }], messages: [] }, onUser: id => users.push(id), onLoadMore() {}, noMore: true, loadingMore: false };
  let tree = screen.render(props);
  const button = nodes(tree).find(node => node.type === 'button' && node.props['data-conversation-id'] === 'room-a');
  assert.ok(button, 'list is grouped by conversation');
  button.props.onClick({ currentTarget: { focus() { focused++; } } });
  tree = screen.render(props);
  const detail = nodes(tree).find(node => node.type?.name === 'AdminConversationDetail');
  assert.equal(detail.props.conversationId, 'room-a');
  assert.match(detail.props.title, /이웃.*산책/);
  assert.deepEqual(users, []);
  detail.props.onClose();
  assert.ok(nodes(screen.render(props)).some(node => node.props?.['data-conversation-id'] === 'room-a'));
  assert.equal(focused, 1);
});

test('a late conversation response cannot show another room and failure is not shown as an empty thread', async () => {
  const requests = [];
  const screen = view('AdminConversationDetail', { '@/lib/admin-conversation-messages': { loadAdminConversationMessages: (_client, id, offset) => new Promise((resolve, reject) => requests.push({ id, offset, resolve, reject })) } });
  const props = { conversationId: 'room-a', title: '첫 대화', onUser() {} };
  screen.render(props);
  const next = { ...props, conversationId: 'room-b', title: '두 번째 대화' };
  screen.render(next);
  requests[1].resolve({ rows: [{ id: 'b', sender_id: 'member-b', body: '두 번째 대화 내용', created_at: '2026-10-14T10:00:00Z' }], total: 1, profiles: [] }); await tick();
  requests[0].resolve({ rows: [{ id: 'a', sender_id: 'member-a', body: '첫 대화의 늦은 응답', created_at: '2026-10-14T10:00:00Z' }], total: 999, profiles: [] }); await tick();
  let tree = screen.render(next);
  assert.ok(nodes(tree).some(node => node.props?.children === '두 번째 대화 내용'));
  assert.equal(nodes(tree).some(node => node.props?.children === '첫 대화의 늦은 응답'), false);
  nodes(tree).find(node => node.type === 'button' && node.props['aria-label'] === '대화 새로고침').props.onClick();
  screen.render(next);
  requests[2].reject(new Error('MFA expired')); await tick();
  tree = screen.render(next);
  assert.ok(nodes(tree).some(node => node.props?.role === 'alert'));
  assert.equal(nodes(tree).some(node => node.props?.children === '두 번째 대화 내용'), false);
});

test('older messages keep the selected room scope, append once and render before newer messages', async () => {
  const requests = [];
  const screen = view('AdminConversationDetail', { '@/lib/admin-conversation-messages': { loadAdminConversationMessages: (_client, id, offset) => new Promise(resolve => requests.push({ id, offset, resolve })) } });
  const props = { conversationId: 'room-a', title: '동네 대화', onUser() {} };
  screen.render(props);
  requests[0].resolve({ rows: [{ id: 'new', sender_id: 'a', body: '새 메시지', created_at: '2026-10-14T10:00:00Z' }], total: 2, profiles: [] }); await tick();
  let tree = screen.render(props);
  const more = nodes(tree).find(node => node.type === 'button' && node.props?.['aria-label'] === '이전 대화 더 보기');
  const pending = more.props.onClick();
  await more.props.onClick();
  assert.equal(requests.length, 2, 'a double tap cannot append the same page twice');
  assert.equal(requests[1].id, 'room-a');
  assert.equal(requests[1].offset, 1);
  requests[1].resolve({ rows: [{ id: 'old', sender_id: 'b', body: '오래된 메시지', created_at: '2026-10-13T10:00:00Z' }], total: 2, profiles: [] });
  await pending;
  tree = screen.render(props);
  assert.deepEqual(nodes(tree).filter(node => node.type === 'article').map(node => node.key), ['old', 'new']);
  assert.equal(nodes(tree).some(node => node.props?.['aria-label'] === '이전 대화 더 보기'), false);
});
