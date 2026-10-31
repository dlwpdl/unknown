import { useCallback, useEffect, useRef, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, TextInput, View } from 'react-native';
import { Pressable, Switch } from '@/components/analytics-controls';
import { ChillingDateInput } from '@/components/chilling-date-input';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { ControlStyles, IconSize, Typography, controlPresentation } from '@/constants/design-system';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadMeetupSessions, type MeetupSession } from '@/lib/meetup-reviews';
import {
  ANNOUNCEMENT_MAX, ANNOUNCEMENTS_PER_DAY, REGULAR_ATTENDANCE, badgeLabels, loadMeetupBadges, loadMeetupLoyalty, loadMeetupRoster, loyaltyError,
  pinnedNotices, postMeetupAnnouncement, saveMemberNote, setCheckinStaff, setHostFollow, setMeetupAutoNext, setMeetupEncore, staffCheckIn, tierAtLeast,
  updateMeetupAnnouncement, type AnnouncementAudience, type BadgeLevels, type MeetupLoyalty, type PinnedNotice, type RosterMember,
} from '@/lib/meetup-loyalty';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

/** Viewer state for one meetup; null while loading, signed out or unavailable. */
function useMeetupLoyalty(postId: string, enabled = true) {
  const { isAuthed, me } = useAuth();
  const [loaded, setLoaded] = useState<{ key: string; value: MeetupLoyalty | null } | null>(null), [revision, setRevision] = useState(0);
  const key = isAuthed && enabled ? `${me.id}:${postId}` : '';
  useEffect(() => {
    if (!key) return;
    let active = true;
    loadMeetupLoyalty(supabase, postId).then(value => { if (active) setLoaded({ key, value }); }, () => { if (active) setLoaded({ key, value: null }); });
    return () => { active = false; };
  }, [key, postId, revision]);
  const state = key && loaded?.key === key ? loaded.value : null;
  const setState = useCallback((value: MeetupLoyalty) => setLoaded({ key, value }), [key]);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  return { state, setState, refresh };
}

/** Attendance/host badges for the given people (or a meetup's host). Badges are a decoration: failures render nothing. */
export function useMeetupBadges(userIds: string[] | null, postId?: string) {
  const { isAuthed, me } = useAuth();
  const [badges, setBadges] = useState<{ key: string; value: Record<string, BadgeLevels> } | null>(null);
  const ids = userIds ? [...userIds].sort().join(',') : '';
  const key = !isAuthed ? '' : userIds ? ids && `${me.id}|u:${ids}` : postId ? `${me.id}|p:${postId}` : '';
  useEffect(() => {
    if (!key) return;
    let active = true;
    loadMeetupBadges(supabase, ids ? { userIds: ids.split(',').slice(0, 100) } : { postId })
      .then(value => { if (active) setBadges({ key, value: value ?? {} }); }, () => { if (active) setBadges({ key, value: {} }); });
    return () => { active = false; };
  }, [key, ids, postId]);
  return key && badges?.key === key ? badges.value : {};
}

