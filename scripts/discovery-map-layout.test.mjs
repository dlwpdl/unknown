import { translationHookDefaults } from './test-language-imports.mjs';
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
import * as openingHours from '../src/lib/opening-hours.ts';

const source = readFileSync(new URL('../src/app/map.tsx', import.meta.url), 'utf8');
// The list sheet's header (summary, sub-filters, sort) is a prop, so it is walked like children.
// The routed map's list/map switch rides in the PageHeader's right slot, so that prop is walked too.
const children = node => [node?.props?.children, ...(node?.props?.header ? [node.props.header] : []), ...(node?.props?.right ? [node.props.right] : [])].flat(Infinity);
const nodes = node => !node || typeof node !== 'object' || node.type === 'Modal' && !node.props.visible ? [] : [node, ...children(node).flatMap(nodes)];
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node === 'object' ? children(node).map(text).join(' ') : String(node);
// The filter sheet's own 지도 보기, not the header's list/map switch with the same name.
const modalControl = (tree, label) => control(nodes(tree).find(node => node.type === 'Modal' && node.props.visible), label);
const emptyCards = tree => [...nodes(tree), ...nodes(nodes(tree).find(node => node.type === 'FlatList')?.props.ListEmptyComponent)].filter(node => node.type === 'StateCard');
const control = (tree, label) => { const result = nodes(tree).find(node => node.props?.accessibilityLabel === label || node.type === 'Pressable' && text(node).trim() === label); assert.ok(result, `Missing control: ${label}`); return result; };

