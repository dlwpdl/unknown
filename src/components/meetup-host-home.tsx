import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Pressable } from '@/components/analytics-controls';
import { ClayBoxFill, ClayPillFill, useClay, useClayBox } from '@/components/clay';
import { ListCard, ListLoading, ListRow, SectionLabel } from '@/components/list-card';
import { MeetupReviews } from '@/components/meetup-reviews';
import { RaisedActionButton } from '@/components/raised-action-button';
import { StateCard } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { loadPendingMeetupRequests } from '@/lib/community-data';
import { loadPublicMeetupContext, type PublicMeetupContext } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadMeetupAutomation, type MeetupAutomation } from '@/lib/meetup-convenience';
import { daysLeftToConfirm, hostTodos, liveSession, sessionWhen, upcomingSessions, type HostTodo } from '@/lib/meetup-host-home';
import { loadMeetupFee, loadMeetupFeePayments, loadMeetupHostRoster, loadMeetupHostTools, meetupFeeAmount, type MeetupFee, type MeetupHostIdentity, type MeetupHostToolsState } from '@/lib/meetup-host-tools';
import { loadMeetupLoyalty, pinnedNotices, type MeetupLoyalty } from '@/lib/meetup-loyalty';
import { loadMeetupSessions, type MeetupSession } from '@/lib/meetup-reviews';
import { supabase } from '@/lib/supabase';

type Home = {
  tools: MeetupHostToolsState; sessions: MeetupSession[]; context: PublicMeetupContext | null; loyalty: MeetupLoyalty | null; automation: MeetupAutomation | null;
  pending: number | null; fee: MeetupFee | null; paid: string[]; roster: MeetupHostIdentity[];
};
const settled = <T,>(result: PromiseSettledResult<T>, fallback: T) => result.status === 'fulfilled' ? result.value : fallback;

async function loadHome(postId: string): Promise<Home> {
  const tools = await loadMeetupHostTools(supabase, postId);
  const [sessions, context, loyalty, automation, requests, fee, paid, roster] = await Promise.allSettled([
    loadMeetupSessions(supabase, postId), loadPublicMeetupContext(supabase, postId), loadMeetupLoyalty(supabase, postId), loadMeetupAutomation(supabase, postId),
    loadPendingMeetupRequests(supabase), tools.available ? loadMeetupFee(supabase, postId) : Promise.resolve(null),
    tools.available ? loadMeetupFeePayments(supabase, postId) : Promise.resolve([]), loadMeetupHostRoster(supabase, postId),
  ]);
  return {
    tools, sessions: settled(sessions, { sessions: [] as MeetupSession[] } as { sessions: MeetupSession[] }).sessions, context: settled(context, null), loyalty: settled(loyalty, null), automation: settled(automation, null),
    // shortcut: the inbox query returns the newest 50 across all my meetups, so a busier host can see a lower count here; the requests tab stays exact.
    pending: requests.status === 'fulfilled' ? requests.value.filter(request => request.post_id === postId).length : null,
    fee: settled(fee, null), paid: settled(paid, [] as { user_id: string }[]).map(row => row.user_id), roster: settled(roster, []),
  };
}

function Stat({ label, value, total }: { label: string; value: string; total?: string }) {
  const theme = useTheme(), clayBox = useClayBox();
  return <View style={[styles.stat, clayBox ? styles.clayCard : { backgroundColor: theme.card, borderColor: theme.line }]}>
    {clayBox && <ClayBoxFill kind="tile" />}
    <ThemedText themeColor="textSecondary" style={Typography.caption}>{label}</ThemedText>
    <ThemedText style={Typography.section}>{value}{!!total && <ThemedText themeColor="textSecondary" style={Typography.supporting}>/{total}</ThemedText>}</ThemedText>
  </View>;
}

