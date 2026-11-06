import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { SymbolView } from '@/components/symbol-view';
import { ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { Pressable, Switch } from '@/components/analytics-controls';
import { ChillingDateInput } from '@/components/chilling-date-input';
import { DragSheet } from '@/components/drag-sheet';
import { InitialAvatar, ListCard, ListLoading, ListRow, SectionLabel, Tag } from '@/components/list-card';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ClayBoxFill, ClayControlFill, ClayPillFill, useClay, useClayBox } from '@/components/clay';
import { SelectionChip } from '@/components/selection-chip';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { ControlStyles, IconSize, Typography, controlPresentation } from '@/constants/design-system';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadMeetupRsvp, setMeetupRsvp, type MeetupRsvp as Rsvp } from '@/lib/meetup-convenience';
import { loadMeetupHostRoster, type MeetupHostIdentity } from '@/lib/meetup-host-tools';
import { sessionWhen } from '@/lib/meetup-host-home';
import {
  ANNOUNCEMENT_MAX, ANNOUNCEMENTS_PER_DAY, REGULAR_ATTENDANCE, badgeLabels, loadMeetupBadges, loadMeetupLoyalty, loadMeetupRoster, loyaltyError,
  pinnedNotices, postMeetupAnnouncement, saveMemberNote, setCheckinStaff, setHostFollow, setMeetupAutoNext, setMeetupEncore, tierAtLeast, unreadNotices,
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
  const theme = useTheme(), clay = useClay();
  const blocked = !!busy || !!disabled;
  return <Pressable analyticsId={analyticsId} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint}
    accessibilityState={{ selected, disabled: blocked, busy: !!busy }} disabled={blocked} onPress={onPress}
    style={({ pressed }) => [ControlStyles.pill, clay && styles.clayPill, controlPresentation(theme, { selected, pressed, disabled, busy, clay }).container]}>
    {clay && <ClayControlFill selected={selected} />}
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

/** Next session and the host's notices, on top of the group chat. Answers and reading happen here, so nobody scrolls the chat for them. */
export function MeetupRoomTop({ postId }: { postId: string }) {
  const { state, refresh } = useMeetupLoyalty(postId);
  const theme = useTheme(), clayBox = useClayBox();
  const [rsvp, setRsvp] = useState<Rsvp | null>(null);
  // "Today/tomorrow" is judged at the time the answer arrived or changed.
  const [now, setNow] = useState(() => Date.now());
  const showRsvp = (next: Rsvp) => { setRsvp(next); setNow(Date.now()); };
  useEffect(() => {
    let active = true;
    loadMeetupRsvp(supabase, postId).then(value => { if (active) showRsvp(value); }, () => {});
    return () => { active = false; };
  }, [postId]);
  const notices = pinnedNotices(state);
  const hasSession = !!rsvp?.available && !!rsvp.startsAt;
  if (!hasSession && !(state && notices.length)) return null;
  const content = <>
    {hasSession && <NextSessionLine postId={postId} rsvp={rsvp!} now={now} onChange={showRsvp} />}
    {!!state && notices.length > 0 && <View style={hasSession ? [styles.boardLine, clayBox && styles.boardLineInset, { borderTopColor: theme.line }] : undefined}><NoticeBoard postId={postId} state={state} notices={notices} onChanged={refresh} /></View>}
  </>;
  // The clay tile overhangs the card, so only the content inside is clipped to its corners.
  if (clayBox) return <View style={styles.roomTopClay}><ClayBoxFill kind="tile" /><View style={styles.roomTopRows}>{content}</View></View>;
  return <View style={[styles.roomTop, { backgroundColor: theme.backgroundElement }]}>{content}</View>;
}

