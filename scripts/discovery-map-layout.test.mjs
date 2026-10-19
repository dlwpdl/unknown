import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as discovery from '../src/lib/discovery.ts';
import * as postMaps from '../src/lib/post-maps.ts';
import { tr } from '../src/i18n/index.ts';
import { contentAdPosition } from '../src/lib/content-ad-placement.ts';

const source = readFileSync(new URL('../src/app/map.tsx', import.meta.url), 'utf8');
const children = node => [node?.props?.children].flat(Infinity);
const nodes = node => !node || typeof node !== 'object' || node.type === 'Modal' && !node.props.visible ? [] : [node, ...children(node).flatMap(nodes)];
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node === 'object' ? children(node).map(text).join(' ') : String(node);
const control = (tree, label) => { const result = nodes(tree).find(node => node.props?.accessibilityLabel === label || node.type === 'Pressable' && text(node).trim() === label); assert.ok(result, `Missing control: ${label}`); return result; };

// Render the actual route and run its handlers; only native/external services are replaced.
function mount({ light = false, reduced = false } = {}) {
  const state = [], feedback = [], alerts = [];
  let index = 0;
  const theme = { background: light ? '#fff' : '#0B0B12', card: light ? '#fff' : '#171722', backgroundElement: '#222231', backgroundSelected: '#343443', text: '#F6F3F0', textSecondary: '#B7B4C3', accent: '#CBB9FF', accentInk: '#171123', line: '#343443' };
  const hooks = { useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial; return [state[slot], next => { state[slot] = typeof next === 'function' ? next(state[slot]) : next; }]; }, useRef: current => ({ current }), useMemo: fn => fn(), useCallback: fn => fn, useEffect() {} };
  const jsx = (type, props, key) => ({ type, props, key });
  const imports = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { ActivityIndicator: 'ActivityIndicator', Alert: { alert: (...args) => alerts.push(args) }, AppState: { currentState: 'active' }, Linking: {}, Modal: 'Modal', StyleSheet: { create: value => value, hairlineWidth: 1 }, TextInput: 'TextInput', View: 'View', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'ios' } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, 'expo-image': { Image: 'Image' }, 'expo-symbols': { SymbolView: 'SymbolView' }, 'expo-location': {},
    'expo-web-browser': {}, '@/lib/merchant-source': {}, '@/lib/public-seo': {},
    '../../supabase/functions/_shared/ticketmaster': {},
    'react-native-reanimated': { useReducedMotion: () => reduced },
    'expo-router': { useFocusEffect() {}, useIsFocused: () => true, useLocalSearchParams: () => ({}), useRouter: () => ({}) },
    '@/lib/mock': { CITIES: [] },
    '@/constants/theme': { Colors: { dark: { ...theme, card: '#171722' }, light: theme } }, '@/hooks/use-language': { useLanguage: () => ({ tr }) },
    '@/components/analytics-controls': { FlatList: 'FlatList', ScrollView: 'ScrollView', Pressable: 'Pressable' },
    '@/components/discovery-map': { DiscoveryMap: 'DiscoveryMap' }, '@/components/gling-loader': { GlingLoader: 'GlingLoader' },
    '@/components/city-place-photo': { CityPlacePhoto: 'CityPlacePhoto' },
    '@/components/feed-ad': { FeedAd: 'FeedAd' }, '@/lib/ads': { adsSupported: false }, '@/lib/content-ad-placement': { contentAdPosition },
    '@/components/state-card': { StateCard: 'StateCard' }, '@/components/content-translation': {}, '@/hooks/use-content-translation': {},
    '@/lib/content-translation': { CONTENT_TRANSLATION_VIEWABILITY: {} }, '@/lib/translation-source': {},
    '@/components/themed-text': { ThemedText: 'Text' }, '@/hooks/use-theme': { useTheme: () => theme },
    '@/hooks/use-content-visibility': { useContentVisibility: () => () => false },
    '@/lib/auth': { useAuth: () => ({ isAuthed: false, me: { id: 'guest' }, promptLogin() {} }) },
    '@/lib/community-city': { useCommunityCity: () => ({ city: { id: 'vancouver', name: '밴쿠버', englishName: 'Vancouver' } }) },
    '@/lib/discovery': discovery, '@/lib/post-maps': postMaps, '@/lib/city-places': { getCityRecommendations: () => [] }, '@/lib/city-top25': { cityTop25Recommendations: () => [] }, '@/hooks/use-city-places': { useCityPlacesRevision: () => 0 }, '@/lib/discovery-data': {}, '@/lib/feed-data': {},
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) }, '@/lib/location': {}, '@/lib/supabase': { supabase: {} },
    '@/lib/ticketmaster': { EVENT_CITIES: { vancouver: {} } }, '@/components/post-ad-label': {}, '@/lib/hashtags': { hasAdLabel: () => false },
  };
  const exports = {};
  const code = ts.transpileModule(source + '\nexports.CityMap = CityMap;', { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, Date, setTimeout, clearTimeout, require: name => { if (name.startsWith('@/assets/')) return name; assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return { render() { index = 0; return exports.CityMap({ city: imports['@/lib/community-city'].useCommunityCity().city }); }, feedback, alerts };
}

test('the map keeps one category row and opens dates and all categories in its filter sheet', () => {
  const view = mount(); let tree = view.render();
  assert.ok(nodes(tree).some(node => node.type === 'DiscoveryMap'));
  assert.ok(!nodes(tree).some(node => text(node).trim() === '전체 날짜'));
  control(tree, '분류와 날짜 필터 열기').props.onPress(); tree = view.render();
  assert.ok(nodes(tree).some(node => node.type === 'Modal' && node.props.visible));
  control(tree, '나이트라이프').props.onPress(); tree = view.render();
  control(tree, '카페').props.onPress(); tree = view.render();
  assert.equal(control(tree, '나이트라이프').props.accessibilityState.checked, true);
  assert.equal(control(tree, '카페').props.accessibilityState.checked, true);
  control(tree, '오늘').props.onPress(); tree = view.render();
  control(tree, '지도 보기').props.onPress(); tree = view.render();
  assert.ok(!nodes(tree).some(node => node.type === 'Modal'));
  assert.equal(control(tree, '분류와 날짜 필터 열기').props.accessibilityState.expanded, false);
  assert.ok(view.feedback.length >= 5);
});

test('the quick category row preserves the owner-selected restaurant, cafe, festival and nightlife order', () => {
  const tree = mount().render();
  const row = nodes(tree).find(node => node.type === 'ScrollView' && node.props.horizontal);
  assert.deepEqual(children(row).map(node => node.props.accessibilityLabel), ['전체', 'TOP 50', '레스토랑', '카페', '페스티벌', '나이트라이프', '가볼 만한 곳', '부동산', '중고거래']);
});
test('visible event dates follow the initial festival choice and preserve a user-selected day across categories', () => {
  const view = mount(); let tree = view.render();
  assert.equal(control(tree, '행사 · 오늘').props.accessibilityState.selected, true);
  control(tree, '페스티벌').props.onPress(); tree = view.render();
  assert.equal(control(tree, '다가오는 7일').props.accessibilityState.selected, true);
  control(tree, '행사 · 오늘').props.onPress(); tree = view.render();
  control(tree, '카페').props.onPress(); tree = view.render();
  assert.equal(control(tree, '행사 · 오늘').props.accessibilityState.selected, true);
  assert.equal(view.feedback.length, 3);
});
test('housing-only views omit automatic event controls while an explicitly chosen date remains visible', () => {
  const view = mount(); let tree = view.render();
  control(tree, '부동산').props.onPress(); tree = view.render();
  assert.equal(nodes(tree).some(node => node.type === 'Pressable' && text(node).trim() === '행사 · 오늘'), false);
  control(tree, '전체').props.onPress(); tree = view.render();
  control(tree, '다가오는 7일').props.onPress(); tree = view.render();
  control(tree, '부동산').props.onPress(); tree = view.render();
  assert.equal(control(tree, '다가오는 7일').props.accessibilityState.selected, true);
});

test('custom dates validate before closing and reset clears both category and date choices', () => {
  const view = mount(); let tree = view.render();
  control(tree, '분류와 날짜 필터 열기').props.onPress(); tree = view.render();
  control(tree, '날짜 지정').props.onPress(); tree = view.render();
  control(tree, '행사 날짜 연도-월-일').props.onChangeText('2026-02-30'); tree = view.render();
  control(tree, '지도 보기').props.onPress(); tree = view.render();
  assert.ok(nodes(tree).some(node => node.props?.accessibilityRole === 'alert'));
  assert.ok(nodes(tree).some(node => node.type === 'Modal'));
  const tomorrow = discovery.discoveryDays('today', 'vancouver')[0];
  control(tree, '행사 날짜 연도-월-일').props.onChangeText(tomorrow); tree = view.render();
  control(tree, '지도 보기').props.onPress(); tree = view.render();
  assert.ok(!nodes(tree).some(node => node.type === 'Modal'));
  control(tree, '분류와 날짜 필터 열기').props.onPress(); tree = view.render();
  control(tree, '초기화').props.onPress(); tree = view.render();
  assert.equal(control(tree, '오늘').props.accessibilityState.selected, true);
  assert.ok(!nodes(tree).some(node => node.props?.accessibilityRole === 'alert'));
  assert.ok(!nodes(tree).some(node => node.type === 'TextInput' && node.props.accessibilityLabel === '행사 날짜 연도-월-일'));
});

test('list and map navigation remain available after compacting the header', () => {
  const view = mount(); let tree = view.render();
  control(tree, '리스트 보기').props.onPress(); tree = view.render();
  assert.ok(nodes(tree).some(node => node.type === 'FlatList'));
  control(tree, '지도 보기').props.onPress(); tree = view.render();
  assert.ok(nodes(tree).some(node => node.type === 'DiscoveryMap'));
});

test('the map requests the shared capsule loader in both themes', () => {
  for (const light of [false, true]) {
    const tree = mount({ light }).render();
    const capsule = nodes(tree).find(node => node.type === 'GlingLoader' && node.props?.accessibilityLabel === '지도 결과 불러오는 중');
    assert.ok(capsule);
    assert.equal(capsule.props.variant, 'capsule');
  }
});