/** Host home: where the meetup stands, the one thing to do next, and the five areas to manage. */
export function MeetupHostHome({ postId, kind }: { postId: string; kind: 'once' | 'group' }) {
  const { tr, locale, language } = useLanguage();
  const router = useRouter(), { play } = useInteractionFeedback(), theme = useTheme();
  const [home, setHome] = useState<Home | null>(null), [failed, setFailed] = useState(false), [revision, setRevision] = useState(0);
  // Times on this screen are judged at the time the home data arrived.
  const [now, setNow] = useState(() => Date.now());
  useFocusEffect(useCallback(() => {
    let active = true;
    loadHome(postId).then(value => { if (active) { setHome(value); setNow(Date.now()); setFailed(false); } }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [postId, revision]));
  if (failed && !home) return <View style={styles.pad}><StateCard kind="error" title={tr('호스트 관리를 불러오지 못했어요')} body={tr('연결을 확인하고 다시 시도해 주세요.')} actionLabel={tr('다시 불러오기')} onAction={() => setRevision(value => value + 1)} /></View>;
  if (!home) return <ListLoading label={tr('불러오는 중이에요')} />;
  // The server decides: anyone who is not the host gets the attendance screen.
  if (!home.tools.isHost) return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}><MeetupReviews postId={postId} kind={kind} attendanceOnly /></ScrollView>;
  const section = (name: string, extra: Record<string, string> = {}) => router.push({ pathname: '/meetup-tools', params: { postId, kind, host: '1', section: name, ...extra } });
  const members = home.roster.filter(person => !person.isHost);
  const unpaid = home.fee ? members.filter(person => !home.paid.includes(person.userId)).length : 0;
  const todos = hostTodos({ sessions: home.sessions, pending: home.pending ?? 0, unpaid, now });
  const live = liveSession(home.sessions, now), next = upcomingSessions(home.sessions, now)[0];
  const room = home.context?.room;
  const notices = pinnedNotices(home.loyalty), scheduled = home.loyalty?.scheduled?.length ?? 0;
  const auto = home.automation && (home.automation.approve.sameCity || home.automation.approve.newcomer || home.automation.approve.age);
  const dateOf = (session: MeetupSession) => new Date(session.startsAt).toLocaleDateString(locale, { month: 'long', day: 'numeric' });
  const run = (todo: HostTodo) => {
    if (todo.kind === 'requests') router.push({ pathname: '/chat', params: { view: 'requests' } });
    else if (todo.kind === 'unpaid') section('dues');
    else section('session', { sessionId: todo.session.id });
  };
  const todoCopy = (todo: HostTodo): { cta: string; title: string; detail: string } => {
    if (todo.kind === 'live') { const came = todo.session.members.filter(member => member.checkedIn).length; return { cta: tr('체크인 시작'), title: tr('지금 체크인 {0}/{1}명', came, todo.session.members.length), detail: tr('모임이 시작됐어요') }; }
    if (todo.kind === 'requests') return { cta: tr('신청 {0}명 확인하기', todo.count), title: tr('신청 {0}명이 기다려요', todo.count), detail: tr('채팅 탭 › 참여 신청에서 승인해요') };
    if (todo.kind === 'confirm') return { cta: tr('{0} 참석 확인하기', dateOf(todo.session)), title: tr('참석 확인할 회차가 있어요'), detail: tr('{0} 회차 · {1}일 남았어요', dateOf(todo.session), daysLeftToConfirm(todo.session, now)) };
    return { cta: '', title: tr('회비 안 낸 분이 {0}명이에요', todo.count), detail: home.fee ? meetupFeeAmount(home.fee.amount) : '' };
  };
  const primary = todos[0]?.kind === 'unpaid' ? null : todos[0] ?? null;
  const rest = primary ? todos.slice(1) : todos;
  return <View style={styles.root}>
    <ScrollView contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={false} tintColor={theme.accent} onRefresh={() => { play('selection'); setRevision(value => value + 1); }} />}>
      <View>
        {!!home.context?.title && <ThemedText accessibilityRole="header" style={Typography.sheetTitle}>{home.context.title}</ThemedText>}
        <ThemedText themeColor="textSecondary" style={Typography.supporting}>{next ? tr('{0} · {1}', live ? tr('이번 회차') : tr('다음 회차'), sessionWhen(next.startsAt, locale, now, tr)) : tr('아직 잡힌 회차가 없어요.')}</ThemedText>
      </View>
      <View style={styles.stats} accessibilityRole="summary">
        <Stat label={tr('참여')} value={String(room?.memberCount ?? members.length + 1)} total={room?.capacity ? String(room.capacity) : undefined} />
        {live ? <Stat label={tr('체크인')} value={String(live.members.filter(member => member.checkedIn).length)} total={String(live.members.length)} /> : <Stat label={tr('신청')} value={home.pending == null ? '—' : String(home.pending)} />}
        <Stat label={tr('대기')} value={home.tools.waitlistCount == null ? '—' : String(home.tools.waitlistCount)} />
      </View>
      {rest.length > 0 && <View>
        <SectionLabel>{tr('지금 할 일')}</SectionLabel>
        <ListCard>{rest.map(todo => { const copy = todoCopy(todo); return <ListRow key={todo.kind} analyticsId="meetup.home.todo" title={copy.title} detail={copy.detail} onPress={() => run(todo)} />; })}</ListCard>
      </View>}
      <View>
        <SectionLabel>{tr('관리')}</SectionLabel>
        <ListCard>
          <ListRow analyticsId="meetup.home.schedule" title={tr('일정·참석')} detail={next ? tr('{0} {1}', live ? tr('이번 회차') : tr('다음 회차'), sessionWhen(next.startsAt, locale, now, tr)) : tr('회차를 추가해 보세요')} onPress={() => section('schedule')} />
          <ListRow analyticsId="meetup.home.members" title={tr('멤버')} detail={tr('{0}명 · 대기 {1}명', room?.memberCount ?? members.length + 1, home.tools.waitlistCount ?? 0)} onPress={() => section('members')} />
          <ListRow analyticsId="meetup.home.notices" title={language === 'en' ? 'Notices' : '공지'} detail={scheduled ? tr('걸린 공지 {0}개 · 예약 {1}개', notices.length, scheduled) : tr('걸린 공지 {0}개', notices.length)} onPress={() => section('notices')} />
          {home.tools.available && <ListRow analyticsId="meetup.home.dues" title={tr('회비')} detail={home.fee ? (unpaid ? tr('{0} · {1}명 아직', meetupFeeAmount(home.fee.amount), unpaid) : tr('{0} · 다 냈어요', meetupFeeAmount(home.fee.amount))) : tr('받지 않아요')} onPress={() => section('dues')} />}
          <ListRow analyticsId="meetup.home.settings" title={tr('운영 설정')} detail={[!home.tools.cohostLimit ? tr('공동 호스트 없음') : home.tools.cohostLimit >= 100 ? tr('공동 호스트 {0}명', home.tools.cohosts.length) : tr('공동 호스트 {0}/{1}', home.tools.cohosts.length, home.tools.cohostLimit), auto ? tr('자동 승인 켜짐') : tr('자동 승인 꺼짐')].join(' · ')} onPress={() => section('settings')} />
        </ListCard>
      </View>
    </ScrollView>
    {primary && <View style={styles.footer}><RaisedActionButton analyticsId="meetup.home.primary" label={todoCopy(primary).cta} onPress={() => { play('selection'); run(primary); }} /></View>}
  </View>;
}

