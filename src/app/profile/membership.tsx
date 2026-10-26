import { useLanguage } from '@/hooks/use-language';
import { GlingLoader } from '@/components/gling-loader';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Animated, LayoutAnimation, Linking, Platform, StyleSheet, UIManager, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoginPanel } from '@/components/login-panel';
import { relationshipSlotData } from '@/components/relationship-slot-card';
import { MeetupPolicyNotice } from '@/components/meetup-policy-notice';
import { InfoNote, WhoSees } from '@/components/notice-blocks';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Depth, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CONTACT_EMAIL } from '@/lib/legal-documents';
import { BUSINESS_LIMITS, GENERAL_BUMP_HOURS, MEMBERSHIP_LIMITS, yearlyListPrice, type BusinessMembershipSnapshot, type MembershipKind, type MembershipOffer } from '@/lib/membership';
import { useMembership } from '@/lib/membership-provider';
import { loadMyMerchants, type BusinessMerchant } from '@/lib/merchant-workspace';
import { supabase } from '@/lib/supabase';

const plans = [
  { tier: 'plus', name: '플러스' },
  { tier: 'pro', name: '프로' },
  { tier: 'premium', name: '프리미엄' },
] as const;
const tierNames = { free: '베이직', plus: '플러스', pro: '프로', premium: '프리미엄', admin: '관리자' };


