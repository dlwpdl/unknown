import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Pressable } from '@/components/analytics-controls';
import { ChillingDateInput } from '@/components/chilling-date-input';
import { ThemedText } from '@/components/themed-text';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';
import { confirmMeetupOccurrence, inviteMeetupCohost, inviteNextMeetupWaitlist, loadMeetupHostAggregates, loadMeetupHostRoster,
  loadMeetupHostTools, proposeMeetupDates, removeMeetupCohost, respondMeetupCohost, setMeetupWaitlist,
  type MeetupHostAggregates, type MeetupHostIdentity, type MeetupHostToolsState, type MeetupOccurrence } from '@/lib/meetup-host-tools';

export type MeetupHostToolsProps = { postId: string; onChanged?: () => void };

export function MeetupHostTools(props: MeetupHostToolsProps) {
  const { isAuthed, me } = useAuth();
  return isAuthed ? <HostTools key={`${me.id}:${props.postId}`} {...props} waitlistOnly={false} /> : null;
}

export function MeetupWaitlist(props: MeetupHostToolsProps) {
  const { isAuthed, me } = useAuth();
  return isAuthed ? <HostTools key={`${me.id}:${props.postId}`} {...props} waitlistOnly /> : null;
}

const notices = {
  joined: ['대기 신청했어요. 초대가 와도 참여 신청과 호스트 승인이 필요해요.', 'You’re on the waitlist. If you’re invited, you’ll still need to apply and get host approval.'],
  cancelled: ['대기 신청을 취소했어요.', 'You left the waitlist.'],
  invited: ['다음 대기자에게 참여를 제안했어요. 승인되거나 자리가 예약되지는 않아요.', 'Invited the next person on the waitlist. This doesn’t approve them or hold a spot.'],
  empty: ['지금 초대할 대기자가 없어요.', 'No one to invite from the waitlist right now.'],
  role: ['공동 호스트 상태를 변경했어요.', 'Cohost status updated.'],
  created: ['이 회차를 등록했어요. 다른 날짜는 각각 확인 후 등록해주세요.', 'Session added. Confirm each of the other dates separately.'],
} as const;

