import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as discovery from '../src/lib/discovery.ts';
import { contentAdPosition } from '../src/lib/content-ad-placement.ts';
import { appendUniquePosts } from '../src/lib/feed-data.ts';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const city = { id: 'vancouver', name: '밴쿠버', englishName: 'Vancouver', state: 'open' };
const ads = tree => nodes(tree).filter(node => node.type === 'FeedAd');

// Same hook/handler harness as the existing map/chat tests; external/native services are inert.
function mount(file, component, imports, globals = {}) {
  const hooks = [], pending = [];
  let at = 0, dirty = true, tree;
  const memo = (fn, deps) => {
    const slot = at++, old = hooks[slot];
    if (!old || !deps?.every((value, index) => Object.is(value, old.deps?.[index]))) hooks[slot] = { value: fn(), deps };
    return hooks[slot].value;
  };
  const effect = (fn, deps) => {
    const slot = at++, old = hooks[slot];
    if (old && deps?.every((value, index) => Object.is(value, old.deps?.[index]))) return;
    hooks[slot] = { deps };
    pending.push(() => { old?.cleanup?.(); hooks[slot].cleanup = fn(); });
  };
  const react = {
    useState(initial) { const slot = at++; if (!(slot in hooks)) hooks[slot] = typeof initial === 'function' ? initial() : initial; return [hooks[slot], value => { const next = typeof value === 'function' ? value(hooks[slot]) : value; if (!Object.is(next, hooks[slot])) { hooks[slot] = next; dirty = true; } }]; },
    useRef(initial) { const slot = at++; return hooks[slot] ??= { current: initial }; },
    useMemo: memo, useCallback: (fn, deps) => memo(() => fn, deps), useEffect: effect, useLayoutEffect: effect,
    useSyncExternalStore: (_subscribe, get) => get(),
  };
  const Value = class { interpolate() { return this; } setValue() {} stopAnimation() {} };
  const native = { View: 'View', Modal: 'Modal', AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'ios' }, StyleSheet: { create: value => value, flatten: value => value },
    Animated: { View: 'AnimatedView', Value, timing: () => ({ start() {}, stop() {} }) }, Easing: { out: value => value, in: value => value, cubic() {}, quad() {} }, useWindowDimensions: () => ({ height: 844 }) };
  const common = {
    react, 'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }), Fragment: 'Fragment' },
    'react-native': native, 'react-native-reanimated': { useReducedMotion: () => true },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-router': { Link: 'Link', useFocusEffect: fn => effect(fn, [fn]), useLocalSearchParams: () => ({}), useRouter: () => ({}), usePathname: () => '/' },
    'expo-asset': { Asset: { fromModule: () => ({ uri: 'local.png' }) } },
    '@/components/analytics-controls': { FlatList: 'FlatList', ScrollView: 'ScrollView', Pressable: 'Pressable' },
    '@/components/feed-ad': { FeedAd: 'FeedAd' }, '@/lib/content-ad-placement': { contentAdPosition },
    '@/lib/ads': { adsSupported: true },
    '@/hooks/use-language': { useLanguage: () => ({ tr: value => value, locale: 'ko-KR' }) },
    '@/hooks/use-theme': { useTheme: () => ({}) }, '@/constants/theme': { Colors: {}, WebNightColors: {} },
    '@/lib/community-city': { useCommunityCity: () => ({ city }) }, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
    '@/lib/auth': { useAuth: () => ({ isAuthed: false, me: { id: 'guest' } }) }, '@/hooks/use-content-visibility': { useContentVisibility: () => () => false },
    '@/lib/hashtags': { hasAdLabel: () => false },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8') + `\nexports.TestComponent = ${component};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, Date, Map, Set, URLSearchParams, AbortController, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, require(name) {
    if (name in imports) return imports[name];
    if (name in common) return common[name];
    if (name.endsWith('.css') || /assets\//.test(name)) return {};
    return new Proxy({}, { get: (_target, key) => key });
  }, ...globals });
  const render = () => { at = 0; dirty = false; tree = exports.TestComponent(); pending.splice(0).forEach(fn => fn()); return tree; };
  return { render, get tree() { return tree; }, async settle() { for (let count = 0; count < 12; count++) { if (dirty) render(); await new Promise(setImmediate); if (!dirty) return; } assert.fail('render loop'); } };
}

test('event index adds standalone ads after four organic cards, preserving every event and keeping header/actions clear', async () => {
  for (const [count, expected] of [[4, 0], [5, 1], [8, 1], [9, 2]]) {
    const events = Array.from({ length: count }, (_, index) => ({ id: `event-${index}`, name: `Event ${index}` }));
    const view = mount('../src/app/events/index.tsx', 'EventListScreen', {
      '@/lib/ticketmaster': { EVENT_CITIES: { vancouver: {} }, EVENT_CATEGORY_LABELS: {}, eventMatchesPriceFilter: () => true, eventTime: () => '', eventNotice: () => '', eventPriceLabel: () => '', loadTicketmasterEvents: async () => ({ events }), loadTicketmasterEventDays: async () => ({ days: [] }) },
    });
    await view.settle();
    const list = nodes(view.tree).find(node => node.props?.analyticsId === 'ticketmaster.events').props;
    assert.deepEqual(list.data, events);
    const rows = list.data.map((item, index) => list.renderItem({ item, index }));
    assert.equal(rows.flatMap(ads).length, expected);
    assert.equal(ads(list.ListHeaderComponent).length + ads(list.ListFooterComponent).length, 0);
    for (const row of rows) for (const node of nodes(row).filter(node => node.type === 'Link' || node.type === 'Pressable')) assert.equal(ads(node).length, 0);
  }
});

test('map list has one slot after the fourth real result; canvas, selected overlay and TOP25 stay clear', async () => {
  for (const count of [4, 5, 9]) {
    const places = Array.from({ length: count }, (_, index) => ({ id: `osm:node:${index + 1}`, cityId: city.id, name: `Place ${index}`, category: 'cafe', address: 'Vancouver', latitude: 49.28, longitude: -123.12, sourceUrl: 'https://www.openstreetmap.org/' }));
    const view = mount('../src/app/map.tsx', 'CityMap', {
      '@/lib/discovery': discovery, '@/lib/city-places': { getCityRecommendations: () => places }, '@/hooks/use-city-places': { useCityPlacesRevision() {} },
      '@/lib/ticketmaster': { EVENT_CITIES: { vancouver: {} }, loadTicketmasterEvents: async () => ({ events: [] }) },
    });
    await view.settle();
    assert.equal(ads(view.tree).length, 0);
    nodes(view.tree).find(node => node.props?.analyticsId === 'discovery.mode').props.onPress(); await view.settle();
    const list = nodes(view.tree).find(node => node.props?.analyticsId === 'discovery.list').props;
    assert.equal(list.data.length, count);
    const rows = list.data.map((item, index) => list.renderItem({ item, index }));
    assert.equal(rows.flatMap(ads).length, count >= 5 ? 1 : 0);
    if (count >= 5) assert.equal(ads(rows[3]).length, 1);
    nodes(view.tree).find(node => node.props?.analyticsId === 'discovery.filter' && node.props.accessibilityLabel === 'TOP 25').props.onPress();
    await view.settle();
    const ranking = nodes(view.tree).find(node => node.props?.analyticsId === 'discovery.list').props;
    assert.equal(ranking.data.flatMap((item, index) => ads(ranking.renderItem({ item, index }))).length, 0);
  }
});