function NextSessionLine({ postId, rsvp, now, onChange }: { postId: string; rsvp: Rsvp; now: number; onChange: (next: Rsvp) => void }) {
  const { tr, locale } = useLanguage();
  const { play } = useInteractionFeedback();
  const [saving, setSaving] = useState(false), [failed, setFailed] = useState(false);
  const answer = async (going: boolean) => {
    if (saving) return;
    setSaving(true); setFailed(false);
    try { onChange(await setMeetupRsvp(supabase, postId, going, false)); play('reaction'); }
    catch { setFailed(true); play('warning'); }
    finally { setSaving(false); }
  };
  const when = sessionWhen(rsvp.startsAt!, locale, now, tr);
  return <View style={styles.nextLine}>
    <View style={styles.flex}>
      <ThemedText style={Typography.label}>{tr('다음 회차')} · {when}</ThemedText>
      {rsvp.isHost && rsvp.canSeeCounts && rsvp.counts && <ThemedText themeColor="textSecondary" accessibilityLiveRegion="polite" style={Typography.caption}>{tr('갈게요 {0}명 · 못 가요 {1}명 · 아직 답 없음 {2}명', rsvp.counts.going, rsvp.counts.notGoing, rsvp.counts.noAnswer)}</ThemedText>}
      {failed && <ThemedText themeColor="danger" accessibilityRole="alert" style={Typography.caption}>{tr('저장하지 못했어요. 다시 시도해 주세요.')}</ThemedText>}
    </View>
    {!rsvp.isHost && <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={tr('참석 알려 주기')}>
      {([[true, 'meetup.rsvp.going', '갈게요'], [false, 'meetup.rsvp.not_going', '못 가요']] as const).map(([going, id, label]) => {
        const selected = rsvp.mine === (going ? 'going' : 'not_going');
        return <SelectionChip key={id} analyticsId={id} selected={selected} disabled={saving} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: saving, busy: saving }}
          baseColor="transparent" label={tr(label)} onPress={() => { play('selection'); if (!selected) void answer(going); }} />;
      })}
    </View>}
  </View>;
}

