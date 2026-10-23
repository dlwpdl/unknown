import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as designSystem from '../src/constants/design-system.ts';
import * as discovery from '../src/lib/discovery.ts';
import { bindBusinessPlaces } from '../src/lib/webshops.ts';
import * as postMaps from '../src/lib/post-maps.ts';
import * as discoverySort from '../src/lib/discovery-sort.ts';
import * as location from '../src/lib/location.ts';
import { tr } from '../src/i18n/index.ts';
import { contentAdPosition } from '../src/lib/content-ad-placement.ts';

const source = readFileSync(new URL('../src/app/map.tsx', import.meta.url), 'utf8');
const children = node => [node?.props?.children].flat(Infinity);
const nodes = node => !node || typeof node !== 'object' || node.type === 'Modal' && !node.props.visible ? [] : [node, ...children(node).flatMap(nodes)];
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node === 'object' ? children(node).map(text).join(' ') : String(node);
const control = (tree, label) => { const result = nodes(tree).find(node => node.props?.accessibilityLabel === label || node.type === 'Pressable' && text(node).trim() === label); assert.ok(result, `Missing control: ${label}`); return result; };

// Render the actual route and run its handlers; only native/external services are replaced.
function mount({ light = false, reduced = false, places = [], business = {}, origin = { latitude: 49.25, longitude: -122.86 }, registryReady = true, onClose, loadWebshops = async () => [] } = {}) {
  const routes = [], state = [], feedback = [], alerts = [], memoValues = [], effects = [], focusEffects = [];
  let index = 0;
  const theme = { background: light ? '#fff' : '#0B0B12', card: light ? '#fff' : '#171722', backgroundElement: '#222231', backgroundSelected: '#343443', text: '#F6F3F0', textSecondary: '#B7B4C3', accent: '#CBB9FF', accentInk: '#171123', line: '#343443' };
  const hooks = { useState(initial) { const slot = index++; if (!(slot in state)) { const value = typeof initial === 'function' ? initial() : initial; state[slot] = value && typeof value === 'object' && 'ready' in value && 'shops' in value ? { ...value, ready: registryReady } : value; } return [state[slot], next => { state[slot] = typeof next === 'function' ? next(state[slot]) : next; }]; }, useRef: current => ({ current }), useMemo: fn => { const value = fn(); memoValues.push(value); return value; }, useCallback: fn => fn, useEffect: (fn, deps) => effects.push({ fn, deps }) };
  const jsx = (type, props, key) => ({ type, props, key });
  const imports = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { ActivityIndicator: 'ActivityIndicator', Alert: { alert: (...args) => alerts.push(args) }, AppState: { currentState: 'active' }, Linking: {}, Modal: 'Modal', StyleSheet: { create: value => value, hairlineWidth: 1 }, TextInput: 'TextInput', View: 'View', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'ios' } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, 'expo-image': { Image: 'Image' }, 'expo-symbols': { SymbolView: 'SymbolView' }, 'expo-location': { Accuracy: { Balanced: 3 }, requestForegroundPermissionsAsync: async () => ({ granted: true }), getCurrentPositionAsync: async () => ({ coords: { ...origin, accuracy: 10 }, timestamp: Date.now(), mocked: false }) },
    'expo-web-browser': {}, '@/lib/merchant-source': {}, '@/lib/public-seo': {},
    '../../supabase/functions/_shared/ticketmaster': {},
    'react-native-reanimated': { useReducedMotion: () => reduced },
    'expo-router': { useFocusEffect: fn => focusEffects.push(fn), useIsFocused: () => true, useLocalSearchParams: () => ({}), useRouter: () => ({ push: route => routes.push(route) }) },
    '@/lib/mock': { CITIES: [] },
    '@/constants/theme': { Colors: { dark: { ...theme, card: '#171722' }, light: theme } }, '@/constants/design-system': designSystem, '@/hooks/use-language': { useLanguage: () => ({ tr }) },
    '@/components/analytics-controls': { FlatList: 'FlatList', ScrollView: 'ScrollView', Pressable: 'Pressable' },
    '@/components/selection-chip': { SelectionChip: 'Pressable' },
    '@/lib/delivery-partners': { DELIVERY_PARTNERS: [], deliveryPartnerPlace: () => undefined },
    '@/lib/webshops': { bindBusinessPlaces: (...args) => bindBusinessPlaces(...args).map(item => ({ ...item, ...business[item.sourceId] })), loadCityBusinessLinks: async () => ({}), loadCityWebshops: loadWebshops },
    '@/components/discovery-map': { DiscoveryMap: 'DiscoveryMap' }, '@/components/gling-loader': { GlingLoader: 'GlingLoader' },
    '@/components/city-place-photo': { CityPlacePhoto: 'CityPlacePhoto' },
    '@/components/feed-ad': { FeedAd: 'FeedAd' }, '@/lib/ads': { adsSupported: false }, '@/lib/content-ad-placement': { contentAdPosition },
    '@/components/state-card': { StateCard: 'StateCard' }, '@/components/content-translation': {}, '@/hooks/use-content-translation': { useContentTranslation: (_kind, _id, source) => ({ display: source }) },
    '@/lib/content-translation': { CONTENT_TRANSLATION_VIEWABILITY: {} }, '@/lib/translation-source': {},
    '@/components/themed-text': { ThemedText: 'Text' }, '@/hooks/use-theme': { useTheme: () => theme },
    '@/hooks/use-content-visibility': { useContentVisibility: () => () => false },
    '@/lib/auth': { useAuth: () => ({ isAuthed: false, me: { id: 'guest' }, promptLogin() {} }) },
    '@/lib/community-city': { useCommunityCity: () => ({ city: { id: 'vancouver', name: '밴쿠버', englishName: 'Vancouver' } }) },
    '@/lib/discovery': discovery, '@/lib/discovery-sort': discoverySort, '@/lib/post-maps': postMaps, '@/lib/city-places': { getCityDiscoveryPlaces: () => places }, '@/lib/city-top25': { cityTop25Recommendations: () => [] }, '@/hooks/use-city-places': { useCityPlacesRevision: () => 0 }, '@/lib/discovery-data': {}, '@/lib/feed-data': {},
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) }, '@/lib/location': location, '@/lib/supabase': { supabase: {} },
    '@/lib/ticketmaster': { EVENT_CITIES: { vancouver: {} } }, '@/components/post-ad-label': {}, '@/lib/hashtags': { hasAdLabel: () => false },
  };
  const exports = {};
  const code = ts.transpileModule(source + '\nexports.CityMap = CityMap; exports.DiscoveryCard = DiscoveryCard; exports.GlingVisitedBadge = GlingVisitedBadge;', { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, Date, AbortController, setTimeout, clearTimeout, require: name => { if (name.startsWith('@/assets/')) return name; assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return { render() { index = 0; memoValues.length = 0; effects.length = 0; focusEffects.length = 0; return exports.CityMap({ city: imports['@/lib/community-city'].useCommunityCity().city, onClose }); }, renderCard(item, distance) { index = 0; return exports.DiscoveryCard({ item, distance, viewerScope: 'guest', onOpen() {} }); }, renderBadge(selected) { index = 0; return exports.GlingVisitedBadge({ selected }); }, get days() { return memoValues[0]; }, get registryDependencies() { return effects.find(value => String(value.fn).includes('loadCityWebshops')).deps; }, readRegistry() { return effects.find(value => String(value.fn).includes('loadCityWebshops')).fn(); }, readResults() { return focusEffects.find(fn => String(fn).includes('loadPage(null)'))(); }, feedback, alerts, routes };
}

test('main categories toggle independently and event dates belong to the festival category', () => {
  const view = mount(); let tree = view.render();
  assert.ok(nodes(tree).some(node => node.type === 'DiscoveryMap'));
  assert.ok(!nodes(tree).some(node => text(node).trim() === '전체 날짜'));
  control(tree, '분류와 날짜 필터 열기').props.onPress(); tree = view.render();
  assert.ok(nodes(tree).some(node => node.type === 'Modal' && node.props.visible));
  control(tree, '나이트라이프').props.onPress(); tree = view.render();
  control(tree, '카페').props.onPress(); tree = view.render();
  assert.equal(control(tree, '나이트라이프').props.accessibilityState.selected, true);
  assert.equal(control(tree, '카페').props.accessibilityState.selected, true);
  assert.equal(control(tree, '전체').props.accessibilityState.selected, false);
  assert.ok(!nodes(tree).some(node => node.props?.analyticsId === 'discovery.date'));
  control(tree, '페스티벌').props.onPress(); tree = view.render();
  control(tree, '오늘').props.onPress(); tree = view.render();
  control(tree, '지도 보기').props.onPress(); tree = view.render();
  assert.ok(!nodes(tree).some(node => node.type === 'Modal'));
  assert.equal(control(tree, '분류와 날짜 필터 열기').props.accessibilityState.expanded, false);
  assert.ok(view.feedback.length >= 5);
});

test('the quick category row preserves the owner-selected restaurant, cafe, festival and nightlife order', () => {
  const tree = mount().render();
  const row = nodes(tree).find(node => node.type === 'ScrollView' && node.props.horizontal);
  assert.deepEqual(children(row).map(node => node.props.accessibilityLabel), ['전체', 'gling Visited', 'TOP 50', '배달 할인', '레스토랑', '카페', '페스티벌', '나이트라이프', '가볼 만한 곳', '부동산', '중고거래']);
});

test('gling Visited selects only attested map pins while dining, cafe and All remain independent', () => {
  const food = { id: 'osm:node:100', cityId: 'vancouver', name: 'Fixture team visit', category: 'food',
    address: 'Fixture address', latitude: 49.29, longitude: -123.13, sourceUrl: 'https://www.openstreetmap.org/node/100',
    glingVisited: { sourceUrl: 'https://www.instagram.com/reel/fixture/' } };
  const cafe = { ...food, id: 'osm:node:101', name: 'Fixture cafe', category: 'cafe', glingVisited: undefined };
  const view = mount({ places: [food, cafe] });
  let tree = view.render();
  const pins = () => nodes(tree).find(node => node.type === 'DiscoveryMap').props.markers;
  assert.equal(pins().length, 2);
  control(tree, 'gling Visited').props.onPress(); tree = view.render();
  assert.equal(control(tree, 'gling Visited').props.accessibilityState.selected, true);
  assert.equal(pins().length, 1);
  assert.equal(pins()[0].label, food.name);
  assert.equal(pins()[0].latitude, food.latitude);
  assert.ok(!nodes(tree).some(node => node.props?.analyticsId === 'discovery.date'));
  control(tree, '카페').props.onPress(); tree = view.render();
  assert.equal(control(tree, 'gling Visited').props.accessibilityState.selected, true);
  assert.equal(control(tree, '카페').props.accessibilityState.selected, true);
  assert.equal(pins().length, 2, 'visited or cafe includes both places without duplicating the visited restaurant');
  control(tree, 'gling Visited').props.onPress(); tree = view.render();
  assert.equal(control(tree, 'gling Visited').props.accessibilityState.selected, false);
  assert.equal(pins().length, 1);
  assert.equal(pins()[0].label, cafe.name);
  control(tree, '전체').props.onPress(); tree = view.render();
  assert.equal(pins().length, 2);
  assert.deepEqual(view.feedback, ['selection', 'selection', 'selection', 'selection']);
});

test('All has no date restriction, while festival dates stay in its subordinate row', () => {
  const view = mount(); let tree = view.render();
  assert.equal(control(tree, '전체').props.accessibilityState.selected, true);
  assert.ok(!nodes(tree).some(node => node.props?.analyticsId === 'discovery.date'));
  assert.deepEqual(Array.from(view.days), []);
  control(tree, '페스티벌').props.onPress(); tree = view.render();
  assert.equal(control(tree, '다가오는 7일').props.accessibilityState.selected, true);
  assert.equal(view.days.length, 7);
  control(tree, '오늘').props.onPress(); tree = view.render();
  assert.equal(view.days.length, 1);
  control(tree, '카페').props.onPress(); tree = view.render();
  assert.ok(nodes(tree).some(node => node.props?.analyticsId === 'discovery.date'), 'festival dates stay available in a mixed selection');
  control(tree, '페스티벌').props.onPress(); tree = view.render();
  assert.ok(!nodes(tree).some(node => node.props?.analyticsId === 'discovery.date'));
  assert.deepEqual(Array.from(view.days), []);
  control(tree, '전체').props.onPress(); tree = view.render();
  assert.equal(control(tree, '전체').props.accessibilityState.selected, true);
  control(tree, '페스티벌').props.onPress(); tree = view.render();
  assert.equal(control(tree, '다가오는 7일').props.accessibilityState.selected, true);
  assert.equal(view.feedback.length, 6);
});
test('an explicit event date is cleared on All and cannot remain active in housing', () => {
  const view = mount(); let tree = view.render();
  control(tree, '페스티벌').props.onPress(); tree = view.render();
  control(tree, '오늘').props.onPress(); tree = view.render();
  control(tree, '부동산').props.onPress(); tree = view.render();
  assert.ok(nodes(tree).some(node => node.props?.analyticsId === 'discovery.date'));
  control(tree, '페스티벌').props.onPress(); tree = view.render();
  assert.ok(!nodes(tree).some(node => node.props?.analyticsId === 'discovery.date'));
  assert.deepEqual(Array.from(view.days), []);
  control(tree, '전체').props.onPress(); tree = view.render();
  assert.ok(!nodes(tree).some(node => node.props?.analyticsId === 'discovery.date'));
  assert.equal(control(tree, '부동산').props.accessibilityState.selected, false);
});

test('custom dates validate before closing and reset clears both category and date choices', () => {
  const view = mount(); let tree = view.render();
  control(tree, '페스티벌').props.onPress(); tree = view.render();
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
  assert.equal(control(tree, '전체').props.accessibilityState.selected, true);
  assert.deepEqual(Array.from(view.days), []);
  assert.ok(!nodes(tree).some(node => node.props?.analyticsId === 'discovery.date'));
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

test('collapsed place cards leave no panel or map inset and lower the list button', () => {
  const place = { id: 'osm:node:100', cityId: 'vancouver', name: 'Fixture place', category: 'cafe', address: 'Fixture address', latitude: 49.29, longitude: -123.13, sourceUrl: 'https://www.openstreetmap.org/node/100' };
  const view = mount({ places: [place] });
  let tree = view.render();
  let map = nodes(tree).find(node => node.type === 'DiscoveryMap');
  map.props.onSelect(map.props.markers[0].id); tree = view.render();
  const panel = nodes(tree).find(node => typeof node.props?.onLayout === 'function' && Array.isArray(node.props.style));
  assert.ok(panel);
  panel.props.onLayout({ nativeEvent: { layout: { height: 220 } } }); tree = view.render();
  assert.equal(nodes(tree).find(node => node.type === 'DiscoveryMap').props.bottomInset, 276);
  control(tree, '장소 카드 접기').props.onPress(); tree = view.render();
  assert.ok(!nodes(tree).some(node => typeof node.props?.onLayout === 'function' && Array.isArray(node.props.style)), 'the card surface must be removed, not left as an empty strip');
  map = nodes(tree).find(node => node.type === 'DiscoveryMap');
  assert.equal(map.props.bottomInset, 0);
  const list = nodes(tree).find(node => node.props?.accessibilityLabel === '리스트 보기' && Array.isArray(node.props.style));
  assert.equal(list.props.style.at(-1).bottom, 56);
  assert.ok(map.props.selectedId, 'collapsing keeps the chosen pin');
});

test('one accessible arrow repeatedly toggles the same selected place with feedback', () => {
  const place = { id: 'osm:node:100', cityId: 'vancouver', name: 'Fixture place', category: 'cafe', address: 'Fixture address', latitude: 49.29, longitude: -123.13, sourceUrl: 'https://www.openstreetmap.org/node/100' };
  for (const light of [false, true]) for (const reduced of [false, true]) {
    const view = mount({ places: [place], light, reduced });
    let tree = view.render();
    const map = nodes(tree).find(node => node.type === 'DiscoveryMap');
    map.props.onSelect(map.props.markers[0].id); tree = view.render();
    const selected = nodes(tree).find(node => node.type === 'DiscoveryMap').props.selectedId;
    for (const expanded of [true, false, true, false]) {
      const arrows = nodes(tree).filter(node => node.type === 'Pressable' && node.props?.analyticsId === 'discovery.detail');
      assert.equal(arrows.length, 1);
      const arrow = arrows[0];
      assert.equal(arrow.props.accessibilityRole, 'button');
      assert.equal(arrow.props.accessibilityState.expanded, expanded);
      assert.equal(arrow.props.accessibilityLabel, expanded ? '장소 카드 접기' : '장소 카드 펼치기');
      const style = Object.assign({}, ...arrow.props.style);
      assert.ok(style.width >= designSystem.ControlMetrics.touch && style.minHeight >= designSystem.ControlMetrics.touch);
      assert.equal(nodes(arrow).find(node => node.type === 'SymbolView').props.name.ios, expanded ? 'chevron.down' : 'chevron.up');
      const count = view.feedback.length;
      arrow.props.onPress(); tree = view.render();
      assert.equal(view.feedback.length, count+1);
      assert.equal(view.feedback.at(-1), 'selection');
      assert.equal(nodes(tree).find(node => node.type === 'DiscoveryMap').props.selectedId, selected);
    }
  }
});


test('map categories float over the map and list categories keep normal flow', () => {
  for (const light of [false, true]) {
    const view = mount({ light }); let tree = view.render();
    const map = nodes(tree).find(node => node.type === 'DiscoveryMap');
    const overlay = nodes(tree).find(node => node.props?.testID === 'map-filter-overlay');
    assert.ok(overlay, 'map categories must overlay the map canvas');
    assert.equal(overlay.props.pointerEvents, 'box-none');
    assert.equal(overlay.props.style.position, 'absolute');
    assert.equal(overlay.props.style.backgroundColor, undefined);
    assert.ok(nodes(tree).some(node => children(node).includes(map) && children(node).includes(overlay)));
    assert.match(control(overlay, '전체').props.baseColor, /#[0-9A-Fa-f]{6}C7$/);
    overlay.props.onLayout({ nativeEvent: { layout: { height: 68 } } }); tree = view.render();
    assert.equal(nodes(tree).find(node => node.type === 'DiscoveryMap').props.topInset, 68);
    const location = control(tree, '내 위치로 지도 이동');
    const controls = nodes(tree).find(node => children(node).includes(location));
    assert.equal(controls.props.style.at(-1).top, 80);
    control(tree, '리스트 보기').props.onPress(); tree = view.render();
    assert.ok(!nodes(tree).some(node => node.props?.testID === 'map-filter-overlay'));
    assert.equal(control(tree, '전체').props.baseColor, '#222231');
  }
});


test('map loading capsule stays centered and lets touches reach the map', () => {
  for (const light of [false, true]) {
    const tree = mount({ light }).render();
    const capsule = nodes(tree).find(node => node.type === 'GlingLoader' && node.props?.accessibilityLabel === '지도 결과 불러오는 중');
    const overlay = nodes(tree).find(node => children(node).includes(capsule));
    assert.equal(overlay.props.pointerEvents, 'none');
    const style = Object.assign({}, ...[overlay.props.style].flat(Infinity));
    assert.equal(style.position, 'absolute');
    assert.equal(style.top, 0);
    assert.equal(style.bottom, 0);
    assert.equal(style.alignItems, 'center');
    assert.equal(style.justifyContent, 'center');
  }
});

test('approved distance appears on place cards and unknown locations do not show a made-up value', () => {
  const view = mount();
  const item = { id: 'place:sample', source: 'place', sourceId: 'sample', cityId: 'vancouver', title: 'Fixture cafe', category: 'dining', label: 'Fixture address', latitude: 49.25, longitude: -122.86, price: null };
  assert.ok(text(view.renderCard(item, .8)).includes('약 0.8km'));
  assert.ok(text(view.renderCard(item, 0)).includes('100m 이내'));
  for (const distance of [null, undefined, NaN, Infinity, -1]) {
    const card = view.renderCard(item, distance);
    assert.ok(!text(card).includes('약 '));
    assert.ok(!text(card).includes('100m 이내'));
  }
  const discounted = view.renderCard({ ...item, webshopDiscount: 20.8 }, .8);
  assert.ok(text(discounted).includes('20.8'));
  assert.ok(text(discounted).includes('확인한 대표 메뉴 최대 할인'));
});

test('Visited category spacing grows without changing filter badge spacing', () => {
  const view = mount();
  const cardStyle = Object.assign({}, ...[view.renderBadge().props.style].flat(Infinity));
  const filterStyle = Object.assign({}, ...[view.renderBadge(true).props.style].flat(Infinity));
  assert.equal(cardStyle.marginLeft, 6, 'existing row gap6 plus margin6 gives12');
  assert.equal(filterStyle.marginLeft ?? 0, 0);
});

test('delivery-only discount sorting preserves the default nearest order and resets after changing category', async () => {
  const places = [{ id: 'osm:node:1', cityId: 'vancouver', name: 'Near shop', category: 'food', address: 'A', latitude: 49.251, longitude: -122.86, sourceUrl: 'https://www.openstreetmap.org/node/1' },
    { id: 'osm:node:2', cityId: 'vancouver', name: 'Larger saving', category: 'food', address: 'B', latitude: 49.29, longitude: -122.86, sourceUrl: 'https://www.openstreetmap.org/node/2' }];
  const view = mount({ places, business: { 'osm:node:1': { delivery: true, webshopDiscount: 10 }, 'osm:node:2': { delivery: true, webshopDiscount: 20.8 } } });
  let tree = view.render();
  assert.ok(!nodes(tree).some(node => node.props?.accessibilityLabel === '할인율 높은 순'));
  control(tree, '배달 할인').props.onPress(); tree = view.render();
  control(tree, '리스트 보기').props.onPress();
  await new Promise(setImmediate); tree = view.render();
  const data = () => nodes(tree).find(node => node.type === 'FlatList').props.data.map(item => item.title);
  assert.deepEqual(Array.from(data()), ['Near shop', 'Larger saving']);
  assert.equal(control(tree, '가까운 순').props.accessibilityState.selected, true);
  control(tree, '할인율 높은 순').props.onPress(); tree = view.render();
  assert.deepEqual(Array.from(data()), ['Larger saving', 'Near shop']);
  control(tree, '카페').props.onPress(); tree = view.render();
  assert.ok(!nodes(tree).some(node => node.props?.accessibilityLabel === '할인율 높은 순'));
  control(tree, '전체').props.onPress(); tree = view.render();
  control(tree, '배달 할인').props.onPress(); tree = view.render();
  assert.equal(control(tree, '가까운 순').props.accessibilityState.selected, true);
});

test('delivery registry pending, failure and retry are distinct from a successfully empty shop list', async () => {
  let offline = true, reads = 0;
  const view = mount({ registryReady: false, loadWebshops: async () => { reads++; if (offline) throw new Error('offline'); return []; } });
  let tree = view.render();
  control(tree, '배달 할인').props.onPress(); tree = view.render();
  const finishResults = view.readResults(); await new Promise(setImmediate); tree = view.render();
  assert.ok(nodes(tree).some(node => node.type === 'GlingLoader'), 'unread registry remains loading after other results have settled');
  assert.ok(!nodes(tree).some(node => node.type === 'StateCard' && node.props.title === '아직 배달 할인 가게가 없어요'));
  const stopRead = view.readRegistry(); await new Promise(setImmediate); tree = view.render();
  const error = nodes(tree).find(node => node.type === 'StateCard' && node.props.kind === 'error');
  assert.equal(error.props.title, '웹샵 할인 정보를 불러오지 못했어요');
  assert.equal(error.props.actionLabel, '다시 시도');
  assert.ok(!nodes(tree).some(node => node.type === 'StateCard' && node.props.title === '아직 배달 할인 가게가 없어요'));
  const attempt = view.registryDependencies[1], feedback = view.feedback.length;
  error.props.onAction(); tree = view.render();
  assert.equal(view.registryDependencies[1], attempt + 1, 'retry changes the actual registry read dependency');
  assert.equal(view.feedback.length, feedback + 1);
  offline = false;
  const stopRetry = view.readRegistry(), finishRetryResults = view.readResults();
  await new Promise(setImmediate); tree = view.render();
  assert.equal(reads, 2);
  assert.ok(!nodes(tree).some(node => node.type === 'StateCard' && node.props.kind === 'error'));
  assert.ok(nodes(tree).some(node => node.type === 'StateCard' && node.props.title === '아직 배달 할인 가게가 없어요'), 'only a successful zero-row read shows an empty list');
  stopRead(); stopRetry(); finishResults(); finishRetryResults();
});


test('main Map opens common search while embedded Map retains its local input and dismissal context', () => {
  const main=mount();let tree=main.render();
  const entry=nodes(tree).find(node=>node.props?.analyticsId==='search.entry.map');assert.ok(entry);entry.props.onPress();
  assert.equal(main.routes[0].pathname,'/search');assert.equal(main.routes[0].params.cityId,'vancouver');assert.ok(main.feedback.includes('selection'));
  let closed=0;const embedded=mount({onClose:()=>{closed++;}});tree=embedded.render();
  assert.equal(nodes(tree).some(node=>node.props?.analyticsId==='search.entry.map'),false);
  const input=nodes(tree).find(node=>node.type==='TextInput'&&typeof node.props.onChangeText==='function');assert.ok(input);input.props.onChangeText('지모코');tree=embedded.render();
  assert.equal(nodes(tree).find(node=>node.type==='TextInput').props.value,'지모코');assert.equal(embedded.routes.length,0);assert.equal(closed,0);
});
