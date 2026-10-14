import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { eventPriceLabel, eventTime } from '../supabase/functions/_shared/ticketmaster.ts';
import * as product from '../src/lib/product-analytics.ts';

function detail({ authed = true, focused = true, loaded = true, offline = false, description = 'An evening of live music.', price = { min: 34.36, max: 95.94, currency: 'CAD' } } = {}) {
  const effects = [], clicks = [], event = { id: 'real-fest', name: 'Real Festival', description, price, venue: 'Park', city: 'Vancouver', startsAt: '2026-10-19T01:00:00Z', timezone: 'America/Vancouver', timeUnconfirmed: false };
  let state = 0;
  const component = ts.transpileModule(fs.readFileSync(new URL('../src/app/events/[id].tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const imports = {
    react: { useRef: current => ({ current }), useLayoutEffect: fn => fn(), useEffect: callback => effects.push(callback), useState: value => [state++ === 0 && loaded ? { key: 'vancouver:real-fest:0', event, error: '' } : value, () => {}] },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'expo-router': { Link: { AppleZoomTarget: 'Target' }, useIsFocused: () => focused, useLocalSearchParams: () => ({ id: event.id, cityId: 'vancouver' }), useRouter: () => ({}) },
    'react-native': { StyleSheet: { create: value => value }, Platform: { OS: 'web' }, View: 'View' },
    'react-native-reanimated': { useReducedMotion: () => true },
    'expo-image': { Image: 'Image' }, 'expo-symbols': { SymbolView: 'Symbol' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeArea' },
    '@/components/analytics-controls': { Pressable: 'Pressable', ScrollView: 'ScrollView' },
    '@/components/themed-text': { ThemedText: 'Text' },
    '@/components/raised-action-button': { RaisedActionButton: 'Action' },
    '@/constants/theme': { Depth: {} }, '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
    '@/lib/event-videos': { eventVideo: () => null }, '@/lib/community-city': { useCommunityCity: () => ({}) },
    '@/lib/auth': { useAuth: () => ({ isAuthed: authed, me: { id: 'member' } }) }, '@/lib/mock': { CITIES: [] },
    '@/lib/product-analytics': product,
    '@/lib/supabase': { supabase: { rpc: async () => ({ data: false, error: null }) } },
    '@/lib/ticketmaster': { loadTicketmasterEvent: async () => ({ event }), eventNotice: () => '', eventPriceLabel, eventTime, meetupAllowed: () => true,
      recordTicketmasterEventClick: async (...args) => { clicks.push(args); if (offline) throw new Error('offline'); } },
  };
  const exports = {};
  vm.runInNewContext(component, { exports, require: name => imports[name] ?? {} });
  const tree = exports.default();
  return { tree, clicks, effects, event };
}

test('a real authenticated foreground event detail records its exact event once', async () => {
  const ui = detail();
  for (const effect of ui.effects) effect();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.clicks.length, 1);
  assert.deepEqual(Array.from(ui.clicks[0]), ['vancouver', 'real-fest']);
});

test('event details show local date, city, short description and approximate price before meetup and ticket actions', () => {
  const ui = detail();
  const nodes = [];
  const visit = tree => {
    if (!tree || typeof tree !== 'object') return;
    if (Array.isArray(tree)) { tree.forEach(visit); return; }
    nodes.push(tree);
    visit(tree.props?.children);
  };
  visit(ui.tree);
  const text = nodes.filter(node => node.type === 'Text').map(node => node.props.children).filter(value => typeof value === 'string');
  assert.deepEqual(text, ['행사 정보', 'Real Festival', eventTime(ui.event), 'Park', 'Vancouver', '약 CA$34부터', '행사 소개', 'An evening of live music.', '함께 갈 모임 찾기', '티켓 확인하기']);
  assert.equal(nodes.find(node => node.props?.children === 'An evening of live music.').props.numberOfLines, 3);
  assert.equal(nodes.find(node => node.type === 'Action').props.label, '함께 갈 모임 만들기');
  const buttons = nodes.filter(node => node.type === 'Pressable');
  assert.deepEqual(buttons.map(node => node.props.analyticsId), ['ticketmaster.detail.back', 'ticketmaster.meetup.find', 'ticketmaster.purchase']);
  assert.equal(buttons.at(-1).props.accessibilityRole, 'link');
});

test('missing introduction or price is shown honestly without guessing free admission', () => {
  const ui = detail({ description: null, price: null });
  const visible = JSON.stringify(ui.tree);
  assert.ok(visible.includes('가격 정보 없음'));
  assert.ok(visible.includes('자세한 소개는 티켓에서 확인해 주세요.'));
  assert.ok(!visible.includes('무료'));
});

test('guest, background and unsuccessful detail loads do not count as member clicks', async () => {
  for (const options of [{ authed: false }, { focused: false }, { loaded: false }]) {
    const ui = detail(options);
    for (const effect of ui.effects) effect();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ui.clicks.length, 0);
  }
});

test('offline popularity recording leaves the event screen usable', async () => {
  const ui = detail({ offline: true });
  for (const effect of ui.effects) effect();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(ui.tree);
  assert.equal(ui.clicks.length, 1);
});
