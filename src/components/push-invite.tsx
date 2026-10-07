import { Pressable } from '@/components/analytics-controls';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { saveNotificationPreferences, shouldInvitePush } from '@/lib/notification-preferences';
import { pushConfigured, pushPermissionGranted, pushPermissionUndetermined, registerPushDevice } from '@/lib/push-notifications';
import { supabase } from '@/lib/supabase';

// iOS 는 권한 창을 평생 한 번만 띄워준다. 거절당하면 앱에서 다시 물을 수 없고
// 사용자가 설정 앱까지 찾아가야 한다. 그래서 시스템 창을 바로 띄우지 않고
// 무엇을 받게 되는지 먼저 말한 다음, 켜겠다고 한 사람에게만 진짜 창을 띄운다.
const ASKED_KEY = 'gling.pushInviteAsked';
// 한 번 거절했다고 영영 안 묻지 않는다. 시스템 창을 아직 안 쓴 사람에게만 7일 뒤 다시 물어본다.
const REASK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export function PushInvite() {
  const { isAuthed, me } = useAuth();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!isAuthed || !me.id || !pushConfigured) return;
      try {
        const askedAt = await AsyncStorage.getItem(ASKED_KEY);
        const askedRecently = !!askedAt && Date.now() - Date.parse(askedAt) < REASK_AFTER_MS;
        if (askedRecently) return;
        const permissionGranted = await pushPermissionGranted();
        if (permissionGranted) return;
        // 이미 시스템 창에서 거절한 기기라면 다시 물어도 창이 뜨지 않는다.
        if (!await pushPermissionUndetermined()) return;
        if (!shouldInvitePush({
          authed: isAuthed, configured: pushConfigured, alreadyAsked: false,
          permissionGranted,
        })) return;
        if (active) setVisible(true);
      } catch {
        // 확인에 실패하면 묻지 않는다. 잘못 띄워 한 번뿐인 기회를 쓰는 것보다 낫다.
      }
    })();
    return () => { active = false; };
  }, [isAuthed, me.id]);

  const close = async (feedback = true) => {
    if (feedback) play('selection');
    setVisible(false);
    await AsyncStorage.setItem(ASKED_KEY, new Date().toISOString()).catch(() => {});
  };

  const allow = async () => {
    if (busy || !me.id) return;
    play('selection');
    setBusy(true);
    try {
      // 여기서 처음으로 진짜 iOS 창이 뜬다.
      const granted = await registerPushDevice(supabase, me.id, true);
      if (granted) {
        await saveNotificationPreferences(supabase, { push_enabled: true });
      }
    } catch {
      // 실패해도 설정 화면에서 다시 켤 수 있다.
    } finally {
      setBusy(false);
      await close(false);
    }
  };

  if (!visible) return null;
  return (
    <Modal visible transparent animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={() => void close()}>
      <View style={styles.backdrop}>
        <Pressable analyticsId="components_push-invite.pressable.1" style={StyleSheet.absoluteFill} onPress={() => void close()} accessibilityRole="button" accessibilityLabel="닫기" />
        <View style={[styles.sheet, { backgroundColor: theme.card, paddingBottom: Math.max(insets.bottom, Spacing.three) + Spacing.two }]}>
          <View style={[styles.badge, { backgroundColor: theme.backgroundElement }]}>
            <SymbolView name={{ ios: 'bell.badge', android: 'notifications_active', web: 'notifications_active' }} size={22} tintColor={theme.accent} />
          </View>
          <ThemedText type="smallBold" style={styles.title}>소식을 놓치지 않게 해드릴까요?</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.lead}>받고 싶은 소식을 알림 설정에서 고를 수 있어요.</ThemedText>
          <View style={styles.lines}>
            <Line symbol={{ ios: 'bubble.left', android: 'chat_bubble', web: 'chat_bubble' }}
              text="내 글의 좋아요·댓글·답글" hint="누가 반응했는지 바로 알 수 있어요" />
            <Line symbol={{ ios: 'person.2', android: 'group', web: 'group' }}
              text="모임 신청과 승인, 새 메시지" hint="상대를 기다리게 두지 않아요" />
            <Line symbol={{ ios: 'flame', android: 'local_fire_department', web: 'local_fire_department' }}
              text="내 지역의 새 글과 인기 소식" hint="관심사와 지역에 맞는 알림을 선택할 수 있어요" />
          </View>
          <Pressable analyticsId="components_push-invite.pressable.2" onPress={() => void allow()} disabled={busy} accessibilityRole="button"
            accessibilityState={{ disabled: busy, busy }}
            style={({ pressed }) => [styles.primary, { backgroundColor: theme.accent },
              (pressed || busy) && { opacity: 0.82, transform: [{ scale: busy ? 1 : 0.985 }] }]}>
            <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{busy ? '설정 중' : '알림 받기'}</ThemedText>
          </Pressable>
          <Pressable analyticsId="components_push-invite.pressable.3" onPress={() => void close()} disabled={busy} accessibilityRole="button"
            style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.6 }]}>
            <ThemedText type="smallBold" themeColor="textSecondary">나중에</ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Line({ symbol, text, hint }: { symbol: SymbolViewProps['name']; text: string; hint: string }) {
  const theme = useTheme();
  return (
    <View style={styles.line}>
      <View style={[styles.lineIcon, { backgroundColor: theme.backgroundElement }]}>
        <SymbolView name={symbol} size={13} tintColor={theme.navy} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <ThemedText type="small">{text}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.lineHint}>{hint}</ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.34)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: Spacing.four, paddingTop: Spacing.four, gap: Spacing.two },
  badge: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  title: { fontSize: 17, textAlign: 'center' },
  lead: { textAlign: 'center' },
  lines: { gap: Spacing.two, marginVertical: Spacing.two },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  lineIcon: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  lineHint: { fontSize: 12 },
  primary: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
