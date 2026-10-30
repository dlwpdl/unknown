import { withLanguageImports } from './test-language-imports.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

import { t } from '../src/i18n/ko.ts';
import { MEMBERSHIP_LIMITS, GENERAL_BUMP_HOURS, BUSINESS_LIMITS, MEETUP_TOOL_PERKS, yearlyListPrice } from '../src/lib/membership.ts';

test('membership keeps stories and direct chat free while preserving meetup and listing plans', () => {
  let states = [], cursor = 0, restored = 0, confirmed = 0, feedback = 0, confirmation, reducedMotion = false;
  const purchases = [], opened = [];
  class AnimatedValue {
    constructor(value) { this.value = value; }
    setValue(value) { this.value = value; }
    interpolate({ outputRange }) { return outputRange[0] + this.value * (outputRange[1] - outputRange[0]); }
  }
  const value = { membership: { tier: 'free', billingPolicyVersion:2, postsUsed: 0, postLimit: 1, meetupsUsed: 1, meetupLimit: 3 }, offers: [], loading: false,
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
    if ((name === 'react-native' || name === '@/components/analytics-controls')) return { View: 'View', ScrollView: 'ScrollView', Pressable: 'Pressable', Alert: { alert: (...args) => { confirmation = args; } }, Linking: { openURL: async url => { opened.push(url); } }, Animated: { Value: AnimatedValue, View: 'View', timing: (value, options) => ({ start() { value.setValue(options.toValue); } }) }, StyleSheet: { create: styles => styles } };
    if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
    if (name === '@/components/login-panel') return { LoginPanel: 'LoginPanel' };
    if (name === '@/components/gling-loader') return { GlingLoader: 'GlingLoader' };
    if (name === '@/components/relationship-slot-card') return { relationshipSlotData: (membership) => membership?.meetupLimit ? { active: membership.meetupsUsed, locked: 0, available: membership.meetupLimit - membership.meetupsUsed, limit: membership.meetupLimit } : null };
    if (name === '@/lib/legal-documents') return { CONTACT_EMAIL: 'gling@example.com' };
    if (name === '@/components/meetup-policy-notice') return { MeetupPolicyNotice: 'MeetupPolicyNotice' };
    if (name === '@/components/notice-blocks') return { InfoNote: 'InfoNote' };
    if (name === '@/components/themed-text') return { ThemedText: 'Text' };
    if (name === '@/components/themed-view') return { ThemedView: 'View' };
    if (name === '@/constants/theme') return { Spacing: { one: 4, two: 8, three: 16, five: 32 }, MaxContentWidth: 800, Depth: { card: {}, control: {} } };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
    if (name === '@/i18n/ko') return { t };
    if (name === '@/lib/auth') return { useAuth: () => ({ isAuthed: true, me:{id:'member'} }) };
    if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play() { feedback++; } }) };
    if (name === '@/lib/membership') return { MEMBERSHIP_LIMITS, GENERAL_BUMP_HOURS, BUSINESS_LIMITS, MEETUP_TOOL_PERKS, yearlyListPrice };
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
  const card = (tree, name) => nodes(tree).find(node => node.props?.analyticsId === 'app_profile_membership.pressable.4' && text(node).startsWith(name));
  for (const [name, facts, tools] of [['플러스', '모임 정원30명공동 호스트1명모임 자리5개', '템플릿 · 질문 재사용 · 조건 맞는 신청 바로 승인'], ['프로', '모임 정원100명공동 호스트3명모임 자리10개', '플러스 + 반복 회차 · 대기 명단 · 빈자리 대기자에게 자동으로 넘기기'], ['프리미엄', '모임 정원500명공동 호스트5명모임 자리20개', '프로 + 신청·참석 통계']]) {
    assert.ok(text(card(tree, name)).includes(facts), `${name} shows seats, cohosts and meetup slots`);
    assert.ok(text(card(tree, name)).includes(tools), `${name} explains its meetup tools`);
  }
  assert.ok(button(tree,'개인'));
  assert.ok(button(tree,'비즈니스'));
  assert.match(text(tree), /모임 자리1 \/ 3/, 'the meetup slot usage sits in the membership card');
  assert.match(text(tree), /내 모임 정원10명플러스부터 30명/);
  assert.match(text(tree), /오늘 글 무제한 · 1:1 대화 바로 시작/);
  assert.match(text(tree), /베이직 · 무료 — 모임 정원 10명 · 모임 자리 3개/);
  assert.doesNotMatch(text(tree), /처음 요청한 사람/);
  assert.equal(button(tree, '구독 준비 중').props.disabled, true, 'checkout is visible immediately but requires a store offer');
  assert.doesNotMatch(text(tree), /자리가 잠기지 않아요/, 'meetup rules start folded');
  nodes(tree).find(node => node.props?.analyticsId === 'membership.compare').props.onPress();
  tree = render();
  assert.match(text(tree), /판매·구인 글5102020/, 'the comparison table keeps live listing capacity');
  assert.match(text(tree), /글 끌올 간격48시간36시간30시간24시간/);
  nodes(tree).find(node => node.props?.analyticsId === 'membership.rules').props.onPress();
  tree = render();
  assert.match(text(tree), /자리가 잠기지 않아요/);
  assert.match(text(tree), /24시간 안에 3번째부터 12시간 참여 제한/);
  button(render(),'비즈니스').props.onPress();
  tree = render();
  assert.deepEqual(planOrder(tree), ['플러스', '프로', '프리미엄'], 'business plans follow Basic, Plus, Pro, Premium');
  for (const [name, facts] of [['플러스','끌올이틀에 1번공동 관리자1명한 달 글2개'], ['프로','끌올하루 1번공동 관리자2명한 달 글5개'], ['프리미엄','끌올12시간에 1번공동 관리자5명한 달 글10개']]) {
    assert.ok(text(card(tree, name)).includes(facts), `${name} displays its business posts, bump interval and managers`);
  }
  assert.match(text(tree), /베이직 · 무료 — 끌올 5일에 1번 · 한 달 글 1개/);
  assert.doesNotMatch(text(tree), /운영대행/);
  assert.doesNotMatch(text(tree), /모임 이용 규칙/, 'meetup rules belong to the personal family');
  nodes(tree).find(node => node.props?.analyticsId === 'membership.business.managed').props.onPress();
  assert.match(opened.at(-1), /^mailto:gling@example\.com\?subject=/, 'Gling management is sold by inquiry');
  assert.equal(button(tree,'구독 준비 중').props.disabled,true,'unverified business cannot purchase');
  value.membership.businessSubscription = { tier:'free', merchantId:'bound-business' };
  assert.match(text(render()), /결제 연결은 다른 비즈니스에 묶여 있어요/, 'an expired or pending business binding must remain visible');
  value.offers = ['plus', 'pro', 'premium'].map(tier => ({ id: `business_${tier}_yearly`, kind: 'business', planVersion: 2, tier, period: 'year', price: 'CA$1', productId: `com.dlwpdl.gling.business.${tier}.yearly.v2` }));
  const blocked = nodes(render()).find(node => node.props?.analyticsId === 'app_profile_membership.pressable.6');
  assert.equal(blocked.props.disabled, false, 'a blocked business purchase still answers a tap (App Review 2.1(b))');
  const purchasesBefore = purchases.length;
  blocked.props.onPress();
  assert.match(confirmation[0], /다른 비즈니스/);
  assert.equal(purchases.length, purchasesBefore, 'an unverified or mismatched business never starts a purchase');
  value.offers = [];
  delete value.membership.businessSubscription;
  value.error = '업체 결제 확인 실패'; value.notice = '복원 확인 중'; value.pendingApproval = true;
  assert.match(text(render()), /업체 결제 확인 실패/);
  assert.match(text(render()), /복원 확인 중/);
  assert.ok(button(render(),'스토어에서 대기 구매 취소·거절을 확인했어요'),'business approval pending must retain the same recovery controls');
  value.error = null; value.notice = null; value.pendingApproval = false;
  button(render(),'개인').props.onPress();
  assert.deepEqual(planOrder(render()), ['플러스', '프로', '프리미엄'], 'switching families preserves ascending general ordering');
  assert.match(t.write.listingNote, /14일 뒤 자동 마감/);
  for (const copy of [t.write.listingNote, t.actionErrors.BUMP_COOLDOWN.body]) {
    assert.match(copy, /베이직은 48시간·플러스는 36시간·프로는 30시간·프리미엄은 24시간/);
    assert.doesNotMatch(copy, /하루에 한 번/);
  }
  tree = render();
  button(tree, '구매 복원').props.onPress();
  assert.equal(restored, 1);
  const monthly = { tier: 'premium', kind: 'general', planVersion: 2, period: 'month', productId: 'premium_monthly', price: 'CA$19.99' };
  // Synthetic eligible annual offer tests screen behavior, not a configured or purchasable store SKU.
  const annual = { id: 'annual-ui-fixture', tier: 'premium', kind: 'general', planVersion: 2, period: 'year', productId: 'annual-ui-fixture', price: 'CA$199.99' };
  value.offers = [monthly, annual];
  tree = render();
  const periodButtons = tree => nodes(tree).filter(node => node.props?.analyticsId === 'app_profile_membership.pressable.5');
  assert.deepEqual(periodButtons(tree).map(text), ['연간2달 무료', '월간'], 'annual comes first');
  assert.equal(button(tree, '연간2달 무료').props.accessibilityState.checked, true);
  assert.equal(button(tree, '월간').props.accessibilityState.checked, false);
  assert.ok(nodes(tree).some(node => node.props?.analyticsId === 'app_profile_membership.pressable.4' && node.props.accessibilityState.checked && text(node).startsWith('프리미엄')), 'The existing default tier stays Premium.');
  assert.match(text(card(tree, '프리미엄')), /CA\$199\.99 \/ 년CA\$239\.88/, 'annual price shows twelve months struck through');
  assert.match(text(tree), /매년 CA\$199\.99 · 자동 갱신/);
  nodes(tree).find(node => node.props?.onLayout).props.onLayout({ nativeEvent: { layout: { width: 300 } } });
  const indicator = tree => nodes(tree).find(node => node.props?.pointerEvents === 'none').props.style[1].transform[0].translateX;
  assert.equal(indicator(render()), 0, 'The initial highlight sits beneath the first, annual option.');
  button(render(), '프리미엄 연간 구독하기').props.onPress();
  assert.equal(purchases.at(-1), annual);
  button(render(), '월간').props.onPress();
  tree = render();
  assert.equal(button(tree, '월간').props.accessibilityState.checked, true);
  assert.ok(indicator(tree) > 0, 'Monthly selection moves the highlight to the second option.');
  assert.match(text(card(tree, '프리미엄')), /CA\$19\.99 \/ 월/);
  button(tree, '프리미엄 월간 구독하기').props.onPress();
  assert.equal(purchases.at(-1), monthly);
  reducedMotion = true;
  button(render(), '연간2달 무료').props.onPress();
  assert.equal(indicator(render()), 0, 'Reduced motion still aligns annual selection with its first option.');
  value.offers = [monthly];
  tree = render();
  assert.equal(periodButtons(tree).length, 0, 'No unavailable annual option is offered for a monthly-only store catalog.');
  assert.match(text(card(tree, '프리미엄')), /CA\$19\.99 \/ 월/);
  assert.match(text(tree), /매월 CA\$19\.99 · 자동 갱신/);
  value.purchaseUnavailableReason = '아직 준비 중';
  assert.equal(button(render(), '프리미엄 월간 구독하기').props.disabled, true);
  value.purchaseUnavailableReason = null;
  assert.equal(button(render(), '프리미엄 월간 구독하기').props.disabled, false);
  button(render(), '프리미엄 월간 구독하기').props.onPress();
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
