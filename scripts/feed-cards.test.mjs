import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

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
    if (name === 'react-native') return { View: 'View', Text: 'Text', Image: 'Image', Pressable: 'Pressable', StyleSheet: { create: value => value, hairlineWidth: 1 } };
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
