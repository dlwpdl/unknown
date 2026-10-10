import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function detail({ authed = true, focused = true, loaded = true, offline = false } = {}) {
  const effects = [], clicks = [], event = { id: 'real-fest', name: 'Real Festival' };
  let state = 0;
  const component = ts.transpileModule(fs.readFileSync(new URL('../src/app/events/[id].tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const imports = {
    react: { useEffect: callback => effects.push(callback), useState: value => [state++ === 0 && loaded ? { key: 'vancouver:real-fest:0', event, error: '' } : value, () => {}] },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'expo-router': { Link: { AppleZoomTarget: 'Target' }, useIsFocused: () => focused, useLocalSearchParams: () => ({ id: event.id, cityId: 'vancouver' }), useRouter: () => ({}) },
    'react-native': { StyleSheet: { create: value => value }, Platform: { OS: 'web' }, View: 'View' },
    'react-native-reanimated': { useReducedMotion: () => true },
    'expo-image': { Image: 'Image' }, 'expo-symbols': { SymbolView: 'Symbol' },
    'react-native-safe-area-context': { SafeAreaView: 'SafeArea' },
    '@/components/analytics-controls': { Pressable: 'Pressable', ScrollView: 'ScrollView' },
    '@/constants/theme': { Depth: {} }, '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
    '@/lib/event-videos': { eventVideo: () => null }, '@/lib/community-city': { useCommunityCity: () => ({}) },
    '@/lib/auth': { useAuth: () => ({ isAuthed: authed }) }, '@/lib/mock': { CITIES: [] },
    '@/lib/ticketmaster': { loadTicketmasterEvent: async () => ({ event }), eventNotice: () => '', eventPriceLabel: () => '', eventTime: () => '', meetupAllowed: () => true,
      recordTicketmasterEventClick: async (...args) => { clicks.push(args); if (offline) throw new Error('offline'); } },
  };
  const exports = {};
  vm.runInNewContext(component, { exports, require: name => imports[name] ?? {} });
  const tree = exports.default();
  return { tree, clicks, effects };
}

test('a real authenticated foreground event detail records its exact event once', async () => {
  const ui = detail();
  for (const effect of ui.effects) effect();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.clicks.length, 1);
  assert.deepEqual(Array.from(ui.clicks[0]), ['vancouver', 'real-fest']);
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
