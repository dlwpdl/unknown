import { ControlStyles, Typography, controlPresentation } from '@/constants/design-system';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useIsFocused } from 'expo-router';
import { Alert, Platform, StyleSheet, TextInput, View } from 'react-native';
import { Pressable } from '@/components/analytics-controls';
import { ChillingDateInput } from '@/components/chilling-date-input';
import { DragSheet } from '@/components/drag-sheet';
import { GlingLoader } from '@/components/gling-loader';
import { ListCard, SectionLabel } from '@/components/list-card';
import { ClayPillFill, useClay } from '@/components/clay';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';
import { setLanguageExchangeWaitlist, type LanguageChoice } from '@/lib/meetup-language';
import { inviteMeetupCohost, inviteNextMeetupWaitlist, loadMeetupHostAggregates, loadMeetupHostRoster, loadMeetupRoster,
  loadMeetupFee, loadMeetupFeePayments, loadMeetupHostTools, meetupFeeAmount, meetupFeeDueIso, meetupFeeDue, meetupFeeDueOn, meetupFeeInput,
  removeMeetupCohost, respondMeetupCohost, setMeetupFee, setMeetupFeePaid, setMeetupWaitlist, type MeetupFee, type MeetupHostAggregates, type MeetupHostIdentity, type MeetupHostToolsState } from '@/lib/meetup-host-tools';

// language: the side a language-exchange applicant chose, so the waitlist offers them that side's seats.
export type MeetupHostSection = 'role' | 'waitlist' | 'dues' | 'cohosts' | 'stats';
// cta: show the waitlist as a screen's action button instead of the panel; fallback replaces it when the waitlist isn't open to this person.
export type MeetupHostToolsProps = { postId: string; onChanged?: () => void; language?: LanguageChoice | null; sections?: MeetupHostSection[]; cta?: 'primary' | 'secondary'; fallback?: ReactNode };

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
  role: ['공동 호스트 상태를 변경했어요.', 'Co-host updated.'],
  feeSaved: ['회비를 저장했어요.', 'Dues saved.'],
  feeCleared: ['회비를 없앴어요.', 'Dues removed.'],
  feePaid: ['회비 낸 사람을 표시했어요.', 'Payment status updated.'],
} as const;
const feeErrors: Record<string, readonly [string, string]> = {
  INVALID_MEETUP_FEE: ['회비는 0보다 크고 10,000달러 이하로 적어주세요. 소수점은 둘째 자리까지 쓸 수 있어요.', 'Enter a fee above $0 and up to $10,000, with at most two decimal places.'],
  INVALID_MEETUP_FEE_NOTE: ['메모는 200자까지 쓸 수 있어요.', 'The note can be up to 200 characters.'],
  MEETUP_CLOSED: ['마감됐거나 끝난 모임이라 바꿀 수 없어요.', 'This meetup is closed or has ended, so it can’t be changed.'],
  MEETUP_NOT_FOUND: ['모임 정보를 찾지 못했어요. 상태를 다시 확인해주세요.', 'The meetup could not be found. Refresh the status.'],
  REQUEST_NOT_FOUND: ['승인된 멤버만 회비 낸 사람으로 표시할 수 있어요.', 'Only approved members can be marked as paid.'],
};

