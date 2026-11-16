import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { animateLayout } from '@/components/disclosure';
import { ClayBoxFill, useClayBox } from '@/components/clay';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadMeetupWaiting, setMeetupWaiting, type MeetupWaiting as Waiting, type MeetupWaitingKind } from '@/lib/meetup-convenience';
import { supabase } from '@/lib/supabase';

/** On an event or place with no open public meetup: one button to hear when one opens, and how many are waiting (never who). */
export function MeetupWaiting({ kind, refId, cityId }: { kind: MeetupWaitingKind; refId: string; cityId: string }) {
  const { isAuthed, me } = useAuth();
  return isAuthed ? <WaitingBlock key={`${me.id}:${kind}:${refId}`} kind={kind} refId={refId} cityId={cityId} /> : null;
}

function WaitingBlock({ kind, refId, cityId }: { kind: MeetupWaitingKind; refId: string; cityId: string }) {
  const { tr } = useLanguage();
  const theme = useTheme(), clayBox = useClayBox(), { play } = useInteractionFeedback(), reduced = useReducedMotion();
  const [state, setState] = useState<Waiting | null>(null), [saving, setSaving] = useState(false), [error, setError] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    loadMeetupWaiting(supabase, kind, refId, cityId).then(value => { if (active.current) setState(value); }).catch(() => {}); // a failed read just hides the card
    return () => { active.current = false; };
  }, [kind, refId, cityId]);
  if (!state || state.open) return null;
  const toggle = async () => {
    if (saving) return;
    const on = !state.mine;
    setSaving(true); setError(false);
    try {
      const next = await setMeetupWaiting(supabase, kind, refId, cityId, on);
      if (!active.current) return;
      animateLayout(reduced); setState(next);
      if (on) play('success');
    } catch (cause) {
      if (!active.current) return;
      // A meetup opened meanwhile: read again, the card goes away.
      if (cause instanceof Error && cause.message.includes('MEETUP_ALREADY_OPEN')) void loadMeetupWaiting(supabase, kind, refId, cityId).then(value => { if (active.current) setState(value); }).catch(() => {});
      else { setError(true); play('warning'); }
    } finally { if (active.current) setSaving(false); }
  };
  return <View style={[styles.card, clayBox ? styles.clayCard : { backgroundColor: theme.card, borderColor: theme.line }]}>
    {clayBox && <ClayBoxFill kind="tile" />}
    <ThemedText accessibilityRole="header" style={Typography.section}>{tr('아직 열린 모임이 없어요')}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{tr('모임이 열리면 알림으로 알려 드려요.')}</ThemedText>
    {state.count > 0 && <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">{state.count === 1 ? tr('1명이 기다리고 있어요.') : tr('{0}명이 기다리고 있어요.', state.count)}</ThemedText>}
    <RaisedActionButton analyticsId={state.mine ? 'meetup.waiting.leave' : 'meetup.waiting.join'} tone="secondary" busy={saving}
      label={state.mine ? tr('알림 받는 중 · 취소하기') : tr('열리면 알려 주세요')} onPress={() => { play('selection'); void toggle(); }} />
    {error && <ThemedText type="small" accessibilityRole="alert">{tr('저장하지 못했어요. 다시 시도해 주세요.')}</ThemedText>}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  clayCard: { backgroundColor: 'transparent', borderColor: 'transparent', overflow: 'visible' },
});
