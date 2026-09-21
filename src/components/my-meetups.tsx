import { Pressable, ScrollView } from '@/components/analytics-controls';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, DeviceEventEmitter, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MeetupPolicyNotice } from '@/components/meetup-policy-notice';
import { relationshipSlotData } from '@/components/relationship-slot-card';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { leaveMeetup, loadMyMeetups, MEETUPS_CHANGED_EVENT, type MyMeetup } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useMembership } from '@/lib/membership-provider';
import { CITIES } from '@/lib/mock';
import { supabase } from '@/lib/supabase';

export function MyMeetups({ onOpen }: { onOpen: (postId: string) => Promise<void> }) {
  const theme = useTheme();
  const hidden = useContentVisibility();
  const router = useRouter();
  const { isAuthed, me, promptLogin } = useAuth();
  const { play } = useInteractionFeedback();
  const { membership, refresh: refreshMembership } = useMembership();
  const slots = relationshipSlotData(membership, 'meetup');
  const userId = isAuthed ? me.id : null;
  const currentUser = useRef(userId);
  useLayoutEffect(() => { currentUser.current = userId; }, [userId]);
  const requestVersion = useRef(0);
  const [result, setResult] = useState<{ userId: string; items: MyMeetup[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const items = result?.userId === userId ? result.items.filter((item) => !hidden('post', item.id, item.authorId)) : [];

  const refresh = useCallback(async () => {
    if (!userId || currentUser.current !== userId) return;
    const version = ++requestVersion.current;
    setLoading(true); setError(false);
    try {
      const next = await loadMyMeetups(supabase, userId);
      if (currentUser.current === userId && requestVersion.current === version) setResult({ userId, items: next });
    } catch {
      if (requestVersion.current === version) setError(true);
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => {
    void refresh();
    void refreshMembership();
    const listener = DeviceEventEmitter.addListener(MEETUPS_CHANGED_EVENT, () => void refresh());
    return () => { requestVersion.current += 1; listener.remove(); };
  }, [refresh, refreshMembership]));

  const changeMeetup = async (meetup: MyMeetup) => {
    if (busy || !userId) return;
    setBusy(meetup.id);
    try {
      await leaveMeetup(supabase, meetup.id);
      if (currentUser.current !== userId) return;
      setResult((current) => current?.userId === userId ? { ...current, items: current.items.filter(({ id }) => id !== meetup.id) } : current);
      play('selection');
      DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT);
      await refreshMembership();
    } catch {
      if (currentUser.current === userId) Alert.alert(t.meetup.changeError);
    } finally { setBusy(null); }
  };

  const confirmChange = (meetup: MyMeetup) => {
    const host = meetup.role === 'host';
    const pending = meetup.role === 'pending';
    Alert.alert(
      host ? t.meetup.endTitle : pending ? t.meetup.cancelTitle : t.meetup.leaveTitle,
      host ? t.meetup.endBody : pending ? t.meetup.cancelBody : t.meetup.leaveBody,
      [
        { text: t.profile.cancel, style: 'cancel' },
        { text: host ? t.meetup.end : pending ? t.meetup.cancelRequest : t.meetup.leave, style: 'destructive', onPress: () => void changeMeetup(meetup) },
      ],
    );
  };

  const open = async (meetup: MyMeetup) => {
    if (busy) return;
    setBusy(meetup.id);
    try { await onOpen(meetup.id); }
    catch { Alert.alert(t.feed.refreshErrorTitle, t.feed.refreshErrorBody); }
    finally { setBusy(null); }
  };

  return <View style={styles.section}>
    <View style={styles.heading}>
      <ThemedText type="smallBold" accessibilityRole="header" style={styles.title}>{t.meetup.mine}</ThemedText>
      {isAuthed && slots && <ThemedText type="small" themeColor="textSecondary" accessibilityLabel={`모임 자리 ${slots.active} / ${slots.limit}`} style={{ fontVariant: ['tabular-nums'] }}>
        모임 자리 <ThemedText type="smallBold">{slots.active}/{slots.limit}</ThemedText>{slots.locked ? ` · 대기 ${slots.locked}` : ''}
      </ThemedText>}
    </View>
    {isAuthed && <><MeetupPolicyNotice mode="leave" /><MeetupPolicyNotice mode="close" /></>}
    {!isAuthed ? <Pressable analyticsId="components_my-meetups.pressable.1" onPress={() => promptLogin(t.auth.reasonJoinLogin)} accessibilityRole="button" style={[styles.empty, { borderColor: theme.line }]}>
      <ThemedText type="small" themeColor="accent">로그인하고 내 모임 보기</ThemedText>
    </Pressable> : <>
      {loading && items.length === 0 && <ActivityIndicator color={theme.accent} accessibilityLabel="내 모임 불러오는 중" />}
      {error && <ThemedText type="small" themeColor="accent" accessibilityRole="alert">{t.meetup.loadError}</ThemedText>}
      {!loading && !error && items.length === 0 && <ThemedText type="small" themeColor="textSecondary">{t.meetup.empty}</ThemedText>}
      {/* 내 모임은 가로 카드로 압축해 공개 모임 소개가 첫 화면에 들어오게 한다. */}
      <ScrollView analyticsId="components_my-meetups.scrollview.1" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>{items.map((meetup) => <View key={meetup.id} style={[styles.meetup, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <Pressable analyticsId="components_my-meetups.pressable.2" onPress={() => void open(meetup)} accessibilityRole="button" disabled={!!busy} accessibilityState={{ disabled: !!busy, busy: busy === meetup.id }} style={({ pressed }) => [styles.copy, { opacity: pressed ? 0.7 : 1 }]}>
          <ThemedText type="smallBold" themeColor="accent">{t.meetup[meetup.role]}</ThemedText>
          <ThemedText type="smallBold">{meetup.title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{CITIES.find(({ id }) => id === meetup.cityId)?.name ?? meetup.cityId}</ThemedText>
          {busy === meetup.id && <ActivityIndicator color={theme.accent} accessibilityLabel="모임 처리 중" />}
        </Pressable>
        {meetup.role !== 'pending' && meetup.conversationId && <Pressable analyticsId="components_my-meetups.pressable.3"
          onPress={() => router.push({ pathname: '/chat', params: { conversationId: meetup.conversationId! } })}
          accessibilityRole="button" style={styles.action}>
          <ThemedText type="smallBold" themeColor="accent">{t.meetup.openChat}</ThemedText>
        </Pressable>}
        <Pressable analyticsId="components_my-meetups.pressable.4" onPress={() => confirmChange(meetup)} accessibilityRole="button" disabled={!!busy} accessibilityState={{ disabled: !!busy, busy: busy === meetup.id }} style={styles.action}>
          <ThemedText type="small" themeColor="textSecondary">{meetup.role === 'host' ? t.meetup.end : meetup.role === 'pending' ? t.meetup.cancelRequest : t.meetup.leave}</ThemedText>
        </Pressable>
      </View>)}</ScrollView>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two, marginBottom: Spacing.four },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  title: { fontSize: 18, lineHeight: 26 },
  rail: { gap: Spacing.two, paddingRight: Spacing.three },
  meetup: { width: 220, borderWidth: 1, borderRadius: 16, padding: Spacing.two, gap: Spacing.one },
  copy: { flexGrow: 1, flexBasis: 160, minHeight: 44, padding: Spacing.two, gap: Spacing.one },
  action: { minHeight: 44, minWidth: 44, padding: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  empty: { minHeight: 44, borderWidth: 1, borderRadius: 12, padding: Spacing.three },
});
