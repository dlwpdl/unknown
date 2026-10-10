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
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Depth, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
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
const tierNames = { free: '베이직', plus: '플러스', pro: '프로', premium: '프리미엄' };
const periodNames = { month: '월', year: '년' };

export default function MembershipScreen() {
  const theme = useTheme();
  const router = useRouter();
  const auth = useAuth();
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const { membership, loading, error, notice, offers, offersLoading, busy, purchaseUnavailableReason, pendingApproval, confirmPendingCancellation, refresh, purchase, restore, manage } = useMembership();
  useFocusEffect(useCallback(() => {
    if (auth.isAuthed) void refresh();
  }, [auth.isAuthed, refresh]));
  const [selection, setSelection] = useState<{ tier: MembershipOffer['tier']; period: MembershipOffer['period'] }>({ tier: 'premium', period: 'month' });
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
      setBusinessError(values.length ? null : '연결된 업체가 없어요. 업체 소유 확인 후 구독할 수 있어요.');
    }).catch(() => { if (active) setBusinessError('업체 연결과 소유 확인이 필요해요. 결제는 진행되지 않아요.'); });
    return () => { active = false; };
  }, [auth.isAuthed, auth.me.id, kind, membership?.businessSubscription?.merchantId]);
  useEffect(() => {
    if (!auth.isAuthed || kind !== 'business' || !merchantId) return;
    let active = true;
    void Promise.resolve(supabase.rpc('get_business_membership', { p_merchant_id: merchantId })).then(({ data, error }) => {
      if (!active) return;
      if (error || !data || data.merchantId !== merchantId) { setBusinessError('업체 멤버십을 확인하지 못했어요. 잠시 후 다시 확인해 주세요.'); return; }
      setBusiness({ userId: auth.me.id, value: data as BusinessMembershipSnapshot }); setBusinessError(null);
    }).catch(() => { if (active) setBusinessError('업체 멤버십을 확인하지 못했어요. 잠시 후 다시 확인해 주세요.'); });
    return () => { active = false; };
  }, [auth.isAuthed, auth.me.id, kind, merchantId, membership]);
  const [rulesExpanded, setRulesExpanded] = useState(false);
  const [plansExpanded, setPlansExpanded] = useState(true);
  const [periodWidth, setPeriodWidth] = useState(0);
  const [periodPosition] = useState(() => new Animated.Value(0));
  const animateLayout = () => {
    if (reducedMotion) return;
    if (Platform?.OS === 'android') UIManager?.setLayoutAnimationEnabledExperimental?.(true);
    LayoutAnimation?.configureNext?.(LayoutAnimation.Presets.easeInEaseOut);
  };
  const selectPlan = (next: typeof selection) => {
    play('selection');
    animateLayout();
    if (reducedMotion) periodPosition.setValue(next.period === 'year' ? 1 : 0);
    else Animated.timing(periodPosition, { toValue: next.period === 'year' ? 1 : 0, duration: 200, useNativeDriver: true }).start();
    setSelection(next);
  };
  const familyOffers = offers.filter((offer) => offer.kind === kind && offer.planVersion === 2);
  const selectedOffer = familyOffers.find((offer) => offer.tier === selection.tier && offer.period === selection.period)
    ?? familyOffers.find((offer) => offer.tier === selection.tier);
  const period = selectedOffer?.period ?? selection.period;
  const periods = (['month', 'year'] as const).filter((value) => familyOffers.some((offer) => offer.tier === selection.tier && offer.period === value));
  const currentProduct = !!activeMembership && activeMembership.tier !== 'free' && !!selectedOffer && selectedOffer.productId === activeMembership.productId;
  const otherBusiness = kind === 'business' && !!membership?.businessSubscription?.merchantId && membership.businessSubscription.merchantId !== merchantId;
  const purchaseDisabled = busy || loading || offersLoading || !selectedOffer || !membership || membership.billingPolicyVersion !== 2 || !!purchaseUnavailableReason || currentProduct || (kind === 'business' && (!business?.canPurchase || otherBusiness));
  const publicSiteUrl = (process.env.EXPO_PUBLIC_APP_URL ?? 'https://gling.ej-entertainment.com').replace(/\/$/, '');
  const leave = () => router.canGoBack() ? router.back() : router.replace('/profile');
  const openLegal = (slug: 'terms' | 'privacy') => {
    play('selection');
    void Linking.openURL(`${publicSiteUrl}/${slug}`).catch(() => Alert.alert('페이지를 열지 못했어요', '잠시 후 다시 시도해 주세요.'));
  };
  const confirmStoreCancellation = () => {
    play('selection');
    Alert.alert('대기 구매가 취소·거절됐나요?', '결제한 스토어에서 이전 요청의 취소 또는 거절 완료 안내를 확인한 경우에만 계속해 주세요. 빈 구독 목록만으로는 확인할 수 없어요. 승인 대기가 남아 있으면 다시 구매할 때 중복 청구될 수 있어요.', [
      { text: '아직 확인 못 했어요', style: 'cancel', onPress: () => play('selection') },
      { text: '취소·거절 확인 완료', onPress: () => { play('selection'); void confirmPendingCancellation(); } },
    ]);
  };

  if (auth.isAuthLoading) return <GlingLoader color={theme.accent} style={styles.loading} accessibilityLabel="로그인 확인 중" />;
  if (!auth.isAuthed) return <LoginPanel reason="내 멤버십을 확인하고 이어서 이용하려면 로그인해 주세요." onApple={auth.signInApple} onKakao={auth.signInKakao} onGoogle={auth.signInGoogle} onDevLogin={auth.signInDev} loading={auth.isAuthLoading} error={auth.authError} />;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView analyticsId="app_profile_membership.scrollview.1" contentContainerStyle={styles.content}>
          <View accessibilityRole="tablist" style={styles.row}>
            {([['general', '일반'], ['business', '비즈니스']] as const).map(([value, label]) => <Pressable analyticsId={`membership.family.${value}`} key={value} accessibilityRole="tab" accessibilityState={{ selected: kind === value, disabled: busy }} disabled={busy}
              onPress={() => { play('selection'); animateLayout(); setKind(value); }} style={({ pressed }) => [styles.period, { backgroundColor: kind === value ? theme.backgroundElement : 'transparent', opacity: pressed ? 0.65 : 1 }]}><ThemedText type="smallBold">{label}</ThemedText></Pressable>)}
          </View>
          {kind === 'business' && <View style={styles.detailContent}>
            <ThemedText type="small" themeColor="textSecondary">업체별로 글링 안의 홍보글을 관리해요. 개인 멤버십과 별도예요.</ThemedText>
            {companies.map((company) => <Pressable analyticsId="membership.business.select" key={company.id} accessibilityRole="radio" accessibilityState={{ selected: merchantId === company.id, checked: merchantId === company.id, disabled: busy }} disabled={busy}
              onPress={() => { play('selection'); setMerchantId(company.id); }} style={({ pressed }) => [styles.row, { borderWidth: 1, borderRadius: 12, borderColor: merchantId === company.id ? theme.accent : theme.line, opacity: pressed ? 0.65 : 1 }]}><ThemedText type="smallBold">{company.name}</ThemedText></Pressable>)}
            {businessError && <ThemedText type="small" accessibilityRole="alert">{businessError}</ThemedText>}
            {business && !business.canPurchase && <ThemedText type="small">확인된 업체 소유자만 구독을 연결할 수 있어요.</ThemedText>}
            {otherBusiness && <ThemedText type="small">결제 연결은 다른 업체에 묶여 있어요. 해당 업체를 선택해 주세요.</ThemedText>}
            {business?.canPurchase && membership?.businessSubscription?.tier !== 'free' && membership?.businessSubscription && !membership.businessSubscription.merchantId && <Pressable analyticsId="membership.business.bind" accessibilityRole="button" disabled={busy || loading} style={styles.textButton}
              onPress={() => { play('selection'); void supabase.rpc('bind_business_membership', { p_merchant_id: merchantId }).then(({ error }) => { if (error) setBusinessError('현재 계정의 업체 소유 확인을 다시 확인해 주세요.'); else void refresh(); }); }}><ThemedText type="smallBold" themeColor="accent">기존 구독을 이 업체에 연결</ThemedText></Pressable>}
          </View>}
          <View style={[styles.card, Depth.card, { borderColor: theme.line, backgroundColor: theme.card }]}>
            <View style={styles.row}>
              <View style={styles.planIdentity}>
                <ThemedText type="small" themeColor="textSecondary">내 멤버십</ThemedText>
                <ThemedText accessibilityRole="header" style={styles.heading}>{activeMembership ? tierNames[activeMembership.tier] : loading ? '확인 중' : '확인 필요'}</ThemedText>
              </View>
              {activeMembership?.tier === 'free' && <View style={[styles.badge, { backgroundColor: theme.backgroundElement }]}><ThemedText type="smallBold" themeColor="textSecondary">무료</ThemedText></View>}
            </View>
            {activeMembership?.expiresAt && activeMembership.tier !== 'free' && <ThemedText type="small" themeColor="textSecondary" style={styles.statusNote}>
              {new Date(activeMembership.expiresAt).toLocaleDateString('ko-KR')} {activeMembership.willRenew === true ? '갱신 예정' : activeMembership.willRenew === false ? '까지 이용 가능' : '이용 기간 종료 예정'}
            </ThemedText>}
            {kind === 'general' && auth.isAdmin && <ThemedText type="small" themeColor="accent" style={styles.statusNote}>관리자 계정 · 모임을 제한 없이 이용해요.</ThemedText>}
            {kind === 'general' && membership?.planVersion === 1 && <ThemedText type="small" themeColor="textSecondary" style={styles.statusNote}>기존 구독 가격과 더 빠른 끌어올리기 혜택을 유지해요.</ThemedText>}
          </View>

          {(error || notice || pendingApproval) && <View style={styles.feedback}>
            {error && <ThemedText type="small" themeColor="accent" accessibilityRole="alert">{error}</ThemedText>}
            {notice && <ThemedText type="small" accessibilityLiveRegion="polite">{notice}</ThemedText>}
            <Pressable analyticsId="app_profile_membership.pressable.1" onPress={() => { play('selection'); void refresh(); }} accessibilityRole="button" disabled={busy || loading} accessibilityState={{ disabled: busy || loading }} style={({ pressed }) => [styles.textButton, { opacity: pressed ? 0.65 : 1 }]}><ThemedText type="smallBold" themeColor="accent">다시 확인하기</ThemedText></Pressable>
            {pendingApproval && <>
              <ThemedText type="small" themeColor="textSecondary">스토어의 취소·거절 완료 안내를 확인해 주세요. 빈 구독 목록만으로는 확인할 수 없어요. 승인 대기가 계속되면 다시 구매하지 마세요.</ThemedText>
              <Pressable analyticsId="membership.pending.manage" onPress={() => { play('selection'); void manage(); }} accessibilityRole="button" disabled={busy || loading} accessibilityState={{ disabled: busy || loading }} style={styles.textButton}><ThemedText type="smallBold" themeColor="accent">스토어 구독 관리 열기</ThemedText></Pressable>
              <Pressable analyticsId="membership.pending.confirm_cancellation" onPress={confirmStoreCancellation} accessibilityRole="button" accessibilityHint="스토어의 취소 또는 거절을 확인한 경우에만 구매 대기를 해제해요." disabled={busy || loading} accessibilityState={{ disabled: busy || loading, busy }} style={styles.textButton}><ThemedText type="smallBold" themeColor="accent">스토어에서 대기 구매 취소·거절을 확인했어요</ThemedText></Pressable>
            </>}
          </View>}

          {/* 같은 주제(자리)를 한 자리에 모으고, 규칙과 플랜은 아래 섹션으로 내린다. */}
          {kind === 'general' ? <>
          <SectionHead title="사용 현황" note="지금 이 순간 기준" />
          <View style={[styles.row, { borderWidth: 1, borderRadius: 12, borderColor: theme.line, backgroundColor: theme.card }]} accessible accessibilityLabel="오늘 이야기 글, 횟수 제한 없음">
            <ThemedText type="small" themeColor="textSecondary">오늘 이야기 글</ThemedText>
            <ThemedText type="smallBold" themeColor="accent">횟수 제한 없음</ThemedText>
          </View>
          {auth.isAdmin ? <View style={[styles.row, { borderWidth: 1, borderRadius: 12, borderColor: theme.line, backgroundColor: theme.card }]}>
            <ThemedText type="smallBold" themeColor="accent">관리자 계정 · 제한 없음</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.flexText}>모임을 숫자와 무관하게 이용해요.</ThemedText>
          </View> : <>
          <RelationshipSlotCard kind="meetup" membership={membership} loading={loading} />
          </>}



          <SectionHead title="이용 규칙" note="필요할 때만 펼쳐 보세요" />
          <View style={[styles.details, { borderColor: theme.line }]}>
            <Pressable analyticsId="app_profile_membership.pressable.2" accessibilityRole="button" aria-expanded={rulesExpanded} accessibilityState={{ expanded: rulesExpanded }}
              onPress={() => { play('selection'); animateLayout(); setRulesExpanded(value => !value); }}
              style={({ pressed }) => [styles.disclosure, { opacity: pressed ? 0.65 : 1 }]}>
              <ThemedText type="smallBold" style={styles.flexText}>자리 사용 · 반복 이용 제한 안내</ThemedText>
              <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
                <SymbolView name={{ ios: rulesExpanded ? 'chevron.up' : 'chevron.down', android: rulesExpanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down', web: rulesExpanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down' }} size={16} tintColor={theme.textSecondary} />
              </View>
            </Pressable>
            {rulesExpanded && <View style={styles.detailContent}>
              <ThemedText type="small" themeColor="textSecondary">모임은 동시에 운영·참여하는 개수를 합산해요. 참여는 방장 승인 후 자리를 사용해요. 1:1 대화는 요청·수락 없이 바로 시작해요.</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">모임 종료·퇴장 시 자리는 바로 돌아와요. 최근 24시간에 승인된 서로 다른 모임에서 자진 퇴장 3회째부터 새 참여가 12시간 제한돼요. 자연 종료·승인 전 취소·강퇴는 제외돼요.</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">칠링 개최는 최근 24시간 3회·7일 10회까지예요. 취소해도 개최 횟수는 유지돼요. 참가자가 있는 행사 조기 해산은 최근 7일 2회째부터 새 개최가 24시간 제한돼요. 무료·유료에 동일하게 적용돼요.</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">1:1 대화를 종료해도 자리 잠금이 없어요. 차단·신고와 과도한 연락을 막는 전송 속도 제한은 모든 등급에 적용돼요.</ThemedText>
            </View>}
          </View>

          <MeetupPolicyNotice mode="join" />
          <MeetupPolicyNotice mode="once" />
          </> : <View style={styles.detailContent}>
            <SectionHead title="이번 달 사용" note={business ? `${new Date(business.resetsAt).toLocaleDateString('ko-KR')} 초기화` : '업체별 합산'} />
            {business && <ThemedText>신규 {business.postsUsed} / {business.postLimit ?? '기존 약정 유지'}편 · 끌어올리기 {business.bumpsUsed} / {business.bumpLimit}회</ThemedText>}
            {business?.tier === 'premium' && <ThemedText type="small">운영대행 사용: 신규 {business.managedPostsUsed}/4편 · 끌어올리기 {business.managedBumpsUsed}/8회 · 보고서 {business.reportsUsed}/1회</ThemedText>}
            <ThemedText type="small" themeColor="textSecondary">같은 내용은 새 글로 다시 올릴 수 없어요. 기존 글을 수정하거나 끌어올려 주세요. 같은 글은 플러스 72시간·프로 60시간·프리미엄 48시간 간격이에요. 비즈니스 전체는 24시간 간격을 지켜 주세요.</ThemedText>
          </View>}

          <SectionHead title="플랜 비교" note="현재 플랜이 표시됩니다" />
          <Pressable analyticsId="app_profile_membership.pressable.3" accessibilityRole="button" aria-expanded={plansExpanded} accessibilityState={{ expanded: plansExpanded }}
            onPress={() => { play('selection'); animateLayout(); setPlansExpanded(value => !value); }}
            style={({ pressed }) => [styles.disclosure, { opacity: pressed ? 0.65 : 1 }]}>
            <View style={styles.planIdentity}>
              <ThemedText type="smallBold">멤버십 비교</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">베이직 · 플러스 · 프로 · 프리미엄</ThemedText>
            </View>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
              <SymbolView name={{ ios: plansExpanded ? 'chevron.up' : 'chevron.down', android: plansExpanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down', web: plansExpanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down' }} size={16} tintColor={theme.textSecondary} />
            </View>
          </Pressable>

          {plansExpanded && <View style={styles.comparison}>
            <View style={styles.freePlan}>
              <ThemedText type="smallBold">베이직 · 무료</ThemedText>
              {kind === 'general' ? <><ThemedText type="small" themeColor="textSecondary">오늘 글 무제한 · 동시 모임 {MEMBERSHIP_LIMITS.free.meetups}개</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{t.membership.listingBenefits.free}</ThemedText></> : <ThemedText type="small" themeColor="textSecondary">월 신규 4편 · 끌어올리기 없음 · 직접 관리</ThemedText>}
            </View>

            {plans.map((plan) => {
              const limits = MEMBERSHIP_LIMITS[plan.tier];
              const offer = familyOffers.find((item) => item.tier === plan.tier && item.period === period) ?? familyOffers.find((item) => item.tier === plan.tier);
              const selected = selection.tier === plan.tier;
              return <Pressable analyticsId="app_profile_membership.pressable.4" key={plan.tier} accessibilityRole="radio" aria-checked={selected} accessibilityState={{ selected, checked: selected, disabled: busy }} disabled={busy}
                onPress={() => selectPlan({ tier: plan.tier, period: offer?.period ?? period })}
                style={({ pressed }) => [styles.plan, selected && Depth.card, { backgroundColor: theme.card, borderColor: selected ? theme.accent : theme.line, opacity: pressed ? 0.88 : 1, transform: [{ translateY: pressed && !reducedMotion ? 2 : 0 }] }]}>
                <View style={styles.planHeading}>
                  <ThemedText style={styles.planName}>{plan.name}</ThemedText>
                  <ThemedText type="smallBold" themeColor={selected ? 'accent' : 'textSecondary'}>{selected ? '✓ 선택됨' : '선택하기'}</ThemedText>
                </View>
                <View style={styles.priceRow}>
                  <ThemedText style={styles.price}>{offer ? `${offer.price} / ${periodNames[offer.period]}` : offersLoading ? '가격 확인 중' : '준비 중'}</ThemedText>
                </View>
                {kind === 'general' ? <><ThemedText type="small" themeColor="textSecondary">오늘 글 무제한 · 동시 모임 {limits.meetups}개</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{t.membership.listingBenefits[plan.tier]}</ThemedText></> : <>
                  <ThemedText type="small" themeColor="textSecondary">월 신규 {BUSINESS_LIMITS[plan.tier].posts}편 · 끌어올리기 {BUSINESS_LIMITS[plan.tier].bumps}회</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">같은 글은 {BUSINESS_LIMITS[plan.tier].bumpCooldownHours}시간 간격</ThemedText>
                  {plan.tier === 'premium' ? <><ThemedText type="small">운영대행: 신규 4편 · 끌어올리기 8회 · 월간 보고서 1회</ThemedText><ThemedText type="small" themeColor="textSecondary">전체 30편·24회에 포함돼요. 직접·AI 관리분은 신규 26편·끌어올리기 16회예요.</ThemedText></> : <ThemedText type="small" themeColor="textSecondary">직접 관리 · 연결된 AI와 사용량 공유</ThemedText>}
                </>}
              </Pressable>;
            })}
            {kind === 'general' && <ThemedText type="small" themeColor="textSecondary">계정과 같은 글에 {GENERAL_BUMP_HOURS[selection.tier]}시간 간격이 적용돼요. 쓰지 않은 끌어올리기는 쌓이지 않아요.</ThemedText>}

            {periods.length > 1 && <View onLayout={event => setPeriodWidth(event.nativeEvent.layout.width)} style={[styles.periods, { backgroundColor: theme.backgroundElement }]}>
              {periodWidth > 0 && <Animated.View pointerEvents="none" style={[styles.periodIndicator, { width: (periodWidth - 12) / 2, backgroundColor: theme.card, transform: [{ translateX: periodPosition.interpolate({ inputRange: [0, 1], outputRange: [0, (periodWidth - 12) / 2 + 4] }) }] }]} />}
              {periods.map((value) => <Pressable analyticsId="app_profile_membership.pressable.5" key={value} accessibilityRole="radio" aria-checked={value === period} accessibilityState={{ selected: value === period, checked: value === period, disabled: busy }} disabled={busy}
                onPress={() => selectPlan({ ...selection, period: value })}
                style={({ pressed }) => [styles.period, { backgroundColor: periodWidth === 0 && value === period ? theme.card : 'transparent', opacity: pressed ? 0.7 : 1 }]}>
                <ThemedText type="smallBold">{value === 'month' ? '월 구독' : '연 구독'}</ThemedText>
              </Pressable>)}
            </View>}

            <View style={styles.checkout}>
              {selectedOffer && <ThemedText type="smallBold" style={styles.center}>{tierNames[selectedOffer.tier]} · {selectedOffer.price} / {periodNames[selectedOffer.period]}</ThemedText>}
              {purchaseUnavailableReason && <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">{purchaseUnavailableReason}</ThemedText>}
              <Pressable analyticsId="app_profile_membership.pressable.6" accessibilityRole="button" disabled={purchaseDisabled} accessibilityState={{ disabled: purchaseDisabled, busy }}
                onPress={() => { play('selection'); if (selectedOffer) void purchase(selectedOffer, kind === 'business' && merchantId ? merchantId : undefined); }}
                style={({ pressed }) => [styles.purchase, Depth.control, { backgroundColor: theme.accent, borderBottomColor: theme.accentDepth, borderBottomWidth: 3, opacity: purchaseDisabled ? 0.5 : 1, transform: [{ translateY: pressed ? 2 : 0 }] }]}>
                {busy ? <GlingLoader color={theme.accentInk} accessibilityLabel="구독 처리 중" /> : <ThemedText type="smallBold" style={{ color: theme.accentInk }}>
                  {currentProduct ? '현재 이용 중인 구독' : selectedOffer ? `${tierNames[selectedOffer.tier]} 구독하기` : '구독 준비 중'}
                </ThemedText>}
              </Pressable>
              {selectedOffer && <ThemedText type="small" themeColor="textSecondary">{selectedOffer.period === 'month' ? '매월' : '매년'} {selectedOffer.price}이 청구되며 자동 갱신됩니다. 구독 변경과 해지는 결제한 스토어에서 관리할 수 있어요.</ThemedText>}
              <Pressable analyticsId="app_profile_membership.pressable.7" onPress={() => { play('selection'); leave(); }} accessibilityRole="button" style={({ pressed }) => [styles.textButton, { opacity: pressed ? 0.65 : 1 }]}><ThemedText type="smallBold">{membership?.tier === 'free' ? '무료로 계속하기' : '돌아가기'}</ThemedText></Pressable>
            </View>
          </View>}

          <View style={[styles.links, { borderTopColor: theme.line }]}>
            <Pressable analyticsId="app_profile_membership.pressable.8" onPress={() => { play('selection'); void restore(); }} accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} style={styles.textButton}><ThemedText type="small">구매 복원</ThemedText></Pressable>
            <Pressable analyticsId="app_profile_membership.pressable.9" onPress={() => { play('selection'); void manage(kind); }} accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} style={styles.textButton}><ThemedText type="small">구독 관리</ThemedText></Pressable>
            <Pressable analyticsId="app_profile_membership.pressable.10" onPress={() => openLegal('terms')} accessibilityRole="link" style={styles.textButton}><ThemedText type="small" themeColor="textSecondary">이용약관</ThemedText></Pressable>
            <Pressable analyticsId="app_profile_membership.pressable.11" onPress={() => openLegal('privacy')} accessibilityRole="link" style={styles.textButton}><ThemedText type="small" themeColor="textSecondary">개인정보처리방침</ThemedText></Pressable>
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
  details: { borderTopWidth: 1, borderBottomWidth: 1 },
  disclosure: { minHeight: 48, paddingVertical: Spacing.two, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  detailContent: { paddingBottom: Spacing.three, gap: Spacing.two },
  comparison: { gap: Spacing.three },
  freePlan: { gap: Spacing.one, paddingVertical: Spacing.two },
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
