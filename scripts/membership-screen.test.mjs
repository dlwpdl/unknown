import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

import { t } from '../src/i18n/ko.ts';
import { MEMBERSHIP_LIMITS, GENERAL_BUMP_HOURS, BUSINESS_LIMITS } from '../src/lib/membership.ts';

test('membership keeps stories and direct chat free while preserving meetup and listing plans', () => {
  let states = [], cursor = 0, restored = 0, confirmed = 0, feedback = 0, confirmation, reducedMotion = false;
  const purchases = [];
  class AnimatedValue {
    constructor(value) { this.value = value; }
    setValue(value) { this.value = value; }
    interpolate({ outputRange }) { return outputRange[0] + this.value * (outputRange[1] - outputRange[0]); }
  }
  const value = { membership: { tier: 'free', billingPolicyVersion:2, postsUsed: 0, postLimit: 1 }, offers: [], loading: false,
    offersLoading: false, busy: false, purchaseUnavailableReason: null,
    pendingApproval: false, confirmPendingCancellation() { confirmed++; },
    refresh() {}, restore() { restored++; }, manage() {}, purchase(offer) { purchases.push(offer); } };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/app/profile/membership.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, process: { env: {} }, require: withLanguageImports((name) => {
    if (name === '@/lib/behavior-analytics') return { behavior() {}, flushBehavior: async () => {} };
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react') return { useCallback: fn => fn, useEffect() {}, useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
    } };
    if (name === 'expo-router') return { useFocusEffect() {}, useRouter: () => ({ canGoBack: () => false, replace() {} }) };
    if (name === 'expo-symbols') return { SymbolView: 'SymbolView' };
    if (name === 'react-native-reanimated') return { useReducedMotion: () => reducedMotion };
    if ((name === 'react-native' || name === '@/components/analytics-controls')) return { View: 'View', ScrollView: 'ScrollView', Pressable: 'Pressable', Alert: { alert: (...args) => { confirmation = args; } }, Animated: { Value: AnimatedValue, View: 'View', timing: (value, options) => ({ start() { value.setValue(options.toValue); } }) }, StyleSheet: { create: styles => styles } };
    if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
    if (name === '@/components/login-panel') return { LoginPanel: 'LoginPanel' };
    if (name === '@/components/gling-loader') return { GlingLoader: 'GlingLoader' };
    if (name === '@/components/relationship-slot-card') return { RelationshipSlotCard: 'RelationshipSlotCard' };
    if (name === '@/components/meetup-policy-notice') return { MeetupPolicyNotice: 'MeetupPolicyNotice' };
    if (name === '@/components/notice-blocks') return { InfoNote: 'InfoNote' };
    if (name === '@/components/themed-text') return { ThemedText: 'Text' };
    if (name === '@/components/themed-view') return { ThemedView: 'View' };
    if (name === '@/constants/theme') return { Spacing: { one: 4, two: 8, three: 16, five: 32 }, MaxContentWidth: 800, Depth: { card: {}, control: {} } };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
    if (name === '@/i18n/ko') return { t };
    if (name === '@/lib/auth') return { useAuth: () => ({ isAuthed: true, me:{id:'member'} }) };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play() { feedback++; } }) };
    if (name === '@/lib/membership') return { MEMBERSHIP_LIMITS, GENERAL_BUMP_HOURS, BUSINESS_LIMITS };
    if (name === '@/lib/merchant-workspace') return {loadMyMerchants:async()=>[]};
    if (name === '@/lib/supabase') return {supabase:{rpc:async()=>({data:null})}};
    if (name === '@/lib/membership-provider') return { useMembership: () => value };
    throw new Error(`Unexpected import: ${name}`);
  }) });
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
  const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree) : tree && typeof tree === 'object' ? [tree.props?.children].flat(Infinity).map(text).join('') : '';
  const render = () => { cursor = 0; return exports.default(); };
  const button = (tree, label) => nodes(tree).find(node => node.type === 'Pressable' && text(node) === label);
  const planOrder = tree => nodes(tree).filter(node => node.props?.analyticsId === 'app_profile_membership.pressable.4').map(node => text(node).match(/^(플러스|프로|프리미엄)/)[0]);
  let tree = render();
  assert.deepEqual(planOrder(tree), ['플러스', '프로', '프리미엄'], 'general plans follow Basic, Plus, Pro, Premium');
  for (const [name, benefit] of [['플러스', '모임 템플릿 · 질문 재사용'], ['프로', '템플릿 · 반복 회차 · 대기 명단 · 공동 호스트'], ['프리미엄', 'Pro 모임 도구 · 신청·참석 통계']]) {
    const card = nodes(tree).find(node => node.props?.analyticsId === 'app_profile_membership.pressable.4' && text(node).startsWith(name));
    assert.ok(text(card).includes(benefit), `${name} explains its meetup tools`);
  }
  assert.ok(button(tree,'일반'));
  assert.ok(button(tree,'비즈니스'));
  assert.equal(nodes(tree).filter(node => node.type === 'RelationshipSlotCard').length, 1);
  assert.doesNotMatch(text(tree), /1:1 대화무료·무제한/);
  assert.match(text(tree), /오늘 이야기 글횟수 제한 없음/);
  assert.doesNotMatch(text(tree), /처음 요청한 사람/);
  assert.equal(button(tree, '구독 준비 중').props.disabled, true, 'checkout is visible immediately but requires a store offer');
  for (const summary of ['오늘 글 무제한 · 동시 모임 3개', '오늘 글 무제한 · 동시 모임 5개', '오늘 글 무제한 · 동시 모임 10개', '오늘 글 무제한 · 동시 모임 20개']) {
    assert.ok(text(tree).includes(summary), summary);
  }
  for (const [name, capacity, hours] of [['베이직 · 무료', 5, 48], ['플러스', 10, 36], ['프로',20,30], ['프리미엄', 20, 24]]) {
    const card = nodes(tree).find(node => text(node).startsWith(name) && (node.type === 'View' || node.props?.accessibilityRole === 'radio'));
    assert.ok(text(card).includes(`살아있는 구해요·팔아요 글 ${capacity}개 · 끌어올리기 ${hours}시간 간격`), `${name} must show its live listing capacity and bump interval`);
  }
  button(render(),'비즈니스').props.onPress();
  assert.deepEqual(planOrder(render()), ['플러스', '프로', '프리미엄'], 'business plans follow Basic, Plus, Pro, Premium');
  for (const [name, every] of [['플러스','2일'], ['프로','1일'], ['프리미엄','12시간']]) {
    const card = nodes(render()).find(node => node.props?.accessibilityRole === 'radio' && text(node).startsWith(name));
    assert.match(text(card), new RegExp(`끌어올리기 ${every}에 한 번 · 모든 글 합쳐서`), `${name} displays its own business bump interval`);
  }
  assert.match(text(render()),/월 신규 1편/);
  assert.match(text(render()),/월 신규 30편끌어올리기 12시간에 한 번/);
  assert.match(text(render()),/신규 4편 · 끌어올리기 8회 · 월간 보고서 1회/);
  assert.equal(nodes(render()).filter(node=>node.type==='RelationshipSlotCard').length,0);
  assert.equal(button(render(),'구독 준비 중').props.disabled,true,'unverified business cannot purchase');
  value.membership.businessSubscription = { tier:'free', merchantId:'bound-business' };
  assert.match(text(render()), /결제 연결은 다른 비즈니스에 묶여 있어요/, 'an expired or pending business binding must remain visible');
  delete value.membership.businessSubscription;
  value.error = '업체 결제 확인 실패'; value.notice = '복원 확인 중'; value.pendingApproval = true;
  assert.match(text(render()), /업체 결제 확인 실패/);
  assert.match(text(render()), /복원 확인 중/);
  assert.ok(button(render(),'스토어에서 대기 구매 취소·거절을 확인했어요'),'business approval pending must retain the same recovery controls');
  value.error = null; value.notice = null; value.pendingApproval = false;
  button(render(),'일반').props.onPress();
  assert.deepEqual(planOrder(render()), ['플러스', '프로', '프리미엄'], 'switching families preserves ascending general ordering');
  assert.match(t.write.listingNote, /14일 뒤 자동 마감/);
  for (const copy of [t.write.listingNote, t.actionErrors.BUMP_COOLDOWN.body]) {
    assert.match(copy, /베이직은 48시간·플러스는 36시간·프로는 30시간·프리미엄은 24시간/);
    assert.doesNotMatch(copy, /하루에 한 번/);
  }
  assert.match(text(tree), /자리가 잠기지 않아요/, 'usage rules stay visible as tiles, no accordion');
  assert.match(text(tree), /24시간 안에 3번째부터 12시간 참여 제한/);
  assert.doesNotMatch(text(render()), /처음 요청한 사람/);
  button(tree, '멤버십 비교베이직 · 플러스 · 프로 · 프리미엄').props.onPress();
  tree = render();
  assert.doesNotMatch(text(tree), /구독 준비 중/);
  button(tree, '멤버십 비교베이직 · 플러스 · 프로 · 프리미엄').props.onPress();
  tree = render();
  assert.equal(button(tree, '구독 준비 중').props.disabled, true);
  button(tree, '구매 복원').props.onPress();
  assert.equal(restored, 1);
  value.membership = { tier: 'free', billingPolicyVersion:2, postsUsed: 100, postLimit: 1 };
  assert.match(text(render()), /오늘 이야기 글횟수 제한 없음/);
  value.membership = { tier: 'free', billingPolicyVersion:2, postsUsed: 0, postLimit: 1 };
  const monthly = { tier: 'premium', kind: 'general', planVersion: 2, period: 'month', productId: 'premium_monthly', price: 'CA$19.99' };
  // Synthetic eligible annual offer tests screen behavior, not a configured or purchasable store SKU.
  const annual = { id: 'annual-ui-fixture', tier: 'premium', kind: 'general', planVersion: 2, period: 'year', productId: 'annual-ui-fixture', price: 'CA$199.99' };
  value.offers = [monthly, annual];
  tree = render();
  const periodButtons = tree => nodes(tree).filter(node => node.props?.analyticsId === 'app_profile_membership.pressable.5');
  assert.deepEqual(periodButtons(tree).map(text), ['연 구독', '월 구독']);
  assert.equal(button(tree, '연 구독').props.accessibilityState.checked, true);
  assert.equal(button(tree, '월 구독').props.accessibilityState.checked, false);
  assert.ok(nodes(tree).some(node => node.props?.analyticsId === 'app_profile_membership.pressable.4' && node.props.accessibilityState.checked && text(node).startsWith('프리미엄')), 'The existing default tier stays Premium.');
  assert.match(text(tree), /프리미엄 · CA\$199\.99 \/ 년/);
  assert.match(text(tree), /매년 CA\$199\.99이 청구되며 자동 갱신/);
  nodes(tree).find(node => node.props?.onLayout).props.onLayout({ nativeEvent: { layout: { width: 300 } } });
  const indicator = tree => nodes(tree).find(node => node.props?.pointerEvents === 'none').props.style[1].transform[0].translateX;
  assert.equal(indicator(render()), 0, 'The initial highlight sits beneath the first, annual option.');
  button(render(), '프리미엄 구독하기').props.onPress();
  assert.equal(purchases.at(-1), annual);
  button(render(), '월 구독').props.onPress();
  tree = render();
  assert.equal(button(tree, '월 구독').props.accessibilityState.checked, true);
  assert.ok(indicator(tree) > 0, 'Monthly selection moves the highlight to the second option.');
  assert.match(text(tree), /프리미엄 · CA\$19\.99 \/ 월/);
  button(tree, '프리미엄 구독하기').props.onPress();
  assert.equal(purchases.at(-1), monthly);
  reducedMotion = true;
  button(render(), '연 구독').props.onPress();
  assert.equal(indicator(render()), 0, 'Reduced motion still aligns annual selection with its first option.');
  value.offers = [monthly];
  tree = render();
  assert.equal(periodButtons(tree).length, 0, 'No unavailable annual option is offered for a monthly-only store catalog.');
  assert.match(text(tree), /프리미엄 · CA\$19\.99 \/ 월/);
  assert.match(text(tree), /매월 CA\$19\.99이 청구되며 자동 갱신/);
  value.purchaseUnavailableReason = '아직 준비 중';
  assert.equal(button(render(), '프리미엄 구독하기').props.disabled, true);
  value.purchaseUnavailableReason = null;
  assert.equal(button(render(), '프리미엄 구독하기').props.disabled, false);
  button(render(), '프리미엄 구독하기').props.onPress();
  assert.equal(purchases.length, 3);
  assert.equal(purchases.at(-1), monthly, 'The annual preference falls back to the exact available monthly product.');
  const cancellationLabel = '스토어에서 대기 구매 취소·거절을 확인했어요';
  assert.equal(button(render(), cancellationLabel), undefined);
  value.pendingApproval = true; value.purchaseUnavailableReason = '승인 대기 중';
  let cancellation = button(render(), cancellationLabel);
  assert.ok(cancellation, 'approval-pending purchases need an explicit recovery action');
  assert.equal(cancellation.props.accessibilityRole, 'button');
  assert.ok(cancellation.props.style.minHeight >= 44);
  const feedbackBefore = feedback;
  cancellation.props.onPress();
  assert.ok(feedback > feedbackBefore);
  assert.equal(confirmed, 0, 'opening confirmation must not clear pending');
  assert.match(confirmation[1], /취소.*거절/);
  confirmation[2].find(action => action.style === 'cancel').onPress();
  assert.equal(confirmed, 0, 'uncertain cancellation must remain pending');
  cancellation.props.onPress();
  confirmation[2].find(action => action.style !== 'cancel').onPress();
  assert.equal(confirmed, 1);
  assert.equal(purchases.length, 3, 'recovery must not invoke purchase');
  value.busy = true;
  assert.equal(button(render(), cancellationLabel).props.disabled, true);
  value.busy = false; value.loading = true;
  assert.equal(button(render(), cancellationLabel).props.disabled, true);
});