function HostTools({ postId, onChanged, waitlistOnly, language: side, sections, cta, fallback }: MeetupHostToolsProps & { waitlistOnly: boolean }) {
  const { language, tr, locale } = useLanguage(), theme = useTheme(), { play } = useInteractionFeedback(), { me, isAuthed } = useAuth();
  const clay = useClay();
  const viewer = isAuthed ? me.id : '', focused = useIsFocused();
  const say = (ko: string, en: string) => tr(language === 'ko' ? ko : en);
  const [state, setState] = useState<MeetupHostToolsState | null>(null), [roster, setRoster] = useState<MeetupHostIdentity[]>([]);
  const [metrics, setMetrics] = useState<MeetupHostAggregates | null>(null), [metricError, setMetricError] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const [error, setError] = useState(''), [notice, setNotice] = useState<keyof typeof notices | null>(null);
  const [feeSheet, setFeeSheet] = useState(false), [inviteSheet, setInviteSheet] = useState(false);
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
          const [identities, nextFee, nicknames] = await Promise.all([loadMeetupHostRoster(supabase, postId), next.available ? loadMeetupFee(supabase, postId) : null,
            next.isHost ? loadMeetupRoster(supabase, postId).catch(() => null) : null]);
          // The roster only names people who applied with a meetup profile; the host's own member list knows the rest.
          const nickname = new Map(Array.isArray(nicknames) ? nicknames.map(member => [member.userId, member.nickname]) : []);
          const members = identities.map(person => person.displayName ? person : { ...person, displayName: nickname.get(person.userId) ?? '' });
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
      if (current()) { setNotice(result === false ? 'empty' : success); setFeeSheet(false); setInviteSheet(false); setLoading(true); setMetricError(false); setRetry(value => value + 1); onChanged?.(); play('success'); }
    } catch (failure) { if (current()) { setError((failure as Error)?.message || 'unknown'); play('warning'); } }
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
  const canInviteCohost = !!(state?.canInviteCohost ?? state?.canInvite);
  const showPanel = waitlistOnly ? !!state && !state.isHost && (!!state.waitlist || state.canJoinWaitlist) : !!state && (state.isHost || state.isCohost || !!ownInvitation);
  const identityById = new Map(roster.map(person => [person.userId, person]));
  const query = candidateQuery.trim().toLocaleLowerCase();
  const candidates = (state?.candidates ?? []).flatMap(id => { const person = identityById.get(id); return person && (!query || person.displayName.toLocaleLowerCase().includes(query)) ? [person] : []; });
  const candidatePages = Math.max(1, Math.ceil(candidates.length / 20)), page = Math.min(candidatePage, candidatePages - 1);
  const visibleCandidates = candidates.slice(page * 20, (page + 1) * 20);
  const feeMembers = roster.filter(person => !person.isHost), paidCount = feeMembers.filter(person => paid.includes(person.userId)).length;
  let feeIssue = '';
  try { if (feeAmount.trim() || feeNote.trim() || feeDue) meetupFeeInput(feeAmount, feeNote, feeDue); } catch (failure) { feeIssue = (failure as Error).message; }
  // The join screen's bottom action: same guards as the panel below, without the panel.
  if (waitlistOnly && cta) {
    if (!showPanel) return loading ? <RaisedActionButton analyticsId="meetup_host_tools.control.1" tone="secondary" busy onPress={() => {}} label={say('확인 중…', 'Checking…')} /> : fallback ?? null;
    return <>
      {state?.waitlist && <ThemedText style={[Typography.supporting, styles.ctaHint]} themeColor="textSecondary" accessibilityLiveRegion="polite">{state.waitlist.invitedAt ? say('참여 제안이 도착했어요. 모임에서 신청을 확인해주세요.', 'You’ve been invited. Check your request on this meetup.') : say(`대기 명단 ${state.waitlist.position}번째예요`, `You’re number ${state.waitlist.position} on the waitlist`)}</ThemedText>}
      <RaisedActionButton analyticsId="meetup_host_tools.control.1" tone={state?.waitlist || cta === 'secondary' ? 'secondary' : 'primary'} disabled={locked} busy={busy}
        onPress={() => void act(() => !state!.waitlist && side ? setLanguageExchangeWaitlist(supabase, postId, side) : setMeetupWaitlist(supabase, postId, !state!.waitlist), state!.waitlist ? 'cancelled' : 'joined', value => state!.waitlist ? !!value.waitlist : value.canJoinWaitlist && !value.waitlist)}
        label={state?.waitlist ? say('대기 취소', 'Leave waitlist') : say('대기 명단에 넣기', 'Join waitlist')} />
      {!!error && <ThemedText style={[Typography.supporting, styles.ctaHint]} accessibilityRole="alert" themeColor="danger">{say('처리하지 못했어요. 다시 시도해 주세요.', 'That didn’t go through. Please try again.')}</ThemedText>}
    </>;
  }
  // Fail closed: non-hosts never see a loading or error shell of the host panel.
  if (!showPanel) return null;
  const show = (section: MeetupHostSection) => !sections || sections.includes(section);
  const person = (name: string, detail: string | null, right: React.ReactNode) => <View style={styles.personRow}>
    <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}><ThemedText style={Typography.label}>{[...name][0] ?? ''}</ThemedText></View>
    <View style={styles.grow}><ThemedText style={Typography.body}>{name}</ThemedText>{!!detail && <ThemedText themeColor="textSecondary" style={Typography.supporting}>{detail}</ThemedText>}</View>
    {right}
  </View>;
  const field = [styles.search, { color: theme.text, borderColor: theme.line, backgroundColor: theme.background }];
  const managing = !!state && (state.isHost || state.isCohost);
  const feeOpen = () => { play('selection'); setFeeSheet(true); };
  const cohostLabel = state?.cohostLimit == null ? say('공동 호스트 · 프로', 'Co-hosts · Pro') : state.cohostLimit === 0 ? say('공동 호스트 · 플러스부터', 'Co-hosts · Plus and up') : state.cohostLimit >= 100 ? say(`공동 호스트 ${(state.cohosts ?? []).length}명`, `Co-hosts: ${(state.cohosts ?? []).length}`) : say(`공동 호스트 ${(state.cohosts ?? []).length}/${state.cohostLimit}명`, `Co-hosts ${(state.cohosts ?? []).length}/${state.cohostLimit}`);
  const errorText = error === 'MEETUP_COHOST_LIMIT' ? say('공동 호스트 자리가 다 찼어요. 멤버십을 올리면 더 둘 수 있어요.', 'All co-host spots are taken. Upgrade your membership to add more.') : error === 'PLUS_REQUIRED' ? say('공동 호스트는 플러스 멤버십부터 둘 수 있어요.', 'Co-hosts are available from Plus.') : feeErrors[error] ? say(...feeErrors[error]) : say('상태를 확인하지 못했어요. 연결과 권한, 멤버십을 확인해 주세요.', 'Couldn’t check the status. Check your connection, access and membership.');
  const refresh = (error || metricError) && <Pressable analyticsId="meetup_host_tools.control.11" accessibilityRole="button" disabled={locked} accessibilityState={{ disabled: locked }} style={button} onPress={() => { play('selection'); setLoading(true); setMetricError(false); setRetry(value => value + 1); }}><ThemedText type="small" style={styles.bodyText}>{say('다시 불러오기', 'Try again')}</ThemedText></Pressable>;
  const status = <>
    {!!error && <ThemedText type="small" accessibilityRole="alert" themeColor="danger" style={styles.helper}>{errorText}</ThemedText>}
    {refresh}
    {notice && <ThemedText type="small" accessibilityLiveRegion="polite" themeColor="textSecondary" style={styles.helper}>{say(notices[notice][0], notices[notice][1])}</ThemedText>}
  </>;
  if (waitlistOnly) return <View style={[styles.panel, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <ThemedText type="subtitle" accessibilityRole="header">{say('모임 대기 신청', 'Meetup waitlist')}</ThemedText>
    {loading && <GlingLoader color={theme.accent} accessibilityLabel={say('운영 상태 불러오는 중', 'Loading meetup status')} />}
    {state && <>
      <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{say('초대 알림을 받을 때까지 기다려요. 대기·초대는 참여 승인이나 자리 예약이 아니에요.', 'We’ll notify you if you’re invited. The waitlist and invitations don’t approve you or hold a spot.')}</ThemedText>
      {state.waitlist && <ThemedText type="small" style={styles.bodyText}>{state.waitlist.invitedAt ? say('참여 제안이 도착했어요. 모임에서 신청을 확인해주세요.', 'You’ve been invited. Check your request on this meetup.') : say(`현재 대기 순서 ${state.waitlist.position}번`, `Your waitlist position: ${state.waitlist.position}`)}</ThemedText>}
      <Pressable analyticsId="meetup_host_tools.control.1" accessibilityRole="button" disabled={locked || (!state.waitlist && !state.canJoinWaitlist)} accessibilityState={{ disabled: locked || (!state.waitlist && !state.canJoinWaitlist) }} style={button}
        onPress={() => void act(() => !state.waitlist && side ? setLanguageExchangeWaitlist(supabase, postId, side) : setMeetupWaitlist(supabase, postId, !state.waitlist), state.waitlist ? 'cancelled' : 'joined', value => state.waitlist ? !!value.waitlist : value.canJoinWaitlist && !value.waitlist)}>
        <ThemedText type="smallBold" style={styles.label}>{state.waitlist ? say('대기 신청 취소', 'Leave waitlist') : say('초대 알림 받기', 'Join waitlist')}</ThemedText>
      </Pressable>
    </>}
    {status}
  </View>;
  return <View style={styles.sections}>
    {loading && !state && <GlingLoader color={theme.accent} accessibilityLabel={say('운영 상태 불러오는 중', 'Loading meetup status')} />}
    {state && <>
      {show('role') && ownInvitation && <View style={[styles.panel, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <ThemedText type="small" style={styles.bodyText}>{say('공동 호스트로 초대받았어요. 수락하면 회차, 참석 확인, 대기자 초대를 함께 해요. 비공개 신청 답변과 계정 권한은 공유되지 않아요.', 'You were invited to co-host. Accept to help with sessions, attendance and waitlist invitations. Private application answers and account access stay private.')}</ThemedText>
        <View style={styles.row}>
          <HostPill analyticsId="meetup_host_tools.control.2" label={say('공동 호스트 수락', 'Accept co-host invitation')} onPress={() => void act(() => respondMeetupCohost(supabase, postId, true), 'role', value => value.available && value.cohosts.some(member => member.userId === viewer && member.status === 'pending'))} disabled={!state.available} selected locked={locked} />
          <HostPill analyticsId="meetup_host_tools.control.3" label={say('초대 거절', 'Decline invitation')} onPress={() => void act(() => respondMeetupCohost(supabase, postId, false), 'role', value => value.available && value.cohosts.some(member => member.userId === viewer && member.status === 'pending'))} locked={locked} />
        </View>
      </View>}
      {show('role') && state.isCohost && <View style={[styles.panel, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{say('공동 호스트예요. 회차 등록, 참석 확인, 대기자 초대를 함께해요. 신청 승인과 비공개 답변은 호스트만 관리해요.', 'You’re a co-host. You help add sessions, check attendance and invite from the waitlist. Only the host handles requests and private answers.')}</ThemedText>
        <HostPill analyticsId="meetup_host_tools.control.4" label={say('공동 호스트 그만하기', 'Stop co-hosting')} onPress={() => confirmRemoval(say('공동 호스트 그만하기', 'Stop co-hosting'), say('공동 호스트를 그만할까요? 회차와 참석 확인을 더 이상 함께 관리하지 않아요.', 'Stop co-hosting? You will no longer help with sessions and attendance.'), () => void act(() => removeMeetupCohost(supabase, postId, me.id), 'role', value => value.isCohost))} danger locked={locked} />
      </View>}
      {show('waitlist') && managing && <View>
        <SectionLabel>{say(`대기 ${state.waitlistCount ?? '—'}명`, `${state.waitlistCount ?? '—'} waiting`)}</SectionLabel>
        <ThemedText type="small" themeColor="textSecondary" style={styles.helperGap}>{state.canInvite ? say('신청한 순서대로 제안해요. 승인과 자리는 별도예요.', 'Invites go out in join order. Approval and spots are handled separately.') : say('다음 대기자에게 먼저 제안하는 건 프로 멤버십부터 쓸 수 있어요.', 'Inviting the next person first is available from Pro.')}</ThemedText>
        <HostWide analyticsId="meetup_host_tools.control.8" label={say('다음 대기자 초대', 'Invite next person')} onPress={() => void act(() => inviteNextMeetupWaitlist(supabase, postId), 'invited', value => (value.isHost || value.isCohost) && value.canInvite && !!value.waitlistCount)} disabled={!state.canInvite || !state.waitlistCount} locked={locked} />
      </View>}
      {state.isHost && <>
        {show('dues') && state.available && <View>
          {fee ? <>
            <ThemedText accessibilityRole="header" style={Typography.screenTitle}>{meetupFeeAmount(fee.amount)}</ThemedText>
            <ThemedText themeColor="textSecondary" style={Typography.supporting}>{[fee.note, fee.dueOn ? say(`${meetupFeeDue(fee.dueOn, locale)}까지`, `Due ${meetupFeeDue(fee.dueOn, locale)}`) : ''].filter(Boolean).join(' · ') || say('신청 전에도 모두에게 보여요.', 'Everyone can see it before applying.')}</ThemedText>
            <ThemedText style={[Typography.body, styles.gapTop]}>{say(`${feeMembers.length}명 중 ${paidCount}명 냈어요`, `${paidCount} of ${feeMembers.length} paid`)}</ThemedText>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.bar, { backgroundColor: theme.backgroundElement }]}><View style={[styles.barFill, { backgroundColor: theme.accent, width: `${feeMembers.length ? paidCount / feeMembers.length * 100 : 0}%` }]} /></View>
            {feeMembers.length ? <ListCard>{[...feeMembers].sort((a, b) => Number(paid.includes(a.userId)) - Number(paid.includes(b.userId))).map(member => { const done = paid.includes(member.userId); return person(member.displayName || say('모임 멤버', 'Meetup member'), null,
              <Pressable key={member.userId} analyticsId="meetup.fee.paid" accessibilityRole="checkbox" accessibilityLabel={say(`${member.displayName || '모임 멤버'} 회비 냈음`, `${member.displayName || 'Meetup member'} paid`)} disabled={locked} accessibilityState={{ checked: done, disabled: locked }}
                style={({ pressed }) => [ControlStyles.pill, styles.pill, controlPresentation(theme, { selected: !done, pressed, disabled: locked }).container]}
                onPress={() => void act(() => setMeetupFeePaid(supabase, postId, member.userId, !done), 'feePaid', value => value.isHost)}><ThemedText type="smallBold" style={controlPresentation(theme, { selected: !done }).text}>{done ? say('냈어요', 'Paid') : say('낸 걸로 표시', 'Mark paid')}</ThemedText></Pressable>); })}</ListCard>
              : <ThemedText type="small" themeColor="textSecondary" style={styles.helperGap}>{say('승인된 멤버가 생기면 여기서 낸 사람을 표시할 수 있어요.', 'Once you approve members, you can mark who paid here.')}</ThemedText>}
            <View style={styles.gapTop}><HostWide analyticsId="meetup.fee.edit" label={say('금액·메모·기한 바꾸기', 'Change amount, note or due date')} onPress={feeOpen} locked={locked} /></View>
          </> : <>
            <ThemedText type="small" themeColor="textSecondary" style={styles.helperGap}>{say('신청 전에도 모두에게 보여요. 돈은 앱 밖에서 받고, 낸 사람만 여기서 표시해요.', 'Everyone can see it before applying. Collect the money outside the app and mark who paid here.')}</ThemedText>
            <HostWide analyticsId="meetup.fee.edit" label={say('회비 정하기', 'Set a fee')} onPress={feeOpen} locked={locked} />
          </>}
          <DragSheet visible={feeSheet} onClose={() => setFeeSheet(false)} dismissible={!busy} title={say('회비', 'Meetup fee')}>
            <View style={styles.sheetBody}>
              <TextInput testID="meetup-fee-amount" accessibilityLabel={say('회비 금액 (캐나다 달러)', 'Fee amount (CAD)')} placeholder={say('금액 (캐나다 달러) · 예: 15', 'Amount (CAD) · e.g. 15')} placeholderTextColor={theme.textSecondary} keyboardType="decimal-pad" inputMode="decimal" editable={!locked} value={feeAmount} onChangeText={setFeeAmount} style={field} />
              <TextInput testID="meetup-fee-note" accessibilityLabel={say('회비 메모 (선택)', 'Fee note (optional)')} placeholder={say('메모 (선택) · 예: e-Transfer로 보내주세요', 'Note (optional) · e.g. Send by e-Transfer')} placeholderTextColor={theme.textSecondary} maxLength={200} editable={!locked} value={feeNote} onChangeText={setFeeNote} style={field} />
              <Pressable analyticsId="meetup.fee.due" accessibilityRole="button" disabled={locked} accessibilityState={{ disabled: locked }} style={button} onPress={() => { play('selection'); setFeeDue(feeDue ? '' : meetupFeeDueOn(new Date(Date.now() + 7 * 86400000).toISOString())); }}><ThemedText type="small" style={styles.bodyText}>{feeDue ? say('기한 빼기', 'Remove due date') : say('기한 정하기 (선택)', 'Add a due date (optional)')}</ThemedText></Pressable>
              {!!feeDue && <ChillingDateInput label={say('이 날까지 내주세요', 'Pay by')} value={meetupFeeDueIso(feeDue)} disabled={locked} onChange={value => { play('selection'); setFeeDue(meetupFeeDueOn(value)); }} />}
              {!!feeIssue && <ThemedText type="small" themeColor="danger" accessibilityLiveRegion="polite" style={styles.helper}>{say(...(feeErrors[feeIssue] ?? feeErrors.INVALID_MEETUP_FEE))}</ThemedText>}
              <Pressable analyticsId="meetup.fee.save" accessibilityRole="button" disabled={locked || !feeAmount.trim() || !!feeIssue} accessibilityState={{ disabled: locked || !feeAmount.trim() || !!feeIssue }} style={({ pressed }) => [ControlStyles.action, controlPresentation(theme, { tone: 'primary', pressed, disabled: locked || !feeAmount.trim() || !!feeIssue, clay }).container]} onPress={() => void act(() => setMeetupFee(supabase, postId, meetupFeeInput(feeAmount, feeNote, feeDue)), 'feeSaved', value => value.isHost && value.available)}>{clay && <ClayPillFill kind="cta" />}<ThemedText type="smallBold" style={{ color: theme.accentInk }}>{fee ? say('회비 바꾸기', 'Update fee') : say('회비 저장', 'Save fee')}</ThemedText></Pressable>
              {fee && <HostWide analyticsId="meetup.fee.clear" label={say('회비 없애기', 'Remove fee')} onPress={() => confirmRemoval(say('회비 없애기', 'Remove fee'), say('회비를 없앨까요? 모임에서 회비 안내가 사라져요.', 'Remove the fee? It will no longer show on the meetup.'), () => void act(() => setMeetupFee(supabase, postId, null), 'feeCleared', value => value.isHost && value.available))} danger locked={locked} />}
            </View>
          </DragSheet>
        </View>}
        {show('cohosts') && <View>
          <SectionLabel>{cohostLabel}</SectionLabel>
          <ThemedText type="small" themeColor="textSecondary" style={styles.helperGap}>{say('승인된 멤버가 수락하면 회차와 참석 확인을 함께 맡아요. 비공개 답변과 계정 권한은 공유하지 않아요.', 'Approved members can co-host once they accept. Private answers and account access aren’t shared.')}</ThemedText>
          {state.cohosts.some(member => identityById.has(member.userId)) && <ListCard>{state.cohosts.map(member => {
            const identity = identityById.get(member.userId);
            return identity ? person(identity.displayName, member.status === 'accepted' ? say('수락함', 'Accepted') : say('수락 대기', 'Awaiting acceptance'),
              <View key={member.userId}><HostPill analyticsId="meetup_host_tools.control.9" label={say('해제', 'Remove')} onPress={() => confirmRemoval(say('공동 호스트 해제', 'Remove co-host'), say(`${identity.displayName}님을 공동 호스트에서 해제할까요?`, `Remove ${identity.displayName} as co-host?`), () => void act(() => removeMeetupCohost(supabase, postId, member.userId), 'role', value => value.isHost && value.cohosts.some(current => current.userId === member.userId)))} danger a11y={say(`${identity.displayName} 공동 호스트 해제`, `Remove ${identity.displayName} as co-host`)} locked={locked} /></View>) : null;
          })}</ListCard>}
          {state.candidates.length > 0 && <View style={styles.gapTop}><HostWide analyticsId="meetup.cohost.invite-open" label={say('멤버 중에서 초대', 'Invite a member')} onPress={() => { play('selection'); setInviteSheet(true); }} disabled={!canInviteCohost} locked={locked} /></View>}
          {state.candidates.length === 0 && state.cohosts.length === 0 && <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{say('승인된 멤버가 생기면 초대할 수 있어요.', 'You can invite members after approving them.')}</ThemedText>}
          <DragSheet visible={inviteSheet} onClose={() => setInviteSheet(false)} dismissible={!busy} title={say('멤버 중에서 초대', 'Invite a member')}>
            <View style={styles.sheetBody}>
              <TextInput testID="meetup-host-candidate-search" accessibilityLabel={say('참가자 이름 검색', 'Search members by name')} placeholder={say('이름으로 찾기', 'Find a member by name')} placeholderTextColor={theme.textSecondary} value={candidateQuery} onChangeText={value => { setCandidateQuery(value); setCandidatePage(0); }} style={field} />
              {visibleCandidates.map(identity => <Pressable analyticsId="meetup_host_tools.control.10" key={identity.userId} accessibilityRole="button" disabled={locked || !canInviteCohost} accessibilityState={{ disabled: locked || !canInviteCohost }} style={[button, !canInviteCohost && styles.disabled]} onPress={() => void act(() => inviteMeetupCohost(supabase, postId, identity.userId), 'role', value => value.isHost && (value.canInviteCohost ?? value.canInvite) && value.candidates.includes(identity.userId))}><ThemedText style={styles.label}>{say(`${identity.displayName} 초대`, `Invite ${identity.displayName}`)}</ThemedText></Pressable>)}
              {!candidates.length && <ThemedText style={styles.helper} themeColor="textSecondary">{say('일치하는 이름이 없어요.', 'No matching names.')}</ThemedText>}
              {candidatePages > 1 && <View style={styles.row}>
                <Pressable analyticsId="meetup_host_tools.candidates.previous" accessibilityRole="button" accessibilityState={{ disabled: locked || page === 0 }} disabled={locked || page === 0} style={button} onPress={() => { play('selection'); setCandidatePage(page - 1); }}><ThemedText style={styles.label}>{say('이전', 'Previous')}</ThemedText></Pressable>
                <ThemedText style={styles.helper}>{say(`${page + 1}/${candidatePages} 페이지`, `Page ${page + 1} of ${candidatePages}`)}</ThemedText>
                <Pressable analyticsId="meetup_host_tools.candidates.next" accessibilityRole="button" accessibilityState={{ disabled: locked || page + 1 >= candidatePages }} disabled={locked || page + 1 >= candidatePages} style={button} onPress={() => { play('selection'); setCandidatePage(page + 1); }}><ThemedText style={styles.label}>{say('다음', 'Next')}</ThemedText></Pressable>
              </View>}
            </View>
          </DragSheet>
        </View>}
        {show('stats') && <View>
          <SectionLabel>{say('내 모임 통계 · 프리미엄', 'My meetup totals · Premium')}</SectionLabel>
          {metrics ? <View style={styles.stats}>
            <ThemedText type="small" style={styles.bodyText}>{say(`신청한 사람 ${metrics.applications}명 · 현재 승인 ${metrics.approvals}명`, `${metrics.applications} applicants · ${metrics.approvals} currently approved`)}</ThemedText>
            <ThemedText type="small" style={styles.bodyText}>{say(`확인된 참석 ${metrics.confirmedAttendance}건 · 회차별 합계`, `Confirmed attendance: ${metrics.confirmedAttendance} · total across sessions`)}</ThemedText>
            <ThemedText type="small" style={styles.bodyText}>{say(`재참가자 ${metrics.repeatParticipants}명 · 두 회차 이상 참석 확인`, `Repeat participants: ${metrics.repeatParticipants} · confirmed in two or more sessions`)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{say('신청한 사람은 계정당 한 번 세고, 참석은 회차별로 합산해요. 호스트 본인은 참석 집계에서 제외해요.', 'Each applicant is counted once. Attendance is added up across sessions, excluding the host.')}</ThemedText>
          </View> : <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>{metricError ? say('통계를 확인하지 못했어요. 수치를 추정하지 않아요.', 'Couldn’t load stats. We never show estimates.') : say('실제 참석 집계는 호스트의 프리미엄 멤버십에서 확인해요.', 'The host can view verified totals with Premium.')}</ThemedText>}
        </View>}
      </>}
    </>}
    {status}
  </View>;
}

type HostButton = { analyticsId: string; label: string; onPress: () => void; locked: boolean; disabled?: boolean; danger?: boolean };
/** Host-tools pill. `locked` turns every control off while something is saving or loading. */
function HostPill({ analyticsId, label, onPress, locked, disabled = false, danger = false, selected = false, a11y }: HostButton & { selected?: boolean; a11y?: string }) {
  const theme = useTheme(), off = locked || disabled;
  return <Pressable analyticsId={analyticsId} accessibilityRole="button" accessibilityLabel={a11y ?? label} disabled={off} accessibilityState={{ disabled: off, selected }} onPress={onPress}
    style={({ pressed }) => [ControlStyles.pill, styles.pill, controlPresentation(theme, { selected, pressed, disabled: off }).container, danger ? { borderColor: theme.danger } : undefined]}>
    <ThemedText type="smallBold" themeColor={danger ? 'danger' : undefined} style={danger ? undefined : controlPresentation(theme, { selected }).text}>{label}</ThemedText>
  </Pressable>;
}
function HostWide({ analyticsId, label, onPress, locked, disabled = false, danger = false }: HostButton) {
  const theme = useTheme(), off = locked || disabled;
  return <Pressable analyticsId={analyticsId} accessibilityRole="button" disabled={off} accessibilityState={{ disabled: off }} onPress={onPress}
    style={({ pressed }) => [ControlStyles.action, styles.wide, controlPresentation(theme, { pressed, disabled: off }).container, { backgroundColor: 'transparent', borderColor: danger ? theme.danger : theme.line }]}>
    <ThemedText type="smallBold" themeColor={danger ? 'danger' : undefined}>{label}</ThemedText>
  </Pressable>;
}

const styles = StyleSheet.create({
  ctaHint: { textAlign: 'center' },
  label: { ...Typography.menu }, helper: { fontSize: 14, lineHeight: 22 }, helperGap: { fontSize: 14, lineHeight: 22, marginBottom: 8 }, bodyText: { fontSize: 16, lineHeight: 24 },
  panel: { padding: 16, borderRadius: 16, borderWidth: 1, gap: 12 },
  sections: { gap: 8 }, sheetBody: { gap: 8, paddingBottom: 16 }, stats: { gap: 4 }, gapTop: { marginTop: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 56, paddingHorizontal: 16, paddingVertical: 8 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  pill: { borderWidth: 1 }, wide: { borderWidth: 1 },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden', marginVertical: 8 }, barFill: { height: 6, borderRadius: 3 },
  button: { minHeight: 48, borderWidth: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, justifyContent: 'center' },
  disabled: { opacity: 0.5 }, grow: { flex: 1, minWidth: 0 },
  search: { ...Typography.menu, minHeight: 48, borderWidth: 1, borderRadius: 12, padding: 12 },
});
