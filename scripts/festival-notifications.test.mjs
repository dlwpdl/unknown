import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { t } from '../src/i18n/ko.ts';
import { loadNotifications } from '../src/lib/community-data.ts';
import * as inbox from '../src/lib/notification-inbox.ts';
import * as preferences from '../src/lib/notification-preferences.ts';
import * as product from '../src/lib/product-analytics.ts';

test('inbox loads optional event titles while remaining compatible with databases without the new column', async () => {
  for (const title of [undefined, 'Jazz in the Park']) {
    const row = { id: 'notice', body: '두 그룹의 공연과 잼 세션이 열려요. 같이 갈 사람!?', ...(title ? { title } : {}) };
    const client = { from(name) { assert.equal(name, 'user_notifications'); return {
      select(columns) { assert.equal(columns, '*'); return this; }, eq() { return this; }, neq(column, value) { assert.deepEqual([column, value], ['kind', 'message']); return this; }, order() { return this; },
      limit: async () => ({ data: [row], error: null }),
    }; } };
    assert.deepEqual(await loadNotifications(client, 'member'), [row]);
  }
});

test('the actual inbox row shows event name and description, reads both and retains route feedback', () => {
  const items = [{ id: 'event', kind: 'trending_post', category: 'trending', title: 'Jazz in the Park',
    body: '두 그룹의 공연과 공개 잼 세션이 열려요. 같이 갈 사람!?', route: '/events/real-fest?cityId=vancouver', read_at: null, created_at: '2026-10-13T18:00:00Z' },
  { id: 'ordinary', kind: 'post_like', category: 'post_likes', body: '내 글에 공감했어요.', route: '/notifications', read_at: null, created_at: '2026-10-13T18:00:00Z' }];
  let state = 0, memo = 0, cache, tab = 'city'; const routes = [], feedback = [], exports = {};
  const jsx = (type, props) => ({ type, props });
  const imports = {
    react: { useLayoutEffect: fn => fn(), useEffect() {}, useMemo: fn => { const value = fn(); if (memo++ === 0) cache = value; return value; },
      useState: value => [state++ === 0 ? { token: cache, rows: items, hasMore: false } : value === 'mine' ? tab : typeof value === 'boolean' ? false : value, () => {}], useRef: current => ({ current }), useCallback: fn => fn },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'expo-router': { useIsFocused: () => true, useRouter: () => ({ navigate: route => routes.push(route) }) },
    'react-native': new Proxy({ StyleSheet: { create: value => value }, Platform: { OS: 'ios' } }, { get: (value, key) => value[key] ?? key }),
    'react-native-reanimated': { useReducedMotion: () => true },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true, isAdmin: false, isAuthLoading: false, me: { id: 'member' } }) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: event => feedback.push(event) }) },
    '@/lib/notification-preferences': preferences, '@/lib/notification-inbox': inbox,
    '@/lib/product-analytics': product, '@/lib/mock': { CITIES: [] },
    '@/lib/supabase': { supabase: { rpc: async () => ({ data: false, error: null }) } },
    '@/constants/theme': { Depth: {}, Spacing: {}, MaxContentWidth: 920, TabBarHeight: 80 },
    '@/hooks/use-theme': { useTheme: () => ({}) }, '@/i18n/ko': { t },
    '@/lib/feed-data': { relativeTime: () => '방금' },
  };
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/app/(tabs)/notifications.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require: withLanguageImports(name => imports[name] ?? new Proxy({}, { get: (_value, key) => key })) });
  const walk = value => !value || typeof value !== 'object' ? [] : [value, ...Object.values(value).flatMap(walk)];
  const render = next => { tab = next; state = 0; memo = 0; const list = walk(exports.default()).find(node => node.type === 'FlatList');
    return id => walk(list.props.renderItem({ item: list.props.data.find(entry => entry.item?.lead.id === id) })); };
  const row = render('city')('event');
  assert.ok(row.some(node => node.type === 'ThemedText' && node.props.children === items[0].title));
  assert.ok(row.some(node => node.type === 'ThemedText' && node.props.children === items[0].body));
  const button = row.find(node => node.props?.analyticsId === 'app_tabs_notifications.pressable.2');
  assert.ok(button.props.accessibilityLabel.includes(items[0].title));
  assert.ok(button.props.accessibilityLabel.includes(items[0].body));
  button.props.onPress(); assert.deepEqual(routes, [items[0].route]); assert.deepEqual(feedback, ['selection']);
  const ordinary = render('mine')('ordinary');
  assert.ok(ordinary.some(node => node.type === 'ThemedText' && node.props.children === items[1].body));
});
