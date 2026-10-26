import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { t } from '../src/i18n/ko.ts';
import { chillingSchedule } from '../src/lib/chilling.ts';
import * as designSystem from '../src/constants/design-system.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const meetup = { id: 'my-meetup', authorId: 'host', title: '페스티벌 같이 가요', cityId: 'vancouver', role: 'host', room: { memberCount: 1, capacity: 8 } };
const post = { ...meetup, author: { id: 'host' }, tag: { kind: 'meetup' }, body: 'private-venue' };
function mount(data = {}) {
  let hooks = [], index = 0, effects = [], tree, childKey;
  const calls = [], auth = { isAuthed: true, me: { id: 'host' } };
  const effect = (fn, deps) => {
    const slot = index++, previous = hooks[slot];
    if (previous && deps && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
    const hook = hooks[slot] = { deps, cleanup: previous?.cleanup };
    effects.push(() => { hook.cleanup?.(); hook.cleanup = fn(); });
  };
  const react = {
    useState(initial) { const slot = index++; if (!(slot in hooks)) hooks[slot] = initial; return [hooks[slot], value => { hooks[slot] = typeof value === 'function' ? value(hooks[slot]) : value; }]; },
    useRef(initial) { const slot = index++; return hooks[slot] ??= { current: initial }; },
    useCallback(fn, deps) { const slot = index++; if (!hooks[slot] || !deps.every((value, i) => Object.is(value, hooks[slot].deps[i]))) hooks[slot] = { fn, deps }; return hooks[slot].fn; },
    useLayoutEffect: effect,
  };
  const exports = {}, native = new Proxy({ StyleSheet: { create: value => value }, Alert: { alert: (...args) => calls.push(['alert', ...args]) }, DeviceEventEmitter: { addListener: () => ({ remove() {} }), emit() {} } }, { get: (value, key) => value[key] ?? key });
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/my-meetups.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: withLanguageImports((name) => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
      if (name === 'react-native') return native;
      if (name === 'expo-router') return { useRouter: () => ({ push: route => calls.push(['push', JSON.parse(JSON.stringify(route))]) }), useFocusEffect: fn => effect(fn, [fn]) };
      if (name === '@/lib/auth') return { useAuth: () => auth };
      if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
      if (name === '@/hooks/use-content-visibility') return { useContentVisibility: () => (_kind, id) => Boolean(data.hidden?.(id)) };
      if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play: value => calls.push(['feedback', value]) }) };
      if (name === '@/lib/membership-provider') return { useMembership: () => ({ refresh: noop }) };
      if (name === '@/components/relationship-slot-card') return { relationshipSlotData: () => null };
      if (name === '@/lib/community-data') return { loadMyMeetups: async () => data.items ?? [meetup], recordPostShare: async (_client, id) => calls.push(['shared', id]), leaveMeetup: async (_client, id) => calls.push(['leave', id]) };
      if (name === '@/lib/feed-data') return { loadPublicPost: async (_client, id) => { calls.push(['load-post', id]); return data.loadPost ? data.loadPost() : post; } };
      if (name === '@/lib/chilling') return { chillingKind: room => room.eventKind === 'once' ? 'once' : 'group', chillingSchedule };
      if (name === '@/lib/mock') return { CITIES: [] };
      if (name === '@/i18n/ko') return { t };
      if (name === '@/constants/theme') return { Spacing: {} };
      if (name === '@/constants/design-system') return designSystem;
      // The real host actions are covered in meetup-host-controls.test.mjs; here only who receives them.
      if (name === '@/components/meetup-room-summary') return { meetupHostActions: ({ postId, room }) => { calls.push(['host-actions', postId, room]); return [{ key: 'edit' }, { key: 'recruiting' }]; } };
      return new Proxy({}, { get: (_value, key) => key });
    }),
  });
  const render = () => {
    tree = exports.MyMeetups({ onOpen: async () => {} });
    if (tree.key !== childKey) { hooks.forEach(hook => hook?.cleanup?.()); hooks = []; childKey = tree.key; }
    index = 0; effects = []; tree = tree.type({ ...tree.props, onOpen: async id => calls.push(['open', id]) }); effects.forEach(fn => fn()); return tree;
  };
  const control = id => nodes(tree).find(node => node.props?.analyticsId === id);
  const sheet = () => nodes(tree).find(node => node.type === 'PostShareSheet');
  const menu = () => nodes(tree).find(node => node.type === 'MeetupManageSheet');
  render();
  return { auth, calls, render, control, sheet, menu, async settle() { await tick(); render(); }, unmount() { hooks.forEach(hook => hook?.cleanup?.()); } };
}
const noop = () => {};

