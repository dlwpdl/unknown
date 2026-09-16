import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ReportSheet } from '@/components/report-sheet';
import { ThemedText } from '@/components/themed-text';
import { TrustBadge } from '@/components/trust-badge';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { count, t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { getCommunityActionError, loadListingReputation, startDirectConversation, type ListingReputation } from '@/lib/community-data';
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
  const [reputation, setReputation] = useState<ListingReputation | null>(null);
  const busy = useRef(false);

  // 평판은 거래를 마친 상대만 남길 수 있어서, 숫자가 있으면 그 자체로 신호다.
  const userId = user?.id;
  useEffect(() => {
    let active = true;
    void (async () => {
      if (!userId) { if (active) setReputation(null); return; }
      try {
        const next = await loadListingReputation(supabase, userId);
        if (active) setReputation(next.total > 0 ? next : null);
      } catch { if (active) setReputation(null); }
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
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button">
          <Pressable style={[styles.sheet, { backgroundColor: theme.card, paddingBottom: Math.max(insets.bottom, Spacing.three) }]} onPress={() => {}}>
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
                {reputation && (
                  <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12.5 }}>
                    거래 후기 {count(reputation.total)} · 다시 거래하겠다 {count(reputation.wouldDealAgain)}
                  </ThemedText>
                )}
                <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: 12.5 }}>
                  {user.mine ? t.profileSheet.self
                    : user.trustLevel === 3 ? t.profileSheet.verifiedL3
                    : user.verified || user.trustLevel === 2 ? t.profileSheet.verifiedL2
                    : t.profileSheet.verifiedL1}
                </ThemedText>
                {user.mine && (
                  <Pressable onPress={() => navigate('/profile')} accessibilityRole="button" style={[styles.cta, { backgroundColor: theme.backgroundElement }]}>
                    <ThemedText type="smallBold">{t.tabs.profile}</ThemedText>
                  </Pressable>
                )}
                {!user.mine && user.id && (
                  <>
                    <ThemedText type="small" themeColor="textSecondary">{t.chat.requesterRisk}</ThemedText>
                    <Pressable onPress={() => void requestChat(user)} accessibilityRole="button" disabled={requesting}
                      accessibilityState={{ disabled: requesting, busy: requesting }}
                      style={[styles.cta, { backgroundColor: theme.accent, opacity: requesting ? 0.55 : 1 }]}>
                      <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{requesting ? t.chat.joinSending : t.profileSheet.chatRequest}</ThemedText>
                    </Pressable>
                    <Pressable onPress={() => { setReporting(user); onClose(); }} accessibilityRole="button"
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

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: Spacing.four, paddingTop: Spacing.four, alignItems: 'center', gap: 6 },
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  nickRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cta: { alignSelf: 'stretch', alignItems: 'center', borderRadius: 999, paddingVertical: 13, marginTop: Spacing.two },
});