/** Same look as the meetup detail's category chips (MeetupChips). */
export function MeetupBadgeChips({ levels }: { levels: Partial<BadgeLevels> | undefined }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const labels = badgeLabels(levels).map(label => tr(label));
  if (!labels.length) return null;
  return <View accessible accessibilityRole="text" accessibilityLabel={tr('배지: {0}', labels.join(', '))} style={styles.chips}>
    {labels.map(label => <View key={label} style={[styles.chip, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold" themeColor="accent">{label}</ThemedText>
    </View>)}
  </View>;
}

function ToggleChip({ analyticsId, label, selected, busy, disabled, onPress, hint }: {
  analyticsId: string; label: string; selected: boolean; busy?: boolean; disabled?: boolean; onPress: () => void; hint?: string;
}) {
  const theme = useTheme();
  const blocked = !!busy || !!disabled;
  return <Pressable analyticsId={analyticsId} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint}
    accessibilityState={{ selected, disabled: blocked, busy: !!busy }} disabled={blocked} onPress={onPress}
    style={({ pressed }) => [ControlStyles.pill, controlPresentation(theme, { selected, pressed, disabled, busy }).container]}>
    <ThemedText type="smallBold" style={controlPresentation(theme, { selected }).text}>{label}</ThemedText>
  </Pressable>;
}

/** Meetup detail: follow the host, ask for an encore after it ends; the host sees both counts. */
export function MeetupFollowEncore({ post }: { post: Post }) {
  const { tr } = useLanguage();
  const { play } = useInteractionFeedback();
  const { state, setState } = useMeetupLoyalty(post.id, !!post.room && !post.business);
  const [busy, setBusy] = useState<'follow' | 'encore' | null>(null), [error, setError] = useState('');
  if (!state) return null;
  const run = async (kind: 'follow' | 'encore') => {
    if (busy) return;
    setBusy(kind); setError(''); play('selection');
    try {
      if (kind === 'follow') { const following = await setHostFollow(supabase, post.id, !state.following); setState({ ...state, following }); }
      else { const encored = await setMeetupEncore(supabase, post.id, !state.encored); setState({ ...state, encored }); }
      play('success');
    } catch (failure) { setError(loyaltyError(failure)); play('warning'); }
    finally { setBusy(null); }
  };
  return <View style={styles.block}>
    <MeetupBadgeChips levels={state.hostBadges} />
    {state.isHost ? <ThemedText type="small" themeColor="textSecondary">
      {state.ended || state.encoreCount ? tr('팔로워 {0}명 · 또 열어 달라는 사람 {1}명', state.followerCount ?? 0, state.encoreCount ?? 0) : tr('팔로워 {0}명', state.followerCount ?? 0)}
    </ThemedText> : <>
      <View style={styles.row}>
        <ToggleChip analyticsId="meetup.host.follow" label={state.following ? tr('팔로우 중') : tr('호스트 팔로우')} selected={state.following} busy={busy === 'follow'} onPress={() => void run('follow')} />
        {state.canEncore && <ToggleChip analyticsId="meetup.encore" label={state.encored ? tr('또 열어 달라고 했어요') : tr('또 열어 주세요')} selected={state.encored} busy={busy === 'encore'} onPress={() => void run('encore')} />}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {state.canEncore ? tr('{0}님이 새 모임을 열면 바로 알려 드려요.', post.author.nickname) : tr('팔로우하면 {0}님이 새 모임을 열 때 알려 드려요.', post.author.nickname)}
      </ThemedText>
    </>}
    {!!error && <ThemedText type="small" accessibilityRole="alert">{tr(error)}</ThemedText>}
  </View>;
}

/** Meetup profile screen: badges for the shown person, plus a follow button on the host's profile. */
export function MeetupProfileLoyalty({ postId, userId }: { postId: string; userId?: string }) {
  const { tr } = useLanguage();
  const { play } = useInteractionFeedback();
  const badges = useMeetupBadges(userId ? [userId] : null, userId ? undefined : postId);
  const { state, setState } = useMeetupLoyalty(postId, !userId);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const levels = userId ? badges[userId] : Object.values(badges)[0];
  const follow = async () => {
    if (!state || busy) return;
    setBusy(true); setError(''); play('selection');
    try { setState({ ...state, following: await setHostFollow(supabase, postId, !state.following) }); play('success'); }
    catch (failure) { setError(loyaltyError(failure)); play('warning'); }
    finally { setBusy(false); }
  };
  return <View style={styles.block}>
    <MeetupBadgeChips levels={levels} />
    {state && !state.isHost && <ToggleChip analyticsId="meetup.host.follow" label={state.following ? tr('팔로우 중') : tr('호스트 팔로우')} selected={state.following} busy={busy} onPress={() => void follow()} />}
    {!!error && <ThemedText type="small" accessibilityRole="alert">{tr(error)}</ThemedText>}
  </View>;
}

/** Group chat: the host's member-wide notices from the last 14 days stay on top, newest first (up to 5). Two or more fold into one line. */
export function MeetupPinnedNotice({ postId }: { postId: string }) {
  const { tr, locale } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const { state, refresh } = useMeetupLoyalty(postId);
  const [busy, setBusy] = useState(''), [open, setOpen] = useState(false);
  const notices = pinnedNotices(state);
  if (!state || !notices.length) return null;
  const day = (notice: PinnedNotice) => new Date(notice.sentAt).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  const unpin = (notice: PinnedNotice, label: string) => state.isHost && <Pressable analyticsId="meetup.notice.unpin" accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ busy: busy === notice.id, disabled: !!busy }} disabled={!!busy}
    onPress={async () => { play('selection'); setBusy(notice.id); try { await updateMeetupAnnouncement(supabase, notice.id, 'unpin'); refresh(); } catch { play('warning'); } finally { setBusy(''); } }}
    style={({ pressed }) => [ControlStyles.icon, styles.unpin, controlPresentation(theme, { tone: 'ghost', pressed, busy: busy === notice.id, disabled: !!busy && busy !== notice.id }).container]}>
    <ThemedText type="smallBold" themeColor="textSecondary">{tr('내리기')}</ThemedText>
  </Pressable>;
  if (notices.length === 1) {
    const pinned = notices[0];
    return <View accessible={!state.isHost} accessibilityLabel={tr('호스트 공지: {0}', pinned.body)} style={[styles.pinned, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.pinnedHead}>
        <ThemedText type="smallBold" themeColor="accent">{tr('공지')} · {day(pinned)}</ThemedText>
        {unpin(pinned, tr('공지 내리기'))}
      </View>
      <ThemedText type="small" numberOfLines={4}>{pinned.body}</ThemedText>
    </View>;
  }
  return <View style={[styles.pinned, styles.pinnedStack, { backgroundColor: theme.backgroundElement }]}>
    <Pressable analyticsId="meetup.notice.expand" accessibilityRole="button" accessibilityState={{ expanded: open }}
      accessibilityLabel={open ? tr('고정된 공지 {0}개, 접기', notices.length) : tr('고정된 공지 {0}개, 눌러서 모두 보기', notices.length)}
      onPress={() => { play('selection'); setOpen(value => !value); }}
      style={({ pressed }) => [styles.pinnedBar, controlPresentation(theme, { tone: 'ghost', pressed }).container]}>
      <ThemedText type="smallBold" themeColor="accent">{tr('공지 {0}', notices.length)}</ThemedText>
      <ThemedText type="small" numberOfLines={1} style={styles.flex}>{open ? '' : notices[0].body}</ThemedText>
      {open && <ThemedText type="small" themeColor="textSecondary">{tr('접기')}</ThemedText>}
      <SymbolView name={{ ios: open ? 'chevron.up' : 'chevron.down', android: open ? 'expand_less' : 'expand_more', web: open ? 'expand_less' : 'expand_more' }}
        size={IconSize.chevron} tintColor={theme.textSecondary} />
    </Pressable>
    {open && notices.map((notice, index) => <View key={notice.id} accessible={!state.isHost} accessibilityLabel={tr('호스트 공지: {0}', notice.body)}
      style={[styles.pinnedItem, { borderTopColor: theme.line }]}>
      <View style={styles.pinnedHead}>
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.flex}>{day(notice)}</ThemedText>
        {index === 0 && <ThemedText type="smallBold" themeColor="accent">{tr('최신')}</ThemedText>}
        {unpin(notice, tr('{0} 공지 내리기', day(notice)))}
      </View>
      <ThemedText type="small" numberOfLines={4}>{notice.body}</ThemedText>
    </View>)}
    {open && state.isHost && <ThemedText type="small" themeColor="textSecondary" style={[styles.pinnedItem, { borderTopColor: theme.line }]}>
      {tr('최근 2주 안에 보낸 공지 중 최신 5개까지 고정돼요.')}</ThemedText>}
  </View>;
}