// Render the actual route and run its handlers; only native/external services are replaced.
function mount({ cities = [], routeParams = {}, light = false, reduced = false, places = [], business = {}, origin = { latitude: 49.25, longitude: -122.86 }, registryReady = true, onClose, loadWebshops = async () => [], loadLinks = async () => ({}), loadPhotos = async () => ({}), loadSaves = async () => null, loadScope = async () => ({ places: new Map(), friendCount: 0 }) } = {}) {
  const routes = [], state = [], feedback = [], alerts = [], memoValues = [], effects = [], focusEffects = [], chosenCities = [], compass = { watches: [], removed: 0 }, savedEntry = { targets: [], state: null };
  let index = 0, focused = true, viewer = 'guest', city = { id: 'vancouver', name: '밴쿠버', englishName: 'Vancouver' };
  const theme = { background: light ? '#fff' : '#0B0B12', card: light ? '#fff' : '#171722', backgroundElement: '#222231', backgroundSelected: '#343443', text: '#F6F3F0', textSecondary: '#B7B4C3', accent: '#CBB9FF', accentInk: '#171123', line: '#343443' };
  const hooks = { useState(initial) { const slot = index++; if (!(slot in state)) { const value = typeof initial === 'function' ? initial() : initial; state[slot] = value && typeof value === 'object' && 'ready' in value && 'shops' in value ? { ...value, key: 'vancouver:guest', ready: registryReady } : value; } return [state[slot], next => { state[slot] = typeof next === 'function' ? next(state[slot]) : next; }]; }, useRef: current => ({ current }), useMemo: fn => { const value = fn(); memoValues.push(value); return value; }, useCallback: fn => fn, useEffect: (fn, deps) => effects.push({ fn, deps }) };
  const jsx = (type, props, key) => ({ type, props, key });
  const imports = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { ActivityIndicator: 'ActivityIndicator', Alert: { alert: (...args) => alerts.push(args) }, AppState: { currentState: 'active' }, Linking: {}, Modal: 'Modal', StyleSheet: { create: value => value, hairlineWidth: 1 }, TextInput: 'TextInput', View: 'View', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'ios' } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, 'expo-image': { Image: 'Image' }, 'expo-symbols': { SymbolView: 'SymbolView' }, 'expo-location': { Accuracy: { Balanced: 3 }, requestForegroundPermissionsAsync: async () => ({ granted: true }), getCurrentPositionAsync: async () => ({ coords: { ...origin, accuracy: 10 }, timestamp: Date.now(), mocked: false }),
      watchHeadingAsync: async callback => { compass.watches.push(callback); return { remove() { compass.removed++; } }; } },
    'expo-web-browser': {}, '@/lib/merchant-source': {}, '@/lib/public-seo': {},
    '../../supabase/functions/_shared/ticketmaster': {},
    'react-native-reanimated': { __esModule: true, default: { View: 'ReanimatedView' }, useReducedMotion: () => reduced, LayoutAnimationConfig: 'LayoutAnimationConfig',
      FadeIn: { duration: ms => ({ fadeIn: ms }) }, SlideInDown: { duration: ms => ({ slideIn: ms }) }, SlideOutDown: { duration: ms => ({ slideOut: ms }) } },
    'expo-router': { useFocusEffect: fn => focusEffects.push(fn), useIsFocused: () => focused, useLocalSearchParams: () => routeParams, useRouter: () => ({ push: route => routes.push(route), setParams: params => routes.push({ setParams: params }) }) },
    '@/lib/mock': { CITIES: cities },
    '@/constants/theme': { Colors: { dark: { ...theme, card: '#171722' }, light: theme } }, '@/constants/design-system': designSystem, '@/hooks/use-language': { useLanguage: () => ({ tr }) },
    '@/components/analytics-controls': { FlatList: 'FlatList', ScrollView: 'ScrollView', Pressable: 'Pressable' }, '@/components/page-header': { PageHeader: 'PageHeader' },
    '@/components/selection-chip': { SelectionChip: 'Pressable' }, '@/components/disclosure': { animateLayout() {} },
    '@/lib/delivery-partners': { DELIVERY_PARTNERS: [], deliveryPartnerPlace: () => undefined },
    '@/lib/webshops': { bindBusinessPlaces: (...args) => bindBusinessPlaces(...args).map(item => ({ ...item, ...business[item.sourceId] })), loadCityBusinessLinks: loadLinks, loadCityBusinessMapPhotos: loadPhotos, loadCityWebshops: loadWebshops },
    '@/components/live-bubbles': { useLive: () => ({ status: 'idle', map: null }), useLiveMarkers: () => [], useMeetupMarkers: () => [], useKeepClearOfNotice: () => ({ current: null }), LiveDock: 'LiveDock', LiveSheets: 'LiveSheets' },
    '@/lib/live-bubbles': { loadLiveMap: async () => {} }, '@/lib/post-map-html': { mapCityCenter: () => [-123.12, 49.28] },
    '@/components/discovery-map': { DiscoveryMap: 'DiscoveryMap' }, '@/components/gling-loader': { GlingLoader: 'GlingLoader' },
    '@/components/city-place-photo': { CityPlacePhoto: 'CityPlacePhoto' }, '@/components/category-icon': { CategoryIcon: 'CategoryIcon' },
    '@/components/feed-ad': { FeedAd: 'FeedAd' }, '@/lib/ads': { adsSupported: false }, '@/lib/content-ad-placement': { contentAdPosition },
    '@/components/state-card': { StateCard: 'StateCard' }, '@/components/content-translation': {}, '@/hooks/use-content-translation': { ...translationHookDefaults, useContentTranslation: (_kind, _id, source) => ({ display: source }) },
    '@/lib/content-translation': { CONTENT_TRANSLATION_VIEWABILITY: {} }, '@/lib/translation-source': {},
    '@/components/themed-text': { ThemedText: 'Text' }, '@/hooks/use-theme': { useTheme: () => theme },
    '@/hooks/use-content-visibility': { useContentVisibility: () => () => false },
    '@/lib/auth': { useAuth: () => ({ isAuthed: viewer !== 'guest', me: { id: viewer }, promptLogin() {} }) },
    '@/lib/community-city': { useCommunityCity: () => ({ city, selectCity: async next => { chosenCities.push(next.id); return true; } }) },
    '@/lib/discovery': discovery, '@/lib/discovery-sort': discoverySort, '@/lib/post-maps': postMaps, '@/lib/city-places': { getCityDiscoveryPlaces: () => places }, '@/lib/city-top25': { cityTop25Recommendations: () => [] }, '@/hooks/use-city-places': { useCityPlacesRevision: () => 0 }, '@/lib/discovery-data': { loadDiscoveryPosts: async () => ({ items: [], cursor: null, hasMore: false }) }, '@/lib/feed-data': {},
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) }, '@/lib/location': location, '@/lib/supabase': { supabase: {} },
    '@/lib/ticketmaster': { EVENT_CITIES: { vancouver: {} }, loadTicketmasterEvents: async () => ({ events: [], hasMore: false }) }, '@/components/post-ad-label': {}, '@/lib/hashtags': { hasAdLabel: () => false },
    '@/components/drag-sheet': { DragSheet: 'DragSheet' }, '@/components/city-picker': { CityPicker: 'CityPicker' }, '@/components/saved-entry': { SavedEntryButton: 'SavedEntryButton', useSavedEntry: target => { savedEntry.targets.push(target); return { state: savedEntry.state }; } }, '@/components/map-list-sheet': { MapListSheet: 'MapListSheet' }, '@/components/map-scope': { FriendSavedLine: 'FriendSavedLine', MapScopeSheet: 'MapScopeSheet' }, '@/lib/profile-friends': { loadMapScope: (...args) => loadScope(...args), loadCityPlaceSaves: (...args) => loadSaves(...args) }, '@/components/place-hours': { PlaceHours: 'PlaceHours' },
    '@/components/reservation-button': { ReservationButton: 'ReservationButton' }, '@/lib/opening-hours': openingHours,
    '@/lib/listing-details': { inBounds: (b, p) => p.latitude >= b.south && p.latitude <= b.north && p.longitude >= b.west && p.longitude <= b.east },
  };
  const exports = {};
  const code = ts.transpileModule(source + '\nexports.CityMap = CityMap; exports.DiscoveryCard = DiscoveryCard; exports.GlingVisitedBadge = GlingVisitedBadge;', { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, Date, AbortController, setTimeout, clearTimeout, require: name => { if (name.startsWith('@/assets/')) return name; assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  return { render() { index = 0; memoValues.length = 0; effects.length = 0; focusEffects.length = 0; return exports.CityMap({ city: imports['@/lib/community-city'].useCommunityCity().city, onClose }); }, renderCard(item, distance, saves) { index = 0; return exports.DiscoveryCard({ item, distance, saves, viewerScope: 'guest', onOpen() {} }); }, renderBadge(selected) { index = 0; return exports.GlingVisitedBadge({ selected }); }, get days() { return memoValues[0]; }, get registryDependencies() { return effects.find(value => String(value.fn).includes('loadCityWebshops')).deps; }, readRegistry() { return effects.find(value => String(value.fn).includes('loadCityWebshops')).fn(); }, readResults() { return focusEffects.find(fn => String(fn).includes('loadPage(null)'))(); }, readScope() { return effects.find(value => String(value.fn).includes('loadMapScope')).fn(); }, readMine() { return effects.find(value => String(value.fn).includes("'mine'")).fn(); }, readSaves() { return effects.find(value => String(value.fn).includes('loadCityPlaceSaves')).fn(); }, readCompass() { return effects.find(value => String(value.fn).includes('watchHeadingAsync')).fn(); }, compass, savedEntry, setCity: id => { city = { ...city, id }; }, setViewer: id => { viewer = id; }, setFocused: value => { focused = value; }, feedback, alerts, routes, chosenCities };
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
  // The live-map chips (말풍선, 근처 모임) are for members only, so a guest sees the row as before.
  assert.deepEqual(children(row).filter(Boolean).map(node => node.props.accessibilityLabel), ['보여 줄 곳, 모두', '전체', '지금 영업 중', 'gling Visited', 'TOP 50', '배달 할인', '레스토랑', '카페', '페스티벌', '나이트라이프', '가볼 만한 곳', '부동산', '중고거래']);
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
  modalControl(tree, '지도 보기').props.onPress(); tree = view.render();
  assert.ok(nodes(tree).some(node => node.props?.accessibilityRole === 'alert'));
  assert.ok(nodes(tree).some(node => node.type === 'Modal'));
  const tomorrow = discovery.discoveryDays('today', 'vancouver')[0];
  control(tree, '행사 날짜 연도-월-일').props.onChangeText(tomorrow); tree = view.render();
  modalControl(tree, '지도 보기').props.onPress(); tree = view.render();
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

test('the map uses the same pulsing logo loader as the other tabs in both themes', () => {
  for (const light of [false, true]) {
    const tree = mount({ light }).render();
    const loader = nodes(tree).find(node => node.type === 'GlingLoader' && node.props?.accessibilityLabel === '지도 결과 불러오는 중');
    assert.ok(loader);
    assert.equal(loader.props.variant, undefined);
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
  // No credits strip under the map any more (owner 691cf630): the card sits 12pt up and the shared row 12pt above it.
  assert.equal(nodes(tree).find(node => node.type === 'DiscoveryMap').props.bottomInset, 244);
  control(tree, '장소 카드 접기').props.onPress(); tree = view.render();
  assert.ok(!nodes(tree).some(node => typeof node.props?.onLayout === 'function' && Array.isArray(node.props.style)), 'the card surface must be removed, not left as an empty strip');
  map = nodes(tree).find(node => node.type === 'DiscoveryMap');
  assert.equal(map.props.bottomInset, 12, 'only the floating row stays, where the map draws its ⓘ');
  const list = nodes(tree).find(node => node.props?.accessibilityLabel === '리스트 보기' && Array.isArray(node.props.style));
  assert.equal(list.props.style.at(-1).bottom, 12);
  assert.ok(map.props.selectedId, 'collapsing keeps the chosen pin');
});

test('the place card rises and drops along the same edge, Reduce Motion drops it, and the list sheet replaces the card', () => {
  const place = { id: 'osm:node:100', cityId: 'vancouver', name: 'Fixture place', category: 'cafe', address: 'Fixture address', latitude: 49.29, longitude: -123.13, sourceUrl: 'https://www.openstreetmap.org/node/100' };
  const { ControlMotion } = designSystem;
  for (const reduced of [false, true]) {
    const view = mount({ places: [place], reduced });
    let tree = view.render();
    const map = nodes(tree).find(node => node.type === 'DiscoveryMap');
    map.props.onSelect(map.props.markers[0].id); tree = view.render();
    const card = nodes(tree).find(node => typeof node.props?.onLayout === 'function' && Array.isArray(node.props.style));
    assert.equal(card.type, 'ReanimatedView');
    assert.deepEqual(card.props.entering, reduced ? undefined : { slideIn: ControlMotion.expandMs });
    assert.deepEqual(card.props.exiting, reduced ? undefined : { slideOut: ControlMotion.sheetCloseMs });
    control(tree, '리스트 보기').props.onPress(); tree = view.render();
    assert.equal(nodes(tree).find(node => node.type === 'MapListSheet').props.snap, 'full', 'the list rises over the map instead of replacing it');
    assert.ok(nodes(tree).some(node => node.type === 'DiscoveryMap'), 'the map stays mounted under the sheet');
    assert.ok(!nodes(tree).some(node => node.type === 'ReanimatedView'), 'the place card leaves when the list opens');
  }
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
    assert.equal(control(overlay, '전체').props.baseColor, undefined, '전체 is a picture with its name, nothing behind it');
    assert.equal(control(overlay, 'gling Visited').props.baseColor, undefined, 'no chip in the row has a pill behind it');
    overlay.props.onLayout({ nativeEvent: { layout: { height: 68 } } }); tree = view.render();
    assert.equal(nodes(tree).find(node => node.type === 'DiscoveryMap').props.topInset, 68);
    const location = control(tree, '내 위치로 지도 이동');
    const controls = nodes(tree).find(node => children(node).includes(location));
    assert.equal(controls.props.style.at(-1).top, 80);
    control(tree, '리스트 보기').props.onPress(); tree = view.render();
    const above = nodes(tree).find(node => node.props?.testID === 'map-filter-overlay');
    assert.ok(above, 'categories stay above the full list so they can still be switched');
    assert.equal(Object.assign({}, ...above.props.style).backgroundColor, light ? '#fff' : '#0B0B12');
    assert.equal(nodes(tree).find(node => node.type === 'MapListSheet').props.positions.full, 68, 'the full list stops under the chips');
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

test('the Visited card badge keeps its spacing (the map chip is now the logo tag picture)', () => {
  const view = mount();
  const cardStyle = Object.assign({}, ...[view.renderBadge().props.style].flat(Infinity));
  assert.equal(cardStyle.marginLeft, 6, 'existing row gap6 plus margin6 gives12');
});

test('delivery-only discount sorting preserves the default nearest order and resets after changing category', async () => {
  const places = [{ id: 'osm:node:1', cityId: 'vancouver', name: 'Near shop', category: 'food', address: 'A', latitude: 49.251, longitude: -122.86, sourceUrl: 'https://www.openstreetmap.org/node/1' },
    { id: 'osm:node:2', cityId: 'vancouver', name: 'Larger saving', category: 'food', address: 'B', latitude: 49.29, longitude: -122.86, sourceUrl: 'https://www.openstreetmap.org/node/2' }];
  const view = mount({ places, business: { 'osm:node:1': { delivery: true, webshopDiscount: 10 }, 'osm:node:2': { delivery: true, webshopDiscount: 20.8 } } });
  let tree = view.render();
  assert.ok(!nodes(tree).some(node => node.props?.accessibilityLabel === '할인율 높은 순'));
  control(tree, '배달 할인').props.onPress(); tree = view.render();
  assert.equal(nodes(tree).find(node => node.type === 'MapListSheet').props.snap, 'half', 'a category tap raises the list half way');
  control(tree, '내 위치 사용').props.onPress();
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
  assert.ok(!emptyCards(tree).some(node => node.props.title === '아직 배달 할인 가게가 없어요'));
  const stopRead = view.readRegistry(); await new Promise(setImmediate); tree = view.render();
  const error = nodes(tree).find(node => node.type === 'StateCard' && node.props.kind === 'error');
  assert.equal(error.props.title, '웹샵 할인 정보를 불러오지 못했어요');
  assert.equal(error.props.actionLabel, '다시 시도');
  assert.ok(!emptyCards(tree).some(node => node.props.title === '아직 배달 할인 가게가 없어요'));
  const attempt = view.registryDependencies[1], feedback = view.feedback.length;
  error.props.onAction(); tree = view.render();
  assert.equal(view.registryDependencies[1], attempt + 1, 'retry changes the actual registry read dependency');
  assert.equal(view.feedback.length, feedback + 1);
  offline = false;
  const stopRetry = view.readRegistry(), finishRetryResults = view.readResults();
  await new Promise(setImmediate); tree = view.render();
  assert.equal(reads, 2);
  assert.ok(!nodes(tree).some(node => node.type === 'StateCard' && node.props.kind === 'error'));
  assert.ok(emptyCards(tree).some(node => node.props.title === '아직 배달 할인 가게가 없어요'), 'only a successful zero-row read shows an empty list');
  stopRead(); stopRetry(); finishResults(); finishRetryResults();
});

test('map photos batch by city, refresh after returning, and clear on removal or failure', async () => {
  const place = { id: 'osm:node:100', cityId: 'vancouver', name: 'Photo branch', category: 'cafe', address: 'A', latitude: 49.25, longitude: -122.86, sourceUrl: 'https://www.openstreetmap.org/node/100', photo: { uri: 'original' } };
  const merchantId = 'a3310000-0000-4000-8000-000000000001';
  let reads = 0, version = 'one';
  const view = mount({ places: [place], loadLinks: async () => ({ [place.id]: merchantId }), loadPhotos: async (_client, cityId) => {
    reads++; if (version === 'offline') throw Error('offline');
    return version === 'removed' ? {} : { [place.id]: { cityId, merchantId, uri: version } };
  } });
  const selected = () => { const tree = view.render(); nodes(tree).find(n => n.type === 'DiscoveryMap').props.onSelect(`place:vancouver:${place.id}`); return nodes(view.render()).find(n => n.type?.name === 'DiscoveryCard').props.item; };
  view.render(); let stop = view.readRegistry(); await new Promise(setImmediate);
  assert.equal(selected().place.mapPhotoUri, 'one');
  view.render(); view.render(); assert.equal(reads, 1, 'renders do not fetch per card');
  stop(); view.setFocused(false); view.render(); view.setFocused(true); view.render(); version = 'two'; stop = view.readRegistry(); await new Promise(setImmediate);
  assert.equal(selected().place.mapPhotoUri, 'two');
  view.setViewer('second-viewer'); assert.equal(selected().place.mapPhotoUri, undefined, 'a previously loaded image is hidden before the next account reads');
  view.setViewer('guest');
  for (const next of ['removed', 'offline']) {
    stop(); view.render(); version = next; stop = view.readRegistry(); await new Promise(setImmediate);
    assert.equal(selected().place.mapPhotoUri, undefined);
    assert.equal(selected().place.photo.uri, 'original');
  }
  stop();
});

test('late map photo reads cannot attach to another city or viewer', async () => {
  const place = { id: 'osm:node:100', cityId: 'vancouver', name: 'Photo branch', category: 'cafe', address: 'A', latitude: 49.25, longitude: -122.86, sourceUrl: 'https://www.openstreetmap.org/node/100' };
  const merchantId = 'a3310000-0000-4000-8000-000000000001', pending = [];
  const view = mount({ places: [place], loadLinks: async () => ({ [place.id]: merchantId }), loadPhotos: (_client, cityId, signal) => new Promise(resolve => pending.push({ cityId, signal, resolve })) });
  view.render(); const stop = view.readRegistry();
  view.setViewer('different-viewer'); view.render(); stop();
  pending[0].resolve({ [place.id]: { cityId: place.cityId, merchantId, uri: 'private-to-previous-scope' } }); await new Promise(setImmediate);
  assert.equal(pending[0].signal.aborted, true);
  let tree = view.render(); nodes(tree).find(n => n.type === 'DiscoveryMap').props.onSelect(`place:vancouver:${place.id}`); tree = view.render();
  assert.equal(nodes(tree).find(n => n.type?.name === 'DiscoveryCard').props.item.place.mapPhotoUri, undefined);
  const dependencies = view.registryDependencies;
  view.setCity('toronto'); view.render(); assert.notDeepEqual(view.registryDependencies, dependencies);
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

const fixturePlace = (id, patch = {}) => ({ id: `osm:node:${id}`, cityId: 'vancouver', name: `Place ${id}`, category: 'food', address: 'A', latitude: 49.25 + id / 1000, longitude: -122.86, sourceUrl: `https://www.openstreetmap.org/node/${id}`, ...patch });
const pinsOf = tree => Array.from(nodes(tree).find(node => node.type === 'DiscoveryMap').props.markers.map(marker => marker.label));
const listOf = tree => Array.from(nodes(tree).find(node => node.type === 'FlatList').props.data.map(item => item.title));
const footerOf = tree => nodes(nodes(tree).find(node => node.type === 'FlatList').props.ListFooterComponent);

test('지금 영업 중 removes closed and unknown places from the map and keeps unknown ones behind the last list row', () => {
  const view = mount({ places: [fixturePlace(1, { name: 'Always open', openingHours: '24/7' }), fixturePlace(2, { name: 'Closed all week', openingHours: 'Mo-Su off' }), fixturePlace(3, { name: 'No hours' }), fixturePlace(4, { name: 'Unreadable', openingHours: 'sunrise-sunset' })] });
  let tree = view.render();
  assert.equal(pinsOf(tree).length, 4);
  const chip = control(tree, '지금 영업 중');
  assert.equal(chip.props.accessibilityState.selected, false);
  chip.props.onPress(); tree = view.render();
  assert.equal(control(tree, '지금 영업 중').props.accessibilityState.selected, true);
  assert.deepEqual(pinsOf(tree), ['Always open']);
  assert.deepEqual(listOf(tree), ['Always open']);
  const row = footerOf(tree).find(node => node.props?.analyticsId === 'discovery.unknown-hours');
  assert.match(text(row), /영업시간을 모르는 곳 2곳/);
  assert.equal(row.props.accessibilityState.expanded, false);
  row.props.onPress(); tree = view.render();
  assert.deepEqual(listOf(tree), ['Always open', 'No hours', 'Unreadable'], 'unknown hours open below the known ones');
  assert.deepEqual(pinsOf(tree), ['Always open'], 'they still stay off the map');
  assert.ok(!footerOf(tree).some(node => node.props?.analyticsId === 'discovery.unknown-hours'), 'the row moves above the places it opened');
  control(tree, '지금 영업 중').props.onPress(); tree = view.render();
  assert.equal(pinsOf(tree).length, 4);
  assert.deepEqual(view.feedback, ['selection', 'selection', 'selection']);
});

test('price chips select several levels, hide without price data, and an empty result offers 가격 필터 풀기', async () => {
  const places = [fixturePlace(1, { name: 'Cheap lunch', priceLevel: 1, subcategories: ['lunch'] }), fixturePlace(2, { name: 'Date night', priceLevel: 3, subcategories: ['date', 'dinner'] }), fixturePlace(3, { name: 'No price' }),
    fixturePlace(4, { name: 'Cafe', category: 'cafe' })];
  const view = mount({ places }); let tree = view.render();
  const priceChip = tree => nodes(tree).some(node => /^가격( 필터| .+, 바꾸기)$/.test(node.props?.accessibilityLabel ?? ''));
  assert.ok(!priceChip(tree), 'no price chip before a priced category is chosen');
  control(tree, '레스토랑').props.onPress(); tree = view.render();
  view.readResults(); await new Promise(setImmediate); tree = view.render();
  assert.equal(nodes(tree).find(node => node.type === 'MapListSheet').props.snap, 'half');
  assert.deepEqual(nodes(tree).filter(node => node.props?.analyticsId === 'discovery.subcategory' && node.props.accessibilityLabel).map(node => node.props.accessibilityLabel), ['점심', '저녁', '데이트'], 'only sub-filters some place has');
  assert.ok(priceChip(tree), 'the price chip shows once a priced category is chosen');
  control(tree, '가격 필터').props.onPress(); tree = view.render();
  assert.equal(nodes(tree).find(node => node.type === 'DragSheet').props.visible, true);
  control(tree, '가격대 1단계').props.onPress(); tree = view.render();
  control(tree, '가격대 2단계').props.onPress(); tree = view.render();
  control(tree, '가격 적용').props.onPress(); tree = view.render();
  assert.equal(nodes(tree).find(node => node.type === 'DragSheet').props.visible, false);
  assert.ok(nodes(tree).some(node => node.props?.accessibilityLabel === '가격 $–$$, 바꾸기'));
  assert.deepEqual(listOf(tree), ['Cheap lunch'], 'places without a price leave while a price is chosen');
  assert.deepEqual(pinsOf(tree), ['Cheap lunch']);
  control(tree, '가격 $–$$, 바꾸기').props.onPress(); tree = view.render();
  control(tree, '가격대 1단계').props.onPress(); tree = view.render();
  control(tree, '가격대 4단계').props.onPress(); tree = view.render();
  control(tree, '가격 적용').props.onPress(); tree = view.render();
  assert.deepEqual(listOf(tree), []);
  const empty = emptyCards(tree).find(node => node.props.actionLabel === '가격 필터 풀기');
  assert.ok(empty, 'an empty price result can be cleared in one tap');
  empty.props.onAction(); tree = view.render();
  assert.deepEqual(listOf(tree), ['Cheap lunch', 'Date night', 'No price']);
  control(tree, '데이트').props.onPress(); tree = view.render();
  assert.deepEqual(listOf(tree), ['Date night']);
  control(tree, '점심').props.onPress(); tree = view.render();
  assert.deepEqual(listOf(tree), ['Cheap lunch', 'Date night'], 'sub-filters add up');
  control(tree, '레스토랑').props.onPress(); control(tree, '카페').props.onPress(); tree = view.render();
  assert.ok(!priceChip(tree) && !nodes(tree).some(node => node.props?.analyticsId === 'discovery.subcategory'), 'a category with no values shows neither row');
  assert.deepEqual(listOf(tree), ['Cafe'], 'leftover sub-filters never hide another category');
});

test('search this area narrows to the moved map, hides when zoomed out to cities, and city pills switch the city', () => {
  const cities = [{ id: 'vancouver', name: '밴쿠버', englishName: 'Vancouver', state: 'open' }, { id: 'toronto', name: '토론토', englishName: 'Toronto', state: 'open' }, { id: 'calgary', name: '캘거리', englishName: 'Calgary', state: 'soon' }];
  const view = mount({ cities, places: [fixturePlace(1, { name: 'Inside' }), fixturePlace(2, { name: 'Outside', latitude: 49.4 })] });
  let tree = view.render(); let map = nodes(tree).find(node => node.type === 'DiscoveryMap');
  assert.deepEqual(Array.from(map.props.cities.map(city => [city.id, city.open])), [['vancouver', true], ['toronto', true], ['calgary', false]]);
  map.props.onMoved({ west: -123, south: 49.2, east: -122.8, north: 49.3 }, 5); tree = view.render();
  assert.ok(!nodes(tree).some(node => node.props?.analyticsId === 'discovery.search-here'), 'the far city stage has no area to search');
  nodes(tree).find(node => node.type === 'DiscoveryMap').props.onMoved({ west: -123, south: 49.2, east: -122.8, north: 49.3 }, 12); tree = view.render();
  const pill = nodes(tree).find(node => node.props?.analyticsId === 'discovery.search-here');
  assert.match(text(pill), /이 지역에서 다시 찾기/);
  pill.props.onPress(); tree = view.render();
  assert.deepEqual(pinsOf(tree), ['Inside']);
  assert.ok(!nodes(tree).some(node => node.props?.analyticsId === 'discovery.search-here'));
  map = nodes(tree).find(node => node.type === 'DiscoveryMap');
  map.props.onCity('calgary'); map.props.onCity('toronto');
  assert.deepEqual(view.chosenCities, ['toronto'], 'only open cities can be chosen, through the shared city choice');
  const routed = mount({ cities, routeParams: { cityId: 'vancouver' } });
  nodes(routed.render()).find(node => node.type === 'DiscoveryMap').props.onCity('toronto');
  assert.deepEqual(JSON.parse(JSON.stringify(routed.routes.at(-1))), { setParams: { cityId: 'toronto' } }, 'a map opened for a city link changes its own link');
  assert.deepEqual(routed.chosenCities, []);
});

test('map pins carry a second line, featured names and the category id for the drawn icon', () => {
  const places = [fixturePlace(1, { name: 'Brunch spot', category: 'cafe', subcategories: ['brunch'] }), fixturePlace(2, { name: 'Visited', glingVisited: { sourceUrl: 'https://www.instagram.com/reel/fixture/' } })];
  const markers = nodes(mount({ places }).render()).find(node => node.type === 'DiscoveryMap').props.markers;
  assert.deepEqual(Array.from(markers.map(marker => [marker.label, marker.sublabel, marker.featured ?? false, marker.icon])), [['Brunch spot', '브런치', false, 'cafe'], ['Visited', '다이닝', true, 'dining']]);
});

test('category chips show the 3D icon in the icon spot and each press replays only the pressed icon', () => {
  const view = mount(); let tree = view.render();
  const icon = (tree, label) => nodes(control(tree, label)).find(node => node.type === 'CategoryIcon');
  assert.equal(icon(tree, '전체').props.id, 'all', '전체 draws the four-tile picture the owner picked');
  assert.equal(icon(tree, 'gling Visited').props.id, 'visited', 'Visited draws the gling logo tag');
  assert.equal(icon(tree, '지금 영업 중').props.id, 'open', '지금 영업 중 draws the desk clock');
  for (const label of ['TOP 50', '배달 할인', '레스토랑', '카페', '페스티벌', '나이트라이프', '가볼 만한 곳', '부동산', '중고거래']) assert.equal(icon(tree, label).props.play, 0, label);
  control(tree, '카페').props.onPress(); tree = view.render();
  const first = icon(tree, '카페').props.play;
  assert.ok(first > 0);
  assert.equal(icon(tree, '레스토랑').props.play, 0);
  assert.equal(icon(tree, '카페').props.id, 'cafe');
  control(tree, '카페').props.onPress(); tree = view.render();
  assert.ok(icon(tree, '카페').props.play > first, 'pressing again (deselecting too) plays again');
  control(tree, '배달 할인').props.onPress(); tree = view.render();
  assert.equal(icon(tree, '카페').props.play, 0);
  assert.ok(icon(tree, '배달 할인').props.play > 0);
});

test('보여 줄 곳 keeps only the saved places inside the other filters, names who saved them and explains an empty scope', async () => {
  const saved = place => ({ placeKey: `osm:node:${place}`, friendCount: 3, friends: [{ id: `f${place}`, nickname: '하늘', avatarPath: null }] });
  const reads = [];
  let answer = { places: new Map([['osm:node:2', saved(2)], ['osm:node:3', saved(3)]]), friendCount: 2 };
  const view = mount({ places: [fixturePlace(1, { name: 'Lunch' }), fixturePlace(2, { name: 'Dinner' }), fixturePlace(3, { name: 'Cafe', category: 'cafe' })],
    loadScope: async (_client, scope, cityId, userId) => { reads.push([scope, cityId, userId]); return answer; } });
  view.setViewer('member-1');
  let tree = view.render();
  view.readResults(); await new Promise(setImmediate); tree = view.render();
  assert.deepEqual(listOf(tree), ['Lunch', 'Dinner', 'Cafe']);
  const sheet = () => nodes(tree).find(node => node.type === 'MapScopeSheet');
  assert.equal(sheet().props.visible, false);
  assert.equal(control(tree, '보여 줄 곳, 모두').props.accessibilityState.selected, false);
  control(tree, '보여 줄 곳, 모두').props.onPress(); tree = view.render();
  assert.equal(sheet().props.visible, true);
  assert.equal(sheet().props.scope, 'all');
  assert.deepEqual(reads, [], 'the scope filter reads nothing while 모두 shows (the pin marks have their own read, tested below)');

  sheet().props.onPick('friends'); tree = view.render();
  assert.equal(sheet().props.visible, false);
  assert.equal(control(tree, '보여 줄 곳, 친구가 저장한 곳').props.accessibilityState.selected, true);
  view.readScope(); await new Promise(setImmediate); tree = view.render();
  assert.deepEqual(reads, [['friends', 'vancouver', 'member-1']]);
  assert.deepEqual(listOf(tree), ['Dinner', 'Cafe']);
  assert.deepEqual(pinsOf(tree), ['Dinner', 'Cafe']);
  const list = nodes(tree).find(node => node.type === 'FlatList');
  const card = nodes(list.props.renderItem({ item: list.props.data[1], index: 1 })).find(node => node.type?.name === 'DiscoveryCard');
  assert.equal(card.props.savedBy, answer.places.get('osm:node:3'), 'each card carries who saved it');
  control(tree, '카페').props.onPress(); tree = view.render();
  assert.deepEqual(listOf(tree), ['Cafe'], 'categories still narrow inside the saved scope');
  control(tree, '전체').props.onPress(); tree = view.render();

  answer = { places: new Map(), friendCount: 0 };
  sheet().props.onPick('mine'); tree = view.render();
  view.readScope(); await new Promise(setImmediate); tree = view.render();
  const mine = emptyCards(tree).find(node => node.props.title === '아직 저장한 곳이 없어요');
  assert.ok(mine, 'an empty 내가 저장한 곳 says so');
  assert.equal(mine.props.actionLabel, '모두 보기');
  sheet().props.onPick('friends'); tree = view.render();
  view.readScope(); await new Promise(setImmediate); tree = view.render();
  const lonely = emptyCards(tree).find(node => node.props.title === '아직 친구가 없어요');
  assert.ok(lonely, 'no friends yet is told apart from friends who saved nothing');
  lonely.props.onAction();
  assert.deepEqual(view.routes.at(-1), '/profile/friends');
  answer = { places: new Map(), friendCount: 2 };
  sheet().props.onPick('mine'); tree = view.render(); view.readScope(); await new Promise(setImmediate);
  sheet().props.onPick('friends'); tree = view.render(); view.readScope(); await new Promise(setImmediate); tree = view.render();
  assert.ok(emptyCards(tree).some(node => node.props.title === '친구가 저장한 곳이 아직 없어요'));

  view.setViewer('guest'); tree = view.render();
  view.readResults(); await new Promise(setImmediate); tree = view.render();
  const login = emptyCards(tree).find(node => node.props.title === '로그인하면 저장한 곳이 지도에 떠요');
  assert.ok(login, 'a signed-out visitor is asked to sign in');
  assert.equal(login.props.actionLabel, '로그인');
  sheet().props.onPick('all'); tree = view.render();
  assert.deepEqual(listOf(tree), ['Lunch', 'Dinner', 'Cafe']);
  assert.equal(reads.length, 5, 'a signed-out visitor never reads saved places');
});

test('M5: my saved places carry a pin mark in 모두, and a save confirmed on the map card moves it at once', async () => {
  const reads = [];
  const view = mount({ places: [fixturePlace(1), fixturePlace(2), fixturePlace(3)],
    loadScope: async (_client, scope, cityId, userId) => { reads.push([scope, cityId, userId]); return { places: new Map([['osm:node:2', null]]), friendCount: null }; } });
  const savedPins = tree => Array.from(nodes(tree).find(node => node.type === 'DiscoveryMap').props.markers.filter(marker => marker.saved), marker => marker.label);
  let tree = view.render();
  assert.equal(view.readMine(), undefined, 'a signed-out visitor reads nothing');
  assert.deepEqual(reads, []);
  view.setViewer('member-1'); tree = view.render();
  view.readResults(); view.readMine(); await new Promise(setImmediate); tree = view.render();
  assert.deepEqual(reads, [['mine', 'vancouver', 'member-1']]);
  assert.deepEqual(savedPins(tree), ['Place 2']);
  assert.equal(view.savedEntry.targets.at(-1), null, 'no card, so no saved-state read');
  const map = nodes(tree).find(node => node.type === 'DiscoveryMap');
  map.props.onSelect(map.props.markers[0].id); tree = view.render();
  assert.equal(JSON.stringify(view.savedEntry.targets.at(-1)), JSON.stringify({ kind: 'place', id: 'osm:node:1', cityId: 'vancouver' }));
  const button = nodes(tree).find(node => node.type === 'SavedEntryButton');
  assert.equal(button.props.analyticsId, 'save.place');
  button.props.onBeen();
  assert.equal(JSON.stringify(view.routes.at(-1)), JSON.stringify({ pathname: '/places/[id]', params: { id: 'osm:node:1', cityId: 'vancouver' } }), '가 봤어요 opens the place for its review');
  view.savedEntry.state = { saved: true }; view.render(); tree = view.render();
  assert.deepEqual(savedPins(tree), ['Place 1', 'Place 2']);
  map.props.onSelect(map.props.markers[1].id); view.savedEntry.state = { saved: false }; view.render(); tree = view.render();
  assert.deepEqual(savedPins(tree), ['Place 1'], 'unsaving drops the mark without waiting for a reload');
  view.setViewer('member-2'); tree = view.render();
  assert.deepEqual(savedPins(tree), [], 'another account never sees the last person\'s marks');
});

test('M3: 저장 많은 순 orders the list by the server total and every place card carries it', async () => {
  const reads = [], totals = new Map([['osm:node:2', { saverCount: 12 }], ['osm:node:3', { saverCount: 40 }]]);
  const view = mount({ places: [fixturePlace(1), fixturePlace(2), fixturePlace(3)], loadSaves: async (_client, cityId) => { reads.push(cityId); return totals; } });
  let tree = view.render();
  view.readSaves(); await new Promise(setImmediate); tree = view.render();
  assert.deepEqual(reads, ['vancouver'], 'a signed-out visitor reads the totals too');
  const list = () => nodes(tree).find(node => node.type === 'FlatList');
  const card = title => list().props.renderItem({ item: list().props.data.find(item => item.title === title), index: 0 });
  const saves = title => nodes(card(title)).find(node => node.type?.name === 'DiscoveryCard').props.saves;
  assert.deepEqual(listOf(tree), ['Place 1', 'Place 2', 'Place 3'], 'nearest first until someone asks');
  assert.equal(saves('Place 3').saverCount, 40);
  assert.equal(saves('Place 1'), undefined, 'a place nobody saved shows no number');
  const chip = nodes(tree).find(node => node.props?.accessibilityLabel === '저장 많은 순');
  assert.equal(chip.props.analyticsId, 'discovery.current', 'a registered target, so old servers keep the analytics batch');
  assert.equal(chip.props.accessibilityRole, 'button');
  chip.props.onPress(); tree = view.render();
  assert.deepEqual(listOf(tree), ['Place 3', 'Place 2', 'Place 1']);
  assert.equal(nodes(tree).find(node => node.props?.accessibilityLabel === '저장 많은 순').props.selected, true);
  assert.ok(view.feedback.includes('selection'));
  assert.ok(text(tree).includes('저장 많은 순'), 'the summary and the list pill name the order');
  control(tree, '레스토랑').props.onPress(); tree = view.render();
  assert.equal(nodes(tree).find(node => node.props?.accessibilityLabel === '저장 많은 순').props.selected, true, 'picking a category keeps the order');
  const line = view.renderCard({ ...list().props.data[0], source: 'place' }, null, { saverCount: 1234 });
  assert.ok(text(line).includes('저장 1,234명'));
  assert.ok(!text(view.renderCard({ ...list().props.data[0], source: 'place' }, null, { saverCount: 0 })).includes('저장 0명'));
  assert.ok(!text(view.renderCard({ ...list().props.data[0], source: 'place' }, null)).includes('저장'), 'no total, no line');
});

test('M3: an older server, a failed read or an empty city hides the totals and leaves the list as it was', async () => {
  const places = [fixturePlace(1), fixturePlace(2)];
  for (const loadSaves of [async () => null, async () => { throw new Error('offline'); }, async () => new Map()]) {
    const view = mount({ places, loadSaves });
    let tree = view.render();
    view.readSaves(); await new Promise(setImmediate); tree = view.render();
    assert.equal(nodes(tree).find(node => node.props?.accessibilityLabel === '저장 많은 순'), undefined);
    assert.ok(!text(tree).includes('저장 많은 순'));
    assert.ok(text(tree).includes('가까운 순'));
    assert.deepEqual(listOf(tree), ['Place 1', 'Place 2']);
    const list = nodes(tree).find(node => node.type === 'FlatList');
    assert.equal(nodes(list.props.renderItem({ item: list.props.data[0], index: 0 })).find(node => node.type?.name === 'DiscoveryCard').props.saves, undefined);
  }
  let answer = new Map([['osm:node:2', { saverCount: 5 }]]);
  const view = mount({ places, loadSaves: async () => { if (!answer) throw new Error('offline'); return answer; } });
  let tree = view.render();
  view.readSaves(); await new Promise(setImmediate); tree = view.render();
  nodes(tree).find(node => node.props?.accessibilityLabel === '저장 많은 순').props.onPress(); tree = view.render();
  assert.deepEqual(listOf(tree), ['Place 2', 'Place 1']);
  answer = null; view.readSaves(); await new Promise(setImmediate); tree = view.render();
  assert.deepEqual(listOf(tree), ['Place 2', 'Place 1'], 'a failed refresh keeps the last good totals');
  answer = new Map(); view.readSaves(); await new Promise(setImmediate); tree = view.render();
  assert.deepEqual(listOf(tree), ['Place 1', 'Place 2'], 'with no totals left the chosen order falls back to nearest');
});

test('M1: 뜨는 중·인기 show on the pin and the card and filter the list; an older server changes nothing', async () => {
  const places = [fixturePlace(1), fixturePlace(2), fixturePlace(3, { subcategories: ['lunch'] }), fixturePlace(4, { priceLevel: 1 })];
  const totals = new Map([['osm:node:1', { saverCount: 2, status: null }], ['osm:node:2', { saverCount: 12, status: 'popular' }], ['osm:node:3', { saverCount: 4, status: 'trending' }]]);
  const view = mount({ places, loadSaves: async () => totals });
  let tree = view.render();
  view.readSaves(); await new Promise(setImmediate); tree = view.render();
  const pin = (markers, label) => markers.find(marker => marker.label === label);
  const markers = () => Array.from(nodes(tree).find(node => node.type === 'DiscoveryMap').props.markers);
  assert.equal(pin(markers(), 'Place 2').statusColor, discovery.PLACE_STATUS.popular.color);
  assert.ok(pin(markers(), 'Place 2').sublabel.startsWith('인기 · '), 'the second line leads with the state');
  assert.equal(pin(markers(), 'Place 3').statusColor, discovery.PLACE_STATUS.trending.color);
  assert.ok(pin(markers(), 'Place 3').sublabel.startsWith('뜨는 중 · '));
  assert.equal(pin(markers(), 'Place 1').statusColor, undefined, 'a save count alone is no state');
  assert.ok(!pin(markers(), 'Place 1').sublabel.includes('·'));
  const chip = label => nodes(tree).find(node => node.props?.accessibilityLabel === label);
  assert.ok(chip('뜨는 중') && chip('인기'));
  assert.equal(chip('인기').props.analyticsId, 'discovery.subcategory', 'a registered target, so old servers keep the analytics batch');
  assert.ok(chip('인기').props.style.flat().some(style => style?.minHeight === 44), 'a 44pt target');
  chip('인기').props.onPress(); tree = view.render();
  assert.deepEqual(listOf(tree), ['Place 2']);
  assert.deepEqual(markers().map(marker => marker.label), ['Place 2'], 'the pins follow the list');
  assert.equal(chip('인기').props.selected, true);
  assert.ok(view.feedback.includes('selection'));
  chip('인기').props.onPress(); tree = view.render();
  assert.equal(listOf(tree).length, 4, 'pressing it again clears it');
  chip('뜨는 중').props.onPress(); tree = view.render();
  assert.deepEqual(listOf(tree), ['Place 3']);
  const card = view.renderCard(nodes(tree).find(node => node.type === 'FlatList').props.data[0], null, { saverCount: 12, status: 'popular' });
  const line = nodes(card).find(node => node.props?.accessibilityLabel === '인기 · 저장 12명');
  assert.ok(line, 'the word and the total read as one line');
  assert.equal(nodes(line).find(node => node.type === 'View' && node !== line).props.style.flat().at(-1).backgroundColor, discovery.PLACE_STATUS.popular.color, 'the same colour as the pin');

  const unknown = mount({ places, loadSaves: async () => new Map([['osm:node:2', { saverCount: 12, status: null }]]) });
  tree = unknown.render(); unknown.readSaves(); await new Promise(setImmediate); tree = unknown.render();
  assert.equal(chip('인기'), undefined, 'no place has it, so no chip');

  for (const loadSaves of [async () => null, async () => { throw new Error('offline'); }]) {
    const old = mount({ places, loadSaves });
    tree = old.render(); old.readSaves(); await new Promise(setImmediate); tree = old.render();
    assert.equal(chip('인기'), undefined);
    assert.equal(chip('뜨는 중'), undefined);
    assert.ok(markers().every(marker => marker.statusColor === undefined && !marker.sublabel.includes('·')));
    assert.equal(listOf(tree).length, 4);
  }
});

test('M1: an empty result under a state filter offers to clear it, and the choice lapses when the state goes away', async () => {
  const places = [fixturePlace(1), fixturePlace(2, { openingHours: 'Mo-Su off' })];
  let answer = new Map([['osm:node:2', { saverCount: 12, status: 'popular' }]]);
  const view = mount({ places, loadSaves: async () => answer });
  let tree = view.render();
  view.readResults(); view.readSaves(); await new Promise(setImmediate); tree = view.render();
  const chip = label => nodes(tree).find(node => node.props?.accessibilityLabel === label);
  chip('인기').props.onPress(); tree = view.render();
  assert.deepEqual(listOf(tree), ['Place 2']);
  control(tree, '지금 영업 중').props.onPress(); tree = view.render();
  const empty = emptyCards(tree)[0];
  assert.equal(empty.props.title, '인기 있는 곳이 없어요');
  assert.equal(empty.props.actionLabel, '인기 필터 풀기');
  empty.props.onAction(); tree = view.render();
  assert.equal(chip('인기').props.selected, false, 'its action clears the filter');
  control(tree, '지금 영업 중').props.onPress(); chip('인기').props.onPress(); tree = view.render();
  assert.deepEqual(listOf(tree), ['Place 2']);
  answer = new Map(); view.readSaves(); await new Promise(setImmediate); tree = view.render();
  assert.equal(chip('인기'), undefined);
  assert.equal(listOf(tree).length, 2, 'the place lost its state, so the filter stops counting instead of emptying the list');
});

test('M7: the compass starts only on screen after a location fix, feeds the cone and stops when the map leaves', async () => {
  const view = mount();
  let tree = view.render();
  assert.equal(view.readCompass(), undefined, 'no location yet, so no compass');
  assert.equal(nodes(tree).find(node => node.type === 'DiscoveryMap').props.heading, null);
  control(tree, '내 위치로 지도 이동').props.onPress(); await new Promise(setImmediate); tree = view.render();
  const stop = view.readCompass(); await new Promise(setImmediate);
  assert.equal(view.compass.watches.length, 1);
  view.compass.watches[0]({ trueHeading: 181, magHeading: 165, accuracy: 3 }); tree = view.render();
  assert.equal(nodes(tree).find(node => node.type === 'DiscoveryMap').props.heading, 180);
  stop(); tree = view.render();
  assert.equal(view.compass.removed, 1);
  assert.equal(nodes(tree).find(node => node.type === 'DiscoveryMap').props.heading, null, 'leaving drops the cone');
  view.compass.watches[0]({ trueHeading: 90, magHeading: 80, accuracy: 3 }); tree = view.render();
  assert.equal(nodes(tree).find(node => node.type === 'DiscoveryMap').props.heading, null, 'a late reading after leaving is ignored');
  view.setFocused(false); tree = view.render();
  assert.equal(view.readCompass(), undefined, 'a hidden map does not listen');
});

test('M6: the map title opens the existing city picker with feedback', () => {
  const view = mount({ onClose() {} });
  let tree = view.render();
  assert.ok(!nodes(tree).some(node => node.type === 'CityPicker'));
  const title = control(tree, '밴쿠버 지도, 도시 바꾸기');
  assert.equal(title.props.accessibilityRole, 'button');
  assert.equal(title.props.analyticsId, 'discovery.open', 'a target the server already accepts');
  assert.ok(nodes(title).some(node => node.type === 'SymbolView' && node.props.name.ios === 'chevron.down'));
  title.props.onPress(); tree = view.render();
  assert.equal(view.feedback.at(-1), 'selection');
  const picker = nodes(tree).find(node => node.type === 'CityPicker');
  assert.ok(picker, 'the same picker the home screen uses');
  picker.props.onClose(); tree = view.render();
  assert.ok(!nodes(tree).some(node => node.type === 'CityPicker'));
});
