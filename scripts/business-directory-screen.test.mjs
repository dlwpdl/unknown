import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const item = { id: '10000000-0000-4000-8000-000000000001', name: '테스트 비즈니스', city_id: 'vancouver', industry: '카페', services: '커피', address: 'Main St', avatarUri: null, bannerUri: null, saved: false, has_webshop: true };
const page = (items = [item], hasMore = false) => ({ items, industries: ['카페'], hasMore, nextOffset: items.length });
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
function screen() {
  const slots = [], calls = [], saves = [], routes = [], feedback = [], timers = [];
  let cursor = 0, focuses = [], previousFocuses = [], cleanups = [], viewer = 'viewer', city = { id: 'vancouver', name: '밴쿠버', state: 'open' }, blocked = new Set();
  let visibility = (_kind, id) => blocked.has(id);
  const slot = initial => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return i; };
  const jsx = (type, props) => ({ type, props });
  const react = {
    useState: initial => { const i = slot(initial); return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef: initial => slots[slot(() => ({ current: initial }))],
    useCallback: (fn, deps) => { const i = slot(null), old = slots[i]; if (!old || deps.some((d, j) => d !== old.deps[j])) slots[i] = { fn, deps }; return slots[i].fn; },
  };
  const imports = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { StyleSheet: { create: s => s, hairlineWidth: 1 }, View: 'View', TextInput: 'TextInput', useWindowDimensions: () => ({ fontScale: 1 }) },
    'expo-router': { useFocusEffect: fn => { focuses.push(fn); }, useRouter: () => ({ canGoBack: () => true, back: () => routes.push('back'), replace: path => routes.push(path), push: target => routes.push(target) }) },
    'expo-image': { Image: 'Image' }, 'expo-symbols': { SymbolView: 'SymbolView' }, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/components/analytics-controls': { Pressable: 'Pressable', FlatList: 'FlatList', ScrollView: 'ScrollView' },
    '@/components/themed-text': { ThemedText: 'ThemedText' }, '@/components/gling-loader': { GlingLoader: 'GlingLoader' }, '@/components/selection-chip': { SelectionChip: 'SelectionChip' }, '@/components/state-card': { StateCard: 'StateCard' },
    '@/constants/design-system': { ControlMotion: { pressedOpacity: .82 }, ControlStyles: { action: {}, icon: {}, field: {}, pill: {} }, IconSize: {}, Typography: { sheetTitle: {}, body: {} }, controlPresentation: () => ({ container: {} }) },
    '@/constants/theme': { Spacing: { one: 4, two: 8, three: 16, four: 24, five: 32 } }, '@/hooks/use-theme': { useTheme: () => ({}) },
    '@/hooks/use-language': { useLanguage: () => ({ tr: (s, ...args) => args.reduce((v, a, i) => v.replace(`{${i}}`, String(a)), s) }) },
    '@/hooks/use-content-visibility': { useContentVisibility: () => visibility }, '@/lib/auth': { useAuth: () => ({ me: { id: viewer }, isAuthed: !!viewer, isAuthLoading: false, promptLogin: reason => routes.push(reason) }) },
    '@/lib/community-city': { useCommunityCity: () => ({ city }) }, '@/lib/supabase': { supabase: {} },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
    '@/lib/business-directory': { loadBusinessDirectory: (_client, options) => new Promise((resolve, reject) => calls.push({ options, resolve, reject })) },
    '@/lib/merchant-conveniences': { setSavedMerchant: (_client, id, saved) => new Promise((resolve, reject) => saves.push({ id, saved, resolve, reject })) },
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(new URL('../src/components/business-directory.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: name => { assert.ok(name in imports, name); return imports[name]; }, AbortController, Map, Set, setTimeout: fn => { timers.push(fn); return fn; }, clearTimeout: fn => { const i = timers.indexOf(fn); if (i >= 0) timers.splice(i, 1); } });
  const render = () => { cursor = 0; focuses = []; return exports.BusinessDirectory().props; };
  const tick = () => { render(); focuses.forEach((focus, i) => { if (focus !== previousFocuses[i]) { cleanups[i]?.(); cleanups[i] = focus(); previousFocuses[i] = focus; } }); while (timers.length) timers.shift()(); return render(); };
  return { render, tick, calls, saves, routes, feedback, view: props => exports.BusinessDirectoryView(props), row: props => { cursor = 100; return exports.BusinessDirectoryRow(props); },
    blur: () => { cleanups.forEach(fn => fn?.()); previousFocuses = []; cleanups = []; },
    setViewer: id => { viewer = id; }, setCity: value => { city = { ...city, id: value }; }, block: id => { blocked = new Set([id]); visibility = (_kind, key) => blocked.has(key); } };
}
const flush = () => new Promise(setImmediate);
test('directory is an explicit route to existing business profiles and webshop availability stays attached to that identity', async () => {
  const app = screen(); app.tick(); app.calls[0].resolve(page()); await flush();
  const props = app.render(); props.onOpen(item); props.onBack();
  assert.equal(app.routes[0].pathname, '/company/[id]'); assert.equal(app.routes[0].params.id, item.id);
  assert.equal(app.routes[1], 'back');
  const row = app.row({ item, saving: false, onOpen: props.onOpen, onSave: props.onSave });
  assert.ok(nodes(row).some(n => n.props?.children === '웹샵 주문 가능'));
  nodes(row).find(n => n.props?.analyticsId === 'business.directory.save').props.onPress();
  assert.equal(app.saves.length, 1); assert.equal(app.saves[0].id, item.id);
  app.saves[0].resolve(true); await flush(); assert.equal(app.render().page.items[0].saved, true);
});
test('new search, city, viewer and block scope cancel prior reads and never show their results', async () => {
  const app = screen(); app.tick(); const stale = app.calls[0];
  app.render().onQuery('hair'); app.tick(); assert.equal(stale.options.signal.aborted, true);
  const second = app.calls[1]; app.setCity('toronto'); app.tick(); assert.equal(second.options.signal.aborted, true);
  app.setViewer('other-viewer'); app.tick(); assert.equal(app.render().page, null);
  app.calls.at(-1).resolve(page()); await flush(); assert.equal(app.render().page.items.length, 1);
  stale.resolve(page([{ ...item, name: 'stale' }])); await flush(); assert.equal(app.render().page.items[0].name, item.name);
  app.block(item.id); assert.equal(app.render().page, null); app.tick(); app.calls.at(-1).resolve(page()); await flush();
  assert.equal(app.render().page.items.length, 0);
});
test('paging is single-flight, keeps previous results on failure, and retries the server cursor', async () => {
  const app = screen(); app.tick(); app.calls[0].resolve({ ...page([item], true), nextOffset: 20 }); await flush();
  app.render().onMore(); app.render().onMore(); assert.equal(app.calls.length, 2); assert.equal(app.calls[1].options.offset, 20);
  app.calls[1].reject(Error('offline')); await flush(); assert.equal(app.render().appendFailed, true); assert.equal(app.render().page.items.length, 1);
  app.render().onRetry(); assert.equal(app.calls[2].options.offset, 20);
  app.calls[2].resolve({ ...page([{ ...item, id: '10000000-0000-4000-8000-000000000002' }]), nextOffset: 21 }); await flush();
  assert.equal(app.render().page.items.length, 2); assert.equal(app.render().appendFailed, false);
});
test('failed save preserves the last verified saved value and cannot update a new viewer', async () => {
  const app = screen(); app.tick(); app.calls[0].resolve(page()); await flush();
  app.render().onSave(item); app.render().onSave(item); assert.equal(app.saves.length, 1);
  app.saves[0].reject(Error('offline')); await flush(); assert.equal(app.render().saveError, true); assert.equal(app.render().page.items[0].saved, false);
  app.render().onSave(item); app.setViewer('new-viewer'); app.tick(); app.saves[1].resolve(true); await flush();
  assert.equal(app.render().page, null);
});

test('a pending replacement read cannot undo a save verified after that read began', async () => {
  const app = screen(); app.tick(); app.calls[0].resolve(page()); await flush();
  app.render().onQuery('hair'); app.tick();
  app.render().onQuery(''); app.tick();
  const pending = app.calls.at(-1);
  assert.equal(app.render().page.items[0].saved, false);
  app.render().onSave(item); app.saves[0].resolve(true); await flush();
  assert.equal(app.render().page.items[0].saved, true);
  pending.resolve(page()); await flush();
  assert.equal(app.render().page.items[0].saved, true, 'read snapshot predates the completed save');
  app.render().onSave(app.render().page.items[0]);
  assert.equal(app.saves[1].saved, false, 'next action must unsave');
});

test('verified saves survive query changes, while refocus rechecks server state', async () => {
  const app = screen(); app.tick(); app.calls[0].resolve(page()); await flush();
  app.render().onSave(item); app.render().onQuery('coffee'); app.tick();
  app.saves[0].resolve(true); await flush(); app.calls.at(-1).resolve(page()); await flush();
  assert.equal(app.render().page.items[0].saved, true);
  app.blur(); app.tick(); app.calls.at(-1).resolve(page()); await flush();
  assert.equal(app.render().page.items[0].saved, false, 'profile/other-device changes are not masked after refocus');
});

test('a save completed after refocus refreshes the same viewer from the server', async () => {
  const app = screen(); app.tick(); app.calls[0].resolve(page()); await flush();
  app.render().onSave(item); app.blur(); app.tick();
  app.calls.at(-1).resolve(page()); await flush();
  app.saves[0].resolve(true); await flush(); app.tick();
  assert.equal(app.calls.length, 3, 'an earlier-focus mutation needs a post-commit server read');
  assert.equal(app.render().page, null, 'stale saved state is unavailable while verifying');
  app.calls.at(-1).resolve(page([{ ...item, saved: true }])); await flush();
  assert.equal(app.render().page.items[0].saved, true);
  app.render().onSave(app.render().page.items[0]); assert.equal(app.saves[1].saved, false);
});