const AUDIENCES: [AnnouncementAudience, string][] = [['members', '참여 멤버 전체'], ['pending', '신청 대기 중인 분'], ['waitlist', '대기 명단']];

/** /meetup-tools: notices, auto next session and roster for the host; check-in for the host and staff. */
export function MeetupLoyaltyTools({ postId }: { postId: string }) {
  const { state, refresh } = useMeetupLoyalty(postId);
  if (!state || (!state.isHost && !state.isStaff)) return null;
  const pro = tierAtLeast(state.hostTier, 'pro');
  return <View style={styles.tools}>
    {state.isHost && <NoticeComposer postId={postId} state={state} onChanged={refresh} />}
    {state.isHost && state.kind === 'group' && <AutoNext postId={postId} state={state} onChanged={refresh} />}
    {state.isHost && <Roster postId={postId} pro={pro} />}
    {(state.isStaff || (state.isHost && pro)) && <StaffCheckIn postId={postId} />}
  </View>;
}

function NoticeComposer({ postId, state, onChanged }: { postId: string; state: MeetupLoyalty; onChanged: () => void }) {
  const { tr, locale } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const plus = tierAtLeast(state.hostTier, 'plus');
  const [body, setBody] = useState(''), [audience, setAudience] = useState<AnnouncementAudience>('members');
  const [scheduled, setScheduled] = useState(false), [sendAt, setSendAt] = useState(() => new Date(Date.now() + 3600000).toISOString());
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), pending = useRef(false);
  const left = Math.max(0, ANNOUNCEMENTS_PER_DAY - (state.sentToday ?? 0));
  const send = async () => {
    if (pending.current || !body.trim()) return;
    pending.current = true; setBusy(true); setMessage(''); play('selection');
    try {
      await postMeetupAnnouncement(supabase, postId, body, audience, scheduled ? sendAt : null);
      setBody(''); setMessage(scheduled ? '공지를 예약했어요.' : audience === 'members' ? '공지를 보냈어요.' : '안전 확인을 마치면 바로 보내 드려요.'); play('success'); onChanged();
    } catch (failure) { setMessage(loyaltyError(failure, '공지를 보내지 못했어요. 잠시 뒤 다시 해 주세요.')); play('warning'); }
    finally { pending.current = false; setBusy(false); }
  };
  return <View style={[styles.section, { borderTopColor: theme.line }]}>
    <ThemedText accessibilityRole="header" style={Typography.section}>{tr('단체 공지')}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{tr('멤버 전체 공지는 모임 대화방 맨 위에 고정되고 알림으로도 가요. 오늘 {0}번 더 보낼 수 있어요.', left)}</ThemedText>
    <TextInput accessibilityLabel={tr('공지 내용')} placeholder={tr('예) 내일은 7시에 역 앞에서 만나요')} placeholderTextColor={theme.textSecondary}
      multiline maxLength={ANNOUNCEMENT_MAX} editable={!busy} value={body} onChangeText={setBody}
      style={[ControlStyles.field, styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.background }]} />
    <ThemedText type="smallBold">{tr('받는 사람')}</ThemedText>
    <View style={styles.row}>{AUDIENCES.map(([value, label]) =>
      <ToggleChip key={value} analyticsId="meetup.notice.audience" label={tr(label)} selected={audience === value} disabled={value !== 'members' && !plus}
        onPress={() => { play('selection'); setAudience(value); }} />)}</View>
    <View style={styles.row}>
      <ToggleChip analyticsId="meetup.notice.schedule" label={tr('지금 보내기')} selected={!scheduled} onPress={() => { play('selection'); setScheduled(false); }} />
      <ToggleChip analyticsId="meetup.notice.schedule" label={tr('시간 정해서 보내기')} selected={scheduled} disabled={!plus} onPress={() => { play('selection'); setScheduled(true); }} />
    </View>
    {!plus && <ThemedText type="small" themeColor="textSecondary">{tr('받는 사람 고르기와 예약 보내기는 플러스 멤버십부터 쓸 수 있어요.')}</ThemedText>}
    {scheduled && <ChillingDateInput label={tr('보낼 시간')} value={sendAt} disabled={busy} minimumDate={new Date()} onChange={value => { play('selection'); setSendAt(value); }} />}
    <RaisedActionButton analyticsId="meetup.notice.send" label={scheduled ? tr('공지 예약하기') : tr('공지 보내기')} busy={busy} disabled={!body.trim() || (!scheduled && left === 0)} onPress={() => void send()} />
    {!!message && <ThemedText type="small" accessibilityLiveRegion="polite">{tr(message)}</ThemedText>}
    {state.scheduled?.map(item => <View key={item.id} style={[styles.listRow, { borderColor: theme.line }]}>
      <View style={styles.flex}>
        <ThemedText type="smallBold">{new Date(item.sendAt).toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {tr(AUDIENCES.find(([value]) => value === item.audience)?.[1] ?? '')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{item.body}</ThemedText>
      </View>
      <ToggleChip analyticsId="meetup.notice.cancel" label={tr('예약 취소')} selected={false} disabled={busy}
        onPress={async () => { play('selection'); try { await updateMeetupAnnouncement(supabase, item.id, 'cancel'); onChanged(); } catch { play('warning'); } }} />
    </View>)}
  </View>;
}

function AutoNext({ postId, state, onChanged }: { postId: string; state: MeetupLoyalty; onChanged: () => void }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const pro = tierAtLeast(state.hostTier, 'pro');
  const enabled = !!state.autoNext?.enabled, cadence = state.autoNext?.cadence ?? 'weekly';
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async (next: boolean, nextCadence: 'weekly' | 'fortnightly') => {
    setBusy(true); setError('');
    try { await setMeetupAutoNext(supabase, postId, next, nextCadence); play('success'); onChanged(); }
    catch (failure) { setError(loyaltyError(failure)); play('warning'); }
    finally { setBusy(false); }
  };
  return <View style={[styles.section, { borderTopColor: theme.line }]}>
    <View style={styles.listRow}>
      <View style={styles.flex}>
        <ThemedText accessibilityRole="header" style={Typography.section}>{tr('다음 회차 자동으로 열기')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{pro ? tr('회차가 끝나면 같은 요일·시간으로 다음 회차를 열고 멤버와 팔로워에게 알려요.') : tr('프로 멤버십부터 쓸 수 있어요.')}</ThemedText>
      </View>
      <Switch analyticsId="meetup.auto-next" accessibilityLabel={tr('다음 회차 자동으로 열기')} value={enabled} disabled={busy || (!pro && !enabled)}
        onValueChange={next => { play('selection'); void save(next, cadence); }} />
    </View>
    {enabled && <View style={styles.row}>{(['weekly', 'fortnightly'] as const).map(value =>
      <ToggleChip key={value} analyticsId="meetup.auto-next.cadence" label={value === 'weekly' ? tr('매주') : tr('2주마다')} selected={cadence === value} busy={busy}
        onPress={() => { play('selection'); void save(true, value); }} />)}</View>}
    {!!error && <ThemedText type="small" accessibilityRole="alert">{tr(error)}</ThemedText>}
  </View>;
}

function Roster({ postId, pro }: { postId: string; pro: boolean }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const [members, setMembers] = useState<RosterMember[] | null>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!pro) return;
    let active = true;
    loadMeetupRoster(supabase, postId).then(value => { if (active) { setMembers(value); setError(''); } },
      failure => { if (active) setError(loyaltyError(failure, '명부를 불러오지 못했어요.')); });
    return () => { active = false; };
  }, [pro, postId, revision]);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  return <View style={[styles.section, { borderTopColor: theme.line }]}>
    <ThemedText accessibilityRole="header" style={Typography.section}>{tr('멤버 명부')}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{pro ? tr('메모와 정회원 표시는 호스트에게만 보여요. 멤버에게는 알리지 않아요.') : tr('프로 멤버십부터 참석 횟수, 단골, 나만 보는 메모, 정회원, 체크인 담당을 쓸 수 있어요.')}</ThemedText>
    {!!error && <ThemedText type="small" accessibilityRole="alert">{tr(error)}</ThemedText>}
    {pro && members?.length === 0 && <ThemedText type="small" themeColor="textSecondary">{tr('아직 승인한 멤버가 없어요.')}</ThemedText>}
    {pro && members?.map(member => <RosterRow key={member.userId} postId={postId} member={member} onChanged={refresh} />)}
  </View>;
}

