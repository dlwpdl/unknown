import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles, Typography, controlPresentation } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadMeetupRsvp, setMeetupRsvp, type MeetupRsvp as Rsvp } from '@/lib/meetup-convenience';
import { supabase } from '@/lib/supabase';

/** "갈게요 / 못 가요" for the next session. Free for members; the head count is shown to plus+ hosts by the server. */
export function MeetupRsvp({ postId }: { postId: string }) {
  const { isAuthed, me } = useAuth();
  return isAuthed ? <RsvpBlock key={`${me.id}:${postId}`} postId={postId} /> : null;
}

function RsvpBlock({ postId }: { postId: string }) {
  const { tr, locale } = useLanguage();
  const theme = useTheme(), router = useRouter(), { play } = useInteractionFeedback();
  const [rsvp, setRsvp] = useState<Rsvp | null>(null), [failed, setFailed] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    loadMeetupRsvp(supabase, postId).then(value => { if (active.current) { setRsvp(value); setFailed(false); } }).catch(() => { if (active.current) setFailed(true); });
    return () => { active.current = false; };
  }, [postId, reload]);
  if (failed) return <Pressable analyticsId="meetup.rsvp.retry" accessibilityRole="button" onPress={() => { play('selection'); setFailed(false); setReload(value => value + 1); }} style={styles.retry}>
    <ThemedText type="small" themeColor="textSecondary">{tr('참석 정보를 불러오지 못했어요. 다시 불러오기')}</ThemedText>
  </Pressable>;
  if (!rsvp?.available || !rsvp.startsAt) return null;
  const when = new Date(rsvp.startsAt).toLocaleString(locale, { month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const answer = async (going: boolean, release = false) => {
    if (saving) return;
    setSaving(true); setError(false);
    try {
      const next = await setMeetupRsvp(supabase, postId, going, release);
      if (!active.current) return;
      setRsvp(next); play('success');
    } catch { if (active.current) { setError(true); play('warning'); } }
    finally { if (active.current) setSaving(false); }
  };
  const release = () => {
    play('selection');
    const title = tr('자리를 비울까요?'), message = tr('모임에서 나가고, 기다리던 분께 자리가 넘어가요. 다시 오려면 새로 신청해야 해요.');
    if (Platform.OS === 'web') { if (globalThis.confirm(`${title}\n${message}`)) void answer(false, true); return; }
    Alert.alert(title, message, [{ text: tr('그대로 두기'), style: 'cancel' }, { text: tr('자리 비우기'), style: 'destructive', onPress: () => void answer(false, true) }]);
  };
  const counts = rsvp.counts;
  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <ThemedText accessibilityRole="header" style={Typography.section}>{rsvp.isHost ? tr('참석 현황') : tr('참석 알려 주기')}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{tr('다음 만남 {0}', when)}</ThemedText>
    {rsvp.isHost ? rsvp.canSeeCounts && counts
      ? <ThemedText accessibilityLiveRegion="polite">{tr('갈게요 {0}명 · 못 가요 {1}명 · 아직 답 없음 {2}명', counts.going, counts.notGoing, counts.noAnswer)}</ThemedText>
      : <Pressable analyticsId="meetup.automation.membership" accessibilityRole="button" onPress={() => { play('selection'); router.push('/profile/membership'); }} style={styles.retry}>
        <ThemedText type="small" themeColor="accent">{tr('누가 오는지 미리 보려면 플러스 멤버십이 필요해요. 멤버십 보기')}</ThemedText>
      </Pressable>
      : <>
        <ThemedText type="small" themeColor="textSecondary">{tr('호스트가 인원을 미리 챙길 수 있어요.')}</ThemedText>
        <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={tr('참석 알려 주기')}>
          {([[true, 'meetup.rsvp.going', '갈게요'], [false, 'meetup.rsvp.not_going', '못 가요']] as const).map(([going, id, label]) => {
            const selected = rsvp.mine === (going ? 'going' : 'not_going');
            return <Pressable key={id} analyticsId={id} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: saving, busy: saving }} disabled={saving}
              onPress={() => { play('selection'); if (!selected) void answer(going); }}
              style={({ pressed }) => [ControlStyles.action, styles.choice, { borderWidth: 1 }, controlPresentation(theme, { selected, pressed, busy: saving }).container]}>
              <ThemedText type="smallBold" style={controlPresentation(theme, { selected }).text}>{tr(label)}</ThemedText>
            </Pressable>;
          })}
        </View>
        {rsvp.mine && <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">{rsvp.mine === 'going' ? tr('간다고 알렸어요. 일정이 바뀌면 다시 눌러 주세요.') : tr('못 간다고 알렸어요.')}</ThemedText>}
        {rsvp.mine === 'not_going' && rsvp.kind === 'once' && <Pressable analyticsId="meetup.rsvp.release" accessibilityRole="button" disabled={saving} onPress={release} style={styles.retry}>
          <ThemedText type="smallBold" themeColor="accent">{tr('자리 비워 주기')}</ThemedText>
        </Pressable>}
      </>}
    {error && <ThemedText type="small" accessibilityRole="alert">{tr('저장하지 못했어요. 다시 시도해 주세요.')}</ThemedText>}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.two, marginVertical: Spacing.three },
  row: { flexDirection: 'row', gap: Spacing.two }, choice: { flex: 1 },
  retry: { minHeight: 44, justifyContent: 'center' },
});
