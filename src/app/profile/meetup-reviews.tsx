import { FlatPressable as Pressable } from '@/components/flat-pressable';
import { KeyboardScreen } from '@/components/keyboard-screen';
import { useLanguage } from '@/hooks/use-language';
import { loadMannerSummary, type MannerSummary as Summary } from '@/lib/user-profile';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { animateLayout, Disclosure } from '@/components/disclosure';
import { DragSheet } from '@/components/drag-sheet';
import { ListCard, ListLoading, ListRow, SectionLabel, Tag } from '@/components/list-card';
import { MannerSummary } from '@/components/manner-summary';
import { RaisedActionButton } from '@/components/raised-action-button';
import { StateCard } from '@/components/state-card';
import { useReducedMotion } from 'react-native-reanimated';
import { MeetupReviews } from '@/components/meetup-reviews';
import { ClayBoxFill, useClayBox } from '@/components/clay';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { formatMeetupTime, meetupZone } from '@/lib/chilling-date';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { appealMannerReview, loadMyMannerFeedback, loadMyMeetupReviewQueue, MANNER_QUESTIONS, nextReview, reviewDaysLeft, reviewDue, type MeetupReviewQueue, type MeetupReviewQueueItem, type MyMannerFeedback } from '@/lib/meetup-reviews';
import { supabase } from '@/lib/supabase';

// The rules that used to sit as paragraphs between the sections, folded into one place at the bottom.
const RULES = [
  ['참석 확인', '종료 후 7일 안에 참석 확인과 평가를 남길 수 있어요. 모임 퇴장·차단 이후에도 이미 참여한 회차의 권한은 유지돼요.'],
  ['공개', '양쪽 제출 또는 7일 경과 후 검토된 결과만 보여요. 작성자와 개인 원문은 공개하지 않아요. 이의제기한 평가는 검토 중 점수에서 제외돼요.'],
  ['점수', '10점 만점 · 최근 30일 · 같은 상대는 한 번만 반영 · 서로 다른 5명부터 평점 표시. 활동 이력과 함께 참고해주세요.'],
] as const;

