import { Typography } from '@/constants/design-system';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useIsFocused } from 'expo-router';
import { Alert, Platform, StyleSheet, TextInput, View } from 'react-native';
import { Pressable } from '@/components/analytics-controls';
import { ChillingDateInput } from '@/components/chilling-date-input';
import { ThemedText } from '@/components/themed-text';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';
import { confirmMeetupOccurrence, inviteMeetupCohost, inviteNextMeetupWaitlist, loadMeetupHostAggregates, loadMeetupHostRoster,
  loadMeetupFee, loadMeetupFeePayments, loadMeetupHostTools, meetupFeeAmount, meetupFeeDueIso, meetupFeeDueOn, meetupFeeInput, proposeMeetupDates,
  removeMeetupCohost, respondMeetupCohost, setMeetupFee, setMeetupFeePaid, setMeetupWaitlist, type MeetupFee, type MeetupHostAggregates, type MeetupHostIdentity, type MeetupHostToolsState, type MeetupOccurrence } from '@/lib/meetup-host-tools';

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
  feeSaved: ['회비를 저장했어요.', 'The fee was saved.'],
  feeCleared: ['회비를 없앴어요.', 'The fee was removed.'],
  feePaid: ['회비 낸 사람을 표시했어요.', 'Payment status updated.'],
} as const;
const feeErrors: Record<string, readonly [string, string]> = {
  INVALID_MEETUP_FEE: ['회비는 0보다 크고 10,000달러 이하로 적어주세요. 소수점은 둘째 자리까지 쓸 수 있어요.', 'Enter a fee above $0 and up to $10,000, with at most two decimal places.'],
  INVALID_MEETUP_FEE_NOTE: ['메모는 200자까지 쓸 수 있어요.', 'The note can be up to 200 characters.'],
  MEETUP_CLOSED: ['마감됐거나 끝난 모임이라 바꿀 수 없어요.', 'This meetup is closed or has ended, so it can’t be changed.'],
  MEETUP_NOT_FOUND: ['모임 정보를 찾지 못했어요. 상태를 다시 확인해주세요.', 'The meetup could not be found. Refresh the status.'],
  REQUEST_NOT_FOUND: ['승인된 멤버만 회비 낸 사람으로 표시할 수 있어요.', 'Only approved members can be marked as paid.'],
};

