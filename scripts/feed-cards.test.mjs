import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { CITIES } from '../src/lib/mock.ts';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const text = tree => typeof tree === 'string' ? tree : tree && typeof tree === 'object' ? [tree.props?.children].flat(Infinity).map(text).join('') : '';
const cityRow = tree => nodes(tree).find(node => node.type === 'Pressable');
const renderCityRow = (list, item) => {
  const section = list.sections.find(section => section.data.includes(item));
  return list.renderItem({ item, section, index: section.data.indexOf(item) });
};

test('weekly ranking: a thin folded pill under the categories, the expanded heading inside its card', () => {
  for (const [total, expanded] of [[2, false], [5, true], [5, false], [0, false]]) {
    let state = 0;
    const entries = Array.from({ length: total }, (_, i) => ({ postId: `post-${i}`, authorId: 'author', rank: i + 1, title: '동네 소식', nickname: '이웃', views: 10 }));
    const { WeeklyRanking } = load('weekly-ranking', {
      react: { useCallback: fn => fn, useEffect() {}, useRef: current => ({ current }), useState: () => [[{ entries }, expanded, 0, {}, { interpolate: () => '0deg' }][state++], () => {}] },
      'expo-router': { useFocusEffect() {} },
      'react-native': { View: 'View', Pressable: 'Pressable', Animated: { View: 'AnimatedView' }, StyleSheet: { create: x => x } },
      'react-native-reanimated': { useReducedMotion: () => true },
      '@/hooks/use-content-visibility': { useContentVisibility: () => () => false },
      '@/components/gling-loader': { GlingLoader: 'GlingLoader' },
      '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
      '@/lib/community-data': {}, '@/lib/supabase': {}, '@/i18n/ko': { count: String }, '@/components/post-zoom-link': { PostZoomLink: 'PostZoomLink' },
    });
    const tree = WeeklyRanking({ cityId: 'vancouver', onOpen() {} });
    if (!total) { assert.equal(tree, null); continue; }
    const style = node => Object.assign({}, ...[node.props?.style].flat(Infinity).filter(s => s && typeof s === 'object'));
    // Owner 2026-11-03 ("공간낭비"): no outer margins, no stacked card behind the folded line.
    assert.equal(style(tree).marginTop, undefined);
    assert.ok(!nodes(tree).some(n => style(n).position === 'absolute'), 'no stacked card behind the ranking');
    const headings = nodes(tree).filter(n => n.props?.accessibilityRole === 'header');
    assert.equal(headings.length, total < 4 || expanded ? 1 : 0);
    if (total >= 4 && !expanded) {
      const fold = nodes(tree).find(n => n.props?.analyticsId === 'components_weekly-ranking.pressable.1');
      const pill = nodes(fold).find(n => style(n).borderRadius === 999);
      const row = nodes(pill).find(n => style(n).minHeight);
      assert.equal(style(pill).borderWidth, undefined, 'the folded line is a filled pill, not a bordered card');
      assert.equal(row.props.style.flat(Infinity).find(s => s?.minHeight).minHeight + 2 * style(fold).paddingVertical, 44, 'a 36pt pill keeps a 44pt touch area');
      assert.equal(style(fold).marginVertical, -style(fold).paddingVertical, 'the touch area takes no extra layout space');
      continue;
    }
    const card = nodes(tree).find(n => [n.props?.style].flat().some(s => s?.overflow === 'hidden'));
    assert.ok(card);
    for (const heading of headings) {
      assert.ok(nodes(card).includes(heading), 'heading belongs to the ranking card, not the journal intro');
      assert.equal(heading.props.numberOfLines, undefined, 'heading can wrap with larger text');
    }
  }
});

// Owner 2026-11-09 "탑10에서만 조회수 안보이게하는게 중요해 다른글에서는 보이게하고": hidden here (since 11-01), shown on feed cards (post-card-image test).
test('weekly ranking (TOP10) shows no view counts', () => {
  assert.doesNotMatch(fs.readFileSync(new URL('../src/components/weekly-ranking.tsx', import.meta.url), 'utf8'), /\.views\b|조회/);
});

