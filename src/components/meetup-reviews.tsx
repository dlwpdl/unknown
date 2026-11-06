import { FlatPressable as Pressable } from '@/components/flat-pressable';
import { useRouter } from 'expo-router';
import { useLanguage } from '@/hooks/use-language';
import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, TextInput, View } from 'react-native';
import { Disclosure } from '@/components/disclosure';
import { InitialAvatar, ListCard, ListLoading, ListRow, SectionLabel, Tag } from '@/components/list-card';
import { MannerReviewButton } from '@/components/manner-review';
import { MeetupHostTools } from '@/components/meetup-host-tools';
import { MeetupRsvp } from '@/components/meetup-rsvp';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ClayBoxFill, ClayControlFill, ClayPillFill, useClay, useClayBox } from '@/components/clay';
import { ReportSheet } from '@/components/report-sheet';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles, Typography, controlPresentation } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { focusSession, inAttendanceWindow, sessionRange, upcomingSessions } from '@/lib/meetup-host-home';
import { loadMeetupLoyalty, staffCheckIn, tierAtLeast } from '@/lib/meetup-loyalty';
import { checkInMeetup, claimMeetupAttendance, confirmMeetupAttendance, createMeetupSession, loadMeetupReviews, loadMeetupSessions, writeMeetupReview, type MeetupReviewPage, type MeetupSessions, type MeetupSession } from '@/lib/meetup-reviews';
import { askForStoreReviewSoon } from '@/lib/store-review';
import { supabase } from '@/lib/supabase';