function NoticeBoard({ postId, state, notices, onChanged }: { postId: string; state: MeetupLoyalty; notices: PinnedNotice[]; onChanged: () => void }) {
  const { tr, locale } = useLanguage();
  const theme = useTheme(), router = useRouter(), { me } = useAuth();
  const { play } = useInteractionFeedback();
  const { width: screen } = useWindowDimensions();
  const storageKey = `meetup-notices-seen:${me.id}:${postId}`;
  // undefined: still reading the device. null: this person has never opened this room's notices.
  const [seen, setSeen] = useState<string[] | null | undefined>(undefined);
  const [open, setOpen] = useState(false), [welcome, setWelcome] = useState(false), [page, setPage] = useState(0), [width, setWidth] = useState(0);
  const [busy, setBusy] = useState(''), [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(storageKey).then(raw => { if (active) setSeen(raw ? JSON.parse(raw) as string[] : null); }).catch(() => { if (active) setSeen([]); });
    return () => { active = false; };
  }, [storageKey]);
  const markSeen = () => {
    const ids = [...new Set([...(seen ?? []), ...notices.map(notice => notice.id)])];
    setSeen(ids);
    void AsyncStorage.setItem(storageKey, JSON.stringify(ids)).catch(() => {});
  };
  // A new member reads what the host pinned before anything else. Shown once, and never to the host who wrote them.
  useEffect(() => {
    if (seen !== null || state.isHost) return;
    const timer = setTimeout(() => { setWelcome(true); setOpen(true); }, 450);
    return () => clearTimeout(timer);
  }, [seen, state.isHost]);
  const unread = state.isHost ? [] : unreadNotices(notices, seen ?? []);
  const shown = () => { play('selection'); setMessage(''); setOpen(true); markSeen(); };
  const closed = () => { setOpen(false); setWelcome(false); if (seen === null) markSeen(); };
  const update = async (notice: PinnedNotice, action: 'unpin' | 'must_read' | 'must_read_off') => {
    if (busy) return;
    play('selection'); setBusy(notice.id); setMessage('');
    try { await updateMeetupAnnouncement(supabase, notice.id, action); onChanged(); }
    catch (failure) { setMessage(loyaltyError(failure)); play('warning'); }
    finally { setBusy(''); }
  };
  // Text first laid out without a width keeps painting past its frame on iOS, so the first render already knows the page width.
  const pageWidth = width || screen - Spacing.three * 2;
  const day = (notice: PinnedNotice) => new Date(notice.sentAt).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  const label = (notice: PinnedNotice) => notice.mustRead ? tr('필독') : tr('공지');
  return <View>
    <ScrollView onLayout={event => setWidth(event.nativeEvent.layout.width)} horizontal pagingEnabled scrollEnabled={notices.length > 1} showsHorizontalScrollIndicator={false}
      onMomentumScrollEnd={event => setPage(Math.round(event.nativeEvent.contentOffset.x / pageWidth))}>
      {notices.map((notice, index) => <View key={notice.id} style={{ width: pageWidth }}><Pressable analyticsId="meetup.notice.open" accessibilityRole="button"
        accessibilityLabel={tr('{0} {1}/{2}: {3}, 눌러서 전체 보기', label(notice), index + 1, notices.length, notice.body)} onPress={shown}
        style={styles.noticePage}>
        <Tag label={label(notice)} tone={notice.mustRead ? 'accent' : 'quiet'} />
        <View style={styles.flex}><ThemedText numberOfLines={1} style={Typography.supporting}>{notice.body}</ThemedText></View>
        {unread.some(item => item.id === notice.id) && <View accessibilityLabel={tr('안 읽음')} style={[styles.dot, { backgroundColor: theme.accent }]} />}
        <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={IconSize.chevron} tintColor={theme.textSecondary} />
      </Pressable></View>)}
    </ScrollView>
    {notices.length > 1 && <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {notices.map((notice, index) => <View key={notice.id} style={[styles.pageDot, { backgroundColor: index === page ? theme.accent : theme.line }]} />)}
    </View>}
    <DragSheet visible={open} onClose={closed} title={tr('공지 {0}개', notices.length)}>
      <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetList}>
        {welcome && <ThemedText themeColor="textSecondary" style={Typography.body}>{tr('처음 오셨네요. 호스트가 걸어 둔 공지예요. 먼저 읽어 주세요.')}</ThemedText>}
        {notices.map(notice => <NoticeItem key={notice.id} notice={notice} label={label(notice)} day={day(notice)}>
          {state.isHost && <View style={styles.row}>
            {state.noticeBoard && <ToggleChip analyticsId="meetup.notice.must-read" label={notice.mustRead ? tr('필독 풀기') : tr('필독으로')} selected={false} busy={busy === notice.id} disabled={!!busy && busy !== notice.id} onPress={() => void update(notice, notice.mustRead ? 'must_read_off' : 'must_read')} />}
            <ToggleChip analyticsId="meetup.notice.unpin" label={tr('내리기')} selected={false} busy={busy === notice.id} disabled={!!busy && busy !== notice.id} onPress={() => void update(notice, 'unpin')} />
          </View>}
        </NoticeItem>)}
        {!!message && <ThemedText type="small" accessibilityRole="alert" themeColor="danger">{tr(message)}</ThemedText>}
        {state.isHost && <ThemedText themeColor="textSecondary" style={Typography.supporting}>{state.noticeBoard ? tr('필독은 내릴 때까지 맨 위에 남고, 일반 공지는 2주 뒤 내려가요. 5개까지 보여요.') : tr('최근 2주 안에 보낸 공지 중 최신 5개까지 고정돼요.')}</ThemedText>}
      </ScrollView>
      {welcome && <RaisedActionButton analyticsId="meetup.notice.read" label={tr('다 읽었어요')} onPress={() => { play('selection'); closed(); }} />}
      {state.isHost && <RaisedActionButton analyticsId="meetup.notice.write" tone="secondary" label={tr('새 공지 쓰기')} onPress={() => { play('selection'); closed(); router.push({ pathname: '/meetup-tools', params: { postId, kind: state.kind, host: '1', section: 'notices' } }); }} />}
    </DragSheet>
  </View>;
}

function NoticeItem({ notice, label, day, children }: { notice: PinnedNotice; label: string; day: string; children?: React.ReactNode }) {
  const { tr } = useLanguage();
  const { play } = useInteractionFeedback(), clay = useClay();
  const [full, setFull] = useState(false);
  const long = [...notice.body].length > 140;
  return <View style={styles.noticeItem}>
    <View style={styles.row}>
      <Tag label={label} tone={notice.mustRead ? 'accent' : 'quiet'} />
      <ThemedText themeColor="textSecondary" style={Typography.caption}>{day}</ThemedText>
    </View>
    <ThemedText selectable numberOfLines={long && !full ? 5 : undefined} style={Typography.body}>{notice.body}</ThemedText>
    {long && <Pressable analyticsId="meetup.notice.more" accessibilityRole="button" accessibilityState={{ expanded: full }} onPress={() => { play('selection'); setFull(value => !value); }} style={[styles.more, clay && styles.clayMore]}>
      {clay && <ClayPillFill kind="white" />}
      <ThemedText type="smallBold" themeColor="accent">{full ? tr('접기') : tr('더 보기')}</ThemedText>
    </Pressable>}
    {children}
  </View>;
}

