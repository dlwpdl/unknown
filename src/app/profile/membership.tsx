import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoginPanel } from '@/components/login-panel';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { MEMBERSHIP_LIMITS, type MembershipOffer } from '@/lib/membership';
import { useMembership } from '@/lib/membership-provider';

const plans = [
  { tier: 'premium', name: '프리미엄' },
  { tier: 'plus', name: '플러스' },
] as const;
const tierNames = { free: '베이직', plus: '플러스', premium: '프리미엄' };
const periodNames = { month: '월', year: '년' };

export default function MembershipScreen() {
  const theme = useTheme();
  const router = useRouter();
  const auth = useAuth();
  const { play } = useInteractionFeedback();
  const { membership, loading, error, notice, offers, offersLoading, busy, purchaseUnavailableReason, refresh, purchase, restore, manage } = useMembership();
  useFocusEffect(useCallback(() => {
    if (auth.isAuthed) void refresh();
  }, [auth.isAuthed, refresh]));
  const [selection, setSelection] = useState<{ tier: MembershipOffer['tier']; period: MembershipOffer['period'] }>({ tier: 'premium', period: 'month' });
  const selectedOffer = offers.find((offer) => offer.tier === selection.tier && offer.period === selection.period)
    ?? offers.find((offer) => offer.tier === selection.tier);
  const period = selectedOffer?.period ?? selection.period;
  const periods = (['month', 'year'] as const).filter((value) => offers.some((offer) => offer.tier === selection.tier && offer.period === value));
  const currentProduct = !!membership && membership.tier !== 'free' && !!selectedOffer && selectedOffer.productId === membership.productId;
  const purchaseDisabled = busy || loading || offersLoading || !selectedOffer || !membership || !!purchaseUnavailableReason || currentProduct;
  const conversationLabel = membership?.conversationPeriod === 'day' ? '하루 새 1:1 대화' : membership?.conversationPeriod === 'active' ? '참여 중인 1:1 대화' : '1:1 대화';
  const publicSiteUrl = (process.env.EXPO_PUBLIC_APP_URL ?? 'https://gling.ej-entertainment.com').replace(/\/$/, '');
  const leave = () => router.canGoBack() ? router.back() : router.replace('/profile');
  const openLegal = (slug: 'terms' | 'privacy') => void Linking.openURL(`${publicSiteUrl}/${slug}`)
    .catch(() => Alert.alert('페이지를 열지 못했어요', '잠시 후 다시 시도해 주세요.'));

  if (auth.isAuthLoading) return <ActivityIndicator color={theme.accent} style={styles.loading} accessibilityLabel="로그인 확인 중" />;
  if (!auth.isAuthed) return <LoginPanel reason="내 멤버십을 확인하고 이어서 이용하려면 로그인해 주세요." onApple={auth.signInApple} onKakao={auth.signInKakao} onDevLogin={auth.signInDev} loading={auth.isAuthLoading} error={auth.authError} />;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.intro}>
            <ThemedText type="smallBold" themeColor="accent">GLING MEMBERSHIP</ThemedText>
            <ThemedText type="subtitle" accessibilityRole="header" style={styles.heading}>나에게 맞는 만큼, 글링</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">글링은 무료로도 함께할 수 있어요.</ThemedText>
          </View>

          <View style={[styles.card, { borderColor: theme.line, backgroundColor: theme.card }]}>
            <View style={styles.row}>
              <ThemedText type="smallBold">내 멤버십</ThemedText>
              <ThemedText type="smallBold" themeColor="accent">{membership ? tierNames[membership.tier] : loading ? '확인 중' : '확인 필요'}</ThemedText>
            </View>
            {membership && <>
              {[
                ['오늘 글 작성', membership.postsUsed, membership.postLimit, '편'],
                ['참여 중인 모임', membership.meetupsUsed, membership.meetupLimit, '개'],
                [conversationLabel, membership.conversationsUsed, membership.conversationLimit, '개'],
              ].map(([label, used, limit, unit]) => (
                <View key={label} style={[styles.row, { borderTopWidth: 1, borderTopColor: theme.line }]}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.flexText}>{label}</ThemedText>
                  <ThemedText type="smallBold" style={styles.numbers}>{used} / {limit}{unit}</ThemedText>
                </View>
              ))}
              {membership.expiresAt && membership.tier !== 'free' && <ThemedText type="small" themeColor="textSecondary" style={styles.statusNote}>
                {new Date(membership.expiresAt).toLocaleDateString('ko-KR')} {membership.willRenew === true ? '갱신 예정' : membership.willRenew === false ? '까지 이용 가능' : '이용 기간 종료 예정'}
              </ThemedText>}
            </>}
          </View>

          <View style={styles.freePlan}>
            <ThemedText type="smallBold">베이직 · 무료</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">하루 글 {MEMBERSHIP_LIMITS.free.posts}편 · 모임 {MEMBERSHIP_LIMITS.free.meetups}개</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{conversationLabel} {MEMBERSHIP_LIMITS.free.conversations}개</ThemedText>
          </View>

          {plans.map((plan) => {
            const limits = MEMBERSHIP_LIMITS[plan.tier];
            const offer = offers.find((item) => item.tier === plan.tier && item.period === period) ?? offers.find((item) => item.tier === plan.tier);
            const selected = selection.tier === plan.tier;
            return <Pressable key={plan.tier} accessibilityRole="radio" aria-checked={selected} accessibilityState={{ selected, checked: selected, disabled: busy }} disabled={busy}
              onPress={() => { setSelection({ tier: plan.tier, period: offer?.period ?? period }); play('selection'); }}
              style={({ pressed }) => [styles.plan, { backgroundColor: theme.card, borderColor: selected ? theme.accent : theme.line, opacity: pressed ? 0.78 : 1 }]}>
              <View style={styles.planHeading}>
                <ThemedText style={styles.planName}>{plan.name}</ThemedText>
                <ThemedText type="smallBold" themeColor={selected ? 'accent' : 'textSecondary'}>{selected ? '✓ 선택됨' : plan.tier === 'premium' ? '더 넉넉하게' : '선택하기'}</ThemedText>
              </View>
              {plan.tier === 'premium' && <ThemedText type="small" themeColor="accent">더 많은 글과 만남을 위한 선택</ThemedText>}
              <ThemedText style={styles.price}>{offer ? `${offer.price} / ${periodNames[offer.period]}` : offersLoading ? '가격 확인 중' : '준비 중'}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">하루 글 {limits.posts}편 · 모임 {limits.meetups}개</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{conversationLabel} {limits.conversations}개</ThemedText>
            </Pressable>;
          })}

          {periods.length > 1 && <View style={[styles.periods, { backgroundColor: theme.backgroundElement }]}>
            {periods.map((value) => <Pressable key={value} accessibilityRole="radio" aria-checked={value === period} accessibilityState={{ selected: value === period, checked: value === period, disabled: busy }} disabled={busy}
              onPress={() => { setSelection({ ...selection, period: value }); play('selection'); }}
              style={({ pressed }) => [styles.period, { backgroundColor: value === period ? theme.card : 'transparent', opacity: pressed ? 0.7 : 1 }]}>
              <ThemedText type="smallBold">{value === 'month' ? '월 구독' : '연 구독'}</ThemedText>
            </Pressable>)}
          </View>}

          <View style={styles.checkout}>
            {selectedOffer && <ThemedText type="smallBold" style={styles.center}>{tierNames[selectedOffer.tier]} · {selectedOffer.price} / {periodNames[selectedOffer.period]}</ThemedText>}
            {purchaseUnavailableReason && <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">{purchaseUnavailableReason}</ThemedText>}
            {(error || notice) && <View style={styles.feedback}>
              {error && <ThemedText type="small" themeColor="accent" accessibilityRole="alert">{error}</ThemedText>}
              {notice && <ThemedText type="small" accessibilityLiveRegion="polite">{notice}</ThemedText>}
              <Pressable onPress={() => void refresh()} accessibilityRole="button" disabled={busy || loading} accessibilityState={{ disabled: busy || loading }} style={styles.textButton}><ThemedText type="smallBold" themeColor="accent">다시 확인하기</ThemedText></Pressable>
            </View>}
            <Pressable accessibilityRole="button" disabled={purchaseDisabled} accessibilityState={{ disabled: purchaseDisabled, busy }}
              onPress={() => selectedOffer && void purchase(selectedOffer)}
              style={({ pressed }) => [styles.purchase, { backgroundColor: theme.accent, opacity: purchaseDisabled ? 0.5 : pressed ? 0.8 : 1 }]}>
              {busy ? <ActivityIndicator color={theme.accentInk} accessibilityLabel="구독 처리 중" /> : <ThemedText type="smallBold" style={{ color: theme.accentInk }}>
                {currentProduct ? '현재 이용 중인 구독' : selectedOffer ? `${tierNames[selectedOffer.tier]} 구독하기` : '구독 준비 중'}
              </ThemedText>}
            </Pressable>
            {selectedOffer && <ThemedText type="small" themeColor="textSecondary">{selectedOffer.period === 'month' ? '매월' : '매년'} {selectedOffer.price}이 청구되며 자동 갱신됩니다. 구독 변경과 해지는 결제한 스토어에서 관리할 수 있어요.</ThemedText>}
            <Pressable onPress={leave} accessibilityRole="button" style={styles.textButton}><ThemedText type="smallBold">{membership?.tier === 'free' ? '무료로 계속하기' : '돌아가기'}</ThemedText></Pressable>
          </View>

          <View style={[styles.links, { borderTopColor: theme.line }]}>
            <Pressable onPress={() => void restore()} accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} style={styles.textButton}><ThemedText type="small">구매 복원</ThemedText></Pressable>
            <Pressable onPress={() => void manage()} accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} style={styles.textButton}><ThemedText type="small">구독 관리</ThemedText></Pressable>
            <Pressable onPress={() => openLegal('terms')} accessibilityRole="link" style={styles.textButton}><ThemedText type="small" themeColor="textSecondary">이용약관</ThemedText></Pressable>
            <Pressable onPress={() => openLegal('privacy')} accessibilityRole="link" style={styles.textButton}><ThemedText type="small" themeColor="textSecondary">개인정보처리방침</ThemedText></Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  loading: { flex: 1 },
  content: { padding: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.three },
  intro: { gap: Spacing.two, paddingVertical: Spacing.two },
  heading: { fontWeight: 700, letterSpacing: -0.5 },
  card: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  row: { minHeight: 44, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, gap: Spacing.two, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' },
  flexText: { flexShrink: 1 },
  numbers: { fontVariant: ['tabular-nums'] },
  statusNote: { padding: Spacing.three, paddingTop: Spacing.two },
  freePlan: { gap: Spacing.one, paddingVertical: Spacing.two },
  plan: { borderWidth: 2, borderRadius: 12, padding: Spacing.three, gap: Spacing.one },
  planHeading: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  planName: { fontSize: 19, lineHeight: 27, fontWeight: 700 },
  price: { fontSize: 22, lineHeight: 30, fontWeight: 700, paddingVertical: Spacing.two },
  periods: { flexDirection: 'row', flexWrap: 'wrap', borderRadius: 12, padding: Spacing.one, gap: Spacing.one },
  period: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 8, padding: Spacing.two },
  checkout: { gap: Spacing.two },
  purchase: { minHeight: 52, borderRadius: 12, padding: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  textButton: { minHeight: 44, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  links: { borderTopWidth: 1, paddingTop: Spacing.two, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: Spacing.two },
  center: { textAlign: 'center' },
  feedback: { gap: Spacing.one },
});
