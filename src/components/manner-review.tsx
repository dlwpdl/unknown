import { FlatPressable as Pressable } from '@/components/flat-pressable';
import { useLanguage } from '@/hooks/use-language';
import { useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadMannerReviewState, MANNER_QUESTIONS, writeMannerReview, type MannerContext, type MannerSignals } from '@/lib/meetup-reviews';
import { supabase } from '@/lib/supabase';

export function MannerReviewButton(props: { subjectId: string; nickname: string; context: MannerContext }) {

  const { isAuthed, me } = useAuth();
  return isAuthed ? <MannerReview key={`${me.id}:${props.subjectId}:${props.context.sessionId ?? props.context.conversationId}`} {...props} /> : null;
}
function MannerReview({ subjectId, nickname, context }: { subjectId: string; nickname: string; context: MannerContext }) {
  const { tr } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [open, setOpen] = useState(false), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [signals, setSignals] = useState<MannerSignals>({ punctual: null, respectful: null, boundaries: null }), [body, setBody] = useState('');
  const [score, setScore] = useState<number | null>(null);
  const pending = useRef(false);
  const negative = (score !== null && score <= 5) || Object.values(signals).includes(false);
  const valid = score !== null && Object.values(signals).some(value => typeof value === 'boolean') && (!negative || body.trim().length >= 10);
  async function start() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setNotice(''); play('selection');
    try {
      const state = await loadMannerReviewState(supabase, subjectId, context);
      if (state.submitted) setNotice("리뷰를 이미 제출했어요. 검토 후 반영됩니다.");
      else if (!state.eligible) setNotice(context.sessionId ? "종료 후 두 사람의 참석 확인이 필요해요. 참석 이의제기는 별도로 신청할 수 있어요." : "양쪽이 충분히 대화한 뒤 대화 리뷰를 남길 수 있어요. 신고는 언제든 가능해요.");
      else setOpen(true);
    } catch { setNotice("리뷰 자격을 확인하지 못했어요. 다시 눌러주세요."); play('warning'); }
    finally { pending.current = false; setBusy(false); }
  }
  async function submit() {
    if (!valid || pending.current) return;
    pending.current = true; setBusy(true); setNotice(''); play('selection');
    try {
      await writeMannerReview(supabase, subjectId, context, signals, score!, body);
      setOpen(false); setNotice("제출했어요. 두 사람 모두 제출하거나 7일이 지난 뒤, 검토된 평가만 반영돼요."); play('success');
    } catch { setNotice("저장을 확인하지 못했어요. 입력은 유지했어요. 같은 내용으로 다시 제출할 수 있어요."); play('warning'); }
    finally { pending.current = false; setBusy(false); }
  }
  const button = [styles.button, { borderColor: theme.line, backgroundColor: theme.backgroundElement }];
  return <View style={styles.container}>
    {!open && <Pressable accessibilityRole="button" accessibilityLabel={tr("{0} {1} 리뷰", (nickname), (context.sessionId ? tr('만남') : tr('대화')))} disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => void start()} style={button}>
      <ThemedText type="smallBold">{busy ? tr("확인 중…") : tr("{0} {1} 리뷰 남기기", (nickname), (context.sessionId ? tr('만남') : tr('대화')))}</ThemedText>
    </Pressable>}
    {open && <>
      <ThemedText type="smallBold">{tr("글링 리뷰 ·") + " "}{score === null ? tr("평점을 선택해주세요") : `${score.toFixed(1)} / 10`}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{tr("최저 1점 · 최고 10점 · 0.5점 단위")}</ThemedText>
      <View accessibilityRole="radiogroup" accessibilityLabel={tr("사용자 리뷰 평점")} style={styles.row}>{Array.from({ length: 19 }, (_, i) => 1 + i / 2).map(value => <Pressable key={value}
        accessibilityRole="radio" accessibilityLabel={tr("{0}점", (value))} aria-checked={score === value} accessibilityState={{ checked: score === value, disabled: busy }} disabled={busy}
        onPress={() => { play('selection'); setScore(value); }} style={[button, { minWidth: 48, alignItems: 'center', backgroundColor: score === value ? theme.accent : theme.backgroundElement, borderColor: score === value ? theme.accent : theme.line }]}>
        <ThemedText type="smallBold" style={{ color: score === value ? theme.accentInk : theme.text }}>{value}</ThemedText>
      </Pressable>)}</View>
      <ThemedText type="smallBold">{tr("직접 경험한 행동을 함께 알려주세요")}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{tr("원문은 운영팀과 AI 안전 분석으로 검토하고 다른 사용자에게 공개하지 않아요. 관계의 목적 자체를 평가하거나 확인되지 않은 주장·개인정보를 적지 마세요.")}</ThemedText>
      {MANNER_QUESTIONS.filter(({ key }) => !context.conversationId || key !== 'punctual').map(({ key, label }) => <View key={key} style={styles.container}>
        <ThemedText type="small">{tr(label)}</ThemedText>
        <View accessibilityRole="radiogroup" accessibilityLabel={tr(label)} style={styles.row}>{([true, false, null] as const).map(value => <Pressable key={String(value)} accessibilityRole="radio" accessibilityLabel={tr("{0} · {1}", (tr(label)), (value === null ? tr('확인 못함') : value ? tr('그랬어요') : tr('아쉬웠어요')))}
          disabled={busy} aria-checked={signals[key] === value} accessibilityState={{ checked: signals[key] === value, disabled: busy }} onPress={() => { play('selection'); setSignals(current => ({ ...current, [key]: value })); }}
          style={[button, signals[key] === value && { borderColor: theme.accent }]}><ThemedText type="small">{value === null ? tr("확인 못함") : value ? tr("그랬어요") : tr("아쉬웠어요")}</ThemedText></Pressable>)}</View>
      </View>)}
      <TextInput accessibilityLabel={tr("운영팀에만 전달할 리뷰 설명")} editable={!busy} value={body} onChangeText={setBody} onFocus={() => play('selection')} multiline maxLength={300}
        placeholder={negative ? tr("구체적으로 겪은 행동 · 10자 이상, 300자 이내") : tr("운영팀에 전달할 설명 · 선택, 300자 이내")} placeholderTextColor={theme.textSecondary} style={[styles.input, { color: theme.text, borderColor: theme.line }]} />
      {negative && <ThemedText type="small" themeColor="textSecondary">{tr("5점 이하 또는 아쉬웠던 행동이 있는 리뷰는 운영팀이 맥락을 확인한 뒤 반영돼요. 긴급한 안전 문제는 별도로 신고해주세요.")}</ThemedText>}
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel={tr("사용자 리뷰 제출")} disabled={busy || !valid} accessibilityState={{ disabled: busy || !valid }} onPress={() => void submit()} style={[button, { opacity: busy || !valid ? 0.5 : 1 }]}><ThemedText type="smallBold">{busy ? tr("제출 중…") : tr("리뷰 제출")}</ThemedText></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => { play('selection'); setOpen(false); }} style={button}><ThemedText type="small">{tr("닫기")}</ThemedText></Pressable>
      </View>
    </>}
    {!!notice && <ThemedText type="small" accessibilityLiveRegion="polite">{tr(notice)}</ThemedText>}
  </View>;
}
const styles = StyleSheet.create({ container: { gap: 8 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { minHeight: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, justifyContent: 'center', paddingVertical: 8 },
  input: { minHeight: 80, borderWidth: 1, borderRadius: 12, padding: 12, textAlignVertical: 'top' } });