const AUDIENCES: [AnnouncementAudience, string][] = [['members', '참여 멤버 전체'], ['pending', '신청 대기 중인 분'], ['waitlist', '대기 명단']];

/** /meetup-tools notices: write one, then see what is pinned and what is scheduled. */
export function MeetupNoticeManager({ postId }: { postId: string }) {
  const { tr, locale } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const { state, refresh } = useMeetupLoyalty(postId);
  const [body, setBody] = useState(''), [audience, setAudience] = useState<AnnouncementAudience>('members'), [mustRead, setMustRead] = useState(false);
  const [scheduled, setScheduled] = useState(false), [sendAt, setSendAt] = useState(() => new Date(Date.now() + 3600000).toISOString());
  const [busy, setBusy] = useState(false), [rowBusy, setRowBusy] = useState(''), [message, setMessage] = useState(''), pending = useRef(false);
  if (!state) return <ListLoading label={tr('불러오는 중이에요')} />;
  if (!state.isHost) return null;
  const plus = tierAtLeast(state.hostTier, 'plus');
  const left = Math.max(0, ANNOUNCEMENTS_PER_DAY - (state.sentToday ?? 0));
  const canMustRead = !!state.noticeBoard && audience === 'members' && !scheduled;
  const notices = pinnedNotices(state);
  const send = async () => {
    if (pending.current || !body.trim()) return;
    pending.current = true; setBusy(true); setMessage(''); play('selection');
    let sent = false;
    try {
      const id = await postMeetupAnnouncement(supabase, postId, body, audience, scheduled ? sendAt : null);
      sent = true;
      if (canMustRead && mustRead) await updateMeetupAnnouncement(supabase, id, 'must_read');
      setBody(''); setMustRead(false);
      setMessage(scheduled ? '공지를 예약했어요.' : audience === 'members' ? '공지를 보냈어요.' : '안전 확인을 마치면 바로 보내 드려요.'); play('success'); refresh();
    } catch (failure) {
      if (sent) { setBody(''); setMustRead(false); refresh(); }
      // Two dictionary sentences joined after translation; tr(message) below passes the joined text through unchanged.
      setMessage(sent ? `${tr('공지는 보냈지만 필독으로 걸지 못했어요.')} ${tr(loyaltyError(failure))}` : loyaltyError(failure, '공지를 보내지 못했어요. 잠시 뒤 다시 해 주세요.')); play('warning');
    }
    finally { pending.current = false; setBusy(false); }
  };
  const update = async (id: string, action: 'unpin' | 'must_read' | 'must_read_off' | 'cancel') => {
    if (rowBusy) return;
    play('selection'); setRowBusy(id); setMessage('');
    try { await updateMeetupAnnouncement(supabase, id, action); refresh(); }
    catch (failure) { setMessage(loyaltyError(failure)); play('warning'); }
    finally { setRowBusy(''); }
  };
  return <View>
    <TextInput accessibilityLabel={tr('공지 내용')} placeholder={tr('예) 내일은 7시에 역 앞에서 만나요')} placeholderTextColor={theme.textSecondary}
      multiline maxLength={ANNOUNCEMENT_MAX} editable={!busy} value={body} onChangeText={setBody}
      style={[ControlStyles.field, styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]} />
    <SectionLabel>{tr('받는 사람')}</SectionLabel>
    <View style={styles.row}>{AUDIENCES.map(([value, label]) =>
      <SelectionChip key={value} analyticsId="meetup.notice.audience" label={tr(label)} selected={audience === value} disabled={value !== 'members' && !plus} accessibilityRole="radio" accessibilityState={{ checked: audience === value, disabled: value !== 'members' && !plus }}
        onPress={() => { play('selection'); setAudience(value); }} />)}</View>
    <SectionLabel>{tr('보내는 때')}</SectionLabel>
    <View style={styles.row}>
      <SelectionChip analyticsId="meetup.notice.schedule" label={tr('지금 보내기')} selected={!scheduled} accessibilityRole="radio" accessibilityState={{ checked: !scheduled }} onPress={() => { play('selection'); setScheduled(false); }} />
      <SelectionChip analyticsId="meetup.notice.schedule" label={tr('시간 정해서 보내기')} selected={scheduled} disabled={!plus} accessibilityRole="radio" accessibilityState={{ checked: scheduled, disabled: !plus }} onPress={() => { play('selection'); setScheduled(true); }} />
    </View>
    {!plus && <ThemedText themeColor="textSecondary" style={[Typography.supporting, styles.note]}>{tr('받는 사람 고르기와 예약 보내기는 플러스 멤버십부터 쓸 수 있어요.')}</ThemedText>}
    {scheduled && <ChillingDateInput label={tr('보낼 시간')} value={sendAt} disabled={busy} minimumDate={new Date()} onChange={value => { play('selection'); setSendAt(value); }} />}
    {canMustRead && <View style={styles.listRow}>
      <ThemedText style={[Typography.body, styles.flex]}>{tr('필독으로 걸기')}</ThemedText>
      <Switch analyticsId="meetup.notice.compose-must-read" accessibilityLabel={tr('필독으로 걸기')} value={mustRead} disabled={busy} onValueChange={value => { play('selection'); setMustRead(value); }} />
    </View>}
    <View style={styles.send}><RaisedActionButton analyticsId="meetup.notice.send" label={scheduled ? tr('공지 예약하기') : tr('공지 보내기')} busy={busy} disabled={!body.trim() || (!scheduled && left === 0)} onPress={() => void send()} /></View>
    <ThemedText themeColor="textSecondary" style={[Typography.supporting, styles.note]}>{tr('멤버 전체 공지는 대화방 맨 위에 걸리고 알림도 가요. 오늘 {0}번 더 보낼 수 있어요.', left)}</ThemedText>
    {!!message && <ThemedText type="small" accessibilityLiveRegion="polite" style={styles.note}>{tr(message)}</ThemedText>}
    <SectionLabel>{tr('걸려 있는 공지 {0}개', notices.length)}</SectionLabel>
    {notices.length ? <ListCard>{notices.map(notice => <View key={notice.id} style={styles.noticeRow}>
      <NoticeItem notice={notice} label={notice.mustRead ? tr('필독') : tr('공지')} day={new Date(notice.sentAt).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}>
        <View style={styles.row}>
          {state.noticeBoard && <ToggleChip analyticsId="meetup.notice.must-read" label={notice.mustRead ? tr('필독 풀기') : tr('필독으로')} selected={false} busy={rowBusy === notice.id} disabled={!!rowBusy && rowBusy !== notice.id} onPress={() => void update(notice.id, notice.mustRead ? 'must_read_off' : 'must_read')} />}
          <ToggleChip analyticsId="meetup.notice.unpin" label={tr('내리기')} selected={false} busy={rowBusy === notice.id} disabled={!!rowBusy && rowBusy !== notice.id} onPress={() => void update(notice.id, 'unpin')} />
        </View>
      </NoticeItem>
    </View>)}</ListCard> : <ThemedText themeColor="textSecondary" style={Typography.supporting}>{tr('아직 걸려 있는 공지가 없어요.')}</ThemedText>}
    {!!state.scheduled?.length && <>
      <SectionLabel>{tr('예약한 공지 {0}개', state.scheduled.length)}</SectionLabel>
      <ListCard>{state.scheduled.map(item => <View key={item.id} style={styles.noticeRow}>
        <ThemedText style={Typography.label}>{new Date(item.sendAt).toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {tr(AUDIENCES.find(([value]) => value === item.audience)?.[1] ?? '')}</ThemedText>
        <ThemedText themeColor="textSecondary" numberOfLines={2} style={Typography.supporting}>{item.body}</ThemedText>
        <View style={styles.row}><ToggleChip analyticsId="meetup.notice.cancel" label={tr('예약 취소')} selected={false} busy={rowBusy === item.id} disabled={!!rowBusy && rowBusy !== item.id} onPress={() => void update(item.id, 'cancel')} /></View>
      </View>)}</ListCard>
    </>}
  </View>;
}

/** /meetup-tools schedule: open the next session by itself. Group meetups only; the host's Pro tier is checked by the server too. */
export function MeetupAutoNext({ postId }: { postId: string }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const { state, refresh } = useMeetupLoyalty(postId);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!state?.isHost || state.kind !== 'group') return null;
  const pro = tierAtLeast(state.hostTier, 'pro');
  const enabled = !!state.autoNext?.enabled, cadence = state.autoNext?.cadence ?? 'weekly';
  const save = async (next: boolean, nextCadence: 'weekly' | 'fortnightly') => {
    setBusy(true); setError('');
    try { await setMeetupAutoNext(supabase, postId, next, nextCadence); refresh(); }
    catch (failure) { setError(loyaltyError(failure)); play('warning'); }
    finally { setBusy(false); }
  };
  return <View>
    <SectionLabel>{tr('반복')}</SectionLabel>
    <ListCard>
      <ListRow title={tr('다음 회차 자동으로 열기')} detail={tr('끝나면 같은 요일, 같은 시간으로 열고 멤버와 팔로워에게 알려요.')}
        trailing={pro || enabled ? <Switch analyticsId="meetup.auto-next" accessibilityLabel={tr('다음 회차 자동으로 열기')} value={enabled} disabled={busy || (!pro && !enabled)} onValueChange={next => { play('selection'); void save(next, cadence); }} /> : <Tag label={tr('프로')} />} />
      {enabled && <View style={[styles.row, styles.rowPad]}>{(['weekly', 'fortnightly'] as const).map(value =>
        <SelectionChip key={value} analyticsId="meetup.auto-next.cadence" label={value === 'weekly' ? tr('매주') : tr('2주마다')} selected={cadence === value} disabled={busy} accessibilityRole="radio" accessibilityState={{ checked: cadence === value, disabled: busy }} baseColor={theme.backgroundElement}
          onPress={() => { play('selection'); void save(true, value); }} />)}</View>}
    </ListCard>
    {!!error && <ThemedText type="small" accessibilityRole="alert" themeColor="danger" style={styles.note}>{tr(error)}</ThemedText>}
  </View>;
}

