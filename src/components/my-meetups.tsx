import { useLanguage } from '@/hooks/use-language';
import { GlingLoader } from '@/components/gling-loader';
import { Pressable } from '@/components/analytics-controls';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Alert, DeviceEventEmitter, Platform, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { PostShareSheet } from '@/components/post-share-sheet';
import { MeetupManageSheet } from '@/components/meetup-manage-sheet';
import { meetupHostActions } from '@/components/meetup-room-summary';
import { MeetupPolicyNotice } from '@/components/meetup-policy-notice';
import { relationshipSlotData } from '@/components/relationship-slot-card';
import { Spacing } from '@/constants/theme';
import { Typography } from '@/constants/design-system';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useAuth } from '@/lib/auth';
import { chillingKind, chillingSchedule } from '@/lib/chilling';
import { leaveMeetup, loadMyMeetups, MEETUPS_CHANGED_EVENT, recordPostShare, type MyMeetup } from '@/lib/community-data';
import { loadPublicPost } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useMembership } from '@/lib/membership-provider';
import { CITIES } from '@/lib/mock';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

type MyMeetupsProps = { onOpen: (postId: string) => Promise<void>; showLoadingIndicator?: boolean; hideTitle?: boolean };
export function MyMeetups(props: MyMeetupsProps) {

  const { isAuthed, me } = useAuth();
  return <MyMeetupsContent key={isAuthed ? me.id : 'guest'} {...props} />;
}
function MyMeetupsContent({ onOpen, showLoadingIndicator = true, hideTitle = false }: MyMeetupsProps) {
  const { tr, t, language, locale: appLocale } = useLanguage();
  const theme = useTheme();
  const hidden = useContentVisibility();
  const router = useRouter();
  const { isAuthed, isAdmin, me, promptLogin } = useAuth();
  const { play } = useInteractionFeedback();
  const { membership, refresh: refreshMembership } = useMembership();
  const slots = relationshipSlotData(membership, 'meetup');
  const userId = isAuthed ? me.id : null;
  const currentUser = useRef(userId);
  useLayoutEffect(() => { currentUser.current = userId; return () => { currentUser.current = null; }; }, [userId]);
  const requestVersion = useRef(0);
  const [result, setResult] = useState<{ userId: string; items: MyMeetup[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sharedPost, setSharedPost] = useState<Post | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<MyMeetup | null>(null);
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
    if (busy || !userId || !active.current || currentUser.current !== userId) return;
    setBusy(meetup.id);
    try {
      await leaveMeetup(supabase, meetup.id);
      if (!active.current || currentUser.current !== userId) return;
      setResult(current => current?.userId === userId ? { ...current, items: current.items.flatMap(item => item.id !== meetup.id ? [item] : meetup.role === 'host' ? [] : [{ ...item, role: 'cancelled' as const, conversationId: null }]) } : current);
      play('selection');
      DeviceEventEmitter.emit(MEETUPS_CHANGED_EVENT);
      await refreshMembership();
    } catch {
      if (active.current && currentUser.current === userId) { play('warning'); Alert.alert(t.meetup.changeError); }
    } finally { if (active.current && currentUser.current === userId) setBusy(null); }
  };

  const confirmChange = (meetup: MyMeetup) => {
    play('selection');
    const host = meetup.role === 'host';
    const pending = meetup.role === 'pending';
    // react-native-web's Alert is a no-op, so web needs the browser confirm.
    if (Platform.OS === 'web') {
      if (globalThis.confirm(`${host ? t.meetup.endTitle : pending ? t.meetup.cancelTitle : t.meetup.leaveTitle}\n\n${host ? t.meetup.endBody : pending ? t.meetup.cancelBody : t.meetup.leaveBody}`)) void changeMeetup(meetup);
      return;
    }
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
    if (busy || !active.current || currentUser.current !== userId) return;
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
      if (!active.current || currentUser.current !== userId) return;
      if (!post?.room || post.id !== meetup.id) throw new Error('MEETUP_UNAVAILABLE');
      setSharedPost(post);
    } catch {
      if (active.current) { play('warning'); Alert.alert(tr("초대 링크를 열지 못했어요"), tr("모임을 다시 확인한 뒤 눌러주세요.")); }
    } finally { shareBusy.current = false; if (active.current) setBusy(null); }
  };

  return <View style={styles.section}>
    <View style={styles.heading}>
      {!hideTitle && <ThemedText type="smallBold" accessibilityRole="header" style={styles.title}>{t.meetup.mine}</ThemedText>}
      {isAuthed && slots && <ThemedText type="small" themeColor="textSecondary" accessibilityLabel={isAdmin ? tr('관리자 계정 · 제한 없음') : tr("모임 자리 {0} / {1}", (slots.active), (slots.limit))} style={[styles.support, { fontVariant: ['tabular-nums'] }]}>
        {isAdmin ? tr('관리자 계정 · 제한 없음') : <>{tr("모임 자리") + " "}<ThemedText type="smallBold" style={styles.support}>{slots.active}/{slots.limit}</ThemedText></>}
      </ThemedText>}
    </View>
    {isAuthed && <><Pressable analyticsId="meetup.mine.policy" accessibilityRole="button" accessibilityState={{ expanded: policyOpen }} onPress={() => { play('selection'); setPolicyOpen(value => !value); }} style={styles.policy}>
      <ThemedText style={styles.support} themeColor="textSecondary">{language === 'en' ? 'Cancellation, leaving and ending' : '취소·탈퇴·종료 안내'}{policyOpen ? ' −' : ' +'}</ThemedText>
    </Pressable>{policyOpen && <><MeetupPolicyNotice mode="leave" /><MeetupPolicyNotice mode="close" /></>}</>}
    {!isAuthed ? <Pressable analyticsId="components_my-meetups.pressable.1" onPress={() => { play('selection'); promptLogin(t.auth.reasonJoinLogin); }} accessibilityRole="button" style={[styles.empty, { borderColor: theme.line }]}>
      <ThemedText type="small" style={styles.body} themeColor="accent">{tr("로그인하고 내 모임 보기")}</ThemedText>
    </Pressable> : <>
      {loading && items.length === 0 && showLoadingIndicator && <GlingLoader color={theme.accent} accessibilityLabel={tr("내 모임 불러오는 중")} />}
      {error && <ThemedText type="small" style={styles.support} themeColor="accent" accessibilityRole="alert">{t.meetup.loadError}</ThemedText>}
      {!loading && !error && items.length === 0 && <ThemedText type="small" style={styles.support} themeColor="textSecondary">{t.meetup.empty}</ThemedText>}
      {/* 내가 연 모임 → 참여 중 → 신청 내역 순서. 종료·나가기 같은 되돌릴 수 없는 동작은 ⋯ 메뉴 안에만 둔다. */}
      {([['host', tr('내가 연 모임')], ['approved', tr('참여 중')], ['other', tr('신청 내역')], ['closed', tr('지난 모임')]] as const).map(([group, heading]) => {
        const list = items.filter(item => group === 'other' ? item.role === 'pending' || item.role === 'rejected' || item.role === 'cancelled' : item.role === group);
        return list.length > 0 && <View key={group} style={styles.list}>
          <ThemedText type="smallBold" accessibilityRole="header" style={styles.support} themeColor="textSecondary">{heading}</ThemedText>
          {list.map(meetup => {
            const member = meetup.role === 'host' || meetup.role === 'approved';
            const canChange = meetup.role === 'host' || meetup.role === 'approved' || meetup.role === 'pending';
            return <View key={meetup.id} style={[styles.meetup, { backgroundColor: theme.card, borderColor: theme.line }]}>
              <View style={styles.cardHead}>
                <Pressable analyticsId="components_my-meetups.pressable.2" onPress={() => void open(meetup)} accessibilityRole="button" disabled={!!busy} accessibilityState={{ disabled: !!busy, busy: busy === meetup.id }} style={({ pressed }) => [styles.copy, { opacity: pressed ? 0.7 : 1 }]}>
                  <ThemedText type="smallBold" style={styles.support} themeColor="accent">{member ? chillingKind(meetup.room) === 'group' ? tr('정기모임') : tr('칠링') : t.meetup[meetup.role]}</ThemedText>
                  <ThemedText accessibilityRole="header" style={styles.cardTitle}>{meetup.title}</ThemedText>
                  <ThemedText style={styles.body}>{chillingSchedule(meetup.room, appLocale)}</ThemedText>
                  <ThemedText type="small" style={styles.support} themeColor="textSecondary">{tr(meetup.room.capacity ? "{0} · {1}/{2}명" : "{0} · {1}명", tr(CITIES.find(({ id }) => id === meetup.cityId)?.name ?? meetup.cityId), meetup.room.memberCount ?? 0, meetup.room.capacity)}{meetup.room.recruitingClosed ? tr(' · 모집 마감') : ''}</ThemedText>
                  {busy === meetup.id && <GlingLoader color={theme.accent} accessibilityLabel={tr("모임 처리 중")} />}
                </Pressable>
                {canChange && <Pressable analyticsId="components_my-meetups.pressable.4" accessibilityRole="button" accessibilityLabel={tr("{0} 더보기", meetup.title)} disabled={!!busy}
                  onPress={() => { play('selection'); setMenuFor(meetup); }}
                  style={({ pressed }) => [styles.more, { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement }]}>
                  <SymbolView name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }} size={18} tintColor={theme.text} />
                </Pressable>}
              </View>
              {(member || !!meetup.conversationId) && <View style={styles.actions}>
                {meetup.conversationId && <Pressable analyticsId="components_my-meetups.pressable.3"
                  onPress={() => { play('selection'); router.push({ pathname: '/chat', params: { conversationId: meetup.conversationId! } }); }}
                  accessibilityRole="button" style={({ pressed }) => [styles.action, styles.grow, { borderRadius: 12, backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 }]}>
                  <ThemedText type="smallBold" style={[styles.body, { color: theme.accentInk }]}>{member ? t.meetup.openChat : tr('지난 대화 보기')}</ThemedText>
                </Pressable>}
                {member && <Pressable analyticsId="meetup.share.open" accessibilityRole="button" accessibilityLabel={tr("{0} 초대 링크 공유", (meetup.title))}
                  disabled={!!busy} accessibilityState={{ disabled: !!busy, busy: busy === meetup.id }} onPress={() => void invite(meetup)}
                  style={({ pressed }) => [styles.action, styles.grow, { borderRadius: 12, backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement }]}>
                  <ThemedText style={styles.body} themeColor="accent">{meetup.role === 'host' ? tr("초대 링크") : tr("친구 초대")}</ThemedText>
                </Pressable>}
              </View>}
            </View>;
          })}
        </View>;
      })}
      {menuFor && <MeetupManageSheet visible title={menuFor.title} onClose={() => setMenuFor(null)} actions={[
        ...(menuFor.role === 'host' || menuFor.role === 'approved' ? [{ key: 'my-open', label: tr('모임 정보 보기'), icon: { ios: 'info.circle', android: 'info', web: 'info' } as const, onPress: () => void open(menuFor) }] : []),
        ...(menuFor.role === 'host' ? meetupHostActions({ postId: menuFor.id, room: menuFor.room, tr, play, router }) : []),
        { key: 'my-change', label: menuFor.role === 'host' ? t.meetup.end : menuFor.role === 'pending' ? t.meetup.cancelRequest : t.meetup.leave, danger: true,
          icon: { ios: menuFor.role === 'host' ? 'xmark.circle' : 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' } as const, onPress: () => confirmChange(menuFor) },
      ]} />}
      {shareTarget && <PostShareSheet post={shareTarget} visible onClose={() => setSharedPost(null)}
        onShared={() => { void recordPostShare(supabase, shareTarget.id).catch(() => {}); }} />}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two, marginBottom: Spacing.four },
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  title: { ...Typography.subtitle },
  list: { gap: Spacing.four, paddingVertical: Spacing.one },
  meetup: { borderWidth: 1, borderRadius: 20, padding: Spacing.four, gap: Spacing.two },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  copy: { flex: 1, minWidth: 0, minHeight: 44, gap: Spacing.two },
  more: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  grow: { flexGrow: 1, flexBasis: 120 },
  cardTitle: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
  body: { ...Typography.body, fontSize: 16, lineHeight: 24 }, support: { ...Typography.supporting, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  policy: { minHeight: 44, justifyContent: 'center' },
  action: { minHeight: 44, minWidth: 44, padding: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  empty: { minHeight: 44, borderWidth: 1, borderRadius: 12, padding: Spacing.three },
});
