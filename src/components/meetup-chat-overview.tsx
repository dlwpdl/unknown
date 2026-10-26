import { Typography } from '@/constants/design-system';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Keyboard, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { Pressable } from '@/components/analytics-controls';
import { GlingLoader } from '@/components/gling-loader';
import { MeetupReviews } from '@/components/meetup-reviews';
import { PostBody } from '@/components/post-body';
import { PostMapLink } from '@/components/post-map-link';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { chillingSchedule, chillingTimezoneLabel } from '@/lib/chilling';
import { loadPublicMeetupContext, type PublicMeetupContext } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { visibleMeetupBody } from '@/lib/meetup-ai';
import { splitPlaceMeetupBody } from '@/lib/meetup-destination';
import { loadMeetupUpcomingSessions, type MeetupSessions } from '@/lib/meetup-reviews';
import { googlePinUrl, postMapBody, postPublicAddress, type PostPin } from '@/lib/post-maps';
import { supabase } from '@/lib/supabase';

const pinUrl = (pin: PostPin) => { try { return googlePinUrl(pin); } catch { return null; } };

/** Existing participants inspect schedules without leaving their conversation. */
export function MeetupChatOverview({ postId, currentUserId, onClose }: { postId: string; currentUserId: string; onClose: () => void }) {
  const { language, locale } = useLanguage(), theme = useTheme(), auth = useAuth(), hidden = useContentVisibility();
  const { play } = useInteractionFeedback(), insets = useSafeAreaInsets(), reducedMotion = useReducedMotion();
  const say = (ko: string, en: string) => language === 'en' ? en : ko;
  const [page, setPage] = useState<{ scope: string; post: PublicMeetupContext | null; participation: MeetupSessions | null; scheduleError: boolean } | null>(null);
  const [errorScope, setErrorScope] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [view, setView] = useState<'overview' | 'intro' | 'attendance'>('overview');
  const [visible, setVisible] = useState(true);
  const closing = useRef(false), finished = useRef(false);
  const scope = auth.isAuthed && auth.me.id === currentUserId && !hidden('post', postId, page?.post?.authorId) ? `${currentUserId}:${postId}` : null;
  const liveScope = useRef(scope);
  useLayoutEffect(() => { liveScope.current = scope; return () => { liveScope.current = null; }; }, [scope]);
  useEffect(() => {
    if (!scope) return;
    let active = true;
    void Promise.allSettled([loadPublicMeetupContext(supabase, postId), loadMeetupUpcomingSessions(supabase, postId)]).then(([post, participation]) => {
      if (!active || liveScope.current !== scope) return;
      if (post.status === 'rejected') { setErrorScope(scope); return; }
      const value = participation.status === 'fulfilled' ? participation.value : null;
      const schedule = value && typeof value.member === 'boolean' && typeof value.isHost === 'boolean'
        && (value.kind === 'once' || value.kind === 'group') && Array.isArray(value.sessions) ? value : null;
      setPage({ scope, post: post.value, participation: schedule, scheduleError: !schedule });
      setNow(Date.now());
    });
    return () => { active = false; };
  }, [scope, postId, retry]);
  const changeView = (next: typeof view) => {
    if (!scope || liveScope.current !== scope || closing.current) return;
    play('selection'); Keyboard.dismiss(); setView(next);
  };
  const finish = () => {
    if (finished.current || !scope || liveScope.current !== scope) return;
    finished.current = true; onClose();
  };
  const dismiss = () => {
    if (!scope || liveScope.current !== scope || closing.current) return;
    closing.current = true; play('selection'); Keyboard.dismiss(); setVisible(false);
    if (Platform.OS !== 'ios') finish();
  };
  const ready = page?.scope === scope && page.participation?.member !== false && page.post?.room ? page : null;
  const post = ready?.post, participation = ready?.participation;
  const upcoming = participation?.sessions.filter(session => Number.isFinite(Date.parse(session.startsAt)) && Date.parse(session.endsAt) > now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)) ?? [];
  const once = participation?.kind === 'once' && !participation.sessions.length && post?.room?.startsAt && post.room.endsAt
    && Number.isFinite(Date.parse(post.room.startsAt)) && Date.parse(post.room.endsAt) > now ? post.room : null;
  const place = post ? splitPlaceMeetupBody(post.body, post.cityId)?.place : null;
  const address = post ? postPublicAddress(post.body) ?? (place ? [place.name, place.address].filter(Boolean).join(' · ') : null) : null;
  const mapUrl = post ? postMapBody(post.body).url ?? (place ? pinUrl(place) : null) : null;
  // Same meetup-zone schedule as the summary card; sessions without a stored zone fall back to the device zone.
  const timezone = post?.room?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const schedule = (startsAt: string, endsAt: string, style: typeof styles.nextDate | typeof styles.bodyText) => {
    const zone = chillingTimezoneLabel({ startsAt, timezone }, locale);
    return <><ThemedText style={style}>{chillingSchedule({ eventKind: 'once', startsAt, endsAt, timezone }, locale)}</ThemedText>
      {zone && <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{say(`${zone} 기준`, `Times in ${zone}`)}</ThemedText>}</>;
  };
  const title = view === 'intro' ? say('모임 소개', 'About this meetup') : view === 'attendance' ? say('일정·참석 확인', 'Sessions and attendance') : say('모임 현황', 'Meetup overview');
  const retryRead = () => { if (scope && liveScope.current === scope && !closing.current) { play('selection'); setPage(null); setErrorScope(null); setRetry(value => value + 1); } };
  return <Modal visible={visible && !!scope} animationType={reducedMotion ? 'none' : 'slide'} presentationStyle="pageSheet" allowSwipeDismissal
    onDismiss={finish} onRequestClose={() => { if (Platform.OS === 'android' && view !== 'overview') changeView('overview'); else dismiss(); }}>
    <View style={[styles.screen, { backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: insets.bottom }]} accessibilityViewIsModal>
      <View style={[styles.header, { borderBottomColor: theme.line }]}>
        {view !== 'overview' && <Pressable analyticsId="components_chat-room.pressable.1" accessibilityRole="button" accessibilityLabel={say('모임 현황으로 돌아가기', 'Back to meetup overview')}
          onPress={() => changeView('overview')} style={({ pressed }) => [styles.icon, { opacity: pressed ? 0.82 : 1 }]}>
          <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={21} tintColor={theme.text} />
        </Pressable>}
        <ThemedText type="smallBold" accessibilityRole="header" style={styles.heading}>{title}</ThemedText>
        <Pressable analyticsId="components_chat-room.pressable.1" accessibilityRole="button" accessibilityLabel={say('모임 현황 닫기', 'Close meetup overview')}
          onPress={dismiss} style={({ pressed }) => [styles.icon, { opacity: pressed ? 0.82 : 1 }]}>
          <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={21} tintColor={theme.textSecondary} />
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {!scope || (page?.scope === scope && !ready) ? <ThemedText style={styles.bodyText}>{say('이 모임에 접근할 수 없어요. 참여 상태를 다시 확인해 주세요.', 'This meetup is unavailable. Please check your membership.')}</ThemedText>
          : errorScope === scope ? <><ThemedText accessibilityRole="alert" style={styles.bodyText}>{say('모임 현황을 불러오지 못했어요.', 'Could not load the meetup overview.')}</ThemedText>
            <Pressable analyticsId="components_chat-room.pressable.1" accessibilityRole="button" onPress={retryRead} style={({ pressed }) => [styles.action, { borderColor: theme.line, opacity: pressed ? 0.82 : 1 }]}><ThemedText style={styles.bodyText}>{say('다시 불러오기', 'Try again')}</ThemedText></Pressable></>
          : !ready ? <GlingLoader accessibilityLabel={say('모임 현황 불러오는 중', 'Loading meetup overview')} />
          : view === 'intro' ? <><ThemedText type="subtitle">{post!.title}</ThemedText><PostBody body={visibleMeetupBody(post!.body)} /></>
          : view === 'attendance' ? <MeetupReviews key={`${currentUserId}:${postId}`} postId={postId} kind={participation!.kind} attendanceOnly onBeforeNavigate={dismiss} />
          : <>
            <ThemedText type="subtitle">{post!.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{say('등록된 모임 멤버', 'Meetup members')} · {post!.room!.memberCount}</ThemedText>
            <ThemedText type="subtitle" accessibilityRole="header">{say('예정 일정', 'Upcoming sessions')}</ThemedText>
            {ready.scheduleError ? <><ThemedText accessibilityRole="alert" style={styles.bodyText}>{say('일정을 불러오지 못했어요.', 'Could not load upcoming sessions.')}</ThemedText>
              <Pressable analyticsId="components_chat-room.pressable.1" accessibilityRole="button" onPress={retryRead} style={({ pressed }) => [styles.action, { borderColor: theme.line, opacity: pressed ? 0.82 : 1 }]}><ThemedText style={styles.bodyText}>{say('다시 불러오기', 'Try again')}</ThemedText></Pressable></>
              : upcoming.length ? upcoming.map((session, index) => <View key={session.id} testID="meetup-upcoming-session" style={[styles.session, { backgroundColor: theme.card, borderColor: theme.line }]}>
              <ThemedText type="smallBold" themeColor={index === 0 ? 'accent' : undefined} style={styles.label}>{Date.parse(session.startsAt) <= now ? say('진행 중', 'In progress') : index === 0 ? say('다음 일정', 'Next session') : say('예정 일정', 'Upcoming session')}</ThemedText>
              {schedule(session.startsAt, session.endsAt, index === 0 ? styles.nextDate : styles.bodyText)}
              {session.members.some(member => member.verified) && <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{say('실제 참석 확인', 'Verified attendance')} · {session.members.filter(member => member.verified).length}</ThemedText>}
            </View>) : once ? <View testID="meetup-once-schedule" style={[styles.session, { backgroundColor: theme.card, borderColor: theme.line }]}>
              {schedule(once.startsAt!, once.endsAt!, styles.nextDate)}
            </View> : <ThemedText themeColor="textSecondary" style={styles.bodyText}>{say('등록된 예정 일정이 없어요.', 'No upcoming sessions are registered.')}</ThemedText>}
            <View style={[styles.session, { backgroundColor: theme.card, borderColor: theme.line }]}><ThemedText type="smallBold" style={styles.label}>{say('모임 공통 장소', 'Meetup location')}</ThemedText>
              {mapUrl ? <PostMapLink url={mapUrl} label={address ?? undefined} /> : <ThemedText style={styles.bodyText}>{address ?? say('장소가 아직 등록되지 않았어요.', 'A location has not been registered.')}</ThemedText>}</View>
            {participation && <Pressable analyticsId="components_chat-room.pressable.1" accessibilityRole="button" accessibilityLabel={participation.isHost ? say('일정·참석 관리', 'Manage sessions and attendance') : say('참석 확인', 'Attendance')}
              onPress={() => changeView('attendance')} style={({ pressed }) => [styles.action, { borderColor: theme.line, backgroundColor: theme.card, opacity: pressed ? 0.82 : 1 }]}><ThemedText type="smallBold" themeColor="accent" style={styles.label}>{participation!.isHost ? say('일정·참석 관리', 'Manage sessions and attendance') : say('참석 확인', 'Attendance')}</ThemedText></Pressable>
            }
            <Pressable analyticsId="chat.meetup-summary" accessibilityRole="button" accessibilityLabel={say('모임 소개', 'About this meetup')}
              onPress={() => changeView('intro')} style={({ pressed }) => [styles.action, { borderColor: theme.line, opacity: pressed ? 0.82 : 1 }]}><ThemedText style={styles.bodyText}>{say('모임 소개', 'About this meetup')}</ThemedText></Pressable>
          </>}
      </ScrollView>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  label: { ...Typography.menu }, helper: { fontSize: 14, lineHeight: 22 }, bodyText: { fontSize: 16, lineHeight: 24 },
  nextDate: { ...Typography.screenTitle },
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  heading: { flex: 1, minWidth: 0, paddingHorizontal: Spacing.two, ...Typography.screenTitle },
  icon: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.four, gap: Spacing.five },
  session: { padding: Spacing.four, borderWidth: 1, borderRadius: 16, gap: Spacing.two },
  action: { minHeight: 48, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderWidth: 1, borderRadius: 14, justifyContent: 'center' },
});