/** /meetup-tools members. Every host sees who is in; attendance counts, notes, regulars and check-in staff are Pro. */
export function MeetupMemberList({ postId }: { postId: string }) {
  const { tr } = useLanguage();
  const { state } = useMeetupLoyalty(postId);
  const pro = tierAtLeast(state?.hostTier, 'pro');
  const known = !!state;
  const [names, setNames] = useState<MeetupHostIdentity[] | null>(null), [members, setMembers] = useState<RosterMember[] | null>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!known) return;
    let active = true;
    (pro ? loadMeetupRoster(supabase, postId).then(value => { if (active) { setMembers(value); setError(''); } })
      : loadMeetupHostRoster(supabase, postId).then(value => { if (active) { setNames(value.filter(person => !person.isHost)); setError(''); } }))
      .catch(failure => { if (active) setError(loyaltyError(failure, '명단을 불러오지 못했어요.')); });
    return () => { active = false; };
  }, [known, pro, postId, revision]);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  if (!state) return <ListLoading label={tr('불러오는 중이에요')} />;
  if (!state.isHost) return null;
  const count = pro ? members?.length : names?.length;
  const current = members?.find(member => member.userId === selected) ?? null;
  return <View>
    <SectionLabel>{count == null ? tr('참여 멤버') : tr('호스트 빼고 {0}명', count)}</SectionLabel>
    {!!error && <ThemedText type="small" accessibilityRole="alert" themeColor="danger">{tr(error)}</ThemedText>}
    {count === 0 && <ThemedText themeColor="textSecondary" style={Typography.supporting}>{tr('아직 승인한 멤버가 없어요.')}</ThemedText>}
    {!!count && <ListCard>
      {pro ? members?.map(member => <ListRow key={member.userId} analyticsId="meetup.roster.open" title={member.nickname} leading={<InitialAvatar name={member.nickname} />}
        detail={[tr('참석 {0}번', member.attended), member.attended >= REGULAR_ATTENDANCE ? tr('단골') : ''].filter(Boolean).join(' · ')}
        trailing={member.regular ? <Tag label={tr('정회원')} /> : undefined} onPress={() => setSelected(member.userId)} />)
        : names?.map(person => <ListRow key={person.userId} title={person.displayName || tr('모임 멤버')} leading={<InitialAvatar name={person.displayName || tr('모임 멤버')} />} />)}
    </ListCard>}
    {!pro && <ThemedText themeColor="textSecondary" style={[Typography.supporting, styles.note]}>{tr('참석 횟수, 단골, 나만 보는 메모, 정회원, 체크인 담당은 프로 멤버십부터 쓸 수 있어요.')}</ThemedText>}
    <MemberSheet key={selected ?? 'none'} postId={postId} member={current} onClose={() => setSelected(null)} onChanged={refresh} />
  </View>;
}