// reviewsOnly: the meetup detail shows published reviews; host tools and attendance live on /meetup-tools.
export function MeetupReviews(props: { postId: string; kind: 'once' | 'group'; attendanceOnly?: boolean; reviewsOnly?: boolean; onBeforeNavigate?: () => void; sessionId?: string }) {

  const { isAuthed, me } = useAuth();
  return <Reviews key={`${isAuthed ? me.id : 'guest'}:${props.postId}`} {...props} />;
}
function Reviews({ postId, kind, attendanceOnly = false, reviewsOnly = false, onBeforeNavigate, sessionId }: { postId: string; kind: 'once' | 'group'; attendanceOnly?: boolean; reviewsOnly?: boolean; onBeforeNavigate?: () => void; sessionId?: string }) {
  const { tr, locale: appLocale } = useLanguage();
  const theme = useTheme(), clay = useClay(), clayBox = useClayBox(), { isAuthed, me } = useAuth(), { play } = useInteractionFeedback();
  const router = useRouter();
  const hidden = useContentVisibility();
  const [page, setPage] = useState<MeetupReviewPage | null>(null), [sessions, setSessions] = useState<MeetupSessions | null>(null);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0), [busy, setBusy] = useState(false), pending = useRef(false);
  const [canStaffCheckIn, setCanStaffCheckIn] = useState(false), [loaded, setLoaded] = useState(false);
  const [report, setReport] = useState<MeetupReviewPage['reviews'][number] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!sessions?.member) return;
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [sessions?.member]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [next, participation, loyalty] = await Promise.all([kind === 'group' && !attendanceOnly ? loadMeetupReviews(supabase, postId) : null, isAuthed && !reviewsOnly ? loadMeetupSessions(supabase, postId) : null,
          isAuthed && attendanceOnly ? loadMeetupLoyalty(supabase, postId).catch(() => null) : null]);
        if (active) { setPage(next); setSessions(participation); setCanStaffCheckIn(!!loyalty && (loyalty.isStaff || (loyalty.isHost && tierAtLeast(loyalty.hostTier, 'pro')))); setNow(Date.now()); setError(''); setLoaded(true); }
      } catch { if (active) { setError("모임 후기·참석 정보를 불러오지 못했어요."); setLoaded(true); } }
    })();
    return () => { active = false; };
  }, [postId, kind, attendanceOnly, reviewsOnly, isAuthed, retry]);
  async function create() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); play('selection');
    try { await createMeetupSession(supabase, postId); setRetry(n => n + 1); play('success'); }
    catch (failure) {
      const code = (failure as Error)?.message;
      setError(code === 'INVALID_SESSION_TIME' ? "종료 시간은 시작 이후여야 해요" : code === 'SESSION_OVERLAP' ? "같은 시간에 이미 등록된 회차가 있어요. 다른 시간을 골라주세요." : "회차를 확인하지 못했어요. 시간·중복 회차·참가 권한을 확인해주세요."); play('warning');
    }
    finally { pending.current = false; setBusy(false); }
  }
  async function more() {
    if (!page || pending.current) return;
    pending.current = true; setBusy(true); play('selection');
    try { const next = await loadMeetupReviews(supabase, postId, page.reviews.length); setPage(current => current ? { ...next, reviews: [...current.reviews, ...next.reviews.filter(r => !current.reviews.some(old => old.id === r.id))] } : next); }
    catch { setError("이전 후기를 불러오지 못했어요."); play('warning'); }
    finally { pending.current = false; setBusy(false); }
  }
  const button = [styles.button, clay ? styles.clayButton : { borderColor: theme.line, backgroundColor: theme.backgroundElement }];
  const fill = clay && <ClayPillFill kind="white" />;
  return <View style={styles.container}>
    {isAuthed && !reviewsOnly && !sessionId && <MeetupHostTools postId={postId} sections={['role', 'waitlist']} onChanged={() => setRetry(value => value + 1)} />}
    {!loaded && <ListLoading label={tr('불러오는 중이에요')} />}
    {kind === 'group' && !attendanceOnly && <>
      {page && <ThemedText type="small" themeColor={page.participants ? undefined : 'textSecondary'}>{page.participants ? tr("{0}/10 · 서로 다른 {1}명", (page.score), (page.participants)) : tr("아직 후기가 없어요.")}</ThemedText>}
      {page?.reviews.filter(review => !hidden('meetup_review', review.id, review.authorId)).map(review => <View key={review.id} style={[styles.review, clayBox ? styles.clayCard : { borderColor: theme.line }]}>{clayBox && <ClayBoxFill kind="tile" />}
        <Pressable accessibilityRole="button" accessibilityLabel={tr("{0} 모임 프로필", review.nickname)} disabled={!isAuthed} style={button} onPress={() => { play('selection'); onBeforeNavigate?.(); router.push({ pathname: '/meetup-profile', params: { postId, userId: review.authorId } }); }}>{fill}<ThemedText type="smallBold">{review.nickname} · {review.score}/10</ThemedText></Pressable>
        <ThemedText type="small" themeColor="textSecondary">{tr('{0} 참석 후기', new Date(review.sessionDate).toLocaleDateString(appLocale))}</ThemedText>
        {!!review.body && <ThemedText type="small">{review.body}</ThemedText>}
        {isAuthed && review.authorId !== me.id && <Pressable accessibilityRole="button" onPress={() => { play('selection'); setReport(review); }} style={button}>{fill}<ThemedText type="small">{tr("후기 신고")}</ThemedText></Pressable>}
      </View>)}
      {!!page && page.reviews.length > 0 && page.reviews.length % 20 === 0 && <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => void more()} style={button}>{fill}<ThemedText type="small">{tr("이전 후기 더 보기")}</ThemedText></Pressable>}
    </>}
    {sessions?.member && <Attendance sessions={sessions} kind={kind} postId={postId} meId={me.id} now={now} sessionId={sessionId} canStaffCheckIn={canStaffCheckIn} busy={busy} onCreate={() => void create()} onChanged={() => setRetry(n => n + 1)} />}
    {!!error && <><ThemedText type="small" accessibilityRole="alert">{tr(error)}</ThemedText><Pressable accessibilityRole="button" onPress={() => { play('selection'); setRetry(n => n + 1); }} style={button}>{fill}<ThemedText type="small">{tr("다시 불러오기")}</ThemedText></Pressable></>}
    {report && <ReportSheet visible targetType="meetup_review" targetId={report.id} reportedUserId={report.authorId} reportedNickname={report.nickname} onClose={() => { setReport(null); setRetry(n => n + 1); }} />}
  </View>;
}
function Attendance({ sessions, kind, postId, meId, now, sessionId, canStaffCheckIn, busy, onCreate, onChanged }: { sessions: MeetupSessions; kind: 'once' | 'group'; postId: string; meId: string; now: number; sessionId?: string; canStaffCheckIn: boolean; busy: boolean; onCreate: () => void; onChanged: () => void }) {
  const { tr, locale } = useLanguage();
  const router = useRouter();
  const focus = sessionId ? sessions.sessions.find(session => session.id === sessionId) ?? null : focusSession(sessions.sessions, now);
  const others = sessionId ? [] : sessions.sessions.filter(session => session.id !== focus?.id);
  const upcoming = focus ? upcomingSessions([focus], now)[0] : null;
  if (!focus) return kind === 'once' && !sessionId
    ? <RaisedActionButton analyticsId="meetup.attendance.open" label={tr("이번 모임 참석 확인 열기")} busy={busy} onPress={onCreate} />
    : <ThemedText themeColor="textSecondary" style={Typography.body}>{tr('아직 등록된 회차가 없어요.')}</ThemedText>;
  return <View>
    <Session key={focus.id} now={now} session={focus} meId={meId} kind={kind} isHost={sessions.isHost} canStaffCheckIn={canStaffCheckIn} onChanged={onChanged} />
    {upcoming && Date.parse(focus.startsAt) > now && <MeetupRsvp postId={postId} />}
    {others.length > 0 && <>
      <SectionLabel>{tr('다른 회차')}</SectionLabel>
      <ListCard>{others.map(session => <ListRow key={session.id} analyticsId="meetup.attendance.session" title={new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(session.startsAt))}
        detail={session.verified ? tr("참석 확인됨") : session.checkedIn ? tr("체크인 완료") : sessionRange(session, locale)}
        onPress={() => router.push({ pathname: '/meetup-tools', params: { postId, kind, host: sessions.isHost ? '1' : '0', section: 'session', sessionId: session.id } })} />)}</ListCard>
    </>}
  </View>;
}

