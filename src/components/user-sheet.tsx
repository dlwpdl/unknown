import { Pressable } from '@/components/analytics-controls';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ReportSheet } from '@/components/report-sheet';
import { ThemedText } from '@/components/themed-text';
import { TrustBadge } from '@/components/trust-badge';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { count, t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { getCommunityActionError, loadTradeProfile, startDirectConversation, type TradeProfile } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

// 미니 프로필 대상 (글 작성자 or 댓글 작성자)
export type SheetUser = {
  id?: string;
  nickname: string;
  neighborhood?: string;
  verified?: boolean;
  trustLevel?: 2 | 3;
  mine?: boolean;
  listingId?: string; // 구해요·팔아요 글에서 열렸을 때. 대화의 출처로 남아 거래 후기 자격이 된다.
};

// Shared by the feed and the post detail so an author tap opens the same profile sheet everywhere.
export function UserSheet({ user, onClose, onBeforeNavigate }: {
  user: SheetUser | null;
  onClose: () => void;
  onBeforeNavigate?: () => void; // parent dismisses its own modal before we push a route
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isAuthed, promptLogin } = useAuth();
  const { play } = useInteractionFeedback();
  const [requesting, setRequesting] = useState(false);
  const [reporting, setReporting] = useState<SheetUser | null>(null);
  const [trade, setTrade] = useState<TradeProfile | null>(null);
  const busy = useRef(false);

  // 거래 이력은 상대가 실제로 사람을 만나 본 기록이라, 숫자 자체가 신호다.
  const userId = user?.id;
  useEffect(() => {
    let active = true;
    void (async () => {
      if (!userId) { if (active) setTrade(null); return; }
      try {
        const next = await loadTradeProfile(supabase, userId);
        if (active) setTrade(next);
      } catch { if (active) setTrade(null); }
    })();
    return () => { active = false; };
  }, [userId]);

  const navigate = (route: Parameters<typeof router.push>[0]) => {
    onClose();
    onBeforeNavigate?.();
    router.push(route);
  };

  const requestChat = async (u: SheetUser) => {
    if (!isAuthed) return promptLogin(t.auth.reasonChatLogin);
    if (!u.id || busy.current) return;
    busy.current = true;
    setRequesting(true);
    try {
      const conversationId = await startDirectConversation(supabase, u.id, u.listingId);
      play('message');
      navigate({ pathname: '/chat', params: { conversationId, view: 'requests' } });
    } catch (error) {
      play('warning');
      const code = getCommunityActionError(error);
      const message = code ? t.actionErrors[code as keyof typeof t.actionErrors] : null;
      if (message) Alert.alert(message.title, message.body, [
        { text: t.write.cancel, style: 'cancel' },
        ...(message.membership ? [{ text: '멤버십 보기', onPress: () => navigate('/profile/membership') }] : []),
      ]);
      else Alert.alert(t.chat.startErrorTitle, t.chat.startErrorBody);
    } finally {
      busy.current = false;
      setRequesting(false);
    }
  };

  return (
    <>
      <Modal visible={!!user} transparent animationType="fade" onRequestClose={onClose}>
        <Pressable analyticsId="components_user-sheet.pressable.1" style={styles.backdrop} onPress={onClose} accessibilityRole="button">
          <Pressable analyticsId="components_user-sheet.pressable.2" style={[styles.sheet, { backgroundColor: theme.card, paddingBottom: Math.max(insets.bottom, Spacing.three) }]} onPress={() => {}}>
            {user && (
              <>
                <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="subtitle" style={{ color: theme.navy }}>{user.nickname[0]}</ThemedText>
                </View>
                <View style={styles.nickRow}>
                  <ThemedText type="smallBold" style={{ fontSize: 18 }}>{user.nickname}</ThemedText>
                  <TrustBadge verified={user.verified} trustLevel={user.trustLevel} />
                </View>
                {user.neighborhood && <ThemedText type="small" themeColor="textSecondary">{user.neighborhood}</ThemedText>}
                {trade && !user.mine && <TradeRecord trade={trade} onOpenPost={(postId) => navigate(`/post/${postId}`)} />}
                <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12.5 }}>
                  {user.mine ? t.profileSheet.self
                    : user.trustLevel === 3 ? t.profileSheet.verifiedL3
                    : user.verified || user.trustLevel === 2 ? t.profileSheet.verifiedL2
                    : t.profileSheet.verifiedL1}
                </ThemedText>
                {user.mine && (
                  <Pressable analyticsId="components_user-sheet.pressable.3" onPress={() => navigate('/profile')} accessibilityRole="button" style={[styles.cta, { backgroundColor: theme.backgroundElement }]}>
                    <ThemedText type="smallBold">{t.tabs.profile}</ThemedText>
                  </Pressable>
                )}
                {!user.mine && user.id && (
                  <>
                    <ThemedText type="small" themeColor="textSecondary">{t.chat.requesterRisk}</ThemedText>
                    <Pressable analyticsId="components_user-sheet.pressable.4" onPress={() => void requestChat(user)} accessibilityRole="button" disabled={requesting}
                      accessibilityState={{ disabled: requesting, busy: requesting }}
                      style={[styles.cta, { backgroundColor: theme.accent, opacity: requesting ? 0.55 : 1 }]}>
                      <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{requesting ? t.chat.joinSending : t.profileSheet.chatRequest}</ThemedText>
                    </Pressable>
                    <Pressable analyticsId="components_user-sheet.pressable.5" onPress={() => { setReporting(user); onClose(); }} accessibilityRole="button"
                      style={[styles.cta, { backgroundColor: theme.backgroundElement }]}>
                      <ThemedText type="smallBold" themeColor="textSecondary">{t.report.userAction}</ThemedText>
                    </Pressable>
                  </>
                )}
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
      {reporting?.id && (
        <ReportSheet visible targetType="user" targetId={reporting.id} reportedUserId={reporting.id} reportedNickname={reporting.nickname} onClose={() => setReporting(null)} />
      )}
    </>
  );
}

// 거래 이력. 점수 한 줄로 줄이지 않는다 — 갓 도착한 사람이 낮은 점수로 깔리면
// 정착을 돕겠다는 앱이 정착을 막는다. 기록이 없으면 "새 이웃"이라고만 적는다.
function TradeRecord({ trade, onOpenPost }: { trade: TradeProfile; onOpenPost: (postId: string) => void }) {
  const theme = useTheme();
  // 칩이 아니라 문장으로 적는다. 신뢰는 훑어서가 아니라 읽어서 판단된다.
  const facts: { symbol: SymbolViewProps['name']; text: string }[] = [];
  if (trade.dealPartners > 0) facts.push({ symbol: { ios: 'person.2', android: 'group', web: 'group' }, text: `이웃 ${count(trade.dealPartners)}명과 거래했어요` });
  if (trade.closedListings > 0) facts.push({ symbol: { ios: 'shippingbox', android: 'inventory_2', web: 'inventory_2' }, text: `거래 완료 ${count(trade.closedListings)}건` });
  if (trade.reviews.total > 0) facts.push({ symbol: { ios: 'arrow.uturn.left', android: 'replay', web: 'replay' }, text: `${count(trade.reviews.total)}명 중 ${count(trade.reviews.wouldDealAgain)}명이 다시 거래하겠다고 했어요` });
  if (trade.memberMonths >= 1) facts.push({ symbol: { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }, text: `글링과 함께한 지 ${count(trade.memberMonths)}개월` });

  return (
    <View style={styles.record}>
      {facts.length > 0 ? (
        <View style={[styles.facts, { borderColor: theme.line }]}>
          {facts.map((fact, index) => (
            <View key={fact.text} style={[styles.fact, index > 0 && { borderTopWidth: 1, borderTopColor: theme.line }]}>
              <SymbolView name={fact.symbol} size={14} tintColor={theme.navy} />
              <ThemedText type="small" style={{ flex: 1 }}>{fact.text}</ThemedText>
            </View>
          ))}
        </View>
      ) : (
        <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12.5, textAlign: 'center' }}>
          아직 거래 기록이 없는 새 이웃이에요.
        </ThemedText>
      )}

      {trade.openListings.length > 0 && (
        <View style={styles.listings}>
          <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12.5 }}>올려둔 구해요·팔아요</ThemedText>
          {trade.openListings.slice(0, 3).map((listing) => (
            <Pressable analyticsId="components_user-sheet.pressable.6" key={listing.id} onPress={() => onOpenPost(listing.id)} accessibilityRole="button"
              accessibilityLabel={`${listing.title}${listing.price != null ? `, ${t.detail.price(Number(listing.price))}` : ''}`}
              style={({ pressed }) => [styles.listing, { borderColor: theme.line },
                pressed && { backgroundColor: theme.backgroundElement, transform: [{ scale: 0.985 }] }]}>
              <ThemedText type="small" numberOfLines={1} style={{ flex: 1 }}>{listing.title}</ThemedText>
              {listing.price != null && <ThemedText type="smallBold" style={{ fontSize: 12 }}>{t.detail.price(Number(listing.price))}</ThemedText>}
            </Pressable>
          ))}
        </View>
      )}

      {trade.reviews.recent.length > 0 && (
        <View style={styles.listings}>
          <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12.5 }}>받은 후기</ThemedText>
          {trade.reviews.recent.slice(0, 2).map((review) => (
            <View key={review.id} style={styles.review}>
              <ThemedText type="small" numberOfLines={2}>{review.body}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 11.5 }}>
                {review.authorNickname} · {review.wouldDealAgain ? '다시 거래하겠다' : '다시 거래 안 함'}
              </ThemedText>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: Spacing.four, paddingTop: Spacing.four, alignItems: 'center', gap: 6 },
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  nickRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  record: { alignSelf: 'stretch', gap: Spacing.two, marginTop: Spacing.one },
  facts: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  fact: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: 9 },
  listings: { gap: Spacing.one },
  listing: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.two, borderWidth: 1, borderRadius: 8 },
  review: { gap: 2, paddingHorizontal: Spacing.two },
  cta: { alignSelf: 'stretch', alignItems: 'center', borderRadius: 999, paddingVertical: 13, marginTop: Spacing.two },
});
