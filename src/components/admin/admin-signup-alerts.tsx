import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { markNotificationsRead } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

type SignupAlert = { id: string; body: string; target_id: string };

export function AdminSignupAlerts({ userId, onUser }: { userId: string; onUser: (id: string) => void }) {
  const [alerts, setAlerts] = useState<SignupAlert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(false);
  const revision = useRef(0);
  const confirming = useRef(false);
  const { play } = useInteractionFeedback();

  useEffect(() => {
    alive.current = true;
    let active = true;
    const refresh = async () => {
      const version = ++revision.current;
      try {
        const result = await supabase.from('user_notifications').select('id,body,target_id')
          .eq('user_id', userId).eq('kind', 'admin_signup').is('read_at', null)
          .order('created_at', { ascending: false }).limit(20);
        if (!active || version !== revision.current) return;
        if (result.error) throw result.error;
        setAlerts((result.data ?? []) as SignupAlert[]);
        setError(null);
      } catch {
        if (active && version === revision.current) setError('가입 알림을 불러오지 못했어요. 연결되면 다시 확인합니다.');
      }
    };
    const channel = supabase.channel(`admin-signups:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => void refresh())
      .subscribe();
    const timer = setInterval(() => void refresh(), 30_000);
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    const focus = () => void refresh();
    if (Platform.OS === 'web') window.addEventListener('focus', focus);
    void refresh();
    return () => {
      active = alive.current = false;
      revision.current += 1;
      clearInterval(timer);
      foreground.remove();
      if (Platform.OS === 'web') window.removeEventListener('focus', focus);
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const confirm = async (id: string) => {
    if (confirming.current) return;
    confirming.current = true;
    revision.current += 1;
    setBusy(true);
    play('selection');
    try {
      await markNotificationsRead(supabase, [id]);
      if (!alive.current) return;
      revision.current += 1;
      setAlerts(current => current.filter(alert => alert.id !== id));
      setError(null);
    } catch {
      if (alive.current) setError('가입 알림을 확인 처리하지 못했어요. 다시 시도해 주세요.');
    } finally {
      confirming.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const alert = alerts[0];
  if (!alert && !error) return null;
  return (
    <View accessibilityLiveRegion="polite" style={styles.banner}>
      {!!alert && <>
        <ThemedText type="smallBold">가입 알림 · {alerts.length}{alerts.length === 20 ? '+' : ''}건 미확인</ThemedText>
        <ThemedText>{alert.body}</ThemedText>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" accessibilityLabel="가입 회원 보기" onPress={() => { play('selection'); onUser(alert.target_id); }} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
            <ThemedText type="smallBold">회원 보기</ThemedText>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="가입 알림 확인" accessibilityState={{ busy, disabled: busy }} disabled={busy} onPress={() => confirm(alert.id)} style={({ pressed }) => [styles.button, (pressed || busy) && styles.pressed]}>
            <ThemedText type="smallBold">{busy ? '확인 중…' : '확인'}</ThemedText>
          </Pressable>
        </View>
      </>}
      {!!error && <ThemedText accessibilityRole="alert" type="small" style={styles.error}>{error}</ThemedText>}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { marginBottom: Spacing.three, padding: Spacing.three, gap: Spacing.two, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8, backgroundColor: Colors.light.card },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.three, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8 },
  pressed: { opacity: 0.6 },
  error: { color: Colors.light.accent },
});