function RosterRow({ postId, member, onChanged }: { postId: string; member: RosterMember; onChanged: () => void }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const [open, setOpen] = useState(false), [note, setNote] = useState(member.note), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); play('success'); onChanged(); }
    catch (failure) { setError(loyaltyError(failure)); play('warning'); }
    finally { setBusy(false); }
  };
  return <View style={[styles.member, { borderColor: theme.line }]}>
    <View style={styles.listRow}>
      <View style={styles.flex}>
        <ThemedText type="smallBold">{member.nickname}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{[tr('참석 {0}번', member.attended), member.attended >= REGULAR_ATTENDANCE ? tr('단골') : '', member.regular ? tr('정회원') : ''].filter(Boolean).join(' · ')}</ThemedText>
      </View>
      <ToggleChip analyticsId="meetup.roster.note" label={open ? tr('접기') : tr('메모')} selected={open} onPress={() => { play('selection'); setOpen(value => !value); }} />
    </View>
    {open && <>
      <View style={styles.listRow}><ThemedText type="small" style={styles.flex}>{tr('정회원')}</ThemedText>
        <Switch analyticsId="meetup.roster.regular" accessibilityLabel={tr('{0}님 정회원', member.nickname)} value={member.regular} disabled={busy}
          onValueChange={next => { play('selection'); void save(() => saveMemberNote(supabase, postId, member.userId, note, next)); }} /></View>
      <View style={styles.listRow}><ThemedText type="small" style={styles.flex}>{tr('체크인 담당 (최대 3명)')}</ThemedText>
        <Switch analyticsId="meetup.roster.staff" accessibilityLabel={tr('{0}님 체크인 담당', member.nickname)} value={member.staff} disabled={busy}
          onValueChange={next => { play('selection'); void save(() => setCheckinStaff(supabase, postId, member.userId, next)); }} /></View>
      <TextInput accessibilityLabel={tr('{0}님 메모', member.nickname)} placeholder={tr('나만 보는 메모')} placeholderTextColor={theme.textSecondary}
        multiline maxLength={500} editable={!busy} value={note} onChangeText={setNote}
        style={[ControlStyles.field, styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.background }]} />
      <ToggleChip analyticsId="meetup.roster.note.save" label={tr('메모 저장')} selected={false} busy={busy} disabled={note.trim() === member.note}
        onPress={() => { play('selection'); void save(() => saveMemberNote(supabase, postId, member.userId, note, member.regular)); }} />
    </>}
    {!!error && <ThemedText type="small" accessibilityRole="alert">{tr(error)}</ThemedText>}
  </View>;
}

