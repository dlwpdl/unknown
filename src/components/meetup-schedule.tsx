import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { ListCard, ListLoading, ListRow, SectionLabel, Tag } from '@/components/list-card';
import { MeetupAddSession } from '@/components/meetup-add-session';
import { MeetupAutoNext } from '@/components/meetup-loyalty';
import { RaisedActionButton } from '@/components/raised-action-button';
import { StateCard } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { daysLeftToConfirm, inAttendanceWindow, liveSession, pastSessions, sessionRange, upcomingSessions } from '@/lib/meetup-host-home';
import { loadMeetupHostTools, type MeetupHostToolsState } from '@/lib/meetup-host-tools';
import { formatMeetupTime, meetupZone } from '@/lib/chilling-date';
import { loadPublicMeetupContext } from '@/lib/feed-data';
import { loadMeetupSessions, type MeetupSession, type MeetupSessions } from '@/lib/meetup-reviews';
import { supabase } from '@/lib/supabase';

function DateTile({ iso, on, zone }: { iso: string; on: boolean; zone: string }) {
  const { locale } = useLanguage();
  const theme = useTheme();
  const color = { color: on ? theme.accentInk : theme.textSecondary };
  return <View style={[styles.tile, { backgroundColor: on ? theme.accent : theme.backgroundElement }]}>
    <ThemedText style={[Typography.caption, color]}>{formatMeetupTime(iso, locale, zone, { month: 'short' })}</ThemedText>
    <ThemedText style={[Typography.menu, { color: on ? theme.accentInk : theme.text }]}>{formatMeetupTime(iso, 'en-CA', zone, { day: 'numeric' })}</ThemedText>
    <ThemedText style={[Typography.caption, color]}>{formatMeetupTime(iso, locale, zone, { weekday: 'short' })}</ThemedText>
  </View>;
}

/** /meetup-tools schedule: what is coming, what happened, and adding more. Each row opens that session. */
export function MeetupSchedule({ postId, kind, host }: { postId: string; kind: 'once' | 'group'; host: boolean }) {
  const { tr, locale } = useLanguage();
  const router = useRouter(), { play } = useInteractionFeedback();
  const [sessions, setSessions] = useState<MeetupSessions | null>(null), [tools, setTools] = useState<MeetupHostToolsState | null>(null);
  const [failed, setFailed] = useState(false), [adding, setAdding] = useState(false), [revision, setRevision] = useState(0), [added, setAdded] = useState(0);
  // Live/upcoming/past are judged at the time the sessions arrived.
  const [now, setNow] = useState(() => Date.now());
  const [zone, setZone] = useState(() => meetupZone());
  useFocusEffect(useCallback(() => {
    let active = true;
    Promise.all([loadMeetupSessions(supabase, postId), loadMeetupHostTools(supabase, postId), loadPublicMeetupContext(supabase, postId).catch(() => null)])
      .then(([nextSessions, nextTools, context]) => { if (active) { setSessions(nextSessions); setTools(nextTools); setZone(meetupZone(context?.room, context?.cityId)); setNow(Date.now()); setFailed(false); } }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  // revision re-reads the sessions after adding one or retrying. The compiler drops a dependency the body does not read unless this line skips it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, revision]));
  if (failed) return <StateCard kind="error" title={tr('일정을 불러오지 못했어요')} body={tr('연결을 확인하고 다시 시도해 주세요.')} actionLabel={tr('다시 불러오기')} onAction={() => setRevision(value => value + 1)} />;
  if (!sessions || !tools) return <ListLoading label={tr('불러오는 중이에요')} />;
  const live = liveSession(sessions.sessions, now);
  const upcoming = upcomingSessions(sessions.sessions, now), past = pastSessions(sessions.sessions, now);
  const open = (session: MeetupSession) => router.push({ pathname: '/meetup-tools', params: { postId, kind, host: host ? '1' : '0', section: 'session', sessionId: session.id } });
  const canAdd = kind === 'group' && (sessions.isHost || tools.canManageSessions);
  const length = (session: MeetupSession) => Math.round((Date.parse(session.endsAt) - Date.parse(session.startsAt)) / 360000) / 10;
  const summary = (session: MeetupSession) => {
    const members = session.members.length, came = session.members.filter(member => member.checkedIn).length, verified = session.members.filter(member => member.verified).length;
    if (session.id === live?.id) return tr('체크인 {0}/{1}명', came, members);
    if (upcoming.includes(session)) return tr('{0}명 참여', members);
    if (!came) return tr('체크인한 분이 없어요');
    return inAttendanceWindow(session, now) && verified < came ? tr('{0}명 체크인 · 서로 확인 중', came) : tr('{0}명 참석 · 확인 끝', verified);
  };
  return <View>
    <SectionLabel>{tr('앞으로')}</SectionLabel>
    {upcoming.length ? <ListCard>{upcoming.map((session, index) => <ListRow key={session.id} analyticsId="meetup.schedule.session" title={tr('{0} · {1}시간', sessionRange(session, locale, zone), length(session))} detail={summary(session)}
      leading={<DateTile iso={session.startsAt} on={index === 0} zone={zone} />} trailing={session.id === live?.id ? <Tag label={tr('지금')} /> : index === 0 ? <Tag label={tr('다음 회차')} /> : undefined} onPress={() => open(session)} />)}</ListCard>
      : <ThemedText themeColor="textSecondary" style={Typography.supporting}>{tr('아직 잡힌 회차가 없어요.')}</ThemedText>}
    {canAdd && <View style={styles.add}><RaisedActionButton analyticsId="meetup.schedule.add" tone="secondary" label={tr('회차 추가')} onPress={() => { play('selection'); setAdding(true); }} /></View>}
    {added > 0 && <ThemedText accessibilityLiveRegion="polite" themeColor="textSecondary" style={[Typography.supporting, styles.note]}>{tr('회차 {0}개를 등록했어요.', added)}</ThemedText>}
    {past.length > 0 && <>
      <SectionLabel>{tr('지난 회차')}</SectionLabel>
      <ListCard>{past.map(session => <ListRow key={session.id} analyticsId="meetup.schedule.session" title={sessionRange(session, locale, zone)} detail={summary(session)} leading={<DateTile iso={session.startsAt} on={false} zone={zone} />}
        trailing={inAttendanceWindow(session, now) ? <Tag label={tr('{0}일 남음', daysLeftToConfirm(session, now))} tone="quiet" /> : undefined} onPress={() => open(session)} />)}</ListCard>
    </>}
    {sessions.isHost && <MeetupAutoNext postId={postId} />}
    {canAdd && <MeetupAddSession postId={postId} zone={zone} visible={adding} canSingle={sessions.isHost} canRepeat={tools.canManageSessions} onClose={() => setAdding(false)} onAdded={count => { setAdded(count); setRevision(value => value + 1); }} />}
  </View>;
}

const styles = StyleSheet.create({
  tile: { width: 44, borderRadius: 10, alignItems: 'center', paddingVertical: 2 },
  add: { marginTop: Spacing.two },
  note: { marginTop: Spacing.two },
});