function HostTools({ postId, onChanged, waitlistOnly }: MeetupHostToolsProps & { waitlistOnly: boolean }) {
  const { language, tr, locale } = useLanguage(), theme = useTheme(), { play } = useInteractionFeedback(), { me, isAuthed } = useAuth();
  const viewer = isAuthed ? me.id : '', focused = useIsFocused();
  const say = (ko: string, en: string) => tr(language === 'ko' ? ko : en);
  const [state, setState] = useState<MeetupHostToolsState | null>(null), [roster, setRoster] = useState<MeetupHostIdentity[]>([]);
  const [metrics, setMetrics] = useState<MeetupHostAggregates | null>(null), [metricError, setMetricError] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const [error, setError] = useState(''), [notice, setNotice] = useState<keyof typeof notices | null>(null);
  const [dates, setDates] = useState<MeetupOccurrence[]>([]), [cadence, setCadence] = useState<'weekly' | 'fortnightly'>('weekly');
  // Same defaults as the free single-session form: tomorrow, two hours long.
  const [startsAt, setStartsAt] = useState(() => new Date(Date.now() + 86400000).toISOString()), [endsAt, setEndsAt] = useState(() => new Date(Date.now() + 93600000).toISOString());
  const [startChosen, setStartChosen] = useState(false);
  const [created, setCreated] = useState<string[]>([]);
  const [candidateQuery, setCandidateQuery] = useState(''), [candidatePage, setCandidatePage] = useState(0);
  const [fee, setFee] = useState<MeetupFee | null>(null), [paid, setPaid] = useState<string[]>([]);
  const [feeAmount, setFeeAmount] = useState(''), [feeNote, setFeeNote] = useState(''), [feeDue, setFeeDue] = useState('');
  const savedFee = useRef('');
  const pending = useRef(false), mounted = useRef(true);
  const generation = useRef(0);
  const live = useRef<{ viewer: string; postId: string; focused: boolean; state: MeetupHostToolsState | null; loading: boolean } | null>(null);
  useLayoutEffect(() => {
    mounted.current = true; generation.current++;
    return () => { mounted.current = false; live.current = null; };
  }, [viewer, postId, focused]);
  useLayoutEffect(() => { live.current = { viewer, postId, focused, state, loading }; }, [viewer, postId, focused, state, loading]);
  const sameOwner = () => !!(mounted.current && viewer && live.current?.viewer === viewer && live.current.postId === postId);
  const currentState = (request = generation.current) => sameOwner() && live.current?.focused && request === generation.current ? live.current.state : null;
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await loadMeetupHostTools(supabase, postId);
        if (!active) return;
        setState(next); setError('');
        if (!waitlistOnly && next.isHost) {
          const [members, nextFee] = await Promise.all([loadMeetupHostRoster(supabase, postId), next.available ? loadMeetupFee(supabase, postId) : null]);
          const payments = nextFee ? await loadMeetupFeePayments(supabase, postId) : [];
          if (active) {
            setRoster(members); setFee(nextFee); setPaid(payments.map(row => row.user_id));
            // Reset the form only when the saved fee changed, so a paid toggle keeps unsaved edits.
            const key = JSON.stringify(nextFee);
            if (savedFee.current !== key) { savedFee.current = key; setFeeAmount(nextFee ? Number(nextFee.amount).toFixed(2) : ''); setFeeNote(nextFee?.note ?? ''); setFeeDue(nextFee?.dueOn ?? ''); }
          }
          if (next.tier === 'premium') {
            try { const result = await loadMeetupHostAggregates(supabase, postId); if (active) setMetrics(result); }
            catch { if (active) { setMetrics(null); setMetricError(true); } }
          } else if (active) setMetrics(null);
        }
      } catch { if (active) { setState(null); setRoster([]); setMetrics(null); setError('load'); } }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [postId, retry, waitlistOnly]);

  async function act(work: (current: () => boolean) => Promise<unknown>, success: keyof typeof notices, allowed: (value: MeetupHostToolsState) => boolean) {
    const request = generation.current, value = currentState(request);
    if (pending.current || live.current?.loading || !value || !allowed(value)) return;
    const current = () => { const value = currentState(request); return !!value && allowed(value); };
    pending.current = true; setBusy(true); setError(''); setNotice(null); play('selection');
    try {
      const result = await work(current);
      if (current()) { setNotice(result === false ? 'empty' : success); setLoading(true); setMetricError(false); setRetry(value => value + 1); onChanged?.(); play('success'); }
    } catch (failure) { if (current()) { setError((failure as Error)?.message || 'unknown'); play('warning'); } }
    finally { pending.current = false; if (sameOwner()) setBusy(false); }
  }
  async function propose() {
    const request = generation.current;
    if (pending.current || live.current?.loading || !currentState()?.canManageSessions || !startChosen) return;
    pending.current = true; setBusy(true); setError(''); setNotice(null); play('selection');
    try {
      const result = await proposeMeetupDates(supabase, postId, startsAt, endsAt, cadence);
      if (currentState(request)?.canManageSessions) { setDates(result); setCreated([]); play('success'); }
    } catch (failure) { if (currentState(request)?.canManageSessions) { setDates([]); setError((failure as Error)?.message || 'unknown'); play('warning'); } }
    finally { pending.current = false; if (sameOwner()) setBusy(false); }
  }
  const confirmRemoval = (title: string, message: string, run: () => void) => {
    play('selection');
    if (Platform.OS === 'web') { if (globalThis.confirm(message)) run(); }
    else Alert.alert(title, message, [{ text: say('취소', 'Cancel'), style: 'cancel' }, { text: title, style: 'destructive', onPress: run }]);
  };
  const locked = busy || loading;
  const button = [styles.button, { borderColor: theme.line, opacity: locked ? 0.5 : 1 }], dangerButton = [...button, { borderColor: theme.danger }];
  const ownInvitation = state?.cohosts.find(member => member.userId === me.id && member.status === 'pending');
  const showPanel = waitlistOnly ? !!state && !state.isHost && (!!state.waitlist || state.canJoinWaitlist) : !!state && (state.isHost || state.isCohost || !!ownInvitation);
  const identityById = new Map(roster.map(person => [person.userId, person]));
  const query = candidateQuery.trim().toLocaleLowerCase();
  const candidates = (state?.candidates ?? []).flatMap(id => { const person = identityById.get(id); return person && (!query || person.displayName.toLocaleLowerCase().includes(query)) ? [person] : []; });
  const candidatePages = Math.max(1, Math.ceil(candidates.length / 20)), page = Math.min(candidatePage, candidatePages - 1);
  const visibleCandidates = candidates.slice(page * 20, (page + 1) * 20);
  const feeMembers = roster.filter(person => !person.isHost), paidCount = feeMembers.filter(person => paid.includes(person.userId)).length;
  let feeIssue = '';
  try { if (feeAmount.trim() || feeNote.trim() || feeDue) meetupFeeInput(feeAmount, feeNote, feeDue); } catch (failure) { feeIssue = (failure as Error).message; }
  // Fail closed: non-hosts never see a loading or error shell of the host panel.
  if (!showPanel) return null;
  return <View style={[styles.panel, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <ThemedText type="subtitle" accessibilityRole="header">{waitlistOnly ? say('모임 대기 신청', 'Meetup waitlist') : say('호스트 도구', 'Host tools')}</ThemedText>
    {loading && <ThemedText type="small" accessibilityLiveRegion="polite" style={styles.helper}>{say('운영 상태 불러오는 중…', 'Loading meetup status…')}</ThemedText>}
    {waitlistOnly && state && <>
      <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{say('초대 알림을 받을 때까지 기다려요. 대기·초대는 참여 승인이나 자리 예약이 아니에요.', 'We’ll notify you if you’re invited. The waitlist and invitations don’t approve you or hold a spot.')}</ThemedText>
      {state.waitlist && <ThemedText type="small" style={styles.bodyText}>{state.waitlist.invitedAt ? say('참여 제안이 도착했어요. 모임에서 신청을 확인해주세요.', 'You’ve been invited. Check your request on this meetup.') : say(`현재 대기 순서 ${state.waitlist.position}번`, `Your waitlist position: ${state.waitlist.position}`)}</ThemedText>}
      <Pressable analyticsId="meetup_host_tools.control.1" accessibilityRole="button" disabled={locked || (!state.waitlist && !state.canJoinWaitlist)} accessibilityState={{ disabled: locked || (!state.waitlist && !state.canJoinWaitlist) }} style={button}
        onPress={() => void act(() => setMeetupWaitlist(supabase, postId, !state.waitlist), state.waitlist ? 'cancelled' : 'joined', value => state.waitlist ? !!value.waitlist : value.canJoinWaitlist && !value.waitlist)}>
        <ThemedText type="smallBold" style={styles.label}>{state.waitlist ? say('대기 신청 취소', 'Leave waitlist') : say('초대 알림 받기', 'Join waitlist')}</ThemedText>
      </Pressable>
    </>}
    {!waitlistOnly && state && <>
      {ownInvitation && <View style={styles.section}>
        <ThemedText type="small" style={styles.bodyText}>{say('공동 호스트로 초대받았어요. 수락하면 회차와 참석 확인을 함께 관리해요. 비공개 신청 답변과 계정 권한은 공유되지 않아요.', 'You were invited to cohost. Accept to help with sessions and attendance. Private application answers and account access stay private.')}</ThemedText>
        <Pressable analyticsId="meetup_host_tools.control.2" accessibilityRole="button" disabled={locked || !state.available} accessibilityState={{ disabled: locked || !state.available }} style={button} onPress={() => void act(() => respondMeetupCohost(supabase, postId, true), 'role', value => value.available && value.cohosts.some(member => member.userId === viewer && member.status === 'pending'))}><ThemedText type="smallBold" style={styles.label}>{say('공동 호스트 수락', 'Accept cohost invitation')}</ThemedText></Pressable>
        <Pressable analyticsId="meetup_host_tools.control.3" accessibilityRole="button" disabled={locked} accessibilityState={{ disabled: locked }} style={button} onPress={() => void act(() => respondMeetupCohost(supabase, postId, false), 'role', value => value.available && value.cohosts.some(member => member.userId === viewer && member.status === 'pending'))}><ThemedText type="small" style={styles.bodyText}>{say('초대 거절', 'Decline invitation')}</ThemedText></Pressable>
      </View>}
      {state.isCohost && <View style={styles.section}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{say('공동 호스트예요. 회차 등록과 기존 참석 확인을 함께해요. 신청 승인과 비공개 답변은 호스트만 관리해요.', 'You’re a cohost. You help add sessions and check attendance. Only the host handles requests and private answers.')}</ThemedText>
        <Pressable analyticsId="meetup_host_tools.control.4" accessibilityRole="button" disabled={locked} accessibilityState={{ disabled: locked }} style={dangerButton} onPress={() => confirmRemoval(say('공동 호스트 그만하기', 'Stop cohosting'), say('공동 호스트를 그만할까요? 회차와 참석 확인을 더 이상 함께 관리하지 않아요.', 'Stop cohosting? You will no longer help with sessions and attendance.'), () => void act(() => removeMeetupCohost(supabase, postId, me.id), 'role', value => value.isCohost))}><ThemedText type="small" themeColor="danger" style={styles.bodyText}>{say('공동 호스트 그만하기', 'Stop cohosting')}</ThemedText></Pressable>
      </View>}
      {(state.isHost || state.isCohost) && state.kind === 'group' && <View style={styles.section}>
        <ThemedText type="subtitle" accessibilityRole="header">{say('4회 반복 날짜 · Pro', 'Four repeating dates · Pro')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{say('첫 회차 시간을 고르면 매주 또는 격주로 4회 날짜를 미리 보여줘요. 각 날짜를 확인해 등록해주세요.', 'Choose the first session time to preview four weekly or fortnightly dates. Confirm each date to create it.')}</ThemedText>
        {!state.canManageSessions && <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{say('4회 반복 날짜는 호스트의 Pro 멤버십이 필요해요. 회차 하나씩은 호스트가 아래 ‘회차 등록’에서 무료로 등록할 수 있어요.', 'Four repeating dates require the host’s Pro membership. The host can still add one session at a time for free with “Register session” below.')}</ThemedText>}
        {state.canManageSessions && <>
          <ChillingDateInput label={say('첫 회차 시작 · 직접 선택', 'First session start · choose a date')} value={startsAt} disabled={locked} onChange={value => { play('selection'); setStartsAt(value); setEndsAt(new Date(Date.parse(value) + 7200000).toISOString()); setStartChosen(true); setDates([]); }} />
          <ChillingDateInput label={say('첫 회차 종료 · 시작 2시간 뒤', 'First session end · two hours after start')} value={endsAt} disabled={locked} onChange={value => { play('selection'); setEndsAt(value); setDates([]); }} />
          <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{Intl.DateTimeFormat().resolvedOptions().timeZone}</ThemedText>
          <View accessibilityRole="radiogroup" accessibilityLabel={say('반복 주기', 'Repeat interval')} style={styles.row}>{(['weekly', 'fortnightly'] as const).map(value => <Pressable analyticsId="meetup_host_tools.control.5" key={value} accessibilityRole="radio" disabled={locked} accessibilityState={{ checked: cadence === value, disabled: locked }} style={[button, cadence === value && { borderColor: theme.accent }]}
            onPress={() => { play('selection'); setCadence(value); setDates([]); }}><ThemedText type="small" style={styles.bodyText}>{value === 'weekly' ? say('매주', 'Weekly') : say('격주', 'Every two weeks')}</ThemedText></Pressable>)}</View>
          <Pressable analyticsId="meetup_host_tools.control.6" accessibilityRole="button" disabled={locked || !startChosen} accessibilityState={{ disabled: locked || !startChosen }} style={[button, !startChosen && styles.disabled]} onPress={() => void propose()}><ThemedText type="smallBold" style={styles.label}>{say('4회 날짜 미리보기', 'Preview four dates')}</ThemedText></Pressable>
          {dates.length > 0 && <ThemedText type="smallBold" style={styles.label}>{say('등록 전 미리보기 · 자동 등록되지 않아요', 'Preview · nothing is added until you confirm')}</ThemedText>}
          {dates.map(date => <View key={date.startsAt} style={[styles.occurrence, { borderColor: theme.line }]}>
            <ThemedText type="small" style={styles.bodyText}>{new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(date.startsAt))} ~ {new Date(date.endsAt).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}</ThemedText>
            <Pressable analyticsId="meetup_host_tools.control.7" accessibilityRole="button" disabled={locked || created.includes(date.startsAt)} accessibilityState={{ disabled: locked || created.includes(date.startsAt) }} style={button}
              onPress={() => void act(async current => { await confirmMeetupOccurrence(supabase, postId, date); if (current()) setCreated(value => [...value, date.startsAt]); }, 'created', value => value.canManageSessions)}>
              <ThemedText type="smallBold" style={styles.label}>{created.includes(date.startsAt) ? say('등록됨', 'Created') : say('이 날짜 확인·등록', 'Confirm and create this date')}</ThemedText>
            </Pressable>
          </View>)}
        </>}
      </View>}
      {state.isHost && <>
        {state.available && <View style={styles.section}>
          <ThemedText type="subtitle" accessibilityRole="header">{say('회비', 'Meetup fee')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{say('신청 전에도 모두에게 보여요. 돈은 앱 밖에서 받고, 낸 사람만 여기서 표시해요.', 'Everyone can see it before applying. Collect the money outside the app and mark who paid here.')}</ThemedText>
          <TextInput testID="meetup-fee-amount" accessibilityLabel={say('회비 금액 (캐나다 달러)', 'Fee amount (CAD)')} placeholder={say('금액 (캐나다 달러) · 예: 15', 'Amount (CAD) · e.g. 15')} placeholderTextColor={theme.textSecondary} keyboardType="decimal-pad" inputMode="decimal" editable={!locked} value={feeAmount} onChangeText={setFeeAmount} style={[styles.search, { color: theme.text, borderColor: theme.line, backgroundColor: theme.background }]} />
          <TextInput testID="meetup-fee-note" accessibilityLabel={say('회비 메모 (선택)', 'Fee note (optional)')} placeholder={say('메모 (선택) · 예: e-Transfer로 보내주세요', 'Note (optional) · e.g. Send by e-Transfer')} placeholderTextColor={theme.textSecondary} maxLength={200} editable={!locked} value={feeNote} onChangeText={setFeeNote} style={[styles.search, { color: theme.text, borderColor: theme.line, backgroundColor: theme.background }]} />
          <Pressable analyticsId="meetup.fee.due" accessibilityRole="button" disabled={locked} accessibilityState={{ disabled: locked }} style={button} onPress={() => { play('selection'); setFeeDue(feeDue ? '' : meetupFeeDueOn(new Date(Date.now() + 7 * 86400000).toISOString())); }}><ThemedText type="small" style={styles.bodyText}>{feeDue ? say('기한 빼기', 'Remove due date') : say('기한 정하기 (선택)', 'Add a due date (optional)')}</ThemedText></Pressable>
          {!!feeDue && <ChillingDateInput label={say('이 날까지 내주세요', 'Pay by')} value={meetupFeeDueIso(feeDue)} disabled={locked} onChange={value => { play('selection'); setFeeDue(meetupFeeDueOn(value)); }} />}
          {!!feeIssue && <ThemedText type="small" themeColor="danger" accessibilityLiveRegion="polite" style={styles.helper}>{say(...(feeErrors[feeIssue] ?? feeErrors.INVALID_MEETUP_FEE))}</ThemedText>}
          <Pressable analyticsId="meetup.fee.save" accessibilityRole="button" disabled={locked || !feeAmount.trim() || !!feeIssue} accessibilityState={{ disabled: locked || !feeAmount.trim() || !!feeIssue }} style={[button, (!feeAmount.trim() || !!feeIssue) && styles.disabled]} onPress={() => void act(() => setMeetupFee(supabase, postId, meetupFeeInput(feeAmount, feeNote, feeDue)), 'feeSaved', value => value.isHost && value.available)}><ThemedText type="smallBold" style={styles.label}>{fee ? say('회비 바꾸기', 'Update fee') : say('회비 저장', 'Save fee')}</ThemedText></Pressable>
          {fee && <>
            <Pressable analyticsId="meetup.fee.clear" accessibilityRole="button" disabled={locked} accessibilityState={{ disabled: locked }} style={dangerButton} onPress={() => confirmRemoval(say('회비 없애기', 'Remove fee'), say('회비를 없앨까요? 모임에서 회비 안내가 사라져요.', 'Remove the fee? It will no longer show on the meetup.'), () => void act(() => setMeetupFee(supabase, postId, null), 'feeCleared', value => value.isHost && value.available))}><ThemedText type="small" themeColor="danger" style={styles.bodyText}>{say('회비 없애기', 'Remove fee')}</ThemedText></Pressable>
            <ThemedText type="smallBold" style={styles.label}>{say(`${meetupFeeAmount(fee.amount)} · ${feeMembers.length}명 중 ${paidCount}명 냈어요`, `${meetupFeeAmount(fee.amount)} · ${paidCount} of ${feeMembers.length} paid`)}</ThemedText>
            {feeMembers.map(person => { const done = paid.includes(person.userId); return <Pressable analyticsId="meetup.fee.paid" key={person.userId} accessibilityRole="checkbox" accessibilityLabel={say(`${person.displayName} 회비 냈음`, `${person.displayName} paid`)} disabled={locked} accessibilityState={{ checked: done, disabled: locked }} style={[button, styles.row, done && { borderColor: theme.accent }]}
              onPress={() => void act(() => setMeetupFeePaid(supabase, postId, person.userId, !done), 'feePaid', value => value.isHost)}><ThemedText type="small" style={[styles.bodyText, styles.grow]}>{person.displayName}</ThemedText><ThemedText type="smallBold" themeColor={done ? 'accent' : 'textSecondary'} style={styles.label}>{done ? say('냈음', 'Paid') : say('아직', 'Not yet')}</ThemedText></Pressable>; })}
            {!feeMembers.length && <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{say('승인된 멤버가 생기면 여기서 낸 사람을 표시할 수 있어요.', 'Once you approve members, you can mark who paid here.')}</ThemedText>}
          </>}
        </View>}
        <View style={styles.section}>
          <ThemedText type="subtitle" accessibilityRole="header">{say('대기자 초대 · Pro', 'Waitlist invitations · Pro')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{say(`초대 대기 ${state.waitlistCount ?? '—'}명 · 신청 순서대로 제안해요. 참여 승인과 자리 예약은 별도예요.`, `${state.waitlistCount ?? '—'} waiting for an invitation · invites go out in join order. Approval and spots are handled separately.`)}</ThemedText>
          <Pressable analyticsId="meetup_host_tools.control.8" accessibilityRole="button" disabled={locked || !state.canInvite || !state.waitlistCount} accessibilityState={{ disabled: locked || !state.canInvite || !state.waitlistCount }} style={[button, (!state.canInvite || !state.waitlistCount) && styles.disabled]} onPress={() => void act(() => inviteNextMeetupWaitlist(supabase, postId), 'invited', value => value.isHost && value.canInvite && !!value.waitlistCount)}><ThemedText type="smallBold" style={styles.label}>{say('다음 대기자 초대', 'Invite next person')}</ThemedText></Pressable>
        </View>
        <View style={styles.section}>
          <ThemedText type="subtitle" accessibilityRole="header">{say('공동 호스트 · Pro', 'Cohosts · Pro')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{say('승인된 멤버가 수락한 뒤 함께 운영해요. 비공개 신청 답변·계정 권한은 공유하지 않아요.', 'Approved members can cohost once they accept. Private answers and account access aren’t shared.')}</ThemedText>
          {state.cohosts.map(member => {
            const identity = identityById.get(member.userId);
            return identity ? <View key={member.userId} style={styles.section}>
              <ThemedText type="small" style={styles.bodyText}>{identity.displayName} · {member.status === 'accepted' ? say('수락함', 'Accepted') : say('수락 대기', 'Awaiting acceptance')}</ThemedText>
              <Pressable analyticsId="meetup_host_tools.control.9" accessibilityRole="button" disabled={locked} accessibilityState={{ disabled: locked }} accessibilityLabel={say(`${identity.displayName} 공동 호스트 해제`, `Remove ${identity.displayName} as cohost`)} style={dangerButton} onPress={() => confirmRemoval(say('공동 호스트 해제', 'Remove cohost'), say(`${identity.displayName}님을 공동 호스트에서 해제할까요?`, `Remove ${identity.displayName} as cohost?`), () => void act(() => removeMeetupCohost(supabase, postId, member.userId), 'role', value => value.isHost && value.cohosts.some(current => current.userId === member.userId)))}><ThemedText type="small" themeColor="danger" style={styles.bodyText}>{say('공동 호스트 해제', 'Remove cohost')}</ThemedText></Pressable>
            </View> : null;
          })}
          {state.candidates.length > 0 && <>
            <TextInput testID="meetup-host-candidate-search" accessibilityLabel={say('참가자 이름 검색', 'Search members by name')} placeholder={say('이름으로 찾기', 'Find a member by name')} placeholderTextColor={theme.textSecondary} value={candidateQuery} onChangeText={value => { setCandidateQuery(value); setCandidatePage(0); }} style={[styles.search, { color: theme.text, borderColor: theme.line, backgroundColor: theme.background }]} />
            {visibleCandidates.map(identity => <Pressable analyticsId="meetup_host_tools.control.10" key={identity.userId} accessibilityRole="button" disabled={locked || !state.canInvite} accessibilityState={{ disabled: locked || !state.canInvite }} style={[button, !state.canInvite && styles.disabled]} onPress={() => void act(() => inviteMeetupCohost(supabase, postId, identity.userId), 'role', value => value.isHost && value.canInvite && value.candidates.includes(identity.userId))}><ThemedText style={styles.label}>{say(`${identity.displayName} 초대`, `Invite ${identity.displayName}`)}</ThemedText></Pressable>)}
            {!candidates.length && <ThemedText style={styles.helper} themeColor="textSecondary">{say('일치하는 이름이 없어요.', 'No matching names.')}</ThemedText>}
            {candidatePages > 1 && <View style={styles.row}>
              <Pressable analyticsId="meetup_host_tools.candidates.previous" accessibilityRole="button" accessibilityState={{ disabled: locked || page === 0 }} disabled={locked || page === 0} style={button} onPress={() => { play('selection'); setCandidatePage(page - 1); }}><ThemedText style={styles.label}>{say('이전', 'Previous')}</ThemedText></Pressable>
              <ThemedText style={styles.helper}>{say(`${page + 1}/${candidatePages} 페이지`, `Page ${page + 1} of ${candidatePages}`)}</ThemedText>
              <Pressable analyticsId="meetup_host_tools.candidates.next" accessibilityRole="button" accessibilityState={{ disabled: locked || page + 1 >= candidatePages }} disabled={locked || page + 1 >= candidatePages} style={button} onPress={() => { play('selection'); setCandidatePage(page + 1); }}><ThemedText style={styles.label}>{say('다음', 'Next')}</ThemedText></Pressable>
            </View>}
          </>}
          {state.candidates.length === 0 && state.cohosts.length === 0 && <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{say('승인된 멤버가 생기면 초대할 수 있어요.', 'You can invite members after approving them.')}</ThemedText>}
        </View>
        <View style={styles.section}>
          <ThemedText type="subtitle" accessibilityRole="header">{say('내 모임 통계 · Premium', 'My meetup totals · Premium')}</ThemedText>
          {metrics ? <>
            <ThemedText type="small" style={styles.bodyText}>{say(`신청한 사람 ${metrics.applications}명 · 현재 승인 ${metrics.approvals}명`, `${metrics.applications} applicants · ${metrics.approvals} currently approved`)}</ThemedText>
            <ThemedText type="small" style={styles.bodyText}>{say(`확인된 참석 ${metrics.confirmedAttendance}건 · 회차별 합계`, `Confirmed attendance: ${metrics.confirmedAttendance} · total across sessions`)}</ThemedText>
            <ThemedText type="small" style={styles.bodyText}>{say(`재참가자 ${metrics.repeatParticipants}명 · 두 회차 이상 참석 확인`, `Repeat participants: ${metrics.repeatParticipants} · confirmed in two or more sessions`)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{say('신청한 사람은 계정당 한 번 세고, 참석은 회차별로 합산해요. 호스트 본인은 참석 집계에서 제외해요.', 'Each applicant is counted once. Attendance is added up across sessions, excluding the host.')}</ThemedText>
          </> : <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{metricError ? say('통계를 확인하지 못했어요. 수치를 추정하지 않아요.', 'Couldn’t load stats. We never show estimates.') : say('실제 참석 집계는 호스트의 Premium 멤버십에서 확인해요.', 'The host can view verified totals with Premium.')}</ThemedText>}
        </View>
      </>}
    </>}
    {!!error && <ThemedText type="small" accessibilityRole="alert" style={styles.helper}>{error === 'INVALID_SESSION_TIME' ? say('종료 시간은 시작 이후여야 해요', 'The end time must be after the start') : error === 'SESSION_OVERLAP' ? say('같은 시간에 이미 등록된 회차가 있어요. 다른 시간을 골라주세요.', 'Another session already overlaps this time. Choose a different time.') : feeErrors[error] ? say(...feeErrors[error]) : say('상태를 확인하지 못했어요. 연결·참가 권한·멤버십과 날짜를 확인해주세요.', 'Couldn’t check the status. Check your connection, access, membership and dates.')}</ThemedText>}
    {(error || metricError || state) && <Pressable analyticsId="meetup_host_tools.control.11" accessibilityRole="button" disabled={locked} accessibilityState={{ disabled: locked }} style={button} onPress={() => { play('selection'); setLoading(true); setMetricError(false); setRetry(value => value + 1); }}><ThemedText type="small" style={styles.bodyText}>{say('상태 다시 확인', 'Refresh status')}</ThemedText></Pressable>}
    {notice && <ThemedText type="small" accessibilityLiveRegion="polite" style={styles.helper}>{say(notices[notice][0], notices[notice][1])}</ThemedText>}
  </View>;
}

const styles = StyleSheet.create({
  label: { ...Typography.menu }, helper: { fontSize: 14, lineHeight: 22 }, bodyText: { fontSize: 16, lineHeight: 24 },
  panel: { padding: 24, borderRadius: 16, borderWidth: 1, gap: 32 },
  section: { gap: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  occurrence: { gap: 8, paddingTop: 12, borderTopWidth: 1 },
  button: { minHeight: 48, borderWidth: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, justifyContent: 'center' },
  disabled: { opacity: 0.5 }, grow: { flex: 1, minWidth: 0 },
  search: { ...Typography.menu, minHeight: 48, borderWidth: 1, borderRadius: 12, padding: 12 },
});