function Steps({ current, last }: { current: number; last: string }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const names = [tr('체크인'), tr('서로 확인'), last];
  return <View accessible accessibilityRole="text" accessibilityLabel={tr('진행 단계: {0}', names[Math.min(current, 2)])} style={styles.steps}>
    {names.map((name, index) => <View key={name} style={styles.step}>
      <View style={[styles.stepBar, { backgroundColor: index <= current ? theme.accent : theme.backgroundElement }]} />
      <ThemedText style={Typography.caption} themeColor={index === current ? undefined : 'textSecondary'}>{name}</ThemedText>
    </View>)}
  </View>;
}

function ScoreStepper({ score, disabled, onChange }: { score: number; disabled: boolean; onChange: (value: number) => void }) {
  const { tr } = useLanguage();
  const theme = useTheme(), clay = useClay(), { play } = useInteractionFeedback();
  const step = (label: string, glyph: string, next: number) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled || next < 1 || next > 10} accessibilityState={{ disabled: disabled || next < 1 || next > 10 }}
    onPress={() => { play('selection'); onChange(next); }} style={({ pressed }) => [ControlStyles.icon, styles.stepButton, controlPresentation(theme, { pressed, disabled: disabled || next < 1 || next > 10, clay }).container, clay && styles.clayVisible]}>
    {clay && <ClayControlFill />}
    <ThemedText style={Typography.menu}>{glyph}</ThemedText>
  </Pressable>;
  return <View accessible={false} style={styles.rate}>
    {step(tr('0.5점 내리기'), '−', score - 0.5)}
    <View style={styles.stars} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 1, 2, 3, 4].map(index => <View key={index} style={styles.star}>
        <ThemedText style={[styles.starGlyph, { color: theme.line }]}>✦</ThemedText>
        <View style={[styles.starFill, { width: `${Math.max(0, Math.min(1, (score - index * 2) / 2)) * 100}%` }]}><ThemedText style={[styles.starGlyph, { color: theme.accent }]}>✦</ThemedText></View>
      </View>)}
    </View>
    <ThemedText accessibilityLiveRegion="polite" accessibilityLabel={tr("{0}점", score)} style={[Typography.label, styles.score]}>{score}/10</ThemedText>
    {step(tr('0.5점 올리기'), '+', score + 0.5)}
  </View>;
}