function load(file, imports) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL(`../src/components/${file}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require: withLanguageImports((name) => {
    if (name === '@/lib/behavior-analytics') return { behavior() {}, flushBehavior: async () => {} };
    if (name in imports) return imports[name];
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if ((name === 'react-native' || name === '@/components/analytics-controls')) return { View: 'View', Text: 'Text', TextInput: 'TextInput', SectionList: 'SectionList', KeyboardAvoidingView: 'KeyboardAvoidingView', useWindowDimensions: () => ({ fontScale: 1 }), Platform: { OS: 'ios' }, LayoutAnimation: { configureNext() {}, Presets: { easeInEaseOut: {} } }, Image: 'Image', Pressable: 'Pressable', StyleSheet: { create: value => value, hairlineWidth: 1 } };
    if (name === 'expo-symbols' || name === '@/components/symbol-view') return { SymbolView: 'SymbolView' };
    if (name === '@/components/themed-text') return { ThemedText: 'Text' };
    if (name === '@/components/glass-surface') return { GlassSurface: 'GlassSurface' };
    if (name === '@/constants/theme') return { Spacing: { one: 4, two: 8, three: 16, four: 24 }, Depth: { card: {}, control: {} } };
    if (name === '@/components/clay') return { useClay: () => false, useClayBox: () => false, ClayIcon: ({ name, size, tintColor }) => name ? { type: 'SymbolView', props: { name, size, tintColor } } : null, ClayPillFill: () => null, ClayBoxFill: () => null, ClayCoinFill: () => null, ClayControlFill: () => null, ClayPhoto: () => null };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
    throw new Error(`Unexpected import: ${name}`);
  }) });
  return exports;
}

test('choosing a post city changes only the draft and keeps upcoming cities unavailable', async () => {
  let selected = CITIES[0], closed = 0;
  const { CityPicker } = load('city-picker', {
    react: { useState: () => ['', () => {}] },
    'react-native-reanimated': { useReducedMotion: () => true },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true }) },
    '@/lib/location-provider': { useCommunityLocation: () => ({ enabled: false, ready: true, busy: false, message: '', cityId: null, capture: () => assert.fail('post city must not collect location'), disable() {} }) },
    '@/lib/mock': { CITIES },
    '@/i18n/ko': { t: (await import('../src/i18n/ko.ts')).t },
    '@/lib/community-city': { useCommunityCity: () => ({ city: CITIES[0], saving: false, selectCity: () => assert.fail('post city must not save profile preferences') }) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
  });
  const heading = tree => text(nodes(tree).find(node => node.props?.accessibilityRole === 'header'));
  assert.equal(heading(CityPicker({ onClose() {} })), '지역 선택');
  assert.equal(heading(CityPicker({ onClose() {}, draft: { city: selected, onSelect() {} } })), '게시 지역');
  const render = () => CityPicker({ title: '활동 도시', onClose: () => { closed++; }, draft: { city: selected, onSelect: city => { selected = city; } } });
  assert.equal(heading(render()), '활동 도시', 'an activity-city caller can name the sheet without changing draft selection behavior');
  const list = () => nodes(render()).find(node => node.type === 'SectionList').props;
  const toronto = CITIES.find(city => city.id === 'toronto');
  await cityRow(renderCityRow(list(), toronto)).props.onPress();
  assert.equal(selected.id, 'toronto');
  assert.equal(closed, 1);
  assert.equal(cityRow(renderCityRow(list(), toronto)).props.accessibilityState.selected, true);
  assert.match(text(list().ListFooterComponent), /이 글/);
  assert.doesNotMatch(text(list().ListFooterComponent), /프로필에 저장/);
  await cityRow(renderCityRow(list(), CITIES.find(city => city.state === 'soon'))).props.onPress();
  assert.equal(selected.id, 'toronto');
  assert.equal(closed, 1);
});

test('location collection requires the visible disclosure and a separate consent action', async () => {
  let open = false, captures = 0, selected = null, manual = 0, received = null;
  const fix = { userId: 'member' };
  const location = { ready: true, enabled: false, busy: false, cityId: 'vancouver', message: '',
    capture: async () => { captures++; return fix; }, disable() {} };
  const { NearbyCityCard } = load('nearby-city-card', {
    react: { useState: () => [open, next => { open = typeof next === 'function' ? next(open) : next; }], useRef: () => ({ current: true }), useEffect() {} },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
    '@/lib/location-provider': { useCommunityLocation: () => location },
    '@/lib/mock': { CITIES: [{ id: 'vancouver', name: '밴쿠버' }] },
    '@/components/disclosure': { animateLayout() {} }, 'react-native-reanimated': { useReducedMotion: () => true },
  });
  const render = () => NearbyCityCard({ onSelect: id => { selected = id; }, onChooseCity: () => { manual++; }, onFix: value => { received = value; } });
  const button = (tree, label) => nodes(tree).find(node => node.type === 'Pressable' && text(node) === label);
  let tree = render();
  assert.doesNotMatch(text(tree), /30일/);
  button(tree, '직접 선택').props.onPress();
  assert.equal(manual, 1);
  assert.equal(captures, 0);
  button(tree, '내 위치로 찾기').props.onPress();
  tree = render();
  assert.equal(captures, 0, 'opening the location explanation must not request permission or collect coordinates');
  assert.match(text(tree), /30일/);
  assert.match(text(tree), /권한 있는 관리자/);
  assert.match(text(tree), /선호 지역이 우선/);
  const disclosure = nodes(tree).find(node => node.props?.accessibilityLabel === '위치 이용 안내');
  assert.equal(disclosure.props.accessibilityState.expanded, true);
  button(tree, '동의하고 찾기').props.onPress();
  await Promise.resolve();
  assert.equal(captures, 1);
  assert.equal(received, fix);
  assert.equal(selected, null, 'a GPS recommendation must not silently change the saved city');
  button(tree, '밴쿠버 소식 보기').props.onPress();
  assert.equal(selected, 'vancouver');
  location.busy = true;
  assert.equal(button(render(), '위치 확인 중…').props.disabled, true);
  location.busy = false;
  location.enabled = true;
  disclosure.props.onPress();
  assert.equal(open, false);
  button(render(), '위치 다시 확인').props.onPress();
  await Promise.resolve();
  assert.equal(captures, 2, 'previously enabled sharing can refresh without another disclosure step');
});

test('city picker searches Canadian cities and keeps upcoming cities and the US tab disabled', async () => {
  let query = '', selected = null, closed = 0;
  const { CityPicker } = load('city-picker', {
    react: { useState: init => init === '' ? [query, next => { query = next; }] : [false, () => {}] },
    'react-native-reanimated': { useReducedMotion: () => true },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true }) },
    '@/lib/location-provider': { useCommunityLocation: () => ({ enabled: false, ready: true, busy: false, message: '', cityId: null, capture: async () => null, disable() {} }) },
    '@/lib/mock': { CITIES },
    '@/i18n/ko': { t: (await import('../src/i18n/ko.ts')).t },
    '@/lib/community-city': { useCommunityCity: () => ({ city: CITIES[0], saving: false, selectCity: async city => { selected = city.id; return true; } }) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
  });
  const render = () => CityPicker({ onClose: () => { closed++; } });
  const list = () => nodes(render()).find(node => node.type === 'SectionList').props;
  assert.deepEqual(Array.from(list().sections, section => section.data.map(city => city.id)), [
    ['montreal', 'toronto', 'vancouver'],
    ['calgary', 'edmonton', 'halifax', 'ottawa', 'regina', 'saint-john', 'saskatoon', 'winnipeg'],
  ]);
  assert.ok(CITIES.some(city => city.id === 'seoul'), 'Seoul stays in the shared city data; only the picker leaves it out (QA Q10)');
  assert.equal(nodes(render()).some(node => node.props?.accessibilityRole === 'tab'), false, 'no country tabs');
  for (const [id, province] of Object.entries({ ottawa: 'ON', winnipeg: 'MB', regina: 'SK', 'saint-john': 'NB', halifax: 'NS' })) {
    const city = CITIES.find(city => city.id === id);
    assert.equal(city.province, province);
    assert.equal(city.state, 'soon');
    const row = cityRow(renderCityRow(list(), city));
    assert.equal(row.props.disabled, true);
    assert.equal(row.props.accessibilityState.disabled, true);
    await row.props.onPress();
    assert.equal(selected, null);
    assert.equal(closed, 0);
  }
  for (const [search, ids] of [[' Ottawa ', ['ottawa']], ['ON', ['toronto', 'ottawa']], ['NB', ['saint-john']], ['세인트존스', ['saint-john']], ['에드먼턴', ['edmonton']], ['NS', ['halifax']], ['서울', []], ['KR', []], ['missing-city', []]]) {
    nodes(render()).find(node => node.type === 'TextInput').props.onChangeText(search);
    assert.deepEqual(Array.from(list().sections).flatMap(section => section.data.map(city => city.id)), ids);
  }
  assert.equal(text(list().ListEmptyComponent), '일치하는 도시가 없어요.');
  nodes(render()).find(node => node.props?.accessibilityLabel === '도시 검색 지우기').props.onPress();
  assert.equal(query, '');
  assert.equal(cityRow(renderCityRow(list(), CITIES[0])).props.accessibilityState.selected, true);
  await cityRow(renderCityRow(list(), CITIES[1])).props.onPress();
  assert.equal(selected, 'toronto');
  assert.equal(closed, 1);
  let picked = 0;
  await cityRow(renderCityRow(nodes(CityPicker({ onClose() {}, onPicked: () => { picked++; } })).find(node => node.type === 'SectionList').props, CITIES[1])).props.onPress();
  assert.equal(picked, 1, 'a saved pick is reported so the start guide can count it (QA Q17)');
});

test('a city picked from the top city button checks off 내 도시 고르기 once and never reopens a hidden guide (QA Q17)', () => {
  let guide = { hidden: false, done: [] }, at = 0;
  const saved = [], refs = [];
  const { StartGuide } = load('start-guide', {
    react: { useState: initial => initial === null ? [guide, next => { guide = next; }] : [false, () => {}], useCallback: fn => fn, useEffect: fn => fn(), useRef: initial => (refs[at++] ??= { current: initial }) },
    'expo-router': { useFocusEffect() {} },
    '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async () => null, setItem: async (_key, value) => { saved.push(JSON.parse(value)); } } },
    'react-native-reanimated': { useReducedMotion: () => true }, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/components/disclosure': { animateLayout() {} }, '@/components/state-card': { PopIn: 'PopIn' },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
  });
  const render = cityPicks => { at = 0; return StartGuide({ cityName: '토론토', cityPicks, onPickCity() {}, onOpenMeetups() {} }); };
  render(0);
  assert.deepEqual([...guide.done], [], 'opening the home screen alone does not count');
  render(1);
  assert.deepEqual([...guide.done], ['city']);
  render(1);
  assert.equal(saved.length, 1, 'the same pick is counted once');
  guide = { hidden: true, done: [] };
  render(2);
  assert.equal(guide.hidden, true, 'a guide the member hid stays hidden');
  assert.equal(saved.length, 1);
});

test('returning from system settings or a permission sheet checks feed ad permission again', () => {
  const listeners = {}, cleanups = [];
  let cleared = 0, revision = 0, removed = 0;
  const { FeedAd } = load('feed-ad', {
    react: {
      useState: initial => [initial, initial === 0 ? next => { revision = next(revision); } : next => { assert.equal(next, null); cleared++; }],
      useEffect: effect => { cleanups.push(effect()); },
    },
    'react-native': {
      AppState: { addEventListener: (_, handler) => { listeners.activity = handler; return { remove: () => { removed++; } }; } },
      DeviceEventEmitter: { addListener: (_, handler) => { listeners.privacy = handler; return { remove: () => { removed++; } }; } },
      StyleSheet: { create: value => value, hairlineWidth: 1 },
    },
    '@/lib/ads': { prepareAds: async () => null },
  });
  assert.equal(FeedAd(), null);
  listeners.activity('inactive');
  assert.equal(revision, 0);
  listeners.activity('active');
  assert.equal(revision, 1, 'ads deferred while another permission sheet was open must retry');
  listeners.activity('background');
  listeners.activity('inactive');
  listeners.activity('active');
  assert.equal(revision, 2);
  assert.equal(cleared, 2);
  listeners.privacy();
  assert.equal(revision, 3);
  for (const cleanup of cleanups) cleanup?.();
  assert.equal(removed, 2);
});

test('native ads keep attribution and required assets inside an uninset native view', () => {
  const sdk = { NativeAdView: 'NativeAdView', NativeAsset: 'NativeAsset', NativeMediaView: 'NativeMediaView',
    NativeAssetType: { HEADLINE: 'headline', BODY: 'body', ICON: 'icon', ADVERTISER: 'advertiser', CALL_TO_ACTION: 'callToAction' } };
  const ad = { headline: 'Test headline', body: 'Test body', advertiser: 'Test advertiser', callToAction: 'Install', icon: { url: 'https://example.com/icon.png' } };
  const { FeedAd } = load('feed-ad', {
    react: { useState: initial => [initial === 0 ? 0 : { ad, sdk }, () => {}], useEffect() {} },
    '@/lib/ads': {},
  });
  const native = nodes(FeedAd()).find(node => node.type === 'NativeAdView');
  assert.ok(native);
  assert.equal(native.props.style, undefined, 'Fabric native content view must not be inset by padding or borders');
  const content = nodes(native);
  assert.equal(text(content.find(node => node.type === 'Text')), 'Ad');
  assert.equal(content.find(node => node.type === 'Text').props.accessibilityLabel, '광고');
  assert.deepEqual(content.filter(node => node.type === 'NativeAsset').map(node => node.props.assetType).sort(), ['advertiser', 'body', 'callToAction', 'headline', 'icon']);
  assert.equal(content.filter(node => node.type === 'NativeMediaView').length, 1);
  assert.equal(content.filter(node => node.type === 'Pressable').length, 0, 'SDK assets handle ad clicks, not a whole-card click target');
});

test('city picker location row discloses before collecting and hides in the post-city sheet', async () => {
  let open = false, captures = 0;
  const location = { enabled: false, ready: true, busy: false, message: '', cityId: null, capture: async () => { captures++; location.cityId = 'toronto'; return { latitude: 43.6, longitude: -79.4, accuracy: 20, measuredAt: Date.now(), mocked: false, userId: 'me' }; }, disable() {} };
  const auth = { isAuthed: true };
  const { CityPicker } = load('city-picker', {
    react: { useState: init => init === '' ? ['', () => {}] : [open, next => { open = next; }] },
    'react-native-reanimated': { useReducedMotion: () => true },
    '@/lib/auth': { useAuth: () => auth },
    '@/lib/location-provider': { useCommunityLocation: () => location },
    '@/lib/mock': { CITIES },
    '@/i18n/ko': { t: (await import('../src/i18n/ko.ts')).t },
    '@/lib/community-city': { useCommunityCity: () => ({ city: CITIES[0], saving: false, selectCity: async () => true }) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
  });
  const list = props => nodes(CityPicker(props)).find(node => node.type === 'SectionList').props;
  assert.equal(list({ onClose() {}, draft: { city: CITIES[0], onSelect() {} } }).ListHeaderComponent, undefined, 'the post-city sheet must not offer GPS lookup');
  auth.isAuthed = false;
  assert.equal(list({ onClose() {} }).ListHeaderComponent, undefined, 'signed-out members see no GPS row');
  auth.isAuthed = true;
  const row = () => nodes(list({ onClose() {} }).ListHeaderComponent).find(node => node.props?.analyticsId === 'components_city-picker.pressable.5');
  assert.equal(row().props.accessibilityLabel, '내 위치로 찾기');
  assert.equal(text(row()), '내 위치로 찾기GPS로 가까운 도시를 한 번만 확인해요');
  row().props.onPress();
  assert.equal(open, true);
  assert.equal(captures, 0, 'opening the disclosure must not request permission or collect coordinates');
  assert.match(text(list({ onClose() {} }).ListHeaderComponent), /30일 보관/);
  assert.equal(text(row()).startsWith('동의하고 찾기'), true);
  assert.equal(row().props.accessibilityLabel, '동의하고 찾기', 'the button is read by the words it shows (QA Q11)');
  await row().props.onPress();
  assert.equal(captures, 1);
  const toronto = renderCityRow(list({ onClose() {} }), CITIES.find(city => city.id === 'toronto'));
  assert.match(text(toronto), /가까움/);
  location.enabled = true; open = false;
  assert.equal(text(row()).startsWith('위치 다시 확인'), true);
});

test('an open sheet closes when a link or push changes the screen, unless it is saving (QA Q08)', () => {
  let listener = null, closed = 0;
  const { DragSheet } = load('drag-sheet', {
    react: { useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useRef: current => ({ current }), useEffect: fn => { fn(); }, useLayoutEffect() {} },
    'react-native': { Animated: { Value: class { setValue() {} stopAnimation() {} }, View: 'AnimatedView', parallel: () => ({ start() {} }), spring: () => ({}), timing: () => ({ start() {} }) },
      Easing: { in: value => value, cubic: 0 }, KeyboardAvoidingView: 'KeyboardAvoidingView', Modal: 'Modal', PanResponder: { create: () => ({ panHandlers: {} }) },
      Platform: { OS: 'ios' }, StyleSheet: { create: value => value, absoluteFill: {}, hairlineWidth: 1 }, useWindowDimensions: () => ({ height: 800 }), View: 'View' },
    'react-native-reanimated': { useReducedMotion: () => true }, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
    '@/lib/link-open': { onLinkOpen: close => { listener = close; return () => { listener = null; }; } },
  });
  const sheet = props => { listener = null; DragSheet({ onClose: () => { closed++; }, children: null, ...props }); };
  sheet({ visible: true });
  listener();
  assert.equal(closed, 1);
  sheet({ visible: true, dismissible: false });
  listener();
  assert.equal(closed, 1, 'a sheet that is saving stays open');
  sheet({ visible: false });
  assert.equal(listener, null, 'a closed sheet does not listen');
});

test('a chosen chip cut at the edge or off screen scrolls fully into view; a visible one stays put (QA Q07)', async () => {
  const { revealOffset } = await import('../src/hooks/use-reveal-chip.ts');
  // Row 390 wide, content 900, chips are [x, width].
  assert.equal(revealOffset(0, 390, 900, 100, 80), 0, 'already visible');
  assert.equal(revealOffset(0, 390, 900, 340, 90), 340 + 90 + 24 - 390, 'cut at the right edge: the chip and a peek of the next');
  assert.equal(revealOffset(0, 390, 900, 820, 76), 900 - 390, 'off screen at the end: stops at the content end');
  assert.equal(revealOffset(400, 390, 900, 10, 60), 0, 'off screen to the left: back to the start');
  assert.equal(revealOffset(0, 390, 300, 200, 60), 0, 'a row that fits never scrolls');
});
