import { useLanguage } from '@/hooks/use-language';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Pressable } from '@/components/analytics-controls';
import { GlingLoader } from '@/components/gling-loader';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { behavior } from '@/lib/behavior-analytics';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadPostPoll, votePostPoll, type PostPoll as Poll } from '@/lib/post-polls';
import { supabase } from '@/lib/supabase';

export function PostPoll({ postId }: { postId: string }) {
  const { tr, locale: appLocale } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback(), { isAuthed, me, promptLogin } = useAuth();
  const key = `${postId}:${me.id}`;
  const [loaded, setLoaded] = useState<{ key: string; poll: Poll | null; error: boolean } | null>(null);
  const poll = loaded?.key === key ? loaded.poll : null, loadError = loaded?.key === key && loaded.error;
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const scope = useRef<{ active: boolean } | null>(null);
  useEffect(() => {
    const request = { active: true };
    scope.current = request;
    void loadPostPoll(supabase, postId).then(value => {
      if (request.active) {
        setLoaded({ key, poll: value, error: false }); setSelected(value?.my_vote ?? null);
        setPreview(false); setError(false); setPending(false);
      }
    }).catch(() => { if (request.active) setLoaded({ key, poll: null, error: true }); });
    return () => { request.active = false; };
  }, [postId, key, reload]);
  if (!poll) return loadError ? <Pressable analyticsId="post.poll.retry" accessibilityRole="button" onPress={() => { play('selection'); setLoaded(null); setReload(value => value + 1); }} style={styles.retry}>
    <ThemedText type="small">{tr("투표를 불러오지 못했어요. 다시 불러오기")}</ThemedText>
  </Pressable> : null;
  const total = poll.counts.reduce((sum, value) => sum + value, 0), voted = poll.my_vote !== null, results = preview || voted;
  const submit = async () => {
    play('selection');
    if (!isAuthed) { promptLogin('로그인하고 투표에 참여해요.'); return; }
    if (selected === null || pending || voted) return;
    const request = scope.current;
    if (!request?.active) return;
    setPending(true); setError(false);
    try {
      const saved = await votePostPoll(supabase, postId, me.id, selected);
      if (!request.active) return;
      setLoaded({ key, poll: saved, error: false }); setSelected(saved.my_vote); play('success');
      behavior('success', 'post.poll.vote');
    } catch { if (request.active) { setError(true); play('warning'); } }
    finally { if (request.active) setPending(false); }
  };
  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <ThemedText type="smallBold">{poll.question}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">{tr("투표 참여") + " "}{total.toLocaleString(appLocale)}{tr("명 · 한 개만 고를 수 있어요")}</ThemedText>
    <View style={styles.options} accessibilityRole="radiogroup">
      {poll.options.map((label, index) => {
        const percentage = total ? Math.round(poll.counts[index] / total * 100) : 0;
        return <Pressable key={index} analyticsId={`post.poll.option.${index}`} accessibilityRole="radio"
          accessibilityLabel={tr("{0}{1}", (label), (results ? `, ${percentage}퍼센트, ${poll.counts[index]}표` : ''))}
          accessibilityState={{ checked: selected === index, disabled: pending || voted }} disabled={pending || voted}
          onPress={() => { play('selection'); setSelected(index); }}
          style={[styles.option, { borderColor: selected === index ? theme.accent : theme.line, backgroundColor: theme.backgroundElement }]}>
          {results && <View pointerEvents="none" style={[styles.bar, { width: `${percentage}%`, backgroundColor: theme.backgroundSelected }]} />}
          <ThemedText style={{ flex: 1 }}>{selected === index ? '◉' : '○'}  {label}</ThemedText>
          {results && <ThemedText type="smallBold">{percentage}%</ThemedText>}
        </Pressable>;
      })}
    </View>
    {error && <ThemedText type="small" accessibilityLiveRegion="polite">{tr("투표를 저장하지 못했어요. 다시 시도해 주세요.")}</ThemedText>}
    <Pressable analyticsId="post.poll.vote" accessibilityRole="button" accessibilityLabel={voted ? tr("투표 완료") : tr("투표하기")}
      accessibilityState={{ disabled: voted || pending || selected === null, busy: pending }} disabled={voted || pending || selected === null}
      onPress={() => void submit()} style={[styles.submit, { backgroundColor: theme.accent, opacity: voted || pending || selected === null ? .55 : 1 }]}>
      {pending ? <GlingLoader accessibilityLabel={tr("투표 저장 중")} size={16} /> : <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{voted ? tr("투표 완료") : tr("투표하기")}</ThemedText>}
    </Pressable>
    {!voted && <Pressable analyticsId="post.poll.preview" accessibilityRole="button" accessibilityLabel={preview ? tr("결과 미리 보기 닫기") : tr("투표 결과 미리 보기")}
      onPress={() => { play('selection'); setPreview(value => !value); }} style={styles.preview}>
      <ThemedText type="small" themeColor="textSecondary">{preview ? tr("미리 보기 닫기") : tr("투표 결과 미리 보기")}</ThemedText>
    </Pressable>}
    <ThemedText type="small" themeColor="textSecondary">{tr("투표한 계정은 공개되지 않아요.")}</ThemedText>
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 10, marginVertical: 16 },
  options: { gap: 8 }, option: { minHeight: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8, overflow: 'hidden' },
  bar: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  submit: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  preview: { minHeight: 44, alignItems: 'center', justifyContent: 'center' }, retry: { minHeight: 44, justifyContent: 'center' },
});