export default function MeetupReviewInbox() {

  const auth = useAuth();
  return <Inbox key={auth.isAuthed ? auth.me.id : 'guest'} />;
}
function Inbox() {
  const { tr, locale } = useLanguage();
  const { isAuthed, me, promptLogin } = useAuth(), theme = useTheme(), clayBox = useClayBox(), { play } = useInteractionFeedback(), router = useRouter();
  const reducedMotion = useReducedMotion();
  const [queue, setQueue] = useState<MeetupReviewQueue | null>(null), [now, setNow] = useState(() => Date.now());
  const [feedback, setFeedback] = useState<MyMannerFeedback[]>([]), [summary, setSummary] = useState<Summary | null>(null);
  const [selected, setSelected] = useState<string | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0), [pulling, setPulling] = useState(false);
  // The item stays while the sheet slides away; only `open` closes it.
  const [sheet, setSheet] = useState<{ item: MeetupReviewQueueItem; open: boolean } | null>(null);
  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    void Promise.all([loadMyMeetupReviewQueue(supabase), loadMyMannerFeedback(supabase), loadMannerSummary(supabase, me.id)])
      .then(([next, incoming, aggregate]) => { if (active) { setQueue(next); setFeedback(incoming); setSummary(aggregate); setNow(Date.now()); setError(''); } })
      .catch(() => { if (active) setError("후기와 평가 상태를 불러오지 못했어요."); })
      .finally(() => { if (active) setPulling(false); });
    return () => { active = false; };
  }, [isAuthed, me.id, retry]);
  const reload = () => setRetry(n => n + 1);
  const button = [styles.button, { backgroundColor: theme.backgroundElement, borderColor: theme.line }];
  // With the review-queue migration each row is a session; without it, the meetup list from before.
  const sessions = queue && 'sessions' in queue ? queue.sessions : null, meetups = queue && 'meetups' in queue ? queue.meetups : null;
  const due = sessions ? nextReview(sessions) : null;
  const dateOf = (item: MeetupReviewQueueItem) => formatMeetupTime(item.startsAt, locale, meetupZone({ timezone: item.timezone }, item.cityId), { month: 'long', day: 'numeric', weekday: 'short' });
  const dueLine = (item: MeetupReviewQueueItem) => {
    const days = reviewDaysLeft(item, now);
    return days === 0 ? tr('{0} 회차 · 오늘까지 남길 수 있어요', dateOf(item)) : days === 1 ? tr('{0} 회차 · 내일까지 남길 수 있어요', dateOf(item)) : tr('{0} 회차 · {1}일 남았어요', dateOf(item), days);
  };
  const tagOf = (item: MeetupReviewQueueItem) => reviewDue(item) ? tr('후기 남기기') : item.verified ? tr('참석 확인됨') : '';
  const open = (item: MeetupReviewQueueItem) => reviewDue(item) ? setSheet({ item, open: true })
    : router.push({ pathname: '/meetup-tools', params: { postId: item.postId, kind: item.kind, host: item.isHost ? '1' : '0', section: 'session', sessionId: item.sessionId } });
  // The profile stack header shows the back button and the menu's name as the title.
  return <KeyboardScreen><ThemedView style={{ flex: 1 }}><SafeAreaView style={{ flex: 1 }} edges={['bottom']}><ScrollView contentContainerStyle={styles.page}
    refreshControl={isAuthed ? <RefreshControl refreshing={pulling} tintColor={theme.accent} onRefresh={() => { play('selection'); setPulling(true); reload(); }} /> : undefined}>
    {!isAuthed ? <Pressable accessibilityRole="button" onPress={() => { play('selection'); promptLogin('후기와 비공개 평가를 관리하려면 로그인해주세요.'); }} style={button}><ThemedText>{tr("로그인")}</ThemedText></Pressable>
    : !queue ? (error ? <StateCard kind="error" title={tr(error)} body={tr('화면을 아래로 당기면 새로 불러와요')} actionLabel={tr('다시 불러오기')} onAction={reload} /> : <ListLoading label={tr("불러오는 중…")} />) : <>
      {/* What to do here comes first: browse when nothing is attended yet, the review that closes first after a meetup. */}
      {(sessions ?? meetups)?.length === 0 && <StateCard title={tr('첫 모임 다녀오면 여기에 쌓여요')} body={tr('끝나고 7일 안에 함께한 분과 서로 참석을 확인하면 후기를 남길 수 있어요.')} actionLabel={tr('모임 둘러보기')}
        onAction={() => router.navigate(Platform.OS === 'web' ? '/?tag=meetup' : '/(tabs)/meetups')} />}
      {due && <StateCard layout="start" title={tr('남길 후기가 있어요')} body={tr('{0} · {1}', due.title, dueLine(due))}>
        <View style={styles.cardAction}><RaisedActionButton analyticsId="meetup.attendance.session" label={tr('후기 남기기')} onPress={() => { play('selection'); open(due); }} /></View>
      </StateCard>}
      {summary && <View><SectionLabel>{tr('이웃이 남긴 리뷰')}</SectionLabel><MannerSummary summary={summary} header={false} /></View>}
      {!!sessions?.length && <View>
        <SectionLabel>{tr("참여한 회차")}</SectionLabel>
        <ListCard>{sessions.map(item => { const tag = tagOf(item); return <ListRow key={item.sessionId} analyticsId="meetup.attendance.session" title={item.title} detail={dateOf(item)}
          label={[item.title, dateOf(item), tag].filter(Boolean).join(', ')} trailing={tag ? <Tag label={tag} tone={reviewDue(item) ? 'accent' : 'quiet'} /> : undefined} onPress={() => open(item)} />; })}</ListCard>
      </View>}
      {!!meetups?.length && <View>
        <SectionLabel>{tr("참여한 회차")}</SectionLabel>
        <View style={styles.stack}>{meetups.map(item => <View key={item.postId} style={styles.stack}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: selected === item.postId }} onPress={() => { play('selection'); animateLayout(reducedMotion); setSelected(old => old === item.postId ? null : item.postId); }} style={[button, clayBox && styles.clayCard]}>{clayBox && <ClayBoxFill kind="tile" />}<ThemedText type="smallBold">{item.title} · {item.kind === 'once' ? tr("참석·개인 평가") : tr("후기·참석 확인")}</ThemedText></Pressable>
          {selected === item.postId && <MeetupReviews postId={item.postId} kind={item.kind} attendanceOnly />}
        </View>)}</View>
      </View>}
      {feedback.length > 0 && <View>
        <SectionLabel>{tr("받은 글링 리뷰")}</SectionLabel>
        <View style={styles.stack}>{feedback.map(item => <Feedback key={item.id} item={item} onChanged={reload} />)}</View>
      </View>}
      {!!error && <ThemedText type="small" accessibilityRole="alert" style={styles.gapTop}>{tr(error)}</ThemedText>}
      <View style={styles.rules}><ListCard><View style={styles.rulesInner}>
        <Disclosure analyticsId="meetup.attendance.how" title={tr('후기와 평가는 이렇게 다뤄요')}>
          {RULES.map(([term, text]) => <View key={term} style={styles.rule}>
            <ThemedText style={Typography.label}>{tr(term)}</ThemedText>
            <ThemedText themeColor="textSecondary" style={Typography.supporting}>{tr(text)}</ThemedText>
          </View>)}
        </Disclosure>
      </View></ListCard></View>
      {Platform.OS !== 'web' && <ThemedText themeColor="textSecondary" style={[Typography.caption, styles.gapTop, styles.hint]}>{tr('화면을 아래로 당기면 새로 불러와요')}</ThemedText>}
    </>}
  </ScrollView></SafeAreaView></ThemedView>
    {/* The session's own check-in, confirm and review steps, in a sheet; the list refreshes once it closes. */}
    {sheet && <DragSheet visible={sheet.open} onClose={() => setSheet(value => value && { ...value, open: false })} onDismissed={() => { setSheet(null); reload(); }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
        <ThemedText themeColor="textSecondary" style={Typography.supporting}>{sheet.item.title}</ThemedText>
        <MeetupReviews key={sheet.item.sessionId} postId={sheet.item.postId} kind={sheet.item.kind} attendanceOnly sessionId={sheet.item.sessionId} />
      </ScrollView>
    </DragSheet>}
  </KeyboardScreen>;
}
function Feedback({ item, onChanged }: { item: MyMannerFeedback; onChanged: () => void }) {
  const { tr } = useLanguage();
  const theme = useTheme(), clayBox = useClayBox(), { play } = useInteractionFeedback();
  const [open, setOpen] = useState(false), [body, setBody] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), pending = useRef(false);
  const button = [styles.button, { borderColor: theme.line, backgroundColor: theme.backgroundElement }];
  async function submit() {
    if (pending.current || body.trim().length < 10) return;
    pending.current = true; setBusy(true); play('selection');
    try { await appealMannerReview(supabase, item.id, body); setOpen(false); onChanged(); play('success'); }
    catch { setError("접수 결과를 확인하지 못했어요. 입력은 유지했어요. 최신 상태를 확인해주세요."); play('warning'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <View style={[styles.card, clayBox ? styles.clayCard : { borderColor: theme.line }]}>
    {clayBox && <ClayBoxFill kind="tile" />}
    <ThemedText type="smallBold">{item.context === 'meeting' ? tr("실제 만남") : tr("대화")} · {item.status === 'held' ? tr("검토 중 · 집계 제외") : tr("반영된 리뷰")}</ThemedText>
    {item.score != null && <ThemedText type="subtitle">{item.score.toFixed(1)} / 10</ThemedText>}
    {MANNER_QUESTIONS.filter(({ key }) => item.context !== 'chat' || key !== 'punctual').map(({ key, label }) => <ThemedText key={key} type="small">{tr(label)} · {item.signals[key] === null ? tr("확인 못함") : item.signals[key] ? tr("그랬어요") : tr("아쉬웠어요")}</ThemedText>)}
    {!item.appealed && item.status === 'published' && <Pressable accessibilityRole="button" onPress={() => { play('selection'); setOpen(old => !old); }} style={button}><ThemedText type="small">{tr("리뷰에 이의제기")}</ThemedText></Pressable>}
    {open && <>
      <TextInput accessibilityLabel={tr("사용자 리뷰 이의제기 사유")} editable={!busy} value={body} onChangeText={setBody} onFocus={() => play('selection')} multiline maxLength={1000} placeholder={tr("사실관계·맥락을 적어주세요. (10자 이상)")} placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, borderColor: theme.line }]} />
      <Pressable accessibilityRole="button" disabled={busy || body.trim().length < 10} accessibilityState={{ disabled: busy || body.trim().length < 10 }} onPress={() => void submit()} style={button}><ThemedText type="smallBold">{busy ? tr("접수 중…") : tr("운영팀에 검토 요청")}</ThemedText></Pressable>
    </>}
    {!!error && <ThemedText type="small" accessibilityRole="alert">{tr(error)}</ThemedText>}
  </View>;
}
const styles = StyleSheet.create({ clayCard: { backgroundColor: 'transparent', borderColor: 'transparent', overflow: 'visible' }, page: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.five }, card: { padding: 12, gap: 8, borderWidth: 1, borderRadius: 12 },
  button: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center' },
  input: { minHeight: 80, padding: 12, borderWidth: 1, borderRadius: 12, textAlignVertical: 'top' },
  stack: { gap: Spacing.two + Spacing.one }, gapTop: { marginTop: Spacing.three },
  cardAction: { marginTop: Spacing.two }, rules: { marginTop: Spacing.four }, rulesInner: { paddingHorizontal: Spacing.three }, rule: { gap: Spacing.half },
  hint: { textAlign: 'center' }, sheetBody: { paddingBottom: Spacing.three } });