function HostTools({ postId, onChanged, waitlistOnly }: MeetupHostToolsProps & { waitlistOnly: boolean }) {
  const { language, tr, locale } = useLanguage(), theme = useTheme(), { play } = useInteractionFeedback(), { me } = useAuth();
  const say = (ko: string, en: string) => tr(language === 'ko' ? ko : en);
  const [state, setState] = useState<MeetupHostToolsState | null>(null), [roster, setRoster] = useState<MeetupHostIdentity[]>([]);
  const [metrics, setMetrics] = useState<MeetupHostAggregates | null>(null), [metricError, setMetricError] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const [error, setError] = useState(false), [notice, setNotice] = useState<keyof typeof notices | null>(null);
  const [dates, setDates] = useState<MeetupOccurrence[]>([]), [cadence, setCadence] = useState<'weekly' | 'fortnightly'>('weekly');
  const [startsAt, setStartsAt] = useState(() => new Date().toISOString()), [endsAt, setEndsAt] = useState(() => new Date().toISOString());
  const [startChosen, setStartChosen] = useState(false), [endChosen, setEndChosen] = useState(false);
  const [created, setCreated] = useState<string[]>([]);
  const pending = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await loadMeetupHostTools(supabase, postId);
        if (!active) return;
        setState(next); setError(false);
        if (!waitlistOnly && next.isHost) {
          const members = await loadMeetupHostRoster(supabase, postId);
          if (active) setRoster(members);
          if (next.tier === 'premium') {
            try { const result = await loadMeetupHostAggregates(supabase, postId); if (active) setMetrics(result); }
            catch { if (active) { setMetrics(null); setMetricError(true); } }
          } else if (active) setMetrics(null);
        }
      } catch { if (active) { setState(null); setRoster([]); setMetrics(null); setError(true); } }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [postId, retry, waitlistOnly]);

  async function act(work: () => Promise<unknown>, success: keyof typeof notices) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(false); setNotice(null); play('selection');
    try {
      const result = await work();
      if (mounted.current) { setNotice(result === false ? 'empty' : success); setLoading(true); setMetricError(false); setRetry(value => value + 1); onChanged?.(); play('success'); }
    } catch { if (mounted.current) { setError(true); play('warning'); } }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function propose() {
    if (pending.current || !startChosen || !endChosen) return;
    pending.current = true; setBusy(true); setError(false); setNotice(null); play('selection');
    try {
      const result = await proposeMeetupDates(supabase, postId, startsAt, endsAt, cadence);
      if (mounted.current) { setDates(result); setCreated([]); play('success'); }
    } catch { if (mounted.current) { setDates([]); setError(true); play('warning'); } }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  const locked = busy || loading;
  const button = [styles.button, { borderColor: theme.line, opacity: locked ? 0.5 : 1 }];
  const ownInvitation = state?.cohosts.find(member => member.userId === me.id && member.status === 'pending');
  const showPanel = waitlistOnly ? !!state && !state.isHost && (!!state.waitlist || state.canJoinWaitlist) : !!state && (state.isHost || state.isCohost || !!ownInvitation);
  if (!loading && !error && !showPanel) return null;
  return <View style={[styles.panel, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <ThemedText type="smallBold">{waitlistOnly ? say('모임 대기 신청', 'Meetup waitlist') : say('호스트 도구', 'Host tools')}</ThemedText>
    {loading && <ThemedText type="small" accessibilityLiveRegion="polite">{say('운영 상태 불러오는 중…', 'Loading meetup status…')}</ThemedText>}
    {waitlistOnly && state && <>
      <ThemedText type="small" themeColor="textSecondary">{say('초대 알림을 받을 때까지 기다려요. 대기·초대는 참여 승인이나 자리 예약이 아니에요.', 'We’ll notify you if you’re invited. The waitlist and invitations don’t approve you or hold a spot.')}</ThemedText>
      {state.waitlist && <ThemedText type="small">{state.waitlist.invitedAt ? say('참여 제안이 도착했어요. 모임에서 신청을 확인해주세요.', 'You’ve been invited. Check your request on this meetup.') : say(`현재 대기 순서 ${state.waitlist.position}번`, `Your waitlist position: ${state.waitlist.position}`)}</ThemedText>}
      <Pressable analyticsId="meetup_host_tools.control.1" accessibilityRole="button" disabled={locked || (!state.waitlist && !state.canJoinWaitlist)} accessibilityState={{ disabled: locked || (!state.waitlist && !state.canJoinWaitlist) }} style={button}
        onPress={() => void act(() => setMeetupWaitlist(supabase, postId, !state.waitlist), state.waitlist ? 'cancelled' : 'joined')}>
        <ThemedText type="smallBold">{state.waitlist ? say('대기 신청 취소', 'Leave waitlist') : say('초대 알림 받기', 'Join waitlist')}</ThemedText>
      </Pressable>
    </>}
    {!waitlistOnly && state && <>
      {ownInvitation && <View style={styles.section}>
        <ThemedText type="small">{say('공동 호스트로 초대받았어요. 수락하면 회차와 참석 확인을 함께 관리해요. 비공개 신청 답변과 계정 권한은 공유되지 않아요.', 'You were invited to cohost. Accept to help with sessions and attendance. Private application answers and account access stay private.')}</ThemedText>
        <Pressable analyticsId="meetup_host_tools.control.2" accessibilityRole="button" disabled={locked || !state.available} accessibilityState={{ disabled: locked || !state.available }} style={button} onPress={() => void act(() => respondMeetupCohost(supabase, postId, true), 'role')}><ThemedText type="smallBold">{say('공동 호스트 수락', 'Accept cohost invitation')}</ThemedText></Pressable>
        <Pressable analyticsId="meetup_host_tools.control.3" accessibilityRole="button" disabled={locked} accessibilityState={{ disabled: locked }} style={button} onPress={() => void act(() => respondMeetupCohost(supabase, postId, false), 'role')}><ThemedText type="small">{say('초대 거절', 'Decline invitation')}</ThemedText></Pressable>
      </View>}
      {state.isCohost && <View style={styles.section}>
        <ThemedText type="small" themeColor="textSecondary">{say('공동 호스트예요. 회차 등록과 기존 참석 확인을 함께해요. 신청 승인과 비공개 답변은 호스트만 관리해요.', 'You’re a cohost. You help add sessions and check attendance. Only the host handles requests and private answers.')}</ThemedText>
        <Pressable analyticsId="meetup_host_tools.control.4" accessibilityRole="button" disabled={locked} accessibilityState={{ disabled: locked }} style={button} onPress={() => void act(() => removeMeetupCohost(supabase, postId, me.id), 'role')}><ThemedText type="small">{say('공동 호스트 그만하기', 'Stop cohosting')}</ThemedText></Pressable>
      </View>}
      {(state.isHost || state.isCohost) && state.kind === 'group' && <View style={styles.section}>
        <ThemedText type="smallBold">{say('반복 회차 준비 · Pro', 'Set up recurring sessions · Pro')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{say('같은 모임에 회차를 더해요. 첫 회차의 시작·종료 시간을 고르고, 각 날짜를 확인해 등록해주세요.', 'Add more sessions to this meetup. Choose when the first one starts and ends, then confirm each suggested date.')}</ThemedText>
        {!state.canManageSessions && <ThemedText type="small" themeColor="textSecondary">{say('새 회차 제안은 호스트의 유효한 Pro 멤버십이 필요해요. 기존 모임과 참석 기록은 유지돼요.', 'Adding sessions needs the host’s active Pro membership. Existing meetups and attendance history stay.')}</ThemedText>}
        {state.canManageSessions && <>
          <ChillingDateInput label={say('첫 회차 시작 · 직접 선택', 'First session start · choose a date')} value={startsAt} disabled={locked} onChange={value => { play('selection'); setStartsAt(value); setStartChosen(true); setDates([]); }} />
          <ChillingDateInput label={say('첫 회차 종료 · 직접 선택', 'First session end · choose a date')} value={endsAt} disabled={locked} onChange={value => { play('selection'); setEndsAt(value); setEndChosen(true); setDates([]); }} />
          <ThemedText type="small" themeColor="textSecondary">{Intl.DateTimeFormat().resolvedOptions().timeZone}</ThemedText>
          <View accessibilityRole="radiogroup" accessibilityLabel={say('반복 주기', 'Repeat interval')} style={styles.row}>{(['weekly', 'fortnightly'] as const).map(value => <Pressable analyticsId="meetup_host_tools.control.5" key={value} accessibilityRole="radio" disabled={locked} accessibilityState={{ checked: cadence === value, disabled: locked }} style={[button, cadence === value && { borderColor: theme.accent }]}
            onPress={() => { play('selection'); setCadence(value); setDates([]); }}><ThemedText type="small">{value === 'weekly' ? say('매주', 'Weekly') : say('격주', 'Every two weeks')}</ThemedText></Pressable>)}</View>
          <Pressable analyticsId="meetup_host_tools.control.6" accessibilityRole="button" disabled={locked || !startChosen || !endChosen} accessibilityState={{ disabled: locked || !startChosen || !endChosen }} style={[button, (!startChosen || !endChosen) && styles.disabled]} onPress={() => void propose()}><ThemedText type="smallBold">{say('4회 날짜 미리보기', 'Preview four dates')}</ThemedText></Pressable>
          {dates.length > 0 && <ThemedText type="smallBold">{say('등록 전 미리보기 · 자동 등록되지 않아요', 'Preview · nothing is added until you confirm')}</ThemedText>}
          {dates.map(date => <View key={date.startsAt} style={[styles.occurrence, { borderColor: theme.line }]}>
            <ThemedText type="small">{new Date(date.startsAt).toLocaleString(locale)} ~ {new Date(date.endsAt).toLocaleString(locale)}</ThemedText>
            <Pressable analyticsId="meetup_host_tools.control.7" accessibilityRole="button" disabled={locked || created.includes(date.startsAt)} accessibilityState={{ disabled: locked || created.includes(date.startsAt) }} style={button}
              onPress={() => void act(async () => { await confirmMeetupOccurrence(supabase, postId, date); if (mounted.current) setCreated(value => [...value, date.startsAt]); }, 'created')}>
              <ThemedText type="smallBold">{created.includes(date.startsAt) ? say('등록됨', 'Created') : say('이 날짜 확인·등록', 'Confirm and create this date')}</ThemedText>
            </Pressable>
          </View>)}
        </>}
      </View>}
      {state.isHost && <>
        <View style={styles.section}>
          <ThemedText type="smallBold">{say('대기자 초대 · Pro', 'Waitlist invitations · Pro')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{say(`초대 대기 ${state.waitlistCount ?? '—'}명 · 신청 순서대로 제안해요. 참여 승인과 자리 예약은 별도예요.`, `${state.waitlistCount ?? '—'} waiting for an invitation · invites go out in join order. Approval and spots are handled separately.`)}</ThemedText>
          <Pressable analyticsId="meetup_host_tools.control.8" accessibilityRole="button" disabled={locked || !state.canInvite || !state.waitlistCount} accessibilityState={{ disabled: locked || !state.canInvite || !state.waitlistCount }} style={[button, (!state.canInvite || !state.waitlistCount) && styles.disabled]} onPress={() => void act(() => inviteNextMeetupWaitlist(supabase, postId), 'invited')}><ThemedText type="smallBold">{say('다음 대기자 초대', 'Invite next person')}</ThemedText></Pressable>
        </View>
        <View style={styles.section}>
          <ThemedText type="smallBold">{say('공동 호스트 · Pro', 'Cohosts · Pro')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{say('승인된 멤버가 수락한 뒤 함께 운영해요. 비공개 신청 답변·계정 권한은 공유하지 않아요.', 'Approved members can cohost once they accept. Private answers and account access aren’t shared.')}</ThemedText>
          {state.cohosts.map(member => {
            const identity = roster.find(person => person.userId === member.userId);
            return identity ? <View key={member.userId} style={styles.section}>
              <ThemedText type="small">{identity.displayName} · {member.status === 'accepted' ? say('수락함', 'Accepted') : say('수락 대기', 'Awaiting acceptance')}</ThemedText>
              <Pressable analyticsId="meetup_host_tools.control.9" accessibilityRole="button" disabled={locked} accessibilityState={{ disabled: locked }} accessibilityLabel={say(`${identity.displayName} 공동 호스트 해제`, `Remove ${identity.displayName} as cohost`)} style={button} onPress={() => void act(() => removeMeetupCohost(supabase, postId, member.userId), 'role')}><ThemedText type="small">{say('공동 호스트 해제', 'Remove cohost')}</ThemedText></Pressable>
            </View> : null;
          })}
          {state.candidates.map(id => {
            const identity = roster.find(person => person.userId === id);
            return identity ? <Pressable analyticsId="meetup_host_tools.control.10" key={id} accessibilityRole="button" disabled={locked || !state.canInvite} accessibilityState={{ disabled: locked || !state.canInvite }} style={[button, !state.canInvite && styles.disabled]} onPress={() => void act(() => inviteMeetupCohost(supabase, postId, id), 'role')}><ThemedText type="small">{say(`${identity.displayName} 초대`, `Invite ${identity.displayName}`)}</ThemedText></Pressable> : null;
          })}
          {state.candidates.length === 0 && state.cohosts.length === 0 && <ThemedText type="small" themeColor="textSecondary">{say('승인된 멤버가 생기면 초대할 수 있어요.', 'You can invite members after approving them.')}</ThemedText>}
        </View>
        <View style={styles.section}>
          <ThemedText type="smallBold">{say('내 모임 통계 · Premium', 'My meetup totals · Premium')}</ThemedText>
          {metrics ? <>
            <ThemedText type="small">{say(`신청한 사람 ${metrics.applications}명 · 현재 승인 ${metrics.approvals}명`, `${metrics.applications} applicants · ${metrics.approvals} currently approved`)}</ThemedText>
            <ThemedText type="small">{say(`확인된 참석 ${metrics.confirmedAttendance}건 · 회차별 합계`, `Confirmed attendance: ${metrics.confirmedAttendance} · total across sessions`)}</ThemedText>
            <ThemedText type="small">{say(`재참가자 ${metrics.repeatParticipants}명 · 두 회차 이상 참석 확인`, `Repeat participants: ${metrics.repeatParticipants} · confirmed in two or more sessions`)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{say('신청한 사람은 계정당 한 번 세고, 참석은 회차별로 합산해요. 호스트 본인은 참석 집계에서 제외해요.', 'Each applicant is counted once. Attendance is added up across sessions, excluding the host.')}</ThemedText>
          </> : <ThemedText type="small" themeColor="textSecondary">{metricError ? say('통계를 확인하지 못했어요. 수치를 추정하지 않아요.', 'Couldn’t load stats. We never show estimates.') : say('실제 참석 집계는 호스트의 Premium 멤버십에서 확인해요.', 'The host can view verified totals with Premium.')}</ThemedText>}
        </View>
      </>}
    </>}
    {(error || metricError) && <ThemedText type="small" accessibilityRole="alert">{say('상태를 확인하지 못했어요. 연결·참가 권한·멤버십과 날짜를 확인해주세요.', 'Couldn’t check the status. Check your connection, access, membership and dates.')}</ThemedText>}
    {(error || metricError || state) && <Pressable analyticsId="meetup_host_tools.control.11" accessibilityRole="button" disabled={locked} accessibilityState={{ disabled: locked }} style={button} onPress={() => { play('selection'); setLoading(true); setMetricError(false); setRetry(value => value + 1); }}><ThemedText type="small">{say('상태 다시 확인', 'Refresh status')}</ThemedText></Pressable>}
    {notice && <ThemedText type="small" accessibilityLiveRegion="polite">{say(notices[notice][0], notices[notice][1])}</ThemedText>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { padding: 16, borderRadius: 16, borderWidth: 1, gap: 16 },
  section: { gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  occurrence: { gap: 8, paddingTop: 12, borderTopWidth: 1 },
  button: { minHeight: 48, borderWidth: 1, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 12, justifyContent: 'center' },
  disabled: { opacity: 0.5 },
});
