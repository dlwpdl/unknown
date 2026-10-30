import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Pressable, Switch } from '@/components/analytics-controls';
import { SelectionChip } from '@/components/selection-chip';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles, Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadMeetupAutomation, setMeetupAutoApproval, setMeetupNoShowRule, setMeetupWaitlistPromotion, type MeetupAutomation as Automation } from '@/lib/meetup-convenience';
import { supabase } from '@/lib/supabase';

const HOURS = [1, 3, 12, 24] as const, THRESHOLDS = [1, 2, 3] as const;

/** Host-only rules. The server checks the host's tier on every save; this only shows what is on. */
export function MeetupAutomation({ postId }: { postId: string }) {
  const { tr } = useLanguage();
  const theme = useTheme(), router = useRouter(), { play } = useInteractionFeedback();
  const [state, setState] = useState<Automation | null>(null), [failed, setFailed] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    loadMeetupAutomation(supabase, postId).then(value => { if (active.current) { setState(value); setFailed(false); } }).catch(() => { if (active.current) setFailed(true); });
    return () => { active.current = false; };
  }, [postId, reload]);
  if (failed) return <Pressable analyticsId="meetup.automation.retry" accessibilityRole="button" onPress={() => { play('selection'); setFailed(false); setReload(value => value + 1); }} style={styles.touch}>
    <ThemedText type="small" themeColor="textSecondary">{tr('자동 관리 설정을 불러오지 못했어요. 다시 불러오기')}</ThemedText>
  </Pressable>;
  if (!state) return null;
  const save = async (next: Automation, write: () => Promise<unknown>) => {
    if (saving) return;
    const previous = state;
    setState(next); setSaving(true); setError(false);
    try { await write(); if (active.current) play('success'); }
    catch { if (active.current) { setState(previous); setError(true); play('warning'); } }
    finally { if (active.current) setSaving(false); }
  };
  const approve = (key: keyof Automation['approve'], value: boolean) => {
    const rules = { ...state.approve, [key]: value };
    void save({ ...state, approve: rules }, () => setMeetupAutoApproval(supabase, postId, rules));
  };
  const promote = (on: boolean, hours = state.offerHours) => void save({ ...state, promote: on, offerHours: hours }, () => setMeetupWaitlistPromotion(supabase, postId, on, hours));
  const noShow = (threshold: number | null) => void save({ ...state, noShowThreshold: threshold }, () => setMeetupNoShowRule(supabase, threshold));
  const locked = (plan: 'plus' | 'pro') => <Pressable analyticsId="meetup.automation.membership" accessibilityRole="button" onPress={() => { play('selection'); router.push('/profile/membership'); }} style={styles.touch}>
    <ThemedText type="small" themeColor="accent">{plan === 'plus' ? tr('플러스 멤버십부터 쓸 수 있어요. 멤버십 보기') : tr('프로 멤버십부터 쓸 수 있어요. 멤버십 보기')}</ThemedText>
  </Pressable>;
  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <ThemedText accessibilityRole="header" style={Typography.section}>{tr('신청·대기 자동 관리')}</ThemedText>

    <ThemedText type="smallBold">{tr('조건에 맞으면 바로 승인')}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{tr('켜 둔 조건 중 하나라도 맞으면 호스트가 확인하지 않아도 바로 승인돼요.')}</ThemedText>
    {state.canAutoApprove ? <>
      <SwitchRow id="meetup.automation.same_city" label={tr('이 도시에 사는 분')} value={state.approve.sameCity} disabled={saving} onChange={value => approve('sameCity', value)} />
      <SwitchRow id="meetup.automation.newcomer" label={tr('가입한 지 얼마 안 된 분')} value={state.approve.newcomer} disabled={saving} onChange={value => approve('newcomer', value)} />
      <SwitchRow id="meetup.automation.age" label={tr('권장 나이에 맞는 분')} value={state.approve.age} disabled={saving || (!state.ageRange && !state.approve.age)} onChange={value => approve('age', value)} />
      {!state.ageRange && <ThemedText type="small" themeColor="textSecondary">{tr('모임에 권장 나이를 정하면 쓸 수 있어요.')}</ThemedText>}
    </> : locked('plus')}

    <View style={[styles.divider, { backgroundColor: theme.line }]} />
    <ThemedText type="smallBold">{tr('빈자리 대기자에게 넘기기')}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{tr('자리가 나면 다음 대기자에게 알려요. 정한 시간 안에 신청하면 바로 승인되고, 답이 없으면 그다음 분께 넘어가요. 모임 6시간 전부터는 1시간만 기다려요.')}</ThemedText>
    {state.canPromote ? <>
      <SwitchRow id="meetup.automation.promote" label={tr('대기자에게 자동으로 넘기기')} value={state.promote} disabled={saving} onChange={value => promote(value)} />
      {state.promote && <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={tr('답을 기다리는 시간')}>
        {HOURS.map(hours => <SelectionChip key={hours} analyticsId="meetup.automation.hours" selected={state.offerHours === hours} disabled={saving} accessibilityRole="radio"
          accessibilityState={{ checked: state.offerHours === hours, disabled: saving }} baseColor={theme.backgroundElement} onPress={() => { play('selection'); promote(true, hours); }} style={ControlStyles.pill}>
          <ThemedText type="smallBold" style={{ color: state.offerHours === hours ? theme.accentInk : theme.text }}>{tr('{0}시간', hours)}</ThemedText>
        </SelectionChip>)}
      </View>}
    </> : locked('pro')}

    <View style={[styles.divider, { backgroundColor: theme.line }]} />
    <ThemedText type="smallBold">{tr('노쇼 규칙')}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{tr('호스트가 체크인한 모임에서 말없이 안 온 횟수만 세요. 미리 ‘못 가요’라고 알린 건 세지 않아요. 내가 여는 모든 모임에 적용돼요.')}</ThemedText>
    {state.canNoShowRule ? <>
      <SwitchRow id="meetup.automation.no_show" label={tr('노쇼가 쌓이면 대기 명단으로만 받기')} value={state.noShowThreshold !== null} disabled={saving} onChange={value => noShow(value ? 2 : null)} />
      {state.noShowThreshold !== null && <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={tr('노쇼 횟수')}>
        {THRESHOLDS.map(count => <SelectionChip key={count} analyticsId="meetup.automation.threshold" selected={state.noShowThreshold === count} disabled={saving} accessibilityRole="radio"
          accessibilityState={{ checked: state.noShowThreshold === count, disabled: saving }} baseColor={theme.backgroundElement} onPress={() => { play('selection'); noShow(count); }} style={ControlStyles.pill}>
          <ThemedText type="smallBold" style={{ color: state.noShowThreshold === count ? theme.accentInk : theme.text }}>{tr('노쇼 {0}번', count)}</ThemedText>
        </SelectionChip>)}
      </View>}
    </> : locked('plus')}
    {error && <ThemedText type="small" accessibilityRole="alert">{tr('설정을 저장하지 못했어요. 다시 시도해 주세요.')}</ThemedText>}
  </View>;
}

function SwitchRow({ id, label, value, disabled, onChange }: { id: string; label: string; value: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  const { play } = useInteractionFeedback();
  return <View style={styles.switchRow}>
    <ThemedText style={[Typography.body, styles.flex]}>{label}</ThemedText>
    <Switch analyticsId={id} accessibilityLabel={label} value={value} disabled={disabled} onValueChange={next => { play('selection'); onChange(next); }} />
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 }, flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.one },
  touch: { minHeight: 44, justifyContent: 'center' },
});
