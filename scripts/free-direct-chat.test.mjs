import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { t } from '../src/i18n/ko.ts';

const source = ts.transpileModule(fs.readFileSync(new URL('../src/components/user-sheet.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function profile({ authenticated = true, failure } = {}) {
  const exports = {}, routes = [], starts = [], feedback = [], alerts = [], login = [];
  const elements = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  vm.runInNewContext(source, { exports, require(name) {
    if (name === 'react') return { useEffect() {}, useRef: value => ({ current: value }), useState: value => [value, () => {}] };
    if (name === 'react/jsx-runtime') return elements;
    if (name === 'react-native') return { Modal: 'Modal', View: 'View', StyleSheet: { create: value => value }, Alert: { alert: (...args) => alerts.push(args) } };
    if (name === '@/components/analytics-controls') return { Pressable: 'Pressable' };
    if (name === 'expo-router') return { useRouter: () => ({ push: route => routes.push(route) }) };
    if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 0 }) };
    if (name === '@/lib/auth') return { useAuth: () => ({ isAuthed: authenticated, promptLogin: reason => login.push(reason) }) };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play: value => feedback.push(value) }) };
    if (name === '@/lib/supabase') return { supabase: {} };
    if (name === '@/lib/community-data') return {
      startDirectConversation: async (_client, userId, postId) => { starts.push({ userId, postId }); if (failure) throw failure; return 'active-room'; },
      getCommunityActionError: error => error.code,
    };
    if (name === '@/i18n/ko') return { t };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
    if (name === '@/constants/theme') return { Depth: {}, Spacing: { three: 16 } };
    if (name === '@/components/raised-action-button') return { RaisedActionButton: 'RaisedActionButton' };
    if (name === '@/components/themed-text') return { ThemedText: 'Text' };
    return {};
  } });
  const tree = exports.UserSheet({ user: { id: 'neighbor', nickname: '이웃', listingId: 'listing' }, onClose() {} });
  const nodes = value => !value || typeof value !== 'object' ? [] : [value, ...[value.props?.children].flat(Infinity).flatMap(nodes)];
  return { button: nodes(tree).find(node => node.type === 'RaisedActionButton'), routes, starts, feedback, alerts, login };
}

test('profile starts direct chat and opens its composer without routing through requests', async () => {
  const p = profile();
  assert.equal(p.button.props.label, '대화하기');
  await Promise.all([p.button.props.onPress(), p.button.props.onPress()]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(p.starts, [{ userId: 'neighbor', postId: 'listing' }]);
  assert.equal(p.routes[0].pathname, '/chat');
  assert.equal(p.routes[0].params.conversationId, 'active-room');
  assert.equal(p.routes[0].params.view, 'direct');
  assert.ok(p.feedback.includes('selection'));
  assert.ok(p.feedback.includes('message'));
});

test('direct entry preserves login and server rejection instead of opening an unauthorized room', async () => {
  const anonymous = profile({ authenticated: false });
  anonymous.button.props.onPress();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(anonymous.login.length, 1);
  assert.equal(anonymous.starts.length, 0);
  assert.equal(anonymous.routes.length, 0);
  const blocked = profile({ failure: { code: 'BLOCKED' } });
  blocked.button.props.onPress();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(blocked.routes.length, 0);
  assert.equal(blocked.alerts.length, 1);
  assert.ok(blocked.feedback.includes('warning'));
});