export default function MembershipScreen() {
  const { tr, locale: appLocale } = useLanguage();
  const periodNames = { get month() { return tr("월"); }, get year() { return tr("년"); } };
  const theme = useTheme();
  const auth = useAuth();
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const { membership, loading, error, notice, offers, offersLoading, busy, purchaseUnavailableReason, pendingApproval, confirmPendingCancellation, refresh, purchase, restore, manage } = useMembership();
  useFocusEffect(useCallback(() => {
    if (auth.isAuthed) void refresh();
  }, [auth.isAuthed, refresh]));
  const [selection, setSelection] = useState<{ tier: MembershipOffer['tier']; period: MembershipOffer['period'] }>({ tier: 'premium', period: 'year' });
  const [kind, setKind] = useState<MembershipKind>('general');
  const [merchants, setMerchants] = useState<{ userId: string; values: BusinessMerchant[] } | null>(null);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [businessState, setBusiness] = useState<{ userId: string; value: BusinessMembershipSnapshot } | null>(null);
  const [businessError, setBusinessError] = useState<string | null>(null);
  const companies = merchants?.userId === auth.me.id ? merchants.values : [];
  const business = businessState?.userId === auth.me.id && businessState.value.merchantId === merchantId ? businessState.value : null;
  const activeMembership = kind === 'business' ? business : membership;
  useEffect(() => {
    if (!auth.isAuthed || kind !== 'business') return;
    let active = true;
    void loadMyMerchants(supabase).then((all) => {
      if (!active) return;
      // The operator account can open every business; subscriptions belong to owners and their co-managers only.
      const values = all.filter((item) => item.role !== 'admin');
      setMerchants({ userId: auth.me.id, values });
      setMerchantId((previous) => values.some((item) => item.id === previous) ? previous : values.find((item) => item.id === membership?.businessSubscription?.merchantId)?.id ?? values.find((item) => item.role === 'owner')?.id ?? values[0]?.id ?? null);
      setBusinessError(values.length ? null : '연결된 비즈니스가 없어요. 비즈니스 소유 확인 후 구독할 수 있어요.');
    }).catch(() => { if (active) setBusinessError('비즈니스 연결과 소유 확인이 필요해요. 결제는 진행되지 않아요.'); });
    return () => { active = false; };
  }, [auth.isAuthed, auth.me.id, kind, membership?.businessSubscription?.merchantId]);
  useEffect(() => {
    if (!auth.isAuthed || kind !== 'business' || !merchantId) return;
    let active = true;
    void Promise.resolve(supabase.rpc('get_business_membership', { p_merchant_id: merchantId })).then(({ data, error }) => {
      if (!active) return;
      if (error || !data || data.merchantId !== merchantId) { setBusinessError('비즈니스 멤버십을 확인하지 못했어요. 잠시 후 다시 확인해 주세요.'); return; }
      setBusiness({ userId: auth.me.id, value: data as BusinessMembershipSnapshot }); setBusinessError(null);
    }).catch(() => { if (active) setBusinessError('비즈니스 멤버십을 확인하지 못했어요. 잠시 후 다시 확인해 주세요.'); });
    return () => { active = false; };
  }, [auth.isAuthed, auth.me.id, kind, merchantId, membership]);
  const [open, setOpen] = useState<{ compare: boolean; rules: boolean; picker: boolean }>({ compare: false, rules: false, picker: false });
  const [periodWidth, setPeriodWidth] = useState(0);
  const [openedAt] = useState(() => Date.now());
  const [periodPosition] = useState(() => new Animated.Value(0));
  const animateLayout = () => {
    if (reducedMotion) return;
    if (Platform?.OS === 'android') UIManager?.setLayoutAnimationEnabledExperimental?.(true);
    LayoutAnimation?.configureNext?.(LayoutAnimation.Presets.easeInEaseOut);
  };
  const bumpEvery = (hours: number) => hours === 24 ? tr("하루 1번") : hours === 48 ? tr("이틀에 1번") : hours % 24 === 0 ? tr("{0}일에 1번", hours / 24) : tr("{0}시간에 1번", hours);
  const planFacts = (tier: 'free' | MembershipOffer['tier']): [string, string][] => kind === 'general'
    ? [[tr("모임 정원"), tr("{0}명", MEMBERSHIP_LIMITS[tier].seats)], [tr("공동 호스트"), tr("{0}명", MEMBERSHIP_LIMITS[tier].cohosts)], [tr("모임 자리"), tr("{0}개", MEMBERSHIP_LIMITS[tier].meetups)]]
    : [[tr("끌올"), bumpEvery(BUSINESS_LIMITS[tier].bumpCooldownHours)], [tr("공동 관리자"), tr("{0}명", BUSINESS_LIMITS[tier].managers)], [tr("한 달 글"), tr("{0}개", BUSINESS_LIMITS[tier].posts)]];
  const toggle = (key: keyof typeof open) => { play('selection'); animateLayout(); setOpen(value => ({ ...value, [key]: !value[key] })); };
  const selectPlan = (next: typeof selection) => {
    play('selection');
    animateLayout();
    if (reducedMotion) periodPosition.setValue(next.period === 'month' ? 1 : 0);
    else Animated.timing(periodPosition, { toValue: next.period === 'month' ? 1 : 0, duration: 200, useNativeDriver: true }).start();
    setSelection(next);
  };
  const familyOffers = offers.filter((offer) => offer.kind === kind && offer.planVersion === 2);
  const selectedOffer = familyOffers.find((offer) => offer.tier === selection.tier && offer.period === selection.period)
    ?? familyOffers.find((offer) => offer.tier === selection.tier);
  const period = selectedOffer?.period ?? selection.period;
  const periods = (['year', 'month'] as const).filter((value) => familyOffers.some((offer) => offer.tier === selection.tier && offer.period === value));
  const currentProduct = !!activeMembership && activeMembership.tier !== 'free' && !!selectedOffer && selectedOffer.productId === activeMembership.productId;
  const otherBusiness = kind === 'business' && !!membership?.businessSubscription?.merchantId && membership.businessSubscription.merchantId !== merchantId;
  const purchaseDisabled = busy || loading || offersLoading || !selectedOffer || !membership || membership.billingPolicyVersion !== 2 || !!purchaseUnavailableReason || currentProduct || (kind === 'business' && (!business?.canPurchase || otherBusiness));
  const publicSiteUrl = (process.env.EXPO_PUBLIC_APP_URL ?? 'https://gling.ej-entertainment.com').replace(/\/$/, '');
  const openLegal = (slug: 'terms' | 'privacy') => {
    play('selection');
    void Linking.openURL(`${publicSiteUrl}/${slug}`).catch(() => Alert.alert(tr("페이지를 열지 못했어요"), tr("잠시 후 다시 시도해 주세요.")));
  };
  const askManaged = () => {
    play('selection');
    void Linking.openURL(`mailto:${process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? CONTACT_EMAIL}?subject=${encodeURIComponent(tr("글링 관리 문의"))}`).catch(() => Alert.alert(tr("메일 앱을 열지 못했어요"), CONTACT_EMAIL));
  };
  const confirmStoreCancellation = () => {
    play('selection');
    Alert.alert(tr("대기 구매가 취소·거절됐나요?"), tr("결제한 스토어에서 이전 요청의 취소 또는 거절 완료 안내를 확인한 경우에만 계속해 주세요. 빈 구독 목록만으로는 확인할 수 없어요. 승인 대기가 남아 있으면 다시 구매할 때 중복 청구될 수 있어요."), [
      { text: tr("아직 확인 못 했어요"), style: 'cancel', onPress: () => play('selection') },
      { text: tr("취소·거절 확인 완료"), onPress: () => { play('selection'); void confirmPendingCancellation(); } },
    ]);
  };

  if (auth.isAuthLoading) return <GlingLoader color={theme.accent} style={styles.loading} accessibilityLabel={tr("로그인 확인 중")} />;
  if (!auth.isAuthed) return <LoginPanel reason="내 멤버십을 확인하고 이어서 이용하려면 로그인해 주세요." onApple={auth.signInApple} onKakao={auth.signInKakao} onGoogle={auth.signInGoogle} onDevLogin={auth.signInDev} loading={auth.isAuthLoading} error={auth.authError} />;

  const slots = relationshipSlotData(membership, 'meetup');
  const myTier = activeMembership && activeMembership.tier !== 'admin' ? activeMembership.tier : null;
  const nextTier = myTier && myTier !== 'premium' ? plans[(['free', 'plus', 'pro'] as const).indexOf(myTier)] : null;
  const nextBump = business?.nextBumpAt && Date.parse(business.nextBumpAt) > openedAt ? Date.parse(business.nextBumpAt) - openedAt : null;
  const bumpsLeft = business && (business.bumpLimit == null || business.bumpsUsed < business.bumpLimit);
  const usage: { label: string; value: string; detail?: string; ratio?: number }[] = kind === 'general'
    ? auth.isAdmin ? [] : [
      { label: tr("모임 자리"), value: slots ? `${slots.active} / ${slots.limit}` : loading ? tr("확인 중") : '—', ratio: slots ? Math.min(1, slots.active / slots.limit) : undefined, detail: slots?.locked ? tr("24시간 잠금 {0}개", slots.locked) : undefined },
      { label: tr("내 모임 정원"), value: myTier ? tr("{0}명", MEMBERSHIP_LIMITS[myTier].seats) : '—', detail: nextTier ? tr("{0}부터 {1}명", tr(nextTier.name), MEMBERSHIP_LIMITS[nextTier.tier].seats) : undefined },
    ]
    : business ? [
      { label: tr("이번 달 글"), value: business.postLimit == null ? tr("제한 없음") : `${business.postsUsed} / ${business.postLimit}`, ratio: business.postLimit ? Math.min(1, business.postsUsed / business.postLimit) : undefined },
      { label: tr("다음 끌올"), value: !bumpsLeft ? tr("다음 달") : nextBump == null ? tr("지금 가능") : nextBump < 86_400_000 ? tr("{0}시간 뒤", Math.ceil(nextBump / 3_600_000)) : tr("{0}일 뒤", Math.ceil(nextBump / 86_400_000)) },
    ] : [];
  const monthlyOf = (tier: MembershipOffer['tier']) => familyOffers.find((item) => item.tier === tier && item.period === 'month');

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView analyticsId="app_profile_membership.scrollview.1" contentContainerStyle={styles.content}>
          <View accessibilityRole="tablist" style={[styles.segment, { backgroundColor: theme.backgroundElement }]}>
            {([['general', tr("개인")], ['business', tr("비즈니스")]] as const).map(([value, label]) => <Pressable analyticsId={`membership.family.${value}`} key={value} accessibilityRole="tab" accessibilityState={{ selected: kind === value, disabled: busy }} disabled={busy}
              onPress={() => { play('selection'); animateLayout(); setKind(value); }} style={({ pressed }) => [styles.period, { backgroundColor: kind === value ? theme.card : 'transparent', opacity: pressed ? 0.65 : 1 }]}><ThemedText type="smallBold" themeColor={kind === value ? 'accent' : undefined}>{label}</ThemedText></Pressable>)}
          </View>
          {kind === 'business' && <View style={styles.stack}>
            {companies.length > 1 && <Disclosure label={companies.find((item) => item.id === merchantId)?.name ?? tr("가게 선택")} note={tr("바꾸기")} open={open.picker} onPress={() => toggle('picker')} analyticsId="membership.business.picker" />}
            {open.picker && companies.map((company) => <Pressable analyticsId="membership.business.select" key={company.id} accessibilityRole="radio" accessibilityState={{ selected: merchantId === company.id, checked: merchantId === company.id, disabled: busy }} disabled={busy}
              onPress={() => { play('selection'); animateLayout(); setMerchantId(company.id); setOpen((value) => ({ ...value, picker: false })); }} style={({ pressed }) => [styles.row, { borderWidth: 1, borderRadius: 12, borderColor: merchantId === company.id ? theme.accent : theme.line, opacity: pressed ? 0.65 : 1 }]}><ThemedText type="smallBold">{company.name}</ThemedText></Pressable>)}
            {businessError && <ThemedText type="small" accessibilityRole="alert">{tr(businessError)}</ThemedText>}
            {business && !business.canPurchase && <ThemedText type="small">{tr("확인된 비즈니스 소유자만 구독을 연결할 수 있어요.")}</ThemedText>}
            {otherBusiness && <ThemedText type="small">{tr("결제 연결은 다른 비즈니스에 묶여 있어요. 해당 비즈니스를 선택해 주세요.")}</ThemedText>}
            {business?.canPurchase && membership?.businessSubscription?.tier !== 'free' && membership?.businessSubscription && !membership.businessSubscription.merchantId && <Pressable analyticsId="membership.business.bind" accessibilityRole="button" disabled={busy || loading} style={styles.textButton}
              onPress={() => { play('selection'); void supabase.rpc('bind_business_membership', { p_merchant_id: merchantId }).then(({ error }) => { if (error) setBusinessError('현재 계정의 비즈니스 소유 확인을 다시 확인해 주세요.'); else void refresh(); }); }}><ThemedText type="smallBold" themeColor="accent">{tr("기존 구독을 이 비즈니스에 연결")}</ThemedText></Pressable>}
          </View>}

          <View style={[styles.me, { backgroundColor: theme.card }]}>
            <ThemedText type="small" themeColor="textSecondary">{kind === 'business' ? companies.find((item) => item.id === merchantId)?.name ?? tr("이 가게의 멤버십") : tr("지금 쓰는 멤버십")}</ThemedText>
            <View style={styles.tierRow}>
              <ThemedText accessibilityRole="header" style={styles.heading}>{activeMembership ? tr(tierNames[activeMembership.tier]) : loading ? tr("확인 중") : tr("확인 필요")}</ThemedText>
              {activeMembership?.tier === 'free' && <View style={[styles.badge, { backgroundColor: theme.backgroundElement }]}><ThemedText type="smallBold" themeColor="textSecondary">{tr("무료")}</ThemedText></View>}
            </View>
            {activeMembership?.expiresAt && activeMembership.tier !== 'free' && activeMembership.tier !== 'admin' && <ThemedText type="small" themeColor="textSecondary">
              {tr(activeMembership.willRenew === true ? '{0} 갱신 예정' : activeMembership.willRenew === false ? '{0} 까지 이용 가능' : '{0} 이용 기간 종료 예정', new Date(activeMembership.expiresAt).toLocaleDateString(appLocale))}
            </ThemedText>}
            {kind === 'general' && auth.isAdmin && <ThemedText type="small" themeColor="accent">{tr("관리자 계정 · 모임을 제한 없이 이용해요.")}</ThemedText>}
            {kind === 'general' && membership?.planVersion === 1 && <ThemedText type="small" themeColor="textSecondary">{tr("기존 구독 가격과 더 빠른 끌어올리기 혜택을 유지해요.")}</ThemedText>}
            {usage.length > 0 && <View style={styles.usage}>
              {usage.map((item) => <View key={item.label} accessible accessibilityLabel={`${item.label} ${item.value}${item.detail ? `, ${item.detail}` : ''}`} style={[styles.usageTile, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="small" themeColor="textSecondary">{item.label}</ThemedText>
                <ThemedText type="smallBold" style={styles.usageValue}>{item.value}</ThemedText>
                {item.ratio != null && <View style={[styles.bar, { backgroundColor: theme.line }]}><View style={{ width: `${item.ratio * 100}%`, height: '100%', backgroundColor: theme.accent }} /></View>}
                {item.detail && <ThemedText type="small" themeColor="textSecondary">{item.detail}</ThemedText>}
              </View>)}
            </View>}
          </View>
          <InfoNote>{kind === 'general' ? tr("모든 등급 공통 · 오늘 글 무제한 · 1:1 대화 바로 시작") : business ? tr("{0}에 글 수가 다시 채워져요", new Date(business.resetsAt).toLocaleDateString(appLocale, { month: 'long', day: 'numeric' })) : tr("매달 1일에 글 수가 다시 채워져요")}</InfoNote>

          {(error || notice || pendingApproval) && <View style={styles.feedback}>
            {error && <ThemedText type="small" themeColor="accent" accessibilityRole="alert">{tr(error)}</ThemedText>}
            {notice && <ThemedText type="small" accessibilityLiveRegion="polite">{tr(notice)}</ThemedText>}
            <Pressable analyticsId="app_profile_membership.pressable.1" onPress={() => { play('selection'); void refresh(); }} accessibilityRole="button" disabled={busy || loading} accessibilityState={{ disabled: busy || loading }} style={({ pressed }) => [styles.textButton, { opacity: pressed ? 0.65 : 1 }]}><ThemedText type="smallBold" themeColor="accent">{tr("다시 확인하기")}</ThemedText></Pressable>
            {pendingApproval && <>
              <ThemedText type="small" themeColor="textSecondary">{tr("스토어의 취소·거절 완료 안내를 확인해 주세요. 빈 구독 목록만으로는 확인할 수 없어요. 승인 대기가 계속되면 다시 구매하지 마세요.")}</ThemedText>
              <Pressable analyticsId="membership.pending.manage" onPress={() => { play('selection'); void manage(); }} accessibilityRole="button" disabled={busy || loading} accessibilityState={{ disabled: busy || loading }} style={styles.textButton}><ThemedText type="smallBold" themeColor="accent">{tr("스토어 구독 관리 열기")}</ThemedText></Pressable>
              <Pressable analyticsId="membership.pending.confirm_cancellation" onPress={confirmStoreCancellation} accessibilityRole="button" accessibilityHint={tr("스토어의 취소 또는 거절을 확인한 경우에만 구매 대기를 해제해요.")} disabled={busy || loading} accessibilityState={{ disabled: busy || loading, busy }} style={styles.textButton}><ThemedText type="smallBold" themeColor="accent">{tr("스토어에서 대기 구매 취소·거절을 확인했어요")}</ThemedText></Pressable>
            </>}
          </View>}

          {/* 연간이 먼저(기본 선택), 월간으로 바꿀 수 있다. 상점에 두 기간이 다 있을 때만 보인다. */}
          {periods.length > 1 && <View onLayout={event => setPeriodWidth(event.nativeEvent.layout.width)} style={[styles.periods, { backgroundColor: theme.backgroundElement }]}>
            {periodWidth > 0 && <Animated.View pointerEvents="none" style={[styles.periodIndicator, { width: (periodWidth - 12) / 2, backgroundColor: theme.card, transform: [{ translateX: periodPosition.interpolate({ inputRange: [0, 1], outputRange: [0, (periodWidth - 12) / 2 + 4] }) }] }]} />}
            {periods.map((value) => <Pressable analyticsId="app_profile_membership.pressable.5" key={value} accessibilityRole="radio" aria-checked={value === period} accessibilityState={{ selected: value === period, checked: value === period, disabled: busy }} disabled={busy}
              onPress={() => selectPlan({ ...selection, period: value })}
              style={({ pressed }) => [styles.period, styles.periodLabel, { backgroundColor: periodWidth === 0 && value === period ? theme.card : 'transparent', opacity: pressed ? 0.7 : 1 }]}>
              <ThemedText type="smallBold" themeColor={value === period ? 'accent' : undefined}>{value === 'month' ? tr("월간") : tr("연간")}</ThemedText>
              {value === 'year' && <View style={[styles.save, { backgroundColor: theme.accent }]}><ThemedText type="smallBold" style={[styles.saveText, { color: theme.accentInk }]}>{tr("2달 무료")}</ThemedText></View>}
            </Pressable>)}
          </View>}

          {kind === 'business' && <WhoSees title={tr("비즈니스 멤버십의 핵심")} rows={[
            { icon: { ios: 'arrow.up.circle', android: 'arrow_circle_up', web: 'arrow_circle_up' }, label: tr("끌올"), detail: tr("올린 글 하나를 최신 글 맨 위로 다시 올려요. 등급이 높을수록 더 자주 할 수 있어요.") },
            { icon: { ios: 'person.2', android: 'group', web: 'group' }, label: tr("공동 관리자"), detail: tr("직원이나 동업자를 초대해 같은 가게 계정을 함께 관리해요.") },
          ]} />}
          {plans.map((plan) => {
            const offer = familyOffers.find((item) => item.tier === plan.tier && item.period === period) ?? familyOffers.find((item) => item.tier === plan.tier);
            const listPrice = offer?.period === 'year' && monthlyOf(plan.tier) ? yearlyListPrice(monthlyOf(plan.tier)!.price) : null;
            const selected = selection.tier === plan.tier;
            return <Pressable analyticsId="app_profile_membership.pressable.4" key={plan.tier} accessibilityRole="radio" aria-checked={selected} accessibilityState={{ selected, checked: selected, disabled: busy }} disabled={busy}
              onPress={() => selectPlan({ tier: plan.tier, period: offer?.period ?? period })}
              style={({ pressed }) => [styles.plan, { backgroundColor: theme.card, borderColor: selected ? theme.accent : theme.line, opacity: pressed ? 0.88 : 1 }]}>
              <View style={styles.planHeading}>
                <ThemedText style={styles.planName}>{tr(plan.name)}</ThemedText>
                <View style={[styles.radio, { borderColor: selected ? theme.accent : theme.line, backgroundColor: selected ? theme.accent : 'transparent' }]}>
                  {selected && <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={12} tintColor={theme.accentInk} />}
                </View>
              </View>
              <View style={styles.priceRow}>
                <ThemedText style={styles.price}>{offer ? `${offer.price} / ${periodNames[offer.period]}` : offersLoading ? tr("가격 확인 중") : tr("준비 중")}</ThemedText>
                {listPrice && <ThemedText type="small" themeColor="textSecondary" style={styles.reference}>{listPrice}</ThemedText>}
              </View>
              <View style={[styles.facts, { borderColor: theme.line }]}>
                {planFacts(plan.tier).map(([label, value], index) => <View key={label} style={[styles.fact, index > 0 && { borderLeftWidth: 1, borderLeftColor: theme.line }]}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.center}>{label}</ThemedText>
                  <ThemedText type="smallBold" themeColor={kind === 'business' && index < 2 ? 'accent' : undefined} style={styles.center}>{value}</ThemedText>
                </View>)}
              </View>
              {kind === 'general' && <ThemedText type="small" themeColor="textSecondary">{tr("모임 도구")} · {tr(plan.tier === 'plus' ? '템플릿 · 질문 재사용' : plan.tier === 'pro' ? '플러스 + 반복 회차 · 대기 명단' : '프로 + 신청·참석 통계')}</ThemedText>}
            </Pressable>;
          })}
          <View style={[styles.free, { borderColor: theme.line }]}>
            <ThemedText type="small" themeColor="textSecondary"><ThemedText type="smallBold">{tr("베이직 · 무료")}</ThemedText> — {planFacts('free').filter((_, index) => index !== 1).map(([label, value]) => `${label} ${value}`).join(' · ')}</ThemedText>
          </View>
          {kind === 'business' && <>
            <InfoNote>{tr("끌올은 올린 글 중 하나를 골라 정해진 간격마다 한 번 할 수 있어요. 같은 내용을 새 글로 다시 올릴 수는 없어요.")}</InfoNote>
            <Pressable analyticsId="membership.business.managed" accessibilityRole="button" accessibilityHint={tr("메일로 문의해요")} onPress={askManaged}
              style={({ pressed }) => [styles.managed, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 }]}>
              <View style={styles.planHeading}>
                <ThemedText type="smallBold">{tr("글링 관리")}</ThemedText>
                <ThemedText type="smallBold" themeColor="accent">{tr("문의하기 ›")}</ThemedText>
              </View>
              <ThemedText type="small" themeColor="textSecondary">{tr("한 달 글 15개를 글링이 대신 써서 올리고 관리해 드려요. 가격은 가게 상황을 듣고 따로 안내해요.")}</ThemedText>
            </Pressable>
          </>}

          <View>
            <Disclosure label={tr("전체 비교 보기")} note={kind === 'general' ? tr("판매 글·끌올 포함") : undefined} open={open.compare} onPress={() => toggle('compare')} analyticsId="membership.compare" />
            {open.compare && <View style={[styles.table, { backgroundColor: theme.card }]}>
              {[['', ...(['free', ...plans.map((plan) => plan.tier)] as const).map((tier) => tr(tierNames[tier]))],
                ...(kind === 'general' ? [
                  [tr("모임 정원"), ...(['free', 'plus', 'pro', 'premium'] as const).map((tier) => String(MEMBERSHIP_LIMITS[tier].seats))],
                  [tr("공동 호스트"), ...(['free', 'plus', 'pro', 'premium'] as const).map((tier) => MEMBERSHIP_LIMITS[tier].cohosts ? String(MEMBERSHIP_LIMITS[tier].cohosts) : '–')],
                  [tr("모임 자리"), ...(['free', 'plus', 'pro', 'premium'] as const).map((tier) => String(MEMBERSHIP_LIMITS[tier].meetups))],
                  [tr("템플릿"), '–', '✓', '✓', '✓'],
                  [tr("반복·대기 명단"), '–', '–', '✓', '✓'],
                  [tr("신청·참석 통계"), '–', '–', '–', '✓'],
                  [tr("판매·구인 글"), ...(['free', 'plus', 'pro', 'premium'] as const).map((tier) => String(MEMBERSHIP_LIMITS[tier].listings))],
                  [tr("글 끌올 간격"), ...(['free', 'plus', 'pro', 'premium'] as const).map((tier) => tr("{0}시간", GENERAL_BUMP_HOURS[tier]))],
                ] : [
                  [tr("한 달 글"), ...(['free', 'plus', 'pro', 'premium'] as const).map((tier) => String(BUSINESS_LIMITS[tier].posts))],
                  [tr("끌올"), ...(['free', 'plus', 'pro', 'premium'] as const).map((tier) => bumpEvery(BUSINESS_LIMITS[tier].bumpCooldownHours))],
                  [tr("공동 관리자"), ...(['free', 'plus', 'pro', 'premium'] as const).map((tier) => BUSINESS_LIMITS[tier].managers ? String(BUSINESS_LIMITS[tier].managers) : '–')],
                ])].map((cells, row) => <View key={cells[0] || 'head'} style={[styles.tableRow, { borderTopColor: theme.line }, row === 0 && { borderTopWidth: 0, backgroundColor: theme.backgroundElement }]}>
                  {cells.map((cell, column) => <ThemedText key={column} type={row === 0 ? 'smallBold' : 'small'} themeColor={column === 0 ? 'textSecondary' : undefined} style={[styles.cell, column === 0 && styles.cellLabel]}>{cell}</ThemedText>)}
                </View>)}
              {kind === 'general' && <ThemedText type="small" themeColor="textSecondary" style={styles.tableNote}>{tr("오늘 글과 1:1 대화는 모든 등급 제한 없음")}</ThemedText>}
            </View>}
            {kind === 'general' && <>
              <Disclosure label={tr("모임 이용 규칙")} note={tr("나가기·칠링 제한")} open={open.rules} onPress={() => toggle('rules')} analyticsId="membership.rules" />
              {open.rules && <View style={styles.stack}>
                <View style={styles.tiles}>
                  {([
                    ['모임 자리', '운영+참여 합산', '방장이 승인한 뒤부터 자리를 차지해요. 끝나거나 나가면 바로 돌아와요.', false],
                    ['1:1 대화', '바로 시작', '요청하고 수락받을 필요가 없어요. 끝내도 자리가 잠기지 않아요.', false],
                    ['스스로 나가기', '24시간 안에 3번째부터 12시간 참여 제한', '승인된 서로 다른 모임 기준이에요. 모임이 자연스럽게 끝났거나, 승인 전에 취소했거나, 호스트가 내보낸 경우는 세지 않아요.', true],
                    ['칠링 열기', '24시간 3번 · 7일 10번까지', '취소해도 연 횟수에 들어가요. 참가자가 있는 행사를 일찍 해산하면 7일 안에 두 번째부터 24시간 동안 새로 열 수 없어요. 무료·유료 모두 같아요.', true],
                  ] as const).map(([label, value, detail, wide]) => <View key={label} style={[styles.tile, wide && styles.tileWide, { backgroundColor: theme.card }]}>
                    <ThemedText type="small" themeColor="textSecondary">{tr(label)}</ThemedText>
                    <ThemedText type="smallBold" themeColor="accent">{tr(value)}</ThemedText>
                    <ThemedText type="small">{tr(detail)}</ThemedText>
                  </View>)}
                </View>
                <InfoNote>{tr("차단·신고, 과도한 연락을 막는 전송 속도 제한은 모든 등급에 적용돼요.")}</InfoNote>
                <MeetupPolicyNotice mode="join" />
                <MeetupPolicyNotice mode="once" />
              </View>}
            </>}
          </View>

          <View style={styles.links}>
            <Pressable analyticsId="app_profile_membership.pressable.8" onPress={() => { play('selection'); void restore(); }} accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} style={styles.textButton}><ThemedText type="small" themeColor="textSecondary">{tr("구매 복원")}</ThemedText></Pressable>
            <Pressable analyticsId="app_profile_membership.pressable.9" onPress={() => { play('selection'); void manage(kind); }} accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} style={styles.textButton}><ThemedText type="small" themeColor="textSecondary">{tr("구독 관리")}</ThemedText></Pressable>
            <Pressable analyticsId="app_profile_membership.pressable.10" onPress={() => openLegal('terms')} accessibilityRole="link" style={styles.textButton}><ThemedText type="small" themeColor="textSecondary">{tr("이용약관")}</ThemedText></Pressable>
            <Pressable analyticsId="app_profile_membership.pressable.11" onPress={() => openLegal('privacy')} accessibilityRole="link" style={styles.textButton}><ThemedText type="small" themeColor="textSecondary">{tr("개인정보처리방침")}</ThemedText></Pressable>
          </View>
        </ScrollView>

        {/* 구독 버튼은 화면 아래에 고정하고, 고른 등급·기간·가격을 바로 위에 보여준다. */}
        <View style={[styles.checkout, { backgroundColor: theme.background, borderTopColor: theme.line }]}>
          {purchaseUnavailableReason && <ThemedText type="small" themeColor="textSecondary" style={styles.center} accessibilityLiveRegion="polite">{purchaseUnavailableReason}</ThemedText>}
          <Pressable analyticsId="app_profile_membership.pressable.6" accessibilityRole="button" disabled={purchaseDisabled} accessibilityState={{ disabled: purchaseDisabled, busy }}
            onPress={() => { play('selection'); if (selectedOffer) void purchase(selectedOffer, kind === 'business' && merchantId ? merchantId : undefined); }}
            style={({ pressed }) => [styles.purchase, Depth.control, { backgroundColor: theme.accent, borderBottomColor: theme.accentDepth, borderBottomWidth: 3, opacity: purchaseDisabled ? 0.5 : pressed ? 0.85 : 1 }]}>
            {busy ? <GlingLoader color={theme.accentInk} accessibilityLabel={tr("구독 처리 중")} /> : <ThemedText type="smallBold" style={{ color: theme.accentInk }}>
              {currentProduct ? tr("현재 이용 중인 구독") : selectedOffer ? tr("{0} {1} 구독하기", tr(tierNames[selectedOffer.tier]), selectedOffer.period === 'year' ? tr("연간") : tr("월간")) : tr("구독 준비 중")}
            </ThemedText>}
          </Pressable>
          {selectedOffer && <ThemedText type="small" themeColor="textSecondary" style={styles.center}>{tr(selectedOffer.period === 'month' ? '매월 {0} · 자동 갱신 · 결제한 스토어에서 언제든 해지' : '매년 {0} · 자동 갱신 · 결제한 스토어에서 언제든 해지', selectedOffer.price)}</ThemedText>}
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

