import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { CITIES } from '../src/lib/mock.ts';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const text = tree => typeof tree === 'string' ? tree : tree && typeof tree === 'object' ? [tree.props?.children].flat(Infinity).map(text).join('') : '';
function load(file, imports) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL(`../src/components/${file}.tsx`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require(name) {
    if (name in imports) return imports[name];
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react-native') return { View: 'View', Text: 'Text', TextInput: 'TextInput', SectionList: 'SectionList', KeyboardAvoidingView: 'KeyboardAvoidingView', useWindowDimensions: () => ({ fontScale: 1 }), Platform: { OS: 'ios' }, Image: 'Image', Pressable: 'Pressable', StyleSheet: { create: value => value, hairlineWidth: 1 } };
    if (name === 'expo-symbols') return { SymbolView: 'SymbolView' };
    if (name === '@/components/themed-text') return { ThemedText: 'Text' };
    if (name === '@/constants/theme') return { Spacing: { one: 4, two: 8, three: 16, four: 24 } };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
    throw new Error(`Unexpected import: ${name}`);
  } });
  return exports;
}

test('location collection requires the visible disclosure and a separate consent action', async () => {
  let open = false, captures = 0, selected = null, manual = 0, received = null;
  const fix = { userId: 'member' };
  const location = { ready: true, enabled: false, busy: false, cityId: 'vancouver', message: '',
    capture: async () => { captures++; return fix; }, disable() {} };
  const { NearbyCityCard } = load('nearby-city-card', {
    react: { useState: () => [open, next => { open = typeof next === 'function' ? next(open) : next; }], useRef: () => ({ current: true }), useEffect() {} },
    '@/lib/location-provider': { useCommunityLocation: () => location },
    '@/lib/mock': { CITIES: [{ id: 'vancouver', name: '밴쿠버' }] },
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
    react: { useState: () => [query, next => { query = next; }] },
    '@/lib/mock': { CITIES },
    '@/i18n/ko': { t: (await import('../src/i18n/ko.ts')).t },
    '@/lib/community-city': { useCommunityCity: () => ({ city: CITIES[0], saving: false, selectCity: async city => { selected = city.id; return true; } }) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) },
  });
  const render = () => CityPicker({ onClose: () => { closed++; } });
  const list = () => nodes(render()).find(node => node.type === 'SectionList').props;
  assert.deepEqual(Array.from(list().sections, section => section.data.length), [2, 9]);
  for (const [id, province] of Object.entries({ ottawa: 'ON', edmonton: 'AB', regina: 'SK', 'saint-john': 'NB', halifax: 'NS' })) {
    const city = CITIES.find(city => city.id === id);
    assert.equal(city.province, province);
    assert.equal(city.state, 'soon');
    const row = list().renderItem({ item: city });
    assert.equal(row.props.disabled, true);
    assert.equal(row.props.accessibilityState.disabled, true);
    await row.props.onPress();
    assert.equal(selected, null);
    assert.equal(closed, 0);
  }
  const usa = nodes(render()).find(node => node.props?.accessibilityLabel === '미국, 준비 중');
  assert.equal(usa.props.disabled, true);
  assert.equal(usa.props.accessibilityState.disabled, true);
  for (const [search, ids] of [[' Ottawa ', ['ottawa']], ['ON', ['toronto', 'ottawa']], ['NB', ['saint-john']], ['세인트존스', ['saint-john']], ['에드먼턴', ['edmonton']], ['NS', ['halifax']], ['missing-city', []]]) {
    nodes(render()).find(node => node.type === 'TextInput').props.onChangeText(search);
    assert.deepEqual(Array.from(list().sections).flatMap(section => section.data.map(city => city.id)), ids);
  }
  assert.equal(text(list().ListEmptyComponent), '일치하는 도시가 없어요.');
  nodes(render()).find(node => node.props?.accessibilityLabel === '도시 검색 지우기').props.onPress();
  assert.equal(query, '');
  assert.equal(list().renderItem({ item: CITIES[0] }).props.accessibilityState.selected, true);
  await list().renderItem({ item: CITIES[1] }).props.onPress();
  assert.equal(selected, 'toronto');
  assert.equal(closed, 1);
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