export function MeetupEditLink({ postId }: { postId: string }) {
  const { tr } = useLanguage();
  const router = useRouter(), { play } = useInteractionFeedback(), clay = useClay();
  return <Pressable analyticsId="meetup.home.edit" accessibilityRole="button" accessibilityLabel={tr('모임 수정')} style={[styles.edit, clay && styles.clayEdit]} onPress={() => { play('selection'); router.push({ pathname: '/meetup-edit', params: { postId } }); }}>
    {clay && <ClayPillFill kind="white" />}
    <ThemedText type="smallBold" themeColor="accent">{tr('모임 수정')}</ThemedText>
  </Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pad: { padding: 22 },
  content: { padding: 22, paddingBottom: Spacing.five, width: '100%', maxWidth: 640, alignSelf: 'center', gap: Spacing.three },
  stats: { flexDirection: 'row', gap: Spacing.two },
  stat: { flex: 1, padding: Spacing.three, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  footer: { paddingHorizontal: 22, paddingTop: Spacing.two, paddingBottom: Spacing.two },
  clayEdit: { overflow: 'visible', paddingHorizontal: 18, alignSelf: 'flex-start' },
  clayCard: { backgroundColor: 'transparent', borderColor: 'transparent', overflow: 'visible' },
  edit: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.one },
});
