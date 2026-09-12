import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

import { MEMBERSHIP_LIMITS } from '../src/lib/membership.ts';

test('membership opens checkout immediately and preserves quota and purchase safeguards', () => {
  let states = [], cursor = 0, restored = 0, purchased = 0;
  const value = { membership: { tier: 'free', postsUsed: 0, postLimit: 1 }, offers: [], loading: false,
    offersLoading: false, busy: false, purchaseUnavailableReason: null,
    refresh() {}, restore() { restored++; }, manage() {}, purchase() { purchased++; } };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/app/profile/membership.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, process: { env: {} }, require(name) {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react') return { useCallback: fn => fn, useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
    } };
    if (name === 'expo-router') return { useFocusEffect() {}, useRouter: () => ({ canGoBack: () => false, replace() {} }) };
    if (name === 'expo-symbols') return { SymbolView: 'SymbolView' };
    if (name === 'react-native') return { View: 'View', ScrollView: 'ScrollView', Pressable: 'Pressable', StyleSheet: { create: styles => styles } };
    if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
    if (name === '@/components/login-panel') return { LoginPanel: 'LoginPanel' };
    if (name === '@/components/relationship-slot-card') return { RelationshipSlotCard: 'RelationshipSlotCard' };
    if (name === '@/components/themed-text') return { ThemedText: 'Text' };
    if (name === '@/components/themed-view') return { ThemedView: 'View' };
    if (name === '@/constants/theme') return { Spacing: { one: 4, two: 8, three: 16, five: 32 }, MaxContentWidth: 800 };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
    if (name === '@/lib/auth') return { useAuth: () => ({ isAuthed: true }) };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play() {} }) };
    if (name === '@/lib/membership') return { MEMBERSHIP_LIMITS };
    if (name === '@/lib/membership-provider') return { useMembership: () => value };
    throw new Error(`Unexpected import: ${name}`);
  } });
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
  const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : tree && typeof tree === 'object' ? [tree.props?.children].flat(Infinity).map(text).join('') : '';
  const render = () => { cursor = 0; return exports.default(); };
  const button = (tree, label) => nodes(tree).find(node => node.type === 'Pressable' && text(node) === label);
  let tree = render();
  assert.equal(nodes(tree).filter(node => node.type === 'RelationshipSlotCard').length, 2);
  assert.match(text(tree), /1편 남음/);
  assert.doesNotMatch(text(tree), /처음 요청한 사람/);
  assert.equal(button(tree, '구독 준비 중').props.disabled, true, 'checkout is visible immediately but requires a store offer');
  assert.equal(button(tree, '자리 사용 · 24시간 잠금 안내').props.accessibilityState.expanded, false);
  assert.equal(button(tree, '자리 사용 · 24시간 잠금 안내').props['aria-expanded'], false);
  button(tree, '자리 사용 · 24시간 잠금 안내').props.onPress();
  tree = render();
  assert.equal(button(tree, '자리 사용 · 24시간 잠금 안내').props.accessibilityState.expanded, true);
  assert.equal(button(tree, '자리 사용 · 24시간 잠금 안내').props['aria-expanded'], true);
  assert.match(text(tree), /처음 요청한 사람의 자리만 24시간/);
  button(tree, '자리 사용 · 24시간 잠금 안내').props.onPress();
  assert.doesNotMatch(text(render()), /처음 요청한 사람/);
  button(tree, '멤버십 비교베이직 · 플러스 · 프리미엄').props.onPress();
  tree = render();
  assert.doesNotMatch(text(tree), /구독 준비 중/);
  button(tree, '멤버십 비교베이직 · 플러스 · 프리미엄').props.onPress();
  tree = render();
  assert.equal(button(tree, '구독 준비 중').props.disabled, true);
  button(tree, '구매 복원').props.onPress();
  assert.equal(restored, 1);
  for (const [postsUsed, postLimit, expected] of [[1, 1, '0편 남음'], [5, 2, '0편 남음'], [2, 5, '3편 남음']]) {
    value.membership = { tier: 'free', postsUsed, postLimit };
    assert.ok(text(render()).includes(expected));
  }
  for (const membership of [null, {}, { postsUsed: -1, postLimit: 1 }, { postsUsed: 0, postLimit: 0 }]) {
    value.membership = membership;
    assert.ok(nodes(render()).some(node => node.props?.accessibilityLabel === '오늘 글 작성, 확인 필요'));
  }
  value.membership = { tier: 'free', postsUsed: 0, postLimit: 1 };
  value.offers = [{ tier: 'premium', period: 'month', productId: 'premium_monthly', price: 'CA$19.99' }];
  value.purchaseUnavailableReason = '아직 준비 중';
  assert.equal(button(render(), '프리미엄 구독하기').props.disabled, true);
  value.purchaseUnavailableReason = null;
  assert.equal(button(render(), '프리미엄 구독하기').props.disabled, false);
  button(render(), '프리미엄 구독하기').props.onPress();
  assert.equal(purchased, 1);
});
