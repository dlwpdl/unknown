import { useLanguage } from '@/hooks/use-language';
import { GlingLoader } from '@/components/gling-loader';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Animated, LayoutAnimation, Linking, Platform, StyleSheet, UIManager, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoginPanel } from '@/components/login-panel';
import { RelationshipSlotCard } from '@/components/relationship-slot-card';
import { MeetupPolicyNotice } from '@/components/meetup-policy-notice';
import { InfoNote } from '@/components/notice-blocks';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Depth, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { BUSINESS_LIMITS, GENERAL_BUMP_HOURS, MEMBERSHIP_LIMITS, type BusinessMembershipSnapshot, type MembershipKind, type MembershipOffer } from '@/lib/membership';
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
  const { tr, t, locale: appLocale } = useLanguage();
  const periodNames = { get month() { return tr("월"); }, get year() { return tr("년"); } };
  const theme = useTheme();
  const router = useRouter();
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
    void loadMyMerchants(supabase).then((values) => {
      if (!active) return;
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
  const [plansExpanded, setPlansExpanded] = useState(true);
  const [periodWidth, setPeriodWidth] = useState(0);
  const [periodPosition] = useState(() => new Animated.Value(0));
  const animateLayout = () => {
    if (reducedMotion) return;
    if (Platform?.OS === 'android') UIManager?.setLayoutAnimationEnabledExperimental?.(true);
    LayoutAnimation?.configureNext?.(LayoutAnimation.Presets.easeInEaseOut);
  };
  const perks = (items: string[]) => items.map(item => <View key={item} style={styles.perk}>
    <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={12} tintColor={theme.accent} />
    <ThemedText type="small" style={styles.flexText}>{item}</ThemedText>
  </View>);
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
  const leave = () => router.canGoBack() ? router.back() : router.replace(Platform.OS === 'web' ? '/?tag=meetup' : '/profile');
  const openLegal = (slug: 'terms' | 'privacy') => {
    play('selection');
    void Linking.openURL(`${publicSiteUrl}/${slug}`).catch(() => Alert.alert(tr("페이지를 열지 못했어요"), tr("잠시 후 다시 시도해 주세요.")));
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

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView analyticsId="app_profile_membership.scrollview.1" contentContainerStyle={styles.content}>
          <View accessibilityRole="tablist" style={styles.row}>
            {([['general', tr("일반")], ['business', tr("비즈니스")]] as const).map(([value, label]) => <Pressable analyticsId={`membership.family.${value}`} key={value} accessibilityRole="tab" accessibilityState={{ selected: kind === value, disabled: busy }} disabled={busy}
              onPress={() => { play('selection'); animateLayout(); setKind(value); }} style={({ pressed }) => [styles.period, { backgroundColor: kind === value ? theme.backgroundElement : 'transparent', opacity: pressed ? 0.65 : 1 }]}><ThemedText type="smallBold">{label}</ThemedText></Pressable>)}
          </View>
          {kind === 'business' && <View style={styles.detailContent}>
            <ThemedText type="small" themeColor="textSecondary">{tr("비즈니스별로 글링 안의 홍보글을 관리해요. 개인 멤버십과 별도예요.")}</ThemedText>
            {companies.map((company) => <Pressable analyticsId="membership.business.select" key={company.id} accessibilityRole="radio" accessibilityState={{ selected: merchantId === company.id, checked: merchantId === company.id, disabled: busy }} disabled={busy}
              onPress={() => { play('selection'); setMerchantId(company.id); }} style={({ pressed }) => [styles.row, { borderWidth: 1, borderRadius: 12, borderColor: merchantId === company.id ? theme.accent : theme.line, opacity: pressed ? 0.65 : 1 }]}><ThemedText type="smallBold">{company.name}</ThemedText></Pressable>)}
            {businessError && <ThemedText type="small" accessibilityRole="alert">{tr(businessError)}</ThemedText>}
            {business && !business.canPurchase && <ThemedText type="small">{tr("확인된 비즈니스 소유자만 구독을 연결할 수 있어요.")}</ThemedText>}
            {otherBusiness && <ThemedText type="small">{tr("결제 연결은 다른 비즈니스에 묶여 있어요. 해당 비즈니스를 선택해 주세요.")}</ThemedText>}
            {business?.canPurchase && membership?.businessSubscription?.tier !== 'free' && membership?.businessSubscription && !membership.businessSubscription.merchantId && <Pressable analyticsId="membership.business.bind" accessibilityRole="button" disabled={busy || loading} style={styles.textButton}
              onPress={() => { play('selection'); void supabase.rpc('bind_business_membership', { p_merchant_id: merchantId }).then(({ error }) => { if (error) setBusinessError('현재 계정의 비즈니스 소유 확인을 다시 확인해 주세요.'); else void refresh(); }); }}><ThemedText type="smallBold" themeColor="accent">{tr("기존 구독을 이 비즈니스에 연결")}</ThemedText></Pressable>}
          </View>}
          <View style={[styles.card, Depth.card, { borderColor: theme.line, backgroundColor: theme.card }]}>
            <View style={styles.row}>
              <View style={styles.planIdentity}>
                <ThemedText type="small" themeColor="textSecondary">{tr("내 멤버십")}</ThemedText>
                <ThemedText accessibilityRole="header" style={styles.heading}>{activeMembership ? tr(tierNames[activeMembership.tier]) : loading ? tr("확인 중") : tr("확인 필요")}</ThemedText>
              </View>
              {activeMembership?.tier === 'free' && <View style={[styles.badge, { backgroundColor: theme.backgroundElement }]}><ThemedText type="smallBold" themeColor="textSecondary">{tr("무료")}</ThemedText></View>}
            </View>
            {activeMembership?.expiresAt && activeMembership.tier !== 'free' && <ThemedText type="small" themeColor="textSecondary" style={styles.statusNote}>
              {tr(activeMembership.willRenew === true ? '{0} 갱신 예정' : activeMembership.willRenew === false ? '{0} 까지 이용 가능' : '{0} 이용 기간 종료 예정', new Date(activeMembership.expiresAt).toLocaleDateString(appLocale))}
            </ThemedText>}
            {kind === 'general' && auth.isAdmin && <ThemedText type="small" themeColor="accent" style={styles.statusNote}>{tr("관리자 계정 · 모임을 제한 없이 이용해요.")}</ThemedText>}
            {kind === 'general' && membership?.planVersion === 1 && <ThemedText type="small" themeColor="textSecondary" style={styles.statusNote}>{tr("기존 구독 가격과 더 빠른 끌어올리기 혜택을 유지해요.")}</ThemedText>}
          </View>

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

          {/* 같은 주제(자리)를 한 자리에 모으고, 규칙과 플랜은 아래 섹션으로 내린다. */}
          {kind === 'general' ? <>
          <SectionHead title={tr("사용 현황")} note={tr("지금 이 순간 기준")} />
          <View style={[styles.row, { borderWidth: 1, borderRadius: 12, borderColor: theme.line, backgroundColor: theme.card }]} accessible accessibilityLabel={tr("오늘 이야기 글, 횟수 제한 없음")}>
            <ThemedText type="small" themeColor="textSecondary">{tr("오늘 이야기 글")}</ThemedText>
            <ThemedText type="smallBold" themeColor="accent">{tr("횟수 제한 없음")}</ThemedText>
          </View>
          {auth.isAdmin ? <View style={[styles.row, { borderWidth: 1, borderRadius: 12, borderColor: theme.line, backgroundColor: theme.card }]}>
            <ThemedText type="smallBold" themeColor="accent">{tr("관리자 계정 · 제한 없음")}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.flexText}>{tr("모임을 숫자와 무관하게 이용해요.")}</ThemedText>
          </View> : <>
          <RelationshipSlotCard kind="meetup" membership={membership} loading={loading} />
          </>}



          <SectionHead title={tr("이용 규칙")} note={tr("모임·대화 규칙")} />
          <View style={styles.tiles}>
            {([
              ['모임 자리', '운영+참여 합산', '방장이 승인한 뒤부터 자리를 차지해요. 끝나거나 나가면 바로 돌아와요.', false],
              ['1:1 대화', '바로 시작', '요청하고 수락받을 필요가 없어요. 끝내도 자리가 잠기지 않아요.', false],
              ['스스로 나가기', '24시간 안에 3번째부터 12시간 참여 제한', '승인된 서로 다른 모임 기준이에요. 모임이 자연스럽게 끝났거나, 승인 전에 취소했거나, 호스트가 내보낸 경우는 세지 않아요.', true],
              ['칠링 열기', '24시간 3번 · 7일 10번까지', '취소해도 연 횟수에 들어가요. 참가자가 있는 행사를 일찍 해산하면 7일 안에 두 번째부터 24시간 동안 새로 열 수 없어요. 무료·유료 모두 같아요.', true],
            ] as const).map(([label, value, body, wide]) => <View key={label} style={[styles.tile, wide && styles.tileWide, { backgroundColor: theme.card }]}>
              <ThemedText type="small" themeColor="textSecondary">{tr(label)}</ThemedText>
              <ThemedText type="smallBold" themeColor="accent" style={styles.tileValue}>{tr(value)}</ThemedText>
              <ThemedText type="small">{tr(body)}</ThemedText>
            </View>)}
          </View>
          <InfoNote>{tr("차단·신고, 과도한 연락을 막는 전송 속도 제한은 모든 등급에 적용돼요.")}</InfoNote>

          <MeetupPolicyNotice mode="join" />
          <MeetupPolicyNotice mode="once" />
          </> : <View style={styles.detailContent}>
            <SectionHead title={tr("이번 달 사용")} note={business ? tr("{0} 초기화", (new Date(business.resetsAt).toLocaleDateString(appLocale))) : tr("비즈니스별 합산")} />
            {business && <ThemedText>{tr('신규 {0} / {1}편 · 끌어올리기 {2} / {3}회', business.postsUsed, business.postLimit ?? tr('기존 약정 유지'), business.bumpsUsed, business.bumpLimit ?? tr('한도 없음'))}</ThemedText>}
            {business?.tier === 'premium' && <ThemedText type="small">{tr('운영대행 사용: 신규 {0}/4편 · 끌어올리기 {1}/8회 · 보고서 {2}/1회', business.managedPostsUsed, business.managedBumpsUsed, business.reportsUsed)}</ThemedText>}
            <ThemedText type="small" themeColor="textSecondary">{tr("같은 내용은 새 글로 다시 올릴 수 없어요. 기존 글을 수정하거나 끌어올려 주세요. 끌어올리기는 모든 글을 합쳐 무료 5일, 플러스 이틀, 프로 하루, 프리미엄 12시간에 한 번이에요.")}</ThemedText>
          </View>}

          <SectionHead title={tr("플랜 비교")} note={tr("현재 플랜이 표시됩니다")} />
          <Pressable analyticsId="app_profile_membership.pressable.3" accessibilityRole="button" aria-expanded={plansExpanded} accessibilityState={{ expanded: plansExpanded }}
            onPress={() => { play('selection'); animateLayout(); setPlansExpanded(value => !value); }}
            style={({ pressed }) => [styles.disclosure, { opacity: pressed ? 0.65 : 1 }]}>
            <View style={styles.planIdentity}>
              <ThemedText type="smallBold">{tr("멤버십 비교")}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{tr("베이직 · 플러스 · 프로 · 프리미엄")}</ThemedText>
            </View>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
              <SymbolView name={{ ios: plansExpanded ? 'chevron.up' : 'chevron.down', android: plansExpanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down', web: plansExpanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down' }} size={16} tintColor={theme.textSecondary} />
            </View>
          </Pressable>

          {plansExpanded && <View style={styles.comparison}>
            <View style={styles.freePlan}>
              <ThemedText type="smallBold">{tr("베이직 · 무료")}</ThemedText>
              {perks(kind === 'general' ? [tr('오늘 글 무제한 · 동시 모임 {0}개', MEMBERSHIP_LIMITS.free.meetups), t.membership.listingBenefits.free] : [tr("월 신규 1편 · 끌어올리기 월 2회(5일에 한 번) · 직접 관리")])}
            </View>

            {plans.map((plan) => {
              const limits = MEMBERSHIP_LIMITS[plan.tier];
              const offer = familyOffers.find((item) => item.tier === plan.tier && item.period === period) ?? familyOffers.find((item) => item.tier === plan.tier);
              const selected = selection.tier === plan.tier;
              return <Pressable analyticsId="app_profile_membership.pressable.4" key={plan.tier} accessibilityRole="radio" aria-checked={selected} accessibilityState={{ selected, checked: selected, disabled: busy }} disabled={busy}
                onPress={() => selectPlan({ tier: plan.tier, period: offer?.period ?? period })}
                style={({ pressed }) => [styles.plan, selected && Depth.card, { backgroundColor: theme.card, borderColor: selected ? theme.accent : theme.line, opacity: pressed ? 0.88 : 1, }]}>
                <View style={styles.planHeading}>
                  <ThemedText style={styles.planName}>{tr(plan.name)}</ThemedText>
                  <ThemedText type="smallBold" themeColor={selected ? 'accent' : 'textSecondary'}>{selected ? tr("✓ 선택됨") : tr("선택하기")}</ThemedText>
                </View>
                <View style={styles.priceRow}>
                  <ThemedText style={styles.price}>{offer ? `${offer.price} / ${periodNames[offer.period]}` : offersLoading ? tr("가격 확인 중") : tr("준비 중")}</ThemedText>
                </View>
                {kind === 'general' ? perks([tr('오늘 글 무제한 · 동시 모임 {0}개', limits.meetups), tr(plan.tier === 'plus' ? '모임 템플릿 · 질문 재사용' : plan.tier === 'pro' ? '템플릿 · 반복 회차 · 대기 명단 · 공동 호스트' : 'Pro 모임 도구 · 신청·참석 통계'), t.membership.listingBenefits[plan.tier]]) : <>
                  {perks([tr('월 신규 {0}편', BUSINESS_LIMITS[plan.tier].posts), BUSINESS_LIMITS[plan.tier].bumpCooldownHours % 24 === 0 ? tr('끌어올리기 {0}일에 한 번 · 모든 글 합쳐서', BUSINESS_LIMITS[plan.tier].bumpCooldownHours / 24) : tr('끌어올리기 {0}시간에 한 번 · 모든 글 합쳐서', BUSINESS_LIMITS[plan.tier].bumpCooldownHours), plan.tier === 'premium' ? tr("운영대행: 신규 4편 · 끌어올리기 8회 · 월간 보고서 1회") : tr("직접 관리 · 연결된 AI와 사용량 공유")])}
                  {plan.tier === 'premium' && <ThemedText type="small" themeColor="textSecondary">{tr("운영대행 4편은 전체 30편에 포함돼요. 대행 끌어올리기도 12시간에 한 번을 함께 써요.")}</ThemedText>}
                </>}
              </Pressable>;
            })}
            {kind === 'general' && <ThemedText type="small" themeColor="textSecondary">{tr('계정과 같은 글에 {0}시간 간격이 적용돼요. 쓰지 않은 끌어올리기는 쌓이지 않아요.', GENERAL_BUMP_HOURS[selection.tier])}</ThemedText>}

            {periods.length > 1 && <View onLayout={event => setPeriodWidth(event.nativeEvent.layout.width)} style={[styles.periods, { backgroundColor: theme.backgroundElement }]}>
              {periodWidth > 0 && <Animated.View pointerEvents="none" style={[styles.periodIndicator, { width: (periodWidth - 12) / 2, backgroundColor: theme.card, transform: [{ translateX: periodPosition.interpolate({ inputRange: [0, 1], outputRange: [0, (periodWidth - 12) / 2 + 4] }) }] }]} />}
              {periods.map((value) => <Pressable analyticsId="app_profile_membership.pressable.5" key={value} accessibilityRole="radio" aria-checked={value === period} accessibilityState={{ selected: value === period, checked: value === period, disabled: busy }} disabled={busy}
                onPress={() => selectPlan({ ...selection, period: value })}
                style={({ pressed }) => [styles.period, { backgroundColor: periodWidth === 0 && value === period ? theme.card : 'transparent', opacity: pressed ? 0.7 : 1 }]}>
                <ThemedText type="smallBold">{value === 'month' ? tr("월 구독") : tr("연 구독")}</ThemedText>
              </Pressable>)}
            </View>}

            <View style={styles.checkout}>
              {selectedOffer && <ThemedText type="smallBold" style={styles.center}>{tr(tierNames[selectedOffer.tier])} · {selectedOffer.price} / {periodNames[selectedOffer.period]}</ThemedText>}
              {purchaseUnavailableReason && <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">{purchaseUnavailableReason}</ThemedText>}
              <Pressable analyticsId="app_profile_membership.pressable.6" accessibilityRole="button" disabled={purchaseDisabled} accessibilityState={{ disabled: purchaseDisabled, busy }}
                onPress={() => { play('selection'); if (selectedOffer) void purchase(selectedOffer, kind === 'business' && merchantId ? merchantId : undefined); }}
                style={({ pressed }) => [styles.purchase, Depth.control, { backgroundColor: theme.accent, borderBottomColor: theme.accentDepth, borderBottomWidth: 3, opacity: purchaseDisabled ? 0.5 : 1, }]}>
                {busy ? <GlingLoader color={theme.accentInk} accessibilityLabel={tr("구독 처리 중")} /> : <ThemedText type="smallBold" style={{ color: theme.accentInk }}>
                  {currentProduct ? tr("현재 이용 중인 구독") : selectedOffer ? tr("{0} 구독하기", tr(tierNames[selectedOffer.tier])) : tr("구독 준비 중")}
                </ThemedText>}
              </Pressable>
              {selectedOffer && <ThemedText type="small" themeColor="textSecondary">{tr(selectedOffer.period === 'month' ? '매월 {0}이 청구되며 자동 갱신됩니다. 구독 변경과 해지는 결제한 스토어에서 관리할 수 있어요.' : '매년 {0}이 청구되며 자동 갱신됩니다. 구독 변경과 해지는 결제한 스토어에서 관리할 수 있어요.', selectedOffer.price)}</ThemedText>}
              <Pressable analyticsId="app_profile_membership.pressable.7" onPress={() => { play('selection'); leave(); }} accessibilityRole="button" style={({ pressed }) => [styles.textButton, { opacity: pressed ? 0.65 : 1 }]}><ThemedText type="smallBold">{membership?.tier === 'free' ? tr("무료로 계속하기") : tr("돌아가기")}</ThemedText></Pressable>
            </View>
          </View>}

          <View style={[styles.links, { borderTopColor: theme.line }]}>
            <Pressable analyticsId="app_profile_membership.pressable.8" onPress={() => { play('selection'); void restore(); }} accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} style={styles.textButton}><ThemedText type="small">{tr("구매 복원")}</ThemedText></Pressable>
            <Pressable analyticsId="app_profile_membership.pressable.9" onPress={() => { play('selection'); void manage(kind); }} accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} style={styles.textButton}><ThemedText type="small">{tr("구독 관리")}</ThemedText></Pressable>
            <Pressable analyticsId="app_profile_membership.pressable.10" onPress={() => openLegal('terms')} accessibilityRole="link" style={styles.textButton}><ThemedText type="small" themeColor="textSecondary">{tr("이용약관")}</ThemedText></Pressable>
            <Pressable analyticsId="app_profile_membership.pressable.11" onPress={() => openLegal('privacy')} accessibilityRole="link" style={styles.textButton}><ThemedText type="small" themeColor="textSecondary">{tr("개인정보처리방침")}</ThemedText></Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function SectionHead({ title, note }: { title: string; note: string }) {

  return (
    <View style={styles.sectionHead}>
      <ThemedText type="smallBold" accessibilityRole="header">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{note}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  loading: { flex: 1 },
  content: { padding: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.three },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: Spacing.two, paddingTop: Spacing.two },
  heading: { fontSize: 24, lineHeight: 32, fontWeight: 700, letterSpacing: -0.5 },
  planIdentity: { gap: Spacing.one, flexShrink: 1 },
  badge: { borderRadius: 6, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  card: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  row: { minHeight: 44, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, gap: Spacing.two, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' },
  flexText: { flexShrink: 1 },
  statusNote: { padding: Spacing.three, paddingTop: Spacing.two },
  disclosure: { minHeight: 48, paddingVertical: Spacing.two, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  detailContent: { paddingBottom: Spacing.three, gap: Spacing.two },
  comparison: { gap: Spacing.three },
  freePlan: { gap: Spacing.one, paddingVertical: Spacing.two },
  perk: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tile: { flexGrow: 1, flexBasis: '45%', borderRadius: 14, padding: Spacing.three, gap: 2 }, tileWide: { flexBasis: '100%' },
  tileValue: { fontSize: 17, lineHeight: 24 },
  plan: { borderWidth: 2, borderRadius: 12, padding: Spacing.three, gap: Spacing.one },
  planHeading: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  planName: { fontSize: 19, lineHeight: 27, fontWeight: 700 },
  price: { fontSize: 19, lineHeight: 27, fontWeight: 700, paddingVertical: Spacing.one },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two, flexWrap: 'wrap' },
  reference: { textDecorationLine: 'line-through' },
  periods: { flexDirection: 'row', borderRadius: 12, padding: Spacing.one, gap: Spacing.one },
  periodIndicator: { position: 'absolute', top: Spacing.one, bottom: Spacing.one, left: Spacing.one, borderRadius: 8 },
  period: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8, padding: Spacing.two },
  checkout: { gap: Spacing.two },
  purchase: { minHeight: 52, borderRadius: 12, padding: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  textButton: { minHeight: 44, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  links: { borderTopWidth: 1, paddingTop: Spacing.two, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: Spacing.two },
  center: { textAlign: 'center' },
  feedback: { gap: Spacing.one },
});
