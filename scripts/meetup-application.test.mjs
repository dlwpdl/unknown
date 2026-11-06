import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const application = { postId: 'post', requesterId: 'applicant', question: '질문', answer: '답변', profile: {}, request: { host_id: 'host', status: 'pending', requester: { nickname: '하늘' }, post: { title: '모임' } } };
const pending = (id, post_id, room = { eventKind: 'once' }, requester_id = id) => ({ id, post_id, requester_id, requester: { nickname: id }, post: { title: post_id, room } });

// Real screen logic with synthetic hooks and data; child components stay inert.
function mount(options = {}) {
  const calls = [], hooks = []; let cursor = 0, dirty = true, effects = [], tree;
  const effect = (fn, deps) => {
    const index = cursor++, previous = hooks[index];
    if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
    const slot = hooks[index] = { deps, cleanup: previous?.cleanup };
    effects.push(() => { slot.cleanup?.(); slot.cleanup = fn(); });
  };
  const react = {
    useState(value) { const i = cursor++; if (!(i in hooks)) hooks[i] = value; return [hooks[i], next => { const v = typeof next === 'function' ? next(hooks[i]) : next; if (!Object.is(hooks[i], v)) { hooks[i] = v; dirty = true; } }]; },
    useRef(value) { return hooks[cursor++] ??= { current: value }; },
    useCallback: fn => fn,
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const imports = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { StyleSheet: { create: value => value }, View: 'View', Platform: { OS: 'ios' }, useWindowDimensions: () => ({ height: 800 }), DeviceEventEmitter: { emit() {} }, LayoutAnimation: { configureNext() {}, Types: {}, Properties: {} }, UIManager: {}, Alert: { alert() {} } },
    'react-native-reanimated': { useReducedMotion: () => true },
    'expo-router': { useFocusEffect: fn => effect(fn, [options.requestId ?? 'request']), useLocalSearchParams: () => ({}), useRouter: () => ({ replace: route => calls.push(['replace', JSON.parse(JSON.stringify(route))]), canGoBack: () => true, back() {} }) },
    '@/hooks/use-language': { useLanguage: () => ({ tr: value => value }) }, '@/components/clay': { useClay: () => false, useClayBox: () => false, ClayIcon: () => null, ClayPillFill: () => null, ClayBoxFill: () => null, ClayCoinFill: () => null, ClayControlFill: () => null, ClayPhoto: () => null }, '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/hooks/use-content-visibility': { useContentVisibility: () => (_type, _id, authorId) => authorId === options.hiddenRequester },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => calls.push(['feedback', kind]) }) },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true, me: { id: 'host' } }) }, '@/lib/membership-provider': { useMembership: () => ({ refresh() {} }) },
    '@/lib/chilling-data': { getChillingError: e => e.message, getChillingErrorCode: e => e.message, loadChillingApplication: async () => application, loadMeetupRequestStatus: async () => null,
      respondMeetupRequestV2: async (_c, id, response) => { calls.push(['respond', id, response]); } },
    '@/lib/community-data': { MEETUPS_CHANGED_EVENT: 'changed', loadPendingMeetupRequests: async () => { if (options.pendingError) throw new Error('offline'); return options.pending ?? []; } },
    '@/lib/user-profile': { loadMannerSummary: async () => null }, '@/lib/supabase': { supabase: {} }, '@/lib/mock': { CITIES: [] }, '@/constants/theme': { Spacing: {}, MaxContentWidth: 640 }, '@/constants/design-system': { ControlMotion: { settleMs: 180 } },
  };
  const exports = {};
  const source = readFileSync(new URL('../src/app/meetup-application.tsx', import.meta.url), 'utf8') + '\nexport { Application };';
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, { exports, globalThis: {}, require: name => {
    if (name in imports) return imports[name];
    if (name.startsWith('@/components/') || name.startsWith('expo-') || name === 'react-native-safe-area-context') return new Proxy({}, { get: (_, key) => key });
    throw new Error(`Unexpected import ${name}`);
  } });
  const render = () => { dirty = false; cursor = 0; tree = exports.Application({ requestId: 'request' }); effects.splice(0).forEach(fn => fn()); };
  const flush = async () => { for (let i = 0; i < 12; i++) { if (dirty) render(); await new Promise(resolve => setImmediate(resolve)); } };
  const nodes = value => !value || typeof value !== 'object' ? [] : [value, ...[value.props?.children].flat(Infinity).flatMap(nodes)];
  return { calls, flush, nodes: () => nodes(tree), control: id => nodes(tree).find(node => node.props?.analyticsId === id) };
}
const approve = async ui => { await ui.flush(); ui.control('app_meetup-application.pressable.3').props.onPress(); await ui.flush(); };

test('the approval conditions sit directly above the approve button', async () => {
  const ui = mount(); await ui.flush();
  const order = ui.nodes().map(node => node.props?.analyticsId === 'app_meetup-application.pressable.3' ? 'approve' : node.props?.analyticsId === 'meetup.application.decide' ? 'conditions' : null).filter(Boolean);
  assert.deepEqual(order, ['conditions', 'approve']);
  const conditions = ui.control('meetup.application.decide');
  assert.match(JSON.stringify(conditions.props.children), /정원이 찼거나.*승인할 수 없어요/);
  assert.ok(conditions.props.style.some(style => style.maxHeight === 256), 'bounded so large text keeps the buttons on screen');
});

test('after a decision the host moves to the next request in the same meetup first', async () => {
  const ui = mount({ pending: [pending('other', 'other-post'), pending('legacy', 'post', null), pending('request', 'post'), pending('same', 'post')] });
  await approve(ui);
  assert.ok(ui.calls.some(call => call[0] === 'respond' && call[1] === 'request' && call[2] === 'approved'));
  ui.control('meetup.application.next').props.onPress();
  assert.deepEqual(ui.calls.at(-1), ['replace', { pathname: '/meetup-application', params: { requestId: 'same' } }]);
  ui.control('meetup.application.inbox').props.onPress();
  assert.deepEqual(ui.calls.at(-1), ['replace', { pathname: '/chat', params: { view: 'requests' } }]);
});

test('falls back to another meetup, skipping hidden requesters and requests with no review screen', async () => {
  const ui = mount({ hiddenRequester: 'blocked', pending: [pending('legacy', 'post', null), pending('blocked', 'post'), pending('other', 'other-post')] });
  await approve(ui);
  ui.control('meetup.application.next').props.onPress();
  assert.deepEqual(ui.calls.at(-1), ['replace', { pathname: '/meetup-application', params: { requestId: 'other' } }]);
});

for (const [name, options] of [['nothing is left', { pending: [pending('request', 'post')] }], ['the lookup fails', { pendingError: true }]]) {
  test(`returns to the inbox when ${name}`, async () => {
    const ui = mount(options);
    await approve(ui);
    assert.equal(ui.control('meetup.application.next'), undefined);
    const inbox = ui.control('meetup.application.inbox');
    assert.equal(inbox.props.busy, false);
    inbox.props.onPress();
    assert.deepEqual(ui.calls.at(-1), ['replace', { pathname: '/chat', params: { view: 'requests' } }]);
  });
}