function Session({ session, meId, kind, isHost, canStaffCheckIn, onChanged, now }: { session: MeetupSession; meId: string; kind: 'once' | 'group'; isHost: boolean; canStaffCheckIn: boolean; onChanged: () => void; now: number }) {
  const { tr, locale: appLocale } = useLanguage();
  const theme = useTheme(), clayBox = useClayBox(), { play } = useInteractionFeedback(), router = useRouter();
  const [busy, setBusy] = useState(false), pending = useRef(false), [notice, setNotice] = useState('');
  const [claim, setClaim] = useState(''), [body, setBody] = useState('');
  const [score, setScore] = useState(8), [submitted, setSubmitted] = useState(false), [staffBusy, setStaffBusy] = useState('');
  const start = Date.parse(session.startsAt), end = Date.parse(session.endsAt), started = now >= start, ended = now >= end, inWindow = inAttendanceWindow(session, now);
  const others = session.members.filter(member => member.id !== meId), arrived = others.filter(member => member.checkedIn).length;
  async function act(action: () => Promise<unknown>, message: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setNotice(''); play('selection');
    try { await action(); setNotice(message); play('success'); onChanged(); }
    catch { setNotice(tr("처리 결과를 확인하지 못했어요. 입력은 유지했어요. 최신 참석 정보를 다시 확인해주세요.")); play('warning'); }
    finally { pending.current = false; setBusy(false); }
  }
  function confirm(userId: string, nickname: string) {
    play('selection');
    const save = () => void act(() => confirmMeetupAttendance(supabase, session.id, userId), tr("확인을 저장했어요. 상대의 확인을 기다려주세요."));
    if (Platform.OS === 'web') { if (globalThis.confirm(tr("{0}님을 실제 현장에서 만났을 때만 확인해주세요. 상대의 확인도 있어야 참석이 확인됩니다.", (nickname)))) save(); return; }
    Alert.alert(tr("같은 회차에 함께했나요?"), tr("{0}님을 실제 현장에서 만났을 때만 확인해주세요. 상대의 확인도 있어야 참석이 확인됩니다.", (nickname)), [
      { text: tr("취소"), style: 'cancel', onPress: () => play('selection') },
      { text: tr("현장에서 만났어요"), onPress: save },
    ]);
  }
  const checkIn = async (attendeeId: string) => {
    if (staffBusy) return;
    setStaffBusy(attendeeId); setNotice(''); play('selection');
    try { await staffCheckIn(supabase, session.id, attendeeId); play('reaction'); onChanged(); }
    catch { setNotice(tr('체크인하지 못했어요.')); play('warning'); }
    finally { setStaffBusy(''); }
  };
  const reasonMissing = score <= 5 && body.trim().length < 10;
  const stage = !ended ? 0 : !session.verified ? 1 : session.reviewStatus || submitted ? 3 : 2;
  const card = (title: string, detail?: string) => <View style={[styles.card, clayBox ? styles.clayCard : { backgroundColor: theme.card, borderColor: theme.line }]}>{clayBox && <ClayBoxFill kind="tile" />}<ThemedText style={Typography.menu}>{title}</ThemedText>{!!detail && <ThemedText themeColor="textSecondary" style={Typography.supporting}>{detail}</ThemedText>}</View>;
  return <View style={styles.session}>
    <View>
      <ThemedText accessibilityRole="header" style={Typography.sheetTitle}>{new Intl.DateTimeFormat(appLocale, { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(session.startsAt))}</ThemedText>
      <ThemedText themeColor="textSecondary" style={Typography.supporting}>{sessionRange(session, appLocale)}</ThemedText>
    </View>
    {(!ended || inWindow || session.verified) && <Steps current={stage} last={kind === 'once' ? tr('매너 평가') : tr('후기')} />}
    {!started && card(tr('체크인은 모임 시작부터 열려요'), new Date(session.startsAt).toLocaleTimeString(appLocale, { hour: 'numeric', minute: '2-digit' }))}
    {started && !ended && (session.checkedIn ? card(tr('체크인했어요'), tr('끝나고 함께한 분을 서로 확인해 주세요.'))
      : <RaisedActionButton analyticsId="meetup.attendance.check-in" label={tr("현장 체크인")} busy={busy} onPress={() => void act(async () => { await checkInMeetup(supabase, session.id); askForStoreReviewSoon(); }, tr("체크인했어요. 끝나고 서로 참석을 확인해 주세요."))} />)}
    {started && !ended && <View>
      <ThemedText style={Typography.body}>{tr('{0}명 중 {1}명 왔어요', others.length, arrived)}</ThemedText>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.bar, { backgroundColor: theme.backgroundElement }]}><View style={[styles.barFill, { backgroundColor: theme.accent, width: `${others.length ? arrived / others.length * 100 : 0}%` }]} /></View>
      {others.length > 0 && <ListCard>{others.map(member => <ListRow key={member.id} title={member.nickname} leading={<InitialAvatar name={member.nickname} />}
        trailing={member.checkedIn ? <Tag label={tr('왔어요')} /> : canStaffCheckIn ? <ReviewPill label={tr('체크인')} onPress={() => void checkIn(member.id)} accessibilityLabel={tr('{0}님이 왔다고 표시해요', member.nickname)} selected blocked={!!staffBusy} /> : <Tag label={tr('아직')} tone="quiet" />} />)}</ListCard>}
      {isHost && !canStaffCheckIn && <View style={styles.gapTop}><ListCard><ListRow analyticsId="meetup.automation.membership" title={tr('호스트가 대신 체크인하기')} detail={tr('멤버는 각자 화면에서 체크인할 수 있어요.')} trailing={<Tag label={tr('프로')} />} onPress={() => router.push('/profile/membership')} /></ListCard></View>}
    </View>}
    {ended && !inWindow && card(session.verified ? tr("참석 확인됨") : tr('확인 기간이 끝났어요'), tr('참석 확인은 끝나고 7일 안에 할 수 있어요.'))}
    {inWindow && others.length > 0 && <View>
      <SectionLabel>{session.checkedIn ? tr('함께한 분을 확인해 주세요') : tr('이 회차에 온 분')}</SectionLabel>
      <ListCard>{others.map(member => <View key={member.id}>
        <ListRow title={member.nickname} leading={<InitialAvatar name={member.nickname} />} detail={member.verified ? tr("참석 확인됨") : member.confirmedByMe ? tr('확인했어요. 상대 확인을 기다려요.') : member.checkedIn ? tr('체크인함') : tr('체크인 안 함')}
          trailing={session.checkedIn && member.checkedIn && !member.confirmedByMe ? <ReviewPill label={tr('만났어요')} onPress={() => confirm(member.id, member.nickname)} accessibilityLabel={tr('{0}님 참석 확인', member.nickname)} blocked={busy} /> : member.confirmedByMe ? <Tag label={tr('확인함')} /> : undefined} />
        {session.verified && member.verified && <View style={styles.manner}><MannerReviewButton subjectId={member.id} nickname={member.nickname} context={{ sessionId: session.id }} /></View>}
      </View>)}</ListCard>
    </View>}
    {session.canReview && !session.reviewStatus && !submitted && <View style={[styles.card, clayBox ? styles.clayCard : { backgroundColor: theme.card, borderColor: theme.line }]}>{clayBox && <ClayBoxFill kind="tile" />}
      <ThemedText accessibilityRole="header" style={Typography.menu}>{tr("이 회차 후기")}</ThemedText>
      <ScoreStepper score={score} disabled={busy} onChange={setScore} />
      <TextInput accessibilityLabel={tr("공개 모임 후기")} value={body} editable={!busy} onChangeText={setBody} onFocus={() => play('selection')} multiline maxLength={300} placeholder={tr("운영·분위기·설명과 같았는지 알려주세요. 개인을 비난하거나 개인정보를 적지 마세요.")} placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, borderColor: theme.line }]} />
      {reasonMissing && <ThemedText themeColor="textSecondary" style={Typography.supporting}>{tr('5점 이하는 이유를 10자 이상 적어 주세요.')}</ThemedText>}
      <RaisedActionButton analyticsId="meetup.review.submit" label={tr("후기 내기")} busy={busy} disabled={reasonMissing} onPress={() => void act(async () => { await writeMeetupReview(supabase, session.id, score, body); setSubmitted(true); if (score >= 4) askForStoreReviewSoon(); }, tr("후기를 냈어요. 검토 후 모임에 반영돼요."))} />
    </View>}
    {!!session.reviewStatus && card(session.reviewStatus === 'published' ? tr('이 회차 후기는 반영되었어요.') : tr('이 회차 후기는 제출했어요. 검토 상태에 따라 공개돼요.'))}
    {session.claimStatus === 'pending' && card(tr("운영팀이 참석 확인 이의제기를 검토 중이에요."))}
    {!!notice && <ThemedText type="small" accessibilityLiveRegion="polite" themeColor="textSecondary">{notice}</ThemedText>}
    {inWindow && !session.verified && session.claimStatus === 'none' && <Disclosure analyticsId="meetup.attendance.claim" title={tr('갔는데 확인을 못 받았나요')}>
      <ThemedText themeColor="textSecondary" style={Typography.supporting}>{tr('회차와 함께한 상황을 적어 보내면 운영팀이 검토해요. 자동으로 인증되지는 않아요.')}</ThemedText>
      <TextInput accessibilityLabel={tr("참석 확인 이의제기")} value={claim} editable={!busy} onChangeText={setClaim} onFocus={() => play('selection')} multiline maxLength={1000} placeholder={tr("회차와 함께한 상황을 구체적으로 적어주세요. 불필요한 개인정보는 제외해주세요. (10자 이상)")} placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, borderColor: theme.line }]} />
      <RaisedActionButton analyticsId="meetup.attendance.claim-send" tone="secondary" label={tr("참석 검토 요청")} busy={busy} disabled={claim.trim().length < 10} onPress={() => void act(() => claimMeetupAttendance(supabase, session.id, claim), tr("운영팀에 참석 검토를 요청했어요. 자동으로 참석 인증되지 않아요."))} />
    </Disclosure>}
    <Disclosure analyticsId="meetup.attendance.how" title={tr('참석 확인은 어떻게 되나요')}>
      <ThemedText themeColor="textSecondary" style={Typography.supporting}>{tr('실제로 함께한 회차만 확인해 주세요. 체크인만으로는 후기나 매너 평가를 쓸 수 없고, 서로 확인하거나 운영팀 검토를 받아야 해요.')}</ThemedText>
    </Disclosure>
  </View>;
}
function ReviewPill({ label, onPress, accessibilityLabel, selected = false, blocked = false }: { label: string; onPress: () => void; accessibilityLabel: string; selected?: boolean; blocked?: boolean }) {
  const theme = useTheme(), clay = useClay();
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={blocked} accessibilityState={{ disabled: blocked }} onPress={onPress}
    style={({ pressed }) => [ControlStyles.pill, styles.pillBorder, controlPresentation(theme, { selected, pressed, disabled: blocked, clay }).container, clay && styles.clayPill]}>{clay && <ClayControlFill selected={selected} />}<ThemedText type="smallBold" style={controlPresentation(theme, { selected }).text}>{label}</ThemedText></Pressable>;
}

