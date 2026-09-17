import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadNotificationPreferences, saveNotificationPreferences, shouldInvitePush } from '@/lib/notification-preferences';
import { pushConfigured, pushPermissionGranted, registerPushDevice } from '@/lib/push-notifications';
import { supabase } from '@/lib/supabase';

// iOS 는 권한 창을 평생 한 번만 띄워준다. 거절당하면 앱에서 다시 물을 수 없고
// 사용자가 설정 앱까지 찾아가야 한다. 그래서 시스템 창을 바로 띄우지 않고
// 무엇을 받게 되는지 먼저 말한 다음, 켜겠다고 한 사람에게만 진짜 창을 띄운다.
const ASKED_KEY = 'gling.pushInviteAsked';

export function PushInvite() {
  const { isAuthed, me } = useAuth();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!isAuthed || !me.id || !pushConfigured) return;
      try {
        const alreadyAsked = !!await AsyncStorage.getItem(ASKED_KEY);
        if (alreadyAsked) return;
        const permissionGranted = await pushPermissionGranted();
        if (permissionGranted) return;
        const preferences = await loadNotificationPreferences(supabase);
        if (!shouldInvitePush({
          authed: isAuthed, configured: pushConfigured, alreadyAsked,
          permissionGranted, pushEnabled: preferences.push_enabled,
        })) return;
        if (active) setVisible(true);
      } catch {
        // 확인에 실패하면 묻지 않는다. 잘못 띄워 한 번뿐인 기회를 쓰는 것보다 낫다.
      }
    })();
    return () => { active = false; };
  }, [isAuthed, me.id]);

  const close = async () => {
    setVisible(false);
    await AsyncStorage.setItem(ASKED_KEY, new Date().toISOString()).catch(() => {});
  };

  const allow = async () => {
    if (busy || !me.id) return;
    setBusy(true);
    try {
      // 여기서 처음으로 진짜 iOS 창이 뜬다.
      const granted = await registerPushDevice(supabase, me.id, true);
      if (granted) {
        await saveNotificationPreferences(supabase, { push_enabled: true });
        play('selection');
      }
    } catch {
      // 실패해도 설정 화면에서 다시 켤 수 있다.
    } finally {
      setBusy(false);
      await close();
    }
  };

  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => void close()}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.card }]}>
          <ThemedText type="smallBold" style={styles.title}>소식을 놓치지 않게 해드릴까요?</ThemedText>
          <View style={styles.lines}>
            <Line text="내 글에 달린 댓글과 답글" />
            <Line text="모임 신청과 승인, 새 메시지" />
            <Line text="내 도시에서 지금 반응이 오는 글" />
          </View>
          <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
            밤 10시부터 아침 8시까지는 보내지 않아요. 어떤 소식을 받을지는 프로필에서 바꿀 수 있어요.
          </ThemedText>
          <Pressable onPress={() => void allow()} disabled={busy} accessibilityRole="button"
            accessibilityState={{ disabled: busy, busy }}
            style={[styles.primary, { backgroundColor: theme.accent, opacity: busy ? 0.6 : 1 }]}>
            <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{busy ? '설정 중' : '알림 받기'}</ThemedText>
          </Pressable>
          <Pressable onPress={() => void close()} disabled={busy} accessibilityRole="button" style={styles.secondary}>
            <ThemedText type="smallBold" themeColor="textSecondary">나중에</ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Line({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.line}>
      <View style={[styles.bullet, { backgroundColor: theme.accent }]} />
      <ThemedText type="small" style={{ flex: 1 }}>{text}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  card: { width: '100%', maxWidth: 340, borderRadius: 18, padding: Spacing.four, gap: Spacing.two },
  title: { fontSize: 17 },
  lines: { gap: Spacing.one, marginTop: Spacing.one },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  bullet: { width: 5, height: 5, borderRadius: 3 },
  note: { fontSize: 12.5, marginTop: Spacing.one },
  primary: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 999, marginTop: Spacing.two },
  secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
