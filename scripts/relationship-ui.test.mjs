import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

import { t } from '../src/i18n/ko.ts';

const source = ts.transpileModule(fs.readFileSync(new URL('../src/components/chat-room.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const direct = { id: 'room', kind: 'direct', status: 'pending', requesterId: 'sender', isGroupHost: false,
  groupPostId: null, title: '대화', otherUser: { id: 'sender', nickname: '요청한 이웃', verificationLevel: 1 }, latestAt: '', latestBody: null };

function loadRoom(userId = 'recipient') {
  const exports = {};
  const effects = [];
  const subscriptions = [];
  let messageReads = 0;
  const channel = { on(_event, filter) { subscriptions.push(filter.table); return this; }, subscribe() { return this; } };
  const react = { useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: value => ({ current: value }), useCallback: fn => fn, useEffect: fn => effects.push(fn), useLayoutEffect: fn => fn() };
  const native = new Proxy({ StyleSheet: { create: value => value }, Platform: { OS: 'ios' }, AppState: { addEventListener: () => ({ remove() {} }) } }, { get: (target, key) => target[key] ?? key });
  vm.runInNewContext(source, { exports, require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react-native') return native;
    if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 0 }) };
    if (name === '@/i18n/ko') return { t };
    if (name === '@/lib/auth') return { useAuth: () => ({ isAuthed: true, me: { id: userId, nickname: '나' } }) };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play() {} }) };
    if (name === '@/lib/supabase') return { supabase: { channel: () => channel, removeChannel() {} } };
    if (name === '@/lib/community-data') return { loadConversationMessages: async () => { messageReads++; return []; } };
    if (name === '@/constants/theme') return { Spacing: { one: 4, two: 8, three: 16, five: 32 } };
    return {};
  } });
  return { exports, effects, subscriptions, reads: () => messageReads };
}

test('only accepted active conversations compose; pending requests never read messages or subscribe to them', async () => {
  for (const status of ['pending', 'active', 'ended', 'rejected', 'cancelled']) {
    const room = loadRoom();
    const access = room.exports.conversationCapabilities(status);
    assert.equal(access.write, status === 'active');
    assert.equal(access.read, status === 'active' || status === 'ended');
    const tree = room.exports.ChatRoom({ conversation: { ...direct, status }, currentUserId: 'recipient', onClose() {}, onChanged: async () => {} });
    const containsInput = value => !!value && typeof value === 'object' && (value.type === 'TextInput'
      || Object.values(value).some(child => Array.isArray(child) ? child.some(containsInput) : containsInput(child)));
    assert.equal(containsInput(tree), status === 'active');
    for (const effect of room.effects) effect();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(room.reads(), access.read ? 1 : 0);
    assert.equal(room.subscriptions.includes('messages'), access.read);
  }
});

test('exit copy assigns risk to original requester and differentiates group owner and legacy rooms', () => {
  const { conversationExitNotice } = loadRoom().exports;
  assert.equal(conversationExitNotice(direct, 'sender'), t.chat.endRequester);
  assert.equal(conversationExitNotice(direct, 'recipient'), t.chat.endRecipient);
  assert.equal(conversationExitNotice({ ...direct, requesterId: null }, 'recipient'), t.chat.endLegacy);
  assert.equal(conversationExitNotice({ ...direct, kind: 'group' }, 'recipient'), t.meetup.leaveBody);
  assert.equal(conversationExitNotice({ ...direct, kind: 'group', isGroupHost: true }, 'recipient'), t.meetup.endBody);
});

test('group messages and reports identify actual sender; unknown nickname never becomes the group host', () => {
  const { conversationSender } = loadRoom().exports;
  const group = { ...direct, kind: 'group', otherUser: { id: 'host', nickname: '방장', verificationLevel: 3 } };
  const actual = conversationSender({ sender_id: 'member', sender_nickname: '실제 작성자' }, group);
  assert.equal(actual.id, 'member'); assert.equal(actual.nickname, '실제 작성자');
  assert.equal(conversationSender({ sender_id: 'member', sender_nickname: null }, group).nickname, t.chat.member);
  assert.equal(conversationSender({ sender_id: 'sender', sender_nickname: null }, direct).nickname, direct.otherUser.nickname);
});

test('missing slot data is unknown, not zero capacity; pending cancellation copy does not claim a consumed slot', () => {
  assert.equal(t.chat.slotSummary(1, 1, 1, 3), '사용 중 1 · 대기 1 · 남은 자리 1 / 3');
  assert.equal(t.chat.slotSummary(1, undefined, undefined, 3), '자리 정보를 확인하고 있어요');
  assert.match(t.profileSheet.pendingCancelBody, /자리를 사용하지 않아/);
  assert.match(t.actionErrors.REQUEST_COOLDOWN.body, /대화 자리가 잠기는 것은 아니에요/);
});
