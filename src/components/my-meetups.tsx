import { useLanguage } from '@/hooks/use-language';
import { GlingLoader } from '@/components/gling-loader';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Alert, DeviceEventEmitter, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PostShareSheet } from '@/components/post-share-sheet';
import { MeetupPolicyNotice } from '@/components/meetup-policy-notice';
import { relationshipSlotData } from '@/components/relationship-slot-card';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useAuth } from '@/lib/auth';
import { chillingSchedule } from '@/lib/chilling';
import { leaveMeetup, loadMyMeetups, MEETUPS_CHANGED_EVENT, recordPostShare, type MyMeetup } from '@/lib/community-data';
import { loadPublicPost } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useMembership } from '@/lib/membership-provider';
import { CITIES } from '@/lib/mock';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

type MyMeetupsProps = { onOpen: (postId: string) => Promise<void>; showLoadingIndicator?: boolean };
export function MyMeetups(props: MyMeetupsProps) {

  const { isAuthed, me } = useAuth();
  return <MyMeetupsContent key={isAuthed ? me.id : 'guest'} {...props} />;
}
function MyMeetupsContent({ onOpen, showLoadingIndicator = true }: MyMeetupsProps) {
  const { tr, t, locale: appLocale } = useLanguage();
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
  const [sharedPost, setSharedPost] = useState<Post | null>(null);
  const shareBusy = useRef(false), active = useRef(true);
  useLayoutEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const shareTarget = sharedPost && !hidden('post', sharedPost.id, sharedPost.author.id) ? sharedPost : null;
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
      setResult(current => current?.userId === userId ? { ...current, items: current.items.flatMap(item => item.id !== meetup.id ? [item] : meetup.role === 'host' ? [] : [{ ...item, role: 'cancelled' as const, conversationId: null }]) } : current);
      play('selection');
      DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT);
      await refreshMembership();
    } catch {
      if (currentUser.current === userId) { play('warning'); Alert.alert(t.meetup.changeError); }
    } finally { setBusy(null); }
  };

  const confirmChange = (meetup: MyMeetup) => {
    play('selection');
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
    play('selection');
    setBusy(meetup.id);
    try {
      if (meetup.role === 'host' || meetup.role === 'approved') await onOpen(meetup.id);
      else router.push({ pathname: '/meetup-join', params: { postId: meetup.id } });
    }
    catch { Alert.alert(t.feed.refreshErrorTitle, t.feed.refreshErrorBody); }
    finally { setBusy(null); }
  };
  const invite = async (meetup: MyMeetup) => {
    if (busy || shareBusy.current || !userId) return;
    shareBusy.current = true; setBusy(meetup.id); play('selection');
    try {
      const post = await loadPublicPost(supabase, meetup.id);
      if (!active.current) return;
      if (!post?.room || post.id !== meetup.id) throw new Error('MEETUP_UNAVAILABLE');
      setSharedPost(post);
    } catch {
      if (active.current) { play('warning'); Alert.alert(tr("초대 링크를 열지 못했어요"), tr("모임을 다시 확인한 뒤 눌러주세요.")); }
    } finally { shareBusy.current = false; if (active.current) setBusy(null); }
  };

  return <View style={styles.section}>
    <View style={styles.heading}>
      <ThemedText type="smallBold" accessibilityRole="header" style={styles.title}>{t.meetup.mine}</ThemedText>
      {isAuthed && slots && <ThemedText type="small" themeColor="textSecondary" accessibilityLabel={tr("모임 자리 {0} / {1}", (slots.active), (slots.limit))} style={{ fontVariant: ['tabular-nums'] }}>
        {tr("모임 자리") + " "}<ThemedText type="smallBold">{slots.active}/{slots.limit}</ThemedText>
      </ThemedText>}
    </View>
    {isAuthed && <><MeetupPolicyNotice mode="leave" /><MeetupPolicyNotice mode="close" /></>}
    {!isAuthed ? <Pressable analyticsId="components_my-meetups.pressable.1" onPress={() => { play('selection'); promptLogin(t.auth.reasonJoinLogin); }} accessibilityRole="button" style={[styles.empty, { borderColor: theme.line }]}>
      <ThemedText type="small" themeColor="accent">{tr("로그인하고 내 모임 보기")}</ThemedText>
    </Pressable> : <>
      {loading && items.length === 0 && showLoadingIndicator && <GlingLoader color={theme.accent} accessibilityLabel={tr("내 모임 불러오는 중")} />}
      {error && <ThemedText type="small" themeColor="accent" accessibilityRole="alert">{t.meetup.loadError}</ThemedText>}
      {!loading && !error && items.length === 0 && <ThemedText type="small" themeColor="textSecondary">{t.meetup.empty}</ThemedText>}
      {/* 내 모임은 가로 카드로 압축해 공개 모임 소개가 첫 화면에 들어오게 한다. */}
      <ScrollView analyticsId="components_my-meetups.scrollview.1" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>{items.map((meetup) => <View key={meetup.id} style={[styles.meetup, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <Pressable analyticsId="components_my-meetups.pressable.2" onPress={() => void open(meetup)} accessibilityRole="button" disabled={!!busy} accessibilityState={{ disabled: !!busy, busy: busy === meetup.id }} style={({ pressed }) => [styles.copy, { opacity: pressed ? 0.7 : 1 }]}>
          <ThemedText type="smallBold" themeColor="accent">{t.meetup[meetup.role]}</ThemedText>
          <ThemedText type="smallBold">{meetup.title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{chillingSchedule(meetup.room, appLocale)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{CITIES.find(({ id }) => id === meetup.cityId)?.name ?? meetup.cityId} · {meetup.room.memberCount ?? 0}{meetup.room.capacity ? `/${meetup.room.capacity}` : ''}{tr("명")}</ThemedText>
          {busy === meetup.id && <GlingLoader color={theme.accent} accessibilityLabel={tr("모임 처리 중")} />}
        </Pressable>
        {(meetup.role === 'host' || meetup.role === 'approved') && <Pressable analyticsId="meetup.share.open" accessibilityRole="button" accessibilityLabel={tr("{0} 초대 링크 공유", (meetup.title))}
          disabled={!!busy} accessibilityState={{ disabled: !!busy, busy: busy === meetup.id }} onPress={() => void invite(meetup)}
          style={({ pressed }) => [styles.action, { borderColor: theme.line, borderWidth: 1, borderRadius: 12, backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement }]}>
          <ThemedText type="smallBold" themeColor="accent">{meetup.role === 'host' ? tr("초대 링크") : tr("같이 가요")}</ThemedText>
        </Pressable>}
        {(meetup.role === 'host' || meetup.role === 'approved') && meetup.conversationId && <Pressable analyticsId="components_my-meetups.pressable.3"
          onPress={() => { play('selection'); router.push({ pathname: '/chat', params: { conversationId: meetup.conversationId! } }); }}
          accessibilityRole="button" style={styles.action}>
          <ThemedText type="smallBold" themeColor="accent">{t.meetup.openChat}</ThemedText>
        </Pressable>}
        {meetup.role !== 'rejected' && meetup.role !== 'cancelled' && <Pressable analyticsId="components_my-meetups.pressable.4" onPress={() => confirmChange(meetup)} accessibilityRole="button" disabled={!!busy} accessibilityState={{ disabled: !!busy, busy: busy === meetup.id }} style={styles.action}>
          <ThemedText type="small" themeColor="textSecondary">{meetup.role === 'host' ? t.meetup.end : meetup.role === 'pending' ? t.meetup.cancelRequest : t.meetup.leave}</ThemedText>
        </Pressable>}
      </View>)}</ScrollView>
      {shareTarget && <PostShareSheet post={shareTarget} visible onClose={() => setSharedPost(null)}
        onShared={() => { void recordPostShare(supabase, shareTarget.id).catch(() => {}); }} />}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two, marginBottom: Spacing.four },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  title: { fontSize: 18, lineHeight: 26 },
  rail: { gap: Spacing.two, paddingTop: Spacing.one, paddingBottom: Spacing.three, paddingRight: Spacing.three },
  meetup: { width: 220, borderWidth: 1, borderRadius: 16, padding: Spacing.two, gap: Spacing.one },
  copy: { flexGrow: 1, flexBasis: 160, minHeight: 44, padding: Spacing.two, gap: Spacing.one },
  action: { minHeight: 44, minWidth: 44, padding: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  empty: { minHeight: 44, borderWidth: 1, borderRadius: 12, padding: Spacing.three },
});