const styles = StyleSheet.create({ container: { gap: 12, marginVertical: 8 }, review: { gap: 8, padding: 12, borderWidth: 1, borderRadius: 12 },
  button: { minHeight: 44, minWidth: 44, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 80, textAlignVertical: 'top' },
  session: { gap: Spacing.three }, card: { gap: Spacing.one, padding: Spacing.three, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16 },
  steps: { flexDirection: 'row', gap: Spacing.one }, step: { flex: 1, gap: Spacing.one }, stepBar: { height: 4, borderRadius: 2 },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden', marginVertical: Spacing.two }, barFill: { height: 6, borderRadius: 3 },
  clayCard: { borderColor: 'transparent', overflow: 'visible' }, clayButton: { overflow: 'visible', paddingHorizontal: 18, borderWidth: 0 }, clayVisible: { overflow: 'visible' }, clayPill: { overflow: 'visible', paddingHorizontal: 18 },
  pillBorder: { borderWidth: 1 }, gapTop: { marginTop: Spacing.two }, manner: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
  rate: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginVertical: Spacing.two }, stepButton: { borderWidth: 1 },
  stars: { flexDirection: 'row', flex: 1, justifyContent: 'center', gap: 2 }, star: { width: 24, height: 28 }, starGlyph: { fontSize: 22, lineHeight: 28, width: 24, textAlign: 'center' },
  starFill: { position: 'absolute', top: 0, left: 0, height: 28, overflow: 'hidden' }, score: { minWidth: 42, textAlign: 'right' },
});
