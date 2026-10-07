import type { PurchasesPackage } from 'react-native-purchases';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Linking, Platform } from 'react-native';

import { useAuth } from '@/lib/auth';
import { membershipOffer, type MembershipOffer, type MembershipSnapshot } from '@/lib/membership';
import { purchaseUnavailableReason, withPurchases } from '@/lib/purchases';
import { supabase } from '@/lib/supabase';

type MembershipValue = {
  membership: MembershipSnapshot | null; loading: boolean; error: string | null; notice: string | null;
  offers: MembershipOffer[]; offersLoading: boolean; busy: boolean; purchaseUnavailableReason: string | null;
  pendingApproval: boolean; confirmPendingCancellation: () => Promise<void>;
  refresh: () => Promise<void>; purchase: (offer: MembershipOffer) => Promise<void>;
  restore: () => Promise<void>; manage: () => Promise<void>;
};
const MembershipContext = createContext<MembershipValue | null>(null);
export function useMembership() {
  const value = useContext(MembershipContext);
  if (!value) throw new Error('useMembership requires MembershipProvider');
  return value;
}

export function MembershipProvider({ children }: { children: ReactNode }) {
  const { isAuthed, me } = useAuth();
  const userId = isAuthed ? me.id : null;
  const currentUser = useRef(userId);
  const generation = useRef(0);
  useLayoutEffect(() => {
    if (currentUser.current !== userId) generation.current++;
    currentUser.current = userId;
  }, [userId]);
  const [state, setState] = useState<{ userId: string; value: MembershipSnapshot } | null>(null);
  const [offersState, setOffers] = useState<{ userId: string; values: MembershipOffer[] } | null>(null);
  const packages = useRef<{ userId: string; values: Map<string, PurchasesPackage> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [offersLoading, setOffersLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const processing = useRef(false);
  const refreshing = useRef<string | null>(null);
  const [pending, setPending] = useState<{ userId: string; previousProductId: string | null; awaitingApproval: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncReadyUser, setSyncReadyUser] = useState<string | null>(null);
  const membership = state?.userId === userId ? state.value : null;
  const offers = offersState?.userId === userId ? offersState.values : [];
  const unavailable = purchaseUnavailableReason();

  const sync = useCallback(async (requestGeneration = generation.current) => {
    if (!userId || currentUser.current !== userId) throw new Error('ACCOUNT_CHANGED');
    const session = await supabase.auth.getSession();
    if (session.error || session.data.session?.user.id !== userId || currentUser.current !== userId || generation.current !== requestGeneration) throw new Error('ACCOUNT_CHANGED');
    const result = await supabase.functions.invoke('membership', { body: {} });
    if (result.error || !result.data?.membership) throw result.error ?? new Error('SYNC_FAILED');
    const value = result.data.membership as MembershipSnapshot;
    if (!['free', 'plus', 'premium'].includes(value.tier) || (value.tier === 'free' ? value.productId !== null : typeof value.productId !== 'string' || !value.productId)) throw new Error('SYNC_FAILED');
    const current = await supabase.auth.getSession();
    if (current.error || current.data.session?.user.id !== userId || currentUser.current !== userId || generation.current !== requestGeneration) throw new Error('ACCOUNT_CHANGED');
    if (currentUser.current === userId && generation.current === requestGeneration) {
      setState({ userId, value }); setSyncReadyUser(userId);
      setPending((previous) => previous?.userId === userId && value.tier !== 'free' && value.productId !== previous.previousProductId ? null : previous);
    }
    return value;
  }, [userId]);

  const refresh = useCallback(async () => {
    if (!userId || processing.current || refreshing.current === userId) return;
    refreshing.current = userId;
    const requestGeneration = ++generation.current;
    setLoading(true); setError(null);
    try {
      const result = await supabase.rpc('get_membership');
      if (result.error) throw result.error;
      if (currentUser.current !== userId || generation.current !== requestGeneration) return;
      setState({ userId, value: result.data as MembershipSnapshot });
      if (!purchaseUnavailableReason()) {
        await sync(requestGeneration);
        if (currentUser.current !== userId || generation.current !== requestGeneration) return;
        setOffersLoading(true);
        packages.current = null; setOffers(null);
        try {
          const available = await withPurchases(userId, (sdk) => sdk.getOfferings());
          if (currentUser.current !== userId || generation.current !== requestGeneration) return;
          const items = available.current?.availablePackages ?? [];
          const offers = items.map(membershipOffer).filter((offer): offer is MembershipOffer => offer !== null);
          packages.current = { userId, values: new Map(items.map((item) => [item.identifier, item])) };
          setOffers({ userId, values: offers });
          if (!offers.length) setError('스토어에서 구매 가능한 구독 상품을 받지 못했어요. 최신 테스트 앱과 스토어 계정을 확인한 뒤 다시 시도해 주세요.');
        } catch {
          if (currentUser.current === userId && generation.current === requestGeneration) setError('구독 상품을 불러오지 못했어요. 현재 멤버십은 계속 이용할 수 있어요.');
        }
      }
    } catch {
      if (currentUser.current === userId && generation.current === requestGeneration) setError('멤버십 정보를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.');
    } finally {
      if (refreshing.current === userId) refreshing.current = null;
      if (currentUser.current === userId && generation.current === requestGeneration) { setLoading(false); setOffersLoading(false); }
    }
  }, [sync, userId]);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      setError(null); setNotice(null); setSyncReadyUser(null);
      if (userId) void refresh();
    });
    const listener = AppState.addEventListener('change', (next) => { if (next === 'active') void refresh(); });
    return () => { active = false; listener.remove(); };
  }, [refresh, userId]);

  const transact = useCallback(async (offer?: MembershipOffer) => {
    if (!userId || processing.current || refreshing.current === userId || (offer && pending?.userId === userId)) return;
    const reason = purchaseUnavailableReason();
    if (reason) { setNotice(reason); return; }
    processing.current = true; setBusy(true); setError(null); setNotice(null);
    const requestGeneration = ++generation.current;
    let storeCompleted = false;
    let previousProductId: string | null = null;
    try {
      const before = await sync(requestGeneration);
      previousProductId = before.productId;
      if (currentUser.current !== userId) return;
      const nativeStore = Platform.OS === 'ios' ? 'app_store' : 'play_store';
      if (offer && before.tier !== 'free' && before.store !== nativeStore && before.store !== 'test_store') {
        setNotice('이미 다른 스토어에서 구독 중이에요. 구독 관리에서 변경해 주세요.'); return;
      }
      await withPurchases(userId, async (sdk) => {
        if (!offer) { await sdk.restorePurchases(); return; }
        const item = packages.current?.userId === userId ? packages.current.values.get(offer.id) : null;
        if (!item || item.product.identifier !== offer.productId) throw new Error('OFFER_UNAVAILABLE');
        if (before.productId === offer.productId && before.tier !== 'free') throw new Error('ALREADY_SUBSCRIBED');
        const change = Platform.OS === 'android' && before.tier !== 'free' && before.productId
          ? { oldProductIdentifier: before.productId, prorationMode: sdk.PRORATION_MODE.DEFERRED }
          : null;
        await sdk.purchasePackage(item, null, change);
      });
      storeCompleted = true;
      if (offer) setPending({ userId, previousProductId, awaitingApproval: false });
      const after = await sync(requestGeneration);
      // A successful paid-plan change may be deferred by the store until renewal.
      if (offer && after.tier !== 'free') setPending(null);
      if (currentUser.current === userId) setNotice(after.tier === 'free'
        ? offer ? '구매를 확인하고 있어요. 잠시 후 다시 확인해 주세요.' : pending?.userId === userId
          ? '현재 활성 구독은 없어요. 이전 구매의 승인 대기 상태는 결제한 스토어에서 확인해 주세요.' : '복원할 활성 구독이 없어요.'
        : offer ? '구독 상태를 확인했어요. 변경 예약은 스토어의 적용일에 반영돼요.' : '구매를 복원했어요.');
    } catch (failure) {
      if (currentUser.current !== userId) return;
      if ((failure as { userCancelled?: boolean })?.userCancelled) setNotice('구매를 취소했어요. 현재 멤버십은 그대로 유지돼요.');
      else if (String((failure as { code?: string })?.code) === '20') {
        setPending({ userId, previousProductId, awaitingApproval: true }); setNotice('스토어에서 결제 승인을 기다리고 있어요. 승인되면 멤버십이 반영돼요.');
      }
      else if (storeCompleted) setError('스토어 처리는 완료됐지만 멤버십 반영을 확인하지 못했어요. 다시 결제하지 말고 잠시 후 다시 확인해 주세요.');
      else setError('구독을 처리하지 못했어요. 결제 내역이 있다면 구매 복원을 이용해 주세요.');
    } finally { processing.current = false; setBusy(false); }
  }, [pending, sync, userId]);

  const confirmPendingCancellation = useCallback(async () => {
    if (!userId || currentUser.current !== userId || processing.current || refreshing.current === userId || pending?.userId !== userId || !pending.awaitingApproval) return;
    const reason = purchaseUnavailableReason();
    if (reason) { setNotice(reason); return; }
    processing.current = true; setBusy(true); setError(null); setNotice(null);
    const requestGeneration = ++generation.current;
    try {
      // Empty receipts cannot prove cancellation. Only the explicit store-confirmed action clears this marker.
      const value = await sync(requestGeneration);
      setPending((previous) => previous === pending ? null : previous);
      setNotice(value.tier === 'free' || value.productId === pending.previousProductId
        ? '확인한 취소·거절 내용을 반영했어요. 새 구매는 구독하기에서 따로 진행해 주세요.'
        : '현재 구독 상태를 확인했어요. 결제 내역은 구독 관리에서 확인해 주세요.');
    } catch {
      if (currentUser.current === userId) setError('계정과 구독 상태를 확인하지 못했어요. 구매 대기는 유지돼요. 잠시 후 다시 확인해 주세요.');
    } finally { processing.current = false; setBusy(false); }
  }, [pending, sync, userId]);

  const manage = useCallback(async () => {
    try {
      const store = membership?.store ?? (Platform.OS === 'ios' ? 'app_store' : 'play_store');
      await Linking.openURL(store === 'app_store' ? 'https://apps.apple.com/account/subscriptions'
        : 'https://play.google.com/store/account/subscriptions?package=com.dlwpdl.gling');
    } catch { setError('구독 관리를 열지 못했어요. 결제한 스토어에서 구독을 확인해 주세요.'); }
  }, [membership]);

  return <MembershipContext.Provider value={{ membership, offers, loading, offersLoading, busy, error, notice,
    pendingApproval: !unavailable && pending?.userId === userId && !!pending?.awaitingApproval, confirmPendingCancellation,
    purchaseUnavailableReason: unavailable ?? (pending?.userId === userId && userId ? '구매 확인이 진행 중이에요. 확인이 끝나면 멤버십이 반영돼요.' : syncReadyUser === userId ? null : '구독 연결을 확인하고 있어요. 무료 기능은 계속 이용할 수 있어요.'),
    refresh, purchase: (offer) => transact(offer), restore: () => transact(), manage }}>
    {children}
  </MembershipContext.Provider>;
}
