import AsyncStorage from '@react-native-async-storage/async-storage';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PurchasesPackage } from 'react-native-purchases';

import { LoginPanel } from '@/components/login-panel';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { loadPromotablePosts, loadPromotionWallet, pausePromotion, promotionOffer, PROMOTIONS_PREVIEW_ENABLED, startPromotion, type PromotionWallet } from '@/lib/promotions';
import { purchaseUnavailableReason, withPurchases } from '@/lib/purchases';
import { supabase } from '@/lib/supabase';

type Offer = NonNullable<ReturnType<typeof promotionOffer>>;
type WalletState = { userId: string; wallet: PromotionWallet; posts: { id: string; title: string }[] };
const statuses = { active: '홍보 중', paused: '중단됨', completed: '노출 완료', refunded: '환불됨' };
const number = (value: number) => value.toLocaleString('ko-KR');
const date = (value: string) => new Date(value).toLocaleDateString('ko-KR');

function ActionButton({ label, onPress, disabled = false, primary = false }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  const theme = useTheme();
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, primary && { backgroundColor: theme.accent }, { opacity: disabled ? 0.5 : pressed ? 0.75 : 1 }]}><ThemedText type="smallBold" style={primary ? { color: theme.accentInk } : undefined}>{label}</ThemedText></Pressable>;
}

export default function PromotionsRoute() {
  return PROMOTIONS_PREVIEW_ENABLED ? <PromotionsScreen /> : <Redirect href="/profile" />;
}

