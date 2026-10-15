import { LensPressable as Pressable } from '@/components/lens-pressable';
import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';
import { ChillingDateInput } from '@/components/chilling-date-input';
import { MannerReviewButton } from '@/components/manner-review';
import { ReportSheet } from '@/components/report-sheet';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { checkInMeetup, claimMeetupAttendance, confirmMeetupAttendance, createMeetupSession, loadMeetupReviews, loadMeetupSessions, writeMeetupReview, type MeetupReviewPage, type MeetupSessions, type MeetupSession } from '@/lib/meetup-reviews';
import { supabase } from '@/lib/supabase';

export function MeetupReviews(props: { postId: string; kind: 'once' | 'group'; attendanceOnly?: boolean }) {
  const { isAuthed, me } = useAuth();
  return <Reviews key={`${isAuthed ? me.id : 'guest'}:${props.postId}`} {...props} />;
}
function Reviews({ postId, kind, attendanceOnly = false }: { postId: string; kind: 'once' | 'group'; attendanceOnly?: boolean }) {
  const theme = useTheme(), { isAuthed, me } = useAuth(), { play } = useInteractionFeedback();
  const hidden = useContentVisibility();
  const [page, setPage] = useState<MeetupReviewPage | null>(null), [sessions, setSessions] = useState<MeetupSessions | null>(null);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0), [busy, setBusy] = useState(false), pending = useRef(false);
  const [startsAt, setStartsAt] = useState(() => new Date(Date.now() + 86400000).toISOString());
  const [endsAt, setEndsAt] = useState(() => new Date(Date.now() + 93600000).toISOString());
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
        const [next, participation] = await Promise.all([kind === 'group' && !attendanceOnly ? loadMeetupReviews(supabase, postId) : null, isAuthed ? loadMeetupSessions(supabase, postId) : null]);
        if (active) { setPage(next); setSessions(participation); setNow(Date.now()); setError(''); }
      } catch { if (active) setError('모임 후기·참석 정보를 불러오지 못했어요.'); }
    })();
    return () => { active = false; };
  }, [postId, kind, attendanceOnly, isAuthed, retry]);
  async function create() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); play('selection');
    try { await createMeetupSession(supabase, postId, kind === 'group' ? startsAt : undefined, kind === 'group' ? endsAt : undefined); setRetry(n => n + 1); play('success'); }
    catch { setError('회차를 확인하지 못했어요. 시간·중복 회차·참가 권한을 확인해주세요.'); play('warning'); }
    finally { pending.current = false; setBusy(false); }
  }
  async function more() {
    if (!page || pending.current) return;
    pending.current = true; setBusy(true); play('selection');
    try { const next = await loadMeetupReviews(supabase, postId, page.reviews.length); setPage(current => current ? { ...next, reviews: [...current.reviews, ...next.reviews.filter(r => !current.reviews.some(old => old.id === r.id))] } : next); }
    catch { setError('이전 후기를 불러오지 못했어요.'); play('warning'); }
    finally { pending.current = false; setBusy(false); }
  }
  const button = [styles.button, { borderColor: theme.line, backgroundColor: theme.backgroundElement }];
  return <View style={styles.container}>
    {kind === 'group' && !attendanceOnly && <>
      <ThemedText type="subtitle">참석자가 남긴 모임 후기</ThemedText>
      <ThemedText type="small">{page?.participants ? `${page.score}/10 · 서로 다른 ${page.participants}명` : '참석 확인된 후기를 기다리고 있어요.'}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">회차별 후기는 모임에 쌓이고, 같은 사람의 반복 참여는 평점을 여러 번 올리지 않아요.</ThemedText>
      {page?.reviews.filter(review => !hidden('meetup_review', review.id, review.authorId)).map(review => <View key={review.id} style={[styles.review, { borderColor: theme.line }]}>
        <ThemedText type="smallBold">{review.nickname} · {review.score}/10</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{new Date(review.sessionDate).toLocaleDateString('ko-KR')} 참석 후기</ThemedText>
        {!!review.body && <ThemedText type="small">{review.body}</ThemedText>}
        {isAuthed && review.authorId !== me.id && <Pressable accessibilityRole="button" onPress={() => { play('selection'); setReport(review); }} style={button}><ThemedText type="small">후기 신고</ThemedText></Pressable>}
      </View>)}
      {!!page && page.reviews.length > 0 && page.reviews.length % 20 === 0 && <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => void more()} style={button}><ThemedText type="small">이전 후기 더 보기</ThemedText></Pressable>}
    </>}
    {sessions?.member && <>
      <ThemedText type="smallBold">회차별 참석 확인 · {kind === 'once' ? '개인 매너 평가' : '후기·매너 평가'}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">실제로 함께한 회차만 확인해주세요. 체크인만으로 평가 권한이 생기지 않아요. 상호 확인 또는 운영팀 검토가 필요해요.</ThemedText>
      {kind === 'group' && sessions.isHost && <>
        <ChillingDateInput label="이번 회차 시작" value={startsAt} onChange={setStartsAt} disabled={busy} />
        <ChillingDateInput label="이번 회차 종료" value={endsAt} onChange={setEndsAt} disabled={busy} />
        <ThemedText type="small" themeColor="textSecondary">내 기기 시간 · {Intl.DateTimeFormat().resolvedOptions().timeZone}</ThemedText>
        <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => void create()} style={button}><ThemedText type="smallBold">{busy ? '등록 확인 중…' : '회차 등록'}</ThemedText></Pressable>
      </>}
      {kind === 'once' && sessions.sessions.length === 0 && <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => void create()} style={button}><ThemedText type="smallBold">이번 모임 참석 확인 열기</ThemedText></Pressable>}
      {sessions.sessions.map(session => <Session key={session.id} now={now} session={session} meId={me.id} onChanged={() => setRetry(n => n + 1)} />)}
      <Pressable accessibilityRole="button" onPress={() => { play('selection'); setRetry(n => n + 1); }} style={button}><ThemedText type="small">참석·후기 상태 다시 확인</ThemedText></Pressable>
    </>}
    {!!error && <><ThemedText type="small" accessibilityRole="alert">{error}</ThemedText><Pressable accessibilityRole="button" onPress={() => { play('selection'); setRetry(n => n + 1); }} style={button}><ThemedText type="small">다시 불러오기</ThemedText></Pressable></>}
    {report && <ReportSheet visible targetType="meetup_review" targetId={report.id} reportedUserId={report.authorId} reportedNickname={report.nickname} onClose={() => { setReport(null); setRetry(n => n + 1); }} />}
  </View>;
}
function Session({ session, meId, onChanged, now }: { session: MeetupSession; meId: string; onChanged: () => void; now: number }) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [busy, setBusy] = useState(false), pending = useRef(false), [notice, setNotice] = useState('');
  const [claim, setClaim] = useState(''), [claimOpen, setClaimOpen] = useState(false), [body, setBody] = useState('');
  const [score, setScore] = useState<number | null>(null), [submitted, setSubmitted] = useState(false);
  const end = Date.parse(session.endsAt), ended = now >= end, inWindow = ended && now < end + 7 * 86400000;
  const button = [styles.button, { borderColor: theme.line, backgroundColor: theme.backgroundElement }];
  async function act(action: () => Promise<unknown>, message: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setNotice(''); play('selection');
    try { await action(); setNotice(message); play('success'); onChanged(); }
    catch { setNotice('처리 결과를 확인하지 못했어요. 입력은 유지했어요. 최신 참석 정보를 다시 확인해주세요.'); play('warning'); }
    finally { pending.current = false; setBusy(false); }
  }
  function confirm(userId: string, nickname: string) {
    play('selection');
    Alert.alert('같은 회차에 함께했나요?', `${nickname}님을 실제 현장에서 만났을 때만 확인해주세요. 상대의 확인도 있어야 참석이 확인됩니다.`, [
      { text: '취소', style: 'cancel', onPress: () => play('selection') },
      { text: '현장에서 만났어요', onPress: () => void act(() => confirmMeetupAttendance(supabase, session.id, userId), '확인을 저장했어요. 상대의 확인을 기다려주세요.') },
    ]);
  }
  return <View style={[styles.review, { borderColor: theme.line }]}>
    <ThemedText type="smallBold">{new Date(session.startsAt).toLocaleString('ko-KR')} ~ {new Date(session.endsAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</ThemedText>
    <ThemedText type="small">{session.verified ? '참석 확인됨' : session.checkedIn ? '체크인 완료 · 참석 확인 대기' : '참석 미확인'}</ThemedText>
    {!ended && now >= Date.parse(session.startsAt) && !session.checkedIn && <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => void act(() => checkInMeetup(supabase, session.id), '체크인했어요. 종료 후 서로 참석을 확인해주세요.')} style={button}><ThemedText type="smallBold">현장 체크인</ThemedText></Pressable>}
    {inWindow && session.members.filter(member => member.id !== meId).map(member => <View key={member.id} style={styles.container}>
      <ThemedText type="small">{member.nickname} · {member.verified ? '참석 확인됨' : '참석 확인 대기'}</ThemedText>
      {session.checkedIn && member.checkedIn && !member.confirmedByMe && <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => confirm(member.id, member.nickname)} style={button}><ThemedText type="small">{member.nickname} 참석 확인</ThemedText></Pressable>}
      {session.verified && member.verified && <MannerReviewButton subjectId={member.id} nickname={member.nickname} context={{ sessionId: session.id }} />}
    </View>)}
    {inWindow && !session.verified && session.claimStatus === 'none' && <>
      <Pressable accessibilityRole="button" onPress={() => { play('selection'); setClaimOpen(value => !value); }} style={button}><ThemedText type="small">실제 참석했지만 확인을 못 받았나요?</ThemedText></Pressable>
      {claimOpen && <>
        <TextInput accessibilityLabel="참석 확인 이의제기" value={claim} editable={!busy} onChangeText={setClaim} onFocus={() => play('selection')} multiline maxLength={1000} placeholder="회차와 함께한 상황을 구체적으로 적어주세요. 불필요한 개인정보는 제외해주세요. (10자 이상)" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, borderColor: theme.line }]} />
        <Pressable accessibilityRole="button" disabled={busy || claim.trim().length < 10} accessibilityState={{ disabled: busy || claim.trim().length < 10 }} onPress={() => void act(() => claimMeetupAttendance(supabase, session.id, claim), '운영팀에 참석 검토를 요청했어요. 자동으로 참석 인증되지 않아요.')} style={button}><ThemedText type="smallBold">참석 검토 요청</ThemedText></Pressable>
      </>}
    </>}
    {session.claimStatus === 'pending' && <ThemedText type="small">운영팀이 참석 확인 이의제기를 검토 중이에요.</ThemedText>}
    {session.canReview && !session.reviewStatus && !submitted && <>
      <ThemedText type="smallBold">이 회차의 모임 후기 · 10점 만점</ThemedText>
      <View accessibilityRole="radiogroup" style={styles.row}>{Array.from({ length: 19 }, (_, i) => 1 + i / 2).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={`${value}점`} accessibilityState={{ selected: score === value, disabled: busy }} disabled={busy} onPress={() => { play('selection'); setScore(value); }} style={[button, score === value && { borderColor: theme.accent }]}><ThemedText type="small">{value}</ThemedText></Pressable>)}</View>
      <TextInput accessibilityLabel="공개 모임 후기" value={body} editable={!busy} onChangeText={setBody} onFocus={() => play('selection')} multiline maxLength={300} placeholder="운영·분위기·설명과 같았는지 알려주세요. 개인을 비난하거나 개인정보를 적지 마세요." placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, borderColor: theme.line }]} />
      <Pressable accessibilityRole="button" disabled={busy || score === null || (score <= 5 && body.trim().length < 10)} accessibilityState={{ disabled: busy || score === null || (score <= 5 && body.trim().length < 10) }} style={button}
        onPress={() => void act(async () => { await writeMeetupReview(supabase, session.id, score!, body); setSubmitted(true); }, '후기를 제출했어요. 검토 후 모임에 반영됩니다.')}><ThemedText type="smallBold">후기 제출</ThemedText></Pressable>
    </>}
    {!!session.reviewStatus && <ThemedText type="small">이 회차 후기는 {session.reviewStatus === 'published' ? '반영되었어요.' : '제출했어요. 검토 상태에 따라 공개돼요.'}</ThemedText>}
    {!!notice && <ThemedText type="small" accessibilityLiveRegion="polite">{notice}</ThemedText>}
  </View>;
}
const styles = StyleSheet.create({ container: { gap: 12, marginVertical: 8 }, review: { gap: 8, padding: 12, borderWidth: 1, borderRadius: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, button: { minHeight: 44, minWidth: 44, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 80, textAlignVertical: 'top' } });
