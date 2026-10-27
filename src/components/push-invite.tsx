import { useLanguage } from '@/hooks/use-language';
import { Pressable } from '@/components/analytics-controls';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Alert, DeviceEventEmitter, Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { ControlMetrics, ControlMotion, ControlStyles } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { NOTIFICATION_PREFERENCES_CHANGED, PUSH_PROMPT_EVENT, pushPromptAllowed, saveNotificationPreferences, type PushPromptReason } from '@/lib/notification-preferences';
import { pushConfigured, pushPermissionGranted, pushPermissionUndetermined, registerPushDevice } from '@/lib/push-notifications';
import { supabase } from '@/lib/supabase';

// iOS 는 권한 창을 평생 한 번만 띄워준다. 그래서 로그인 직후가 아니라, 처음 댓글·글·모임 신청·모임 만들기를
// 마친 바로 그 순간에 그 일과 이어서 묻고, 켜겠다고 한 사람에게만 진짜 창을 띄운다.
const ASKED_KEY = 'gling.pushInviteAsked'; // "나중에"를 누른 시각. 14일 동안 다시 묻지 않는다.
const REASONS_KEY = 'gling.pushPromptReasons'; // 이미 물어본 순간들
const COPY: Record<PushPromptReason, { title: string; body: string; preview: string }> = {
  comment: { title: '답글 달리면 바로 알려 드릴까요?', body: '방금 쓴 댓글에 누가 답하면 휴대폰으로 알려 드려요. 알림 종류는 설정에서 언제든 바꿀 수 있어요.', preview: '내 댓글에 답글이 달렸어요' },
  post: { title: '댓글이 달리면 바로 알려 드릴까요?', body: '방금 올린 글에 댓글이 달리면 휴대폰으로 알려 드려요. 알림 종류는 설정에서 언제든 바꿀 수 있어요.', preview: '내 글에 댓글이 달렸어요' },
  meetup_request: { title: '호스트가 수락하면 바로 알려 드릴까요?', body: '호스트가 내 신청을 수락하면 휴대폰으로 알려 드려요. 알림 종류는 설정에서 언제든 바꿀 수 있어요.', preview: '모임 참여 신청이 수락됐어요' },
  meetup_create: { title: '참여 신청이 오면 바로 알려 드릴까요?', body: '누가 내 모임에 신청하면 휴대폰으로 알려 드려요. 알림 종류는 설정에서 언제든 바꿀 수 있어요.', preview: '내 모임에 새 참여 신청이 왔어요' },
};
const readReasons = async () => { try { const value = JSON.parse(await AsyncStorage.getItem(REASONS_KEY) ?? '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } };

export function PushInvite() {
  const { tr } = useLanguage();
  const { isAuthed, me } = useAuth();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const [reason, setReason] = useState<PushPromptReason | null>(null);
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const visible = reason !== null;

  useEffect(() => {
    let active = true, checking = false;
    const listener = DeviceEventEmitter.addListener(PUSH_PROMPT_EVENT, (event: { reason?: PushPromptReason }) => {
      const next = event?.reason;
      if (!next || !(next in COPY) || checking || !isAuthed || !me.id || !pushConfigured) return;
      checking = true;
      void (async () => {
        try {
          const [snoozedAt, askedReasons, permissionGranted, canAsk] = await Promise.all([
            AsyncStorage.getItem(ASKED_KEY), readReasons(), pushPermissionGranted(), pushPermissionUndetermined()]);
          if (active && pushPromptAllowed({ authed: isAuthed, configured: pushConfigured, snoozedAt, askedReasons, reason: next, permissionGranted, canAsk, now: Date.now() })) setReason(current => current ?? next);
        } catch {
          // 확인에 실패하면 묻지 않는다. 잘못 띄워 한 번뿐인 기회를 쓰는 것보다 낫다.
        } finally { checking = false; }
      })();
    });
    return () => { active = false; listener.remove(); };
  }, [isAuthed, me.id]);

  const remember = async (snooze: boolean) => {
    const asked = reason;
    setReason(null);
    try {
      if (asked) await AsyncStorage.setItem(REASONS_KEY, JSON.stringify([...new Set([...await readReasons(), asked])]));
      if (snooze) await AsyncStorage.setItem(ASKED_KEY, new Date().toISOString());
    } catch { /* 저장에 실패해도 창은 닫는다. */ }
  };
  const close = async () => { play('selection'); await remember(true); };

  const allow = async () => {
    if (busy || !me.id) return;
    play('selection');
    setBusy(true);
    try {
      // 여기서 처음으로 진짜 시스템 창이 뜬다.
      const granted = await registerPushDevice(supabase, me.id, true);
      if (granted) {
        const preferences = await saveNotificationPreferences(supabase, { push_enabled: true });
        DeviceEventEmitter.emit(NOTIFICATION_PREFERENCES_CHANGED, { userId: me.id, preferences });
      }
      await remember(false);
    } catch {
      play('warning');
      Alert.alert(tr("알림을 켜지 못했어요"), tr("연결 상태를 확인하고 다시 시도해 주세요."),
        [{ text: tr("확인"), onPress: () => play('selection') }]);
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;
  const copy = COPY[reason];
  return (
    <Modal visible transparent animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={() => { if (!busy) void close(); }}>
      <View style={styles.backdrop}>
        <Pressable analyticsId="components_push-invite.pressable.1" style={StyleSheet.absoluteFill} onPress={() => void close()} disabled={busy} accessibilityRole="button" accessibilityLabel={tr("닫기")} />
        <View style={[styles.sheet, { backgroundColor: theme.card, paddingBottom: Math.max(insets.bottom, Spacing.three) + Spacing.two }]}>
          <View style={[styles.grab, { backgroundColor: theme.backgroundSelected }]} />
          <ThemedText accessibilityRole="header" type="sheetTitle">{tr(copy.title)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{tr(copy.body)}</ThemedText>
          <View style={[styles.preview, { backgroundColor: theme.backgroundElement }]} accessibilityLabel={tr("알림 예시: {0}", tr(copy.preview))}>
            <View style={[styles.previewIcon, { backgroundColor: theme.accent }]}><ThemedText type="smallBold" style={{ color: theme.accentInk }}>g</ThemedText></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <ThemedText type="smallBold">{tr("글링")}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{tr(copy.preview)}</ThemedText>
            </View>
          </View>
          <Pressable lens analyticsId="components_push-invite.pressable.2" onPress={() => void allow()} disabled={busy} accessibilityRole="button"
            accessibilityState={{ disabled: busy, busy }}
            style={({ pressed }) => [styles.primary, { backgroundColor: theme.accent, opacity: busy ? ControlMotion.disabledOpacity : pressed ? ControlMotion.pressedOpacity : 1 }]}>
            <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{busy ? tr("설정 중") : tr("알림 받기")}</ThemedText>
          </Pressable>
          <Pressable lens analyticsId="components_push-invite.pressable.3" onPress={() => void close()} disabled={busy} accessibilityRole="button"
            style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.6 }]}>
            <ThemedText type="smallBold" themeColor="textSecondary">{tr("나중에")}</ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.34)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: Spacing.four, paddingTop: Spacing.four, gap: Spacing.two },
  grab: { width: 36, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: Spacing.two },
  preview: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 14, padding: Spacing.three, marginVertical: Spacing.two },
  previewIcon: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  primary: { ...ControlStyles.action, minHeight: ControlMetrics.actionWide },
  secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