function PromotionsScreen() {
  const theme = useTheme();
  const auth = useAuth();
  const router = useRouter();
  const { postId } = useLocalSearchParams<{ postId?: string }>();
  const userId = auth.isAuthed ? auth.me.id : null;
  const currentUser = useRef(userId);
  const mounted = useRef(true);
  const generation = useRef(0);
  const processing = useRef(false);
  const packages = useRef<{ userId: string; items: PurchasesPackage[] } | null>(null);
  const [data, setData] = useState<WalletState | null>(null);
  const [offers, setOffers] = useState<{ userId: string; items: Offer[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ userId: string; text: string } | null>(null);
  const [storeNotice, setStoreNotice] = useState('');
  const [selection, setSelection] = useState({ userId, postId, id: postId ?? '' });
  const selected = selection.userId === userId && selection.postId === postId ? selection.id : postId ?? '';
  const [budget, setBudget] = useState(900);
  const [confirmation, setConfirmation] = useState('');
  const confirmNoSlots = confirmation === `${userId}:${selected}:${budget}`;
  const [pauseId, setPauseId] = useState<string | null>(null);
  const [purchasePending, setPurchasePending] = useState<string | null>(null);
  useLayoutEffect(() => { currentUser.current = userId; generation.current += 1; }, [userId]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const valid = useCallback((owner: string) => mounted.current && currentUser.current === owner, []);
  const wallet = data?.userId === userId ? data.wallet : null;
  const posts = data?.userId === userId ? data.posts : [];
  const visibleOffers = offers?.userId === userId ? offers.items : [];
  const notice = feedback?.userId === userId ? feedback.text : null;
  const pendingKey = userId ? `gling.promotion.purchase.${userId}` : '';
  const unavailable = purchaseUnavailableReason();
  const say = (owner: string, text: string) => { if (valid(owner)) setFeedback({ userId: owner, text }); };

  const refresh = useCallback(async () => {
    if (!userId) return;
    const request = ++generation.current;
    setLoading(true);
    const results = await Promise.allSettled([
      loadPromotionWallet(supabase), loadPromotablePosts(supabase, userId), AsyncStorage.getItem(`gling.promotion.purchase.${userId}`),
      purchaseUnavailableReason() ? Promise.resolve(null) : withPurchases(userId, (sdk) => sdk.getOfferings()),
    ]);
    if (!valid(userId) || generation.current !== request) return;
    const [balance, ownPosts, pending, products] = results;
    if (balance.status === 'fulfilled' && ownPosts.status === 'fulfilled') {
      setData({ userId, wallet: balance.value, posts: ownPosts.value });
      if (pending.status === 'fulfilled' && pending.value) {
        try {
          if (balance.value.purchases.some((item) => item.transactionId === pending.value)) {
            await AsyncStorage.removeItem(`gling.promotion.purchase.${userId}`);
            if (valid(userId)) setPurchasePending(null);
          } else setPurchasePending(userId);
        } catch { setPurchasePending(userId); }
      } else if (pending.status === 'fulfilled') setPurchasePending(null);
    } else setFeedback({ userId, text: '크레딧과 내 글을 확인하지 못했어요. 잠시 후 다시 확인해 주세요.' });
    if (!valid(userId) || generation.current !== request) return;
    if (products.status === 'fulfilled') {
      const items = products.value?.all.promotions?.availablePackages ?? [];
      packages.current = { userId, items };
      setOffers({ userId, items: items.map(promotionOffer).filter((item): item is Offer => item !== null) });
      setStoreNotice(items.length ? '' : Platform.OS === 'web' ? '크레딧 구매는 설치된 글링 iOS·Android 앱에서 이용할 수 있어요.' : '크레딧 구매를 준비하고 있어요.');
    } else { packages.current = null; setOffers(null); setStoreNotice('구매 상품을 확인하지 못했어요. 다시 확인해 주세요.'); }
    if (valid(userId) && generation.current === request) setLoading(false);
  }, [userId, valid]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const purchase = async (offer: Offer) => {
    if (!userId || processing.current || loading || !wallet || purchasePending === userId) return;
    const owner = userId;
    processing.current = true; setBusy(true); setFeedback(null);
    let completed = false;
    try {
      const result = await withPurchases(owner, async (sdk) => {
        const item = packages.current?.userId === owner ? packages.current.items.find((candidate) => candidate.identifier === offer.id && candidate.product.identifier === offer.productId) : null;
        if (!item) throw new Error('OFFER_UNAVAILABLE');
        // A missing store result remains unresolved instead of inviting another charge.
        await AsyncStorage.setItem(pendingKey, 'pending');
        if (!valid(owner)) throw new Error('ACCOUNT_CHANGED');
        setPurchasePending(owner);
        return sdk.purchasePackage(item);
      });
      completed = true;
      await AsyncStorage.setItem(pendingKey, result.transaction.transactionIdentifier);
      say(owner, '스토어 구매를 확인했어요. 결제 확인이 끝나면 크레딧이 반영돼요. 다시 결제하지 않고 아래에서 새로 확인할 수 있어요.');
      if (valid(owner)) await refresh();
    } catch (error) {
      if ((error as { userCancelled?: boolean })?.userCancelled) {
        await AsyncStorage.removeItem(pendingKey);
        if (valid(owner)) { setPurchasePending(null); say(owner, '구매를 취소했어요. 크레딧은 그대로예요.'); }
      } else say(owner, completed ? '구매 후 잔액을 확인하지 못했어요. 다시 결제하지 말고 잠시 후 새로 확인해 주세요.' : '구매 상태를 확인하지 못했어요. 결제 승인 또는 크레딧 반영을 기다리고 있다면 다시 결제하지 마세요.');
    } finally { processing.current = false; if (mounted.current) setBusy(false); }
  };

  const start = async (allowNoSlots = false) => {
    if (!userId || !selected || processing.current || loading || !wallet?.configured) return;
    const owner = userId;
    processing.current = true; setBusy(true); setFeedback(null);
    try {
      const latest = await loadPromotionWallet(supabase);
      if (!valid(owner)) return;
      setData((previous) => previous?.userId === owner ? { ...previous, wallet: latest } : previous);
      if (latest.slotStatus === 'ready' && latest.slotAvailable === 0 && !allowNoSlots) { setConfirmation(`${owner}:${selected}:${budget}`); return; }
      const key = `gling.promotion.start.${owner}.${selected}.${budget}`;
      let requestId = await AsyncStorage.getItem(key);
      if (!requestId) { requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`; await AsyncStorage.setItem(key, requestId); }
      if (!valid(owner)) return;
      await startPromotion(supabase, { postId: selected, budget, requestId, allowNoSlots });
      await AsyncStorage.removeItem(key);
      if (valid(owner)) { setConfirmation(''); say(owner, '홍보를 시작했어요. 추가 홍보 노출은 아래에서 확인할 수 있어요.'); await refresh(); }
    } catch (error) {
      const message = String((error as { message?: string })?.message ?? '');
      if (valid(owner) && message.includes('NO_CONVERSATION_SLOTS')) setConfirmation(`${owner}:${selected}:${budget}`);
      else say(owner, message.includes('INSUFFICIENT') ? '사용 가능한 크레딧이 부족해요. 잔액을 확인해 주세요.' : '홍보 시작을 확인하지 못했어요. 같은 글과 수량으로 다시 시도하면 이전 요청을 이어서 확인해요.');
    } finally { processing.current = false; if (mounted.current) setBusy(false); }
  };

  const stop = async (id: string) => {
    if (!userId || processing.current) return;
    const owner = userId;
    processing.current = true; setBusy(true);
    try { await pausePromotion(supabase, id); if (valid(owner)) { setPauseId(null); say(owner, '홍보를 중단했어요. 사용하지 않은 크레딧은 잔액으로 돌아와요.'); await refresh(); } }
    catch { say(owner, '홍보 중단을 확인하지 못했어요. 새로 확인한 뒤 다시 시도해 주세요.'); }
    finally { processing.current = false; if (mounted.current) setBusy(false); }
  };

  if (auth.isAuthLoading) return <ActivityIndicator style={styles.container} color={theme.accent} accessibilityLabel="로그인 확인 중" />;
  if (!auth.isAuthed) return <LoginPanel reason="홍보 크레딧과 내 글을 확인하려면 로그인해 주세요." onApple={auth.signInApple} onKakao={auth.signInKakao} onGoogle={auth.signInGoogle} onDevLogin={auth.signInDev} loading={auth.isAuthLoading} error={auth.authError} />;
  const card = [styles.card, { backgroundColor: theme.card, borderColor: theme.line }];
  return <ThemedView style={styles.container}><SafeAreaView edges={['bottom']} style={styles.safeArea}><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.intro}><ThemedText type="smallBold" themeColor="accent">내 글을 더 멀리</ThemedText><ThemedText type="subtitle" accessibilityRole="header">홍보 크레딧</ThemedText><ThemedText type="small" themeColor="textSecondary">미리 구매하고, 알리고 싶은 글에 사용해요.</ThemedText></View>
    <View style={card}><ThemedText type="small" themeColor="textSecondary">사용 가능한 크레딧</ThemedText><ThemedText style={styles.balance}>{wallet ? `${number(wallet.balance)} 크레딧` : loading ? '확인 중' : '확인 필요'}</ThemedText>{wallet && wallet.testBalance !== 0 && <ThemedText type="small" themeColor="textSecondary">테스트 크레딧 {number(wallet.testBalance)} · 실제 홍보에 사용할 수 없어요.</ThemedText>}</View>
    {notice && <ThemedText type="small" accessibilityLiveRegion="polite">{notice}</ThemedText>}
    {purchasePending === userId && <ThemedText type="small" themeColor="accent" accessibilityLiveRegion="polite">구매 확인 중이에요. 크레딧 반영을 확인할 때까지 추가 구매는 잠시 기다려 주세요.</ThemedText>}
    {purchasePending === userId && <ActionButton label="결제 확인 문의" onPress={() => router.push('/profile/settings')} disabled={busy} />}
    <ActionButton label={loading ? '확인 중…' : '잔액과 내역 새로 확인'} onPress={() => void refresh()} disabled={busy || loading} />
    <View style={styles.section}><ThemedText type="smallBold" accessibilityRole="header">크레딧 구매</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">무료 회원도 구매할 수 있어요. 충전한 크레딧은 홍보를 시작할 때 사용해요.</ThemedText>
      {visibleOffers.map((offer) => <View key={offer.id} style={card}><View style={styles.row}><ThemedText type="smallBold">{number(offer.credits)} 크레딧</ThemedText><ThemedText type="smallBold">{offer.price}</ThemedText></View><ActionButton label={`${offer.price}에 구매`} onPress={() => void purchase(offer)} disabled={busy || loading || !wallet || !!unavailable || purchasePending === userId} primary /></View>)}
      {!!storeNotice && <ThemedText type="small" themeColor="textSecondary">{storeNotice}</ThemedText>}
    </View>
    <View style={styles.section}><ThemedText type="smallBold" accessibilityRole="header">내 글 끌어올리기</ThemedText>
      {wallet && !wallet.configured && <ThemedText type="small" themeColor="textSecondary">게시글 홍보를 준비하고 있어요. 시작할 수 있게 되면 보관한 크레딧을 사용할 수 있어요.</ThemedText>}
      {posts.length === 0 && !loading && <ThemedText type="small" themeColor="textSecondary">지금 홍보할 수 있는 내 글이 없어요. 글을 게시한 뒤 여기에서 선택해 주세요.</ThemedText>}
      {posts.map((post) => <Pressable key={post.id} accessibilityRole="radio" accessibilityState={{ checked: selected === post.id, disabled: busy }} disabled={busy} onPress={() => { setSelection({ userId, postId, id: post.id }); setConfirmation(''); }} style={[card, selected === post.id && { borderColor: theme.accent }]}><ThemedText type="smallBold">{selected === post.id ? '✓ ' : ''}{post.title}</ThemedText></Pressable>)}
      {!!selected && <View style={card}><ThemedText type="smallBold">추가 홍보 노출</ThemedText><View style={styles.row}>{[900, 1700].map((amount) => <Pressable key={amount} accessibilityRole="radio" accessibilityState={{ checked: amount === budget, disabled: busy }} disabled={busy} onPress={() => { setBudget(amount); setConfirmation(''); }} style={[styles.choice, { borderColor: amount === budget ? theme.accent : theme.line }]}><ThemedText type="smallBold">{number(amount)}회</ThemedText><ThemedText type="small" themeColor="textSecondary">{number(amount)} 크레딧</ThemedText></Pressable>)}</View>
        <ThemedText type="small" themeColor="textSecondary">자연 노출은 차감하지 않아요. 구매한 추가 노출을 채우면 홍보가 종료돼요. 문의나 거래 성사를 보장하지는 않아요.</ThemedText>
        <ThemedText type="smallBold">{wallet?.slotStatus === 'ready' && wallet.slotAvailable !== null ? `새 대화 수락 가능 ${wallet.slotAvailable}개` : '대화 자리 확인 준비 중'}</ThemedText>
        {wallet?.slotStatus !== 'ready' && <ThemedText type="small" themeColor="textSecondary">현재 수락할 수 있는 대화 수를 확인할 수 없어요. 홍보 시작으로 대화 자리가 추가되지는 않아요.</ThemedText>}
        {wallet?.slotAvailable === 0 && wallet.slotStatus === 'ready' && <ThemedText type="small" themeColor="textSecondary">지금은 새 대화를 수락할 자리가 없어요. 요청은 받을 수 있지만, 자리가 생긴 뒤 수락할 수 있어요. 홍보는 계속할 수 있어요.</ThemedText>}
        <ActionButton label={confirmNoSlots ? '그대로 홍보 시작' : `${number(budget)} 크레딧 사용하고 홍보 시작`} onPress={() => void start(confirmNoSlots)} disabled={busy || loading || !wallet?.configured || wallet.balance < budget || !posts.some((post) => post.id === selected)} primary />
        <ActionButton label="홍보 나중에 하기" onPress={() => router.canGoBack() ? router.back() : router.replace('/profile')} disabled={busy} />
      </View>}
    </View>
    <View style={styles.section}><ThemedText type="smallBold" accessibilityRole="header">홍보 현황</ThemedText>{wallet?.campaigns.length === 0 && <ThemedText type="small" themeColor="textSecondary">아직 시작한 홍보가 없어요.</ThemedText>}
      {wallet?.campaigns.map((campaign) => <View key={campaign.id} style={card}><View style={styles.row}><ThemedText type="smallBold" style={styles.flex}>{campaign.title}</ThemedText><ThemedText type="small" themeColor="accent">{statuses[campaign.status]}</ThemedText></View><ThemedText type="small" themeColor="textSecondary">{campaign.environment !== 'PRODUCTION' ? '테스트 · ' : ''}{date(campaign.createdAt)} · 추가 노출 {number(campaign.delivered)} / {number(campaign.budget)}회</ThemedText>{campaign.status === 'active' && <>{pauseId === campaign.id && <ThemedText type="small">홍보를 중단하면 남은 노출에 해당하는 크레딧이 잔액으로 돌아와요.</ThemedText>}<ActionButton label={pauseId === campaign.id ? '중단하고 남은 크레딧 돌려받기' : '홍보 중단'} onPress={() => pauseId === campaign.id ? void stop(campaign.id) : setPauseId(campaign.id)} disabled={busy} />{pauseId === campaign.id && <ActionButton label="계속 홍보하기" onPress={() => setPauseId(null)} disabled={busy} />}</>}</View>)}
    </View>
    <View style={styles.section}><ThemedText type="smallBold" accessibilityRole="header">구매 내역</ThemedText>{wallet?.purchases.length === 0 && <ThemedText type="small" themeColor="textSecondary">아직 구매 내역이 없어요.</ThemedText>}{wallet?.purchases.map((purchase) => <View key={purchase.id} style={[styles.history, { borderBottomColor: theme.line }]}><ThemedText type="smallBold">{number(purchase.credits)} 크레딧 · {purchase.refunded ? '환불됨' : '충전'}</ThemedText><ThemedText type="small" themeColor="textSecondary">{purchase.environment !== 'PRODUCTION' ? '테스트 · ' : ''}{date(purchase.createdAt)}</ThemedText></View>)}</View>
  </ScrollView></SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  content: { padding: Spacing.three, paddingBottom: Spacing.five, gap: Spacing.three },
  intro: { gap: Spacing.two, paddingVertical: Spacing.two },
  section: { gap: Spacing.two, paddingTop: Spacing.two },
  card: { padding: Spacing.three, borderWidth: 1, borderRadius: 12, gap: Spacing.two, minHeight: 44 },
  balance: { fontSize: 26, lineHeight: 34, fontWeight: 700, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: Spacing.two },
  flex: { flex: 1, minWidth: 120 },
  button: { minHeight: 44, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  choice: { flex: 1, minWidth: 112, minHeight: 44, borderWidth: 1, borderRadius: 12, padding: Spacing.two, gap: Spacing.one },
  history: { minHeight: 44, paddingVertical: Spacing.two, gap: Spacing.one, borderBottomWidth: 1 },
});