function MemberSheet({ postId, member, onClose, onChanged }: { postId: string; member: RosterMember | null; onClose: () => void; onChanged: () => void }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const [note, setNote] = useState(member?.note ?? ''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async (action: () => Promise<unknown>, done?: () => void) => {
    setBusy(true); setError('');
    try { await action(); onChanged(); done?.(); }
    catch (failure) { setError(loyaltyError(failure)); play('warning'); }
    finally { setBusy(false); }
  };
  return <DragSheet visible={!!member} onClose={onClose} dismissible={!busy} title={member?.nickname}>
    {member && <View style={styles.sheetList}>
      <ThemedText themeColor="textSecondary" style={Typography.supporting}>{tr('메모와 정회원 표시는 호스트에게만 보여요. 멤버에게는 알리지 않아요.')}</ThemedText>
      <View style={styles.listRow}><ThemedText style={[Typography.body, styles.flex]}>{tr('정회원')}</ThemedText>
        <Switch analyticsId="meetup.roster.regular" accessibilityLabel={tr('{0}님 정회원', member.nickname)} value={member.regular} disabled={busy}
          onValueChange={next => { play('selection'); void save(() => saveMemberNote(supabase, postId, member.userId, member.note, next)); }} /></View>
      <View style={styles.listRow}><ThemedText style={[Typography.body, styles.flex]}>{tr('체크인 담당 (최대 3명)')}</ThemedText>
        <Switch analyticsId="meetup.roster.staff" accessibilityLabel={tr('{0}님 체크인 담당', member.nickname)} value={member.staff} disabled={busy}
          onValueChange={next => { play('selection'); void save(() => setCheckinStaff(supabase, postId, member.userId, next)); }} /></View>
      <TextInput accessibilityLabel={tr('{0}님 메모', member.nickname)} placeholder={tr('나만 보는 메모')} placeholderTextColor={theme.textSecondary}
        multiline maxLength={500} editable={!busy} value={note} onChangeText={setNote}
        style={[ControlStyles.field, styles.input, { color: theme.text, borderColor: theme.line, backgroundColor: theme.background }]} />
      {!!error && <ThemedText type="small" accessibilityRole="alert" themeColor="danger">{tr(error)}</ThemedText>}
      <RaisedActionButton analyticsId="meetup.roster.note.save" label={tr('메모 저장')} busy={busy} disabled={note.trim() === member.note} onPress={() => { play('selection'); void save(() => saveMemberNote(supabase, postId, member.userId, note, member.regular), () => { play('success'); onClose(); }); }} />
    </View>}
  </DragSheet>;
}

const styles = StyleSheet.create({
  block: { gap: Spacing.two },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  rowPad: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
  roomTop: { marginHorizontal: Spacing.three, marginBottom: Spacing.two, borderRadius: 12, overflow: 'hidden' },
  nextLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 52, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one },
  boardLine: { borderTopWidth: StyleSheet.hairlineWidth }, boardLineInset: { marginHorizontal: Spacing.three },
  roomTopClay: { marginHorizontal: Spacing.three, marginBottom: Spacing.two }, roomTopRows: { borderRadius: 16, overflow: 'hidden' },
  noticePage: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44, paddingHorizontal: Spacing.three },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.one, paddingBottom: Spacing.one },
  pageDot: { width: 5, height: 5, borderRadius: 3 },
  sheetScroll: { flexShrink: 1 },
  sheetList: { gap: Spacing.three, paddingBottom: Spacing.three },
  noticeItem: { gap: Spacing.one },
  noticeRow: { padding: Spacing.three, gap: Spacing.one },
  clayPill: { overflow: 'visible', paddingHorizontal: 18 }, clayMore: { overflow: 'visible', paddingHorizontal: 18, alignSelf: 'flex-start' },
  more: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  send: { marginTop: Spacing.three },
  note: { marginTop: Spacing.two },
  input: { minHeight: 88, paddingTop: Spacing.two, textAlignVertical: 'top' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 },
  flex: { flex: 1, minWidth: 0 },
});
