import { LensPressable as Pressable } from '@/components/lens-pressable';
import { loadMannerSummary, type MannerSummary as Summary } from '@/lib/user-profile';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MannerSummary } from '@/components/manner-summary';
import { MeetupReviews } from '@/components/meetup-reviews';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { appealMannerReview, loadMyMannerFeedback, loadMyMeetupReviewInbox, MANNER_QUESTIONS, type MyMannerFeedback } from '@/lib/meetup-reviews';
import { supabase } from '@/lib/supabase';

export default function MeetupReviewInbox() {
  const auth = useAuth();
  return <Inbox key={auth.isAuthed ? auth.me.id : 'guest'} />;
}
function Inbox() {
  const { isAuthed, me, promptLogin } = useAuth(), theme = useTheme(), { play } = useInteractionFeedback(), router = useRouter();
  const [items, setItems] = useState<{ postId: string; title: string; kind: 'once' | 'group' }[] | null>(null);
  const [feedback, setFeedback] = useState<MyMannerFeedback[]>([]), [summary, setSummary] = useState<Summary | null>(null);
  const [selected, setSelected] = useState<string | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    void Promise.all([loadMyMeetupReviewInbox(supabase), loadMyMannerFeedback(supabase), loadMannerSummary(supabase, me.id)])
      .then(([meetups, incoming, aggregate]) => { if (active) { setItems(meetups); setFeedback(incoming); setSummary(aggregate); setError(''); } })
      .catch(() => { if (active) setError('후기와 평가 상태를 불러오지 못했어요.'); });
    return () => { active = false; };
  }, [isAuthed, me.id, retry]);
  const button = [styles.button, { backgroundColor: theme.backgroundElement, borderColor: theme.line }];
  return <ThemedView style={{ flex: 1 }}><SafeAreaView style={{ flex: 1 }}><ScrollView contentContainerStyle={styles.page}>
    <Pressable accessibilityRole="button" accessibilityLabel="뒤로 가기" onPress={() => { play('selection'); if (router.canGoBack()) router.back(); else router.replace('/profile'); }} style={button}><ThemedText>뒤로</ThemedText></Pressable>
    <ThemedText type="title">모임 후기 · 내 글링 리뷰</ThemedText>
    {!isAuthed ? <Pressable accessibilityRole="button" onPress={() => { play('selection'); promptLogin('후기와 비공개 평가를 관리하려면 로그인해주세요.'); }} style={button}><ThemedText>로그인</ThemedText></Pressable> : <>
      {summary && <MannerSummary summary={summary} />}
      <ThemedText type="subtitle">참여한 회차</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">종료 후 7일 안에 참석 확인과 평가를 남길 수 있어요. 모임 퇴장·차단 이후에도 이미 참여한 회차의 권한은 유지돼요.</ThemedText>
      {!items && !error && <ThemedText>불러오는 중…</ThemedText>}
      {items?.length === 0 && <ThemedText type="small">아직 등록된 참여 회차가 없어요. 모임 화면에서 회차를 열고 실제 현장에 체크인해주세요.</ThemedText>}
      {items?.map(item => <View key={item.postId} style={{ gap: 12 }}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: selected === item.postId }} onPress={() => { play('selection'); setSelected(old => old === item.postId ? null : item.postId); }} style={button}><ThemedText type="smallBold">{item.title} · {item.kind === 'once' ? '참석·개인 평가' : '후기·참석 확인'}</ThemedText></Pressable>
        {selected === item.postId && <MeetupReviews postId={item.postId} kind={item.kind} attendanceOnly />}
      </View>)}
      <ThemedText type="subtitle">받은 글링 리뷰</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">양쪽 제출 또는 7일 경과 후 검토된 결과만 보여요. 작성자와 개인 원문은 공개하지 않아요. 이의제기한 평가는 검토 중 점수에서 제외돼요.</ThemedText>
      {feedback.length === 0 && <ThemedText type="small">현재 공개 시점에 도달한 평가가 없어요.</ThemedText>}
      {feedback.map(item => <Feedback key={item.id} item={item} onChanged={() => setRetry(n => n + 1)} />)}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <Pressable accessibilityRole="button" onPress={() => { play('selection'); setRetry(n => n + 1); }} style={button}><ThemedText type="small">최신 상태 다시 확인</ThemedText></Pressable>
    </>}
  </ScrollView></SafeAreaView></ThemedView>;
}
function Feedback({ item, onChanged }: { item: MyMannerFeedback; onChanged: () => void }) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [open, setOpen] = useState(false), [body, setBody] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), pending = useRef(false);
  const button = [styles.button, { borderColor: theme.line, backgroundColor: theme.backgroundElement }];
  async function submit() {
    if (pending.current || body.trim().length < 10) return;
    pending.current = true; setBusy(true); play('selection');
    try { await appealMannerReview(supabase, item.id, body); setOpen(false); onChanged(); play('success'); }
    catch { setError('접수 결과를 확인하지 못했어요. 입력은 유지했어요. 최신 상태를 확인해주세요.'); play('warning'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <View style={[styles.card, { borderColor: theme.line }]}>
    <ThemedText type="smallBold">{item.context === 'meeting' ? '실제 만남' : '대화'} · {item.status === 'held' ? '검토 중 · 집계 제외' : '반영된 리뷰'}</ThemedText>
    {item.score != null && <ThemedText type="subtitle">{item.score.toFixed(1)} / 10</ThemedText>}
    {MANNER_QUESTIONS.filter(({ key }) => item.context !== 'chat' || key !== 'punctual').map(({ key, label }) => <ThemedText key={key} type="small">{label} · {item.signals[key] === null ? '확인 못함' : item.signals[key] ? '그랬어요' : '아쉬웠어요'}</ThemedText>)}
    {!item.appealed && item.status === 'published' && <Pressable accessibilityRole="button" onPress={() => { play('selection'); setOpen(old => !old); }} style={button}><ThemedText type="small">리뷰에 이의제기</ThemedText></Pressable>}
    {open && <>
      <TextInput accessibilityLabel="사용자 리뷰 이의제기 사유" editable={!busy} value={body} onChangeText={setBody} onFocus={() => play('selection')} multiline maxLength={1000} placeholder="사실관계·맥락을 적어주세요. (10자 이상)" placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, borderColor: theme.line }]} />
      <Pressable accessibilityRole="button" disabled={busy || body.trim().length < 10} accessibilityState={{ disabled: busy || body.trim().length < 10 }} onPress={() => void submit()} style={button}><ThemedText type="smallBold">{busy ? '접수 중…' : '운영팀에 검토 요청'}</ThemedText></Pressable>
    </>}
    {!!error && <ThemedText type="small" accessibilityRole="alert">{error}</ThemedText>}
  </View>;
}
const styles = StyleSheet.create({ page: { padding: 16, gap: 16 }, card: { padding: 12, gap: 8, borderWidth: 1, borderRadius: 12 },
  button: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, justifyContent: 'center' },
  input: { minHeight: 80, padding: 12, borderWidth: 1, borderRadius: 12, textAlignVertical: 'top' } });