test('hosts and approved members open the existing invitation sheet directly from My Meetups', async () => {
  for (const role of ['host', 'approved']) {
    const ui = mount({ items: [{ ...meetup, role }] }); await ui.settle();
    const invite = ui.control('meetup.share.open'); assert.ok(invite);
    invite.props.onPress(); invite.props.onPress(); await ui.settle();
    assert.equal(ui.calls.filter(([name]) => name === 'load-post').length, 1, 'double taps do not start duplicate loads');
    assert.equal(ui.sheet().props.post, post);
    assert.ok(ui.calls.some(([name, value]) => name === 'feedback' && value === 'selection'));
    ui.sheet().props.onShared(); await ui.settle();
    assert.deepEqual(ui.calls.find(([name]) => name === 'shared'), ['shared', meetup.id]);
    ui.sheet().props.onClose(); ui.render(); assert.equal(ui.sheet(), undefined); ui.unmount();
  }
});
test('My Meetups keeps role destinations and destructive actions truthful without hiding any list items', async () => {
  for (const role of ['host', 'approved', 'pending', 'rejected', 'cancelled']) {
    const ui = mount({ items: [{ ...meetup, role }] }); await ui.settle();
    ui.control('components_my-meetups.pressable.2').props.onPress(); await ui.settle();
    assert.ok(ui.calls.some(([name]) => name === (role === 'host' || role === 'approved' ? 'open' : 'push')));
    assert.equal(!!ui.control('components_my-meetups.pressable.4'), role !== 'rejected' && role !== 'cancelled'); ui.unmount();
  }
  const ui = mount({ items: Array.from({ length: 65 }, (_, i) => ({ ...meetup, id: String(i) })) }); await ui.settle();
  assert.equal(nodes(ui.render()).filter(node => node.props?.analyticsId === 'components_my-meetups.pressable.2').length, 65); ui.unmount();
});
test('a retained cancel or end confirmation cannot write after account switch or unmount', async () => {
  for (const change of ['account', 'unmount']) {
    const ui = mount(); await ui.settle(); ui.control('components_my-meetups.pressable.4').props.onPress(); ui.render();
    ui.menu().props.actions.find(({ key }) => key === 'my-change').onPress();
    const confirm = ui.calls.find(([name]) => name === 'alert')[3].find(button => button.style === 'destructive');
    if (change === 'account') { ui.auth.me = { id: 'other' }; ui.render(); } else ui.unmount();
    confirm.onPress(); await ui.settle(); assert.equal(ui.calls.some(([name]) => name === 'leave'), false); ui.unmount();
  }
});
test('pending, rejected and cancelled requests offer no host invitation action', async () => {
  for (const role of ['pending', 'rejected', 'cancelled']) {
    const ui = mount({ items: [{ ...meetup, role }] }); await ui.settle();
    assert.equal(ui.control('meetup.share.open'), undefined); ui.unmount();
  }
});
test('deleted or unavailable meetup cannot open an invitation sheet and can be retried', async () => {
  for (const loadPost of [async () => null, async () => { throw new Error('offline'); }]) {
    const ui = mount({ loadPost }); await ui.settle(); ui.control('meetup.share.open').props.onPress(); await ui.settle();
    assert.equal(ui.sheet(), undefined); assert.equal(ui.control('meetup.share.open').props.disabled, false);
    assert.ok(ui.calls.some(([name]) => name === 'alert')); ui.unmount();
  }
});
test('late invitations cannot appear after logout, account change, unmount or hiding the meetup', async () => {
  for (const change of ['logout', 'account', 'unmount', 'hidden']) {
    let resolve, hidden = false;
    const ui = mount({ loadPost: () => new Promise(yes => { resolve = yes; }), hidden: () => hidden });
    await ui.settle(); ui.control('meetup.share.open').props.onPress();
    if (change === 'logout') ui.auth.isAuthed = false;
    if (change === 'account') ui.auth.me = { id: 'other' };
    if (change === 'hidden') hidden = true;
    if (change === 'unmount') ui.unmount(); else ui.render();
    resolve(post); await ui.settle(); assert.equal(ui.sheet(), undefined); ui.unmount();
  }
});

test('only the host menu lists recruiting pause and edit, ahead of the destructive action', async () => {
  for (const role of ['host', 'approved', 'pending']) {
    const ui = mount({ items: [{ ...meetup, role }] }); await ui.settle();
    ui.control('components_my-meetups.pressable.4').props.onPress(); ui.render();
    const keys = ui.menu().props.actions.map(({ key }) => key);
    assert.equal(keys.includes('recruiting') && keys.includes('edit'), role === 'host', role);
    if (role === 'host') {
      assert.deepEqual(ui.calls.find(([name]) => name === 'host-actions'), ['host-actions', meetup.id, meetup.room]);
      assert.equal(keys.at(-1), 'my-change');
    }
    ui.unmount();
  }
});

test('a past meetup opens its read-only chat only when the room is still readable, without invite or change actions', async () => {
  for (const conversationId of ['ended-room', null]) {
    const ui = mount({ items: [{ ...meetup, role: 'closed', conversationId }] }); await ui.settle();
    const chat = ui.control('components_my-meetups.pressable.3');
    assert.equal(!!chat, !!conversationId);
    assert.equal(ui.control('meetup.share.open'), undefined);
    assert.equal(ui.control('components_my-meetups.pressable.4'), undefined);
    if (chat) {
      assert.equal(nodes(chat).find(node => node.type === 'ThemedText').props.children, '지난 대화 보기');
      chat.props.onPress();
      assert.deepEqual(ui.calls.at(-1), ['push', { pathname: '/chat', params: { conversationId } }]);
      assert.deepEqual(ui.calls.at(-2), ['feedback', 'selection']);
    }
    ui.unmount();
  }
});