function Disclosure({ label, note, open, onPress, analyticsId }: { label: string; note?: string; open: boolean; onPress: () => void; analyticsId: string }) {
  const theme = useTheme();
  return <Pressable analyticsId={analyticsId} accessibilityRole="button" aria-expanded={open} accessibilityState={{ expanded: open }} onPress={onPress}
    style={({ pressed }) => [styles.disclosure, { borderTopColor: theme.line, opacity: pressed ? 0.65 : 1 }]}>
    <ThemedText type="smallBold" style={styles.flexText}>{label}</ThemedText>
    {note && <ThemedText type="small" themeColor="textSecondary">{note}</ThemedText>}
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
      <SymbolView name={{ ios: open ? 'chevron.up' : 'chevron.down', android: open ? 'keyboard_arrow_up' : 'keyboard_arrow_down', web: open ? 'keyboard_arrow_up' : 'keyboard_arrow_down' }} size={14} tintColor={theme.textSecondary} />
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  loading: { flex: 1 },
  content: { padding: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.three },
  stack: { gap: Spacing.two },
  segment: { flexDirection: 'row', borderRadius: 12, padding: Spacing.one, gap: Spacing.one },
  me: { borderRadius: 16, padding: Spacing.three, gap: Spacing.one },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  heading: { fontSize: 22, lineHeight: 30, fontWeight: 800, letterSpacing: -0.4 },
  badge: { borderRadius: 6, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  usage: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  usageTile: { flex: 1, borderRadius: 12, padding: 10, gap: 2 },
  usageValue: { fontSize: 16, lineHeight: 22 },
  bar: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: Spacing.one },
  row: { minHeight: 44, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, gap: Spacing.two, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' },
  flexText: { flex: 1 },
  disclosure: { minHeight: 48, borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  plan: { borderWidth: 2, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  planHeading: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  planName: { fontSize: 18, lineHeight: 26, fontWeight: 800 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two, flexWrap: 'wrap' },
  price: { fontSize: 20, lineHeight: 28, fontWeight: 700, letterSpacing: -0.2 },
  reference: { textDecorationLine: 'line-through' },
  facts: { flexDirection: 'row', borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  fact: { flex: 1, paddingVertical: Spacing.two, paddingHorizontal: Spacing.one, gap: 2 },
  free: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 14, padding: Spacing.three },
  managed: { borderRadius: 16, padding: Spacing.three, gap: Spacing.one, minHeight: 44 },
  table: { borderRadius: 14, overflow: 'hidden', marginBottom: Spacing.two },
  tableRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, paddingVertical: Spacing.two, paddingHorizontal: Spacing.two },
  cell: { flex: 1, textAlign: 'center' },
  cellLabel: { flex: 1.6, textAlign: 'left' },
  tableNote: { padding: Spacing.two },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tile: { flexGrow: 1, flexBasis: '45%', borderRadius: 14, padding: Spacing.three, gap: 2 }, tileWide: { flexBasis: '100%' },
  periods: { flexDirection: 'row', borderRadius: 12, padding: Spacing.one, gap: Spacing.one },
  periodIndicator: { position: 'absolute', top: Spacing.one, bottom: Spacing.one, left: Spacing.one, borderRadius: 8 },
  period: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8, padding: Spacing.two },
  periodLabel: { flexDirection: 'row', gap: Spacing.one },
  save: { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  saveText: { fontSize: 11, lineHeight: 15 },
  checkout: { gap: Spacing.one, paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
  purchase: { minHeight: 52, borderRadius: 14, padding: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  textButton: { minHeight: 44, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: Spacing.two },
  center: { textAlign: 'center' },
  feedback: { gap: Spacing.one },
});