function StaffCheckIn({ postId }: { postId: string }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const { me } = useAuth();
  const { play } = useInteractionFeedback();
  const [live, setLive] = useState<MeetupSession | null | undefined>(undefined), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    loadMeetupSessions(supabase, postId).then(value => {
      const now = Date.now();
      if (active) setLive(value.sessions.find(session => Date.parse(session.startsAt) <= now && now < Date.parse(session.endsAt)) ?? null);
    }, () => { if (active) setLive(null); });
    return () => { active = false; };
  }, [postId, revision]);
  const checkIn = async (sessionId: string, attendeeId: string) => {
    if (busy) return;
    setBusy(attendeeId); setError(''); play('selection');
    try { await staffCheckIn(supabase, sessionId, attendeeId); play('success'); setRevision(value => value + 1); }
    catch (failure) { setError(loyaltyError(failure, '체크인하지 못했어요.')); play('warning'); }
    finally { setBusy(null); }
  };
  const waiting = live?.members.filter(member => !member.checkedIn && member.id !== me.id) ?? [];
  return <View style={[styles.section, { borderTopColor: theme.line }]}>
    <ThemedText accessibilityRole="header" style={Typography.section}>{tr('멤버 체크인')}</ThemedText>
    {live === undefined ? null : !live ? <ThemedText type="small" themeColor="textSecondary">{tr('모임 시간이 되면 여기서 온 사람을 체크인할 수 있어요.')}</ThemedText>
      : !waiting.length ? <ThemedText type="small" themeColor="textSecondary">{tr('모두 체크인했어요.')}</ThemedText>
      : waiting.map(member => <View key={member.id} style={styles.listRow}>
        <ThemedText type="smallBold" style={styles.flex}>{member.nickname}</ThemedText>
        <ToggleChip analyticsId="meetup.staff.check-in" label={tr('체크인')} hint={tr('{0}님이 왔다고 표시해요', member.nickname)} selected={false} busy={busy === member.id} disabled={!!busy && busy !== member.id}
          onPress={() => void checkIn(live.id, member.id)} />
      </View>)}
    {!!error && <ThemedText type="small" accessibilityRole="alert">{tr(error)}</ThemedText>}
  </View>;
}

const styles = StyleSheet.create({
  block: { gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  pinned: { marginHorizontal: Spacing.three, marginBottom: Spacing.two, borderRadius: 12, padding: Spacing.three, gap: Spacing.one },
  pinnedHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  pinnedStack: { padding: 0, gap: 0, overflow: 'hidden' },
  pinnedBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44, paddingHorizontal: Spacing.three, borderRadius: 12 },
  pinnedItem: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, gap: Spacing.one },
  unpin: { width: 'auto', paddingHorizontal: Spacing.two },
  tools: { gap: Spacing.three },
  section: { gap: Spacing.two, paddingTop: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth },
  input: { minHeight: 88, paddingTop: Spacing.two, textAlignVertical: 'top' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 },
  member: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  flex: { flex: 1, minWidth: 0 },
});
