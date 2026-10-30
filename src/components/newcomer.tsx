import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import { DeviceEventEmitter, StyleSheet, View } from 'react-native';

import { Pressable, Switch } from '@/components/analytics-controls';
import { SelectionChip } from '@/components/selection-chip';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles, IconSize, Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { MEETUPS_CHANGED_EVENT } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { MEETUP_LABEL_TEXT, loadNewcomerStatus, meetupLabels, newcomerDaysLeft, type MeetupLabel, type NewcomerStatus } from '@/lib/newcomer';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

/** My own newcomer status; nobody else's is ever loaded or shown. */
export function useNewcomerStatus(enabled = true) {
  const { isAuthed, me } = useAuth();
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{ key: string; userId: string; status: NewcomerStatus | null } | null>(null);
  const userId = enabled && isAuthed && me.id ? me.id : null;
  const key = userId ? `${userId}:${version}` : null;
  useEffect(() => {
    if (!key || !userId) return;
    let active = true;
    loadNewcomerStatus(supabase, userId, version > 0).then(
      status => { if (active) setResult({ key, userId, status }); },
      () => { if (active) setResult({ key, userId, status: null }); });
    return () => { active = false; };
  }, [key, userId, version]);
  useEffect(() => {
    if (!enabled) return;
    const listener = DeviceEventEmitter.addListener(MEETUPS_CHANGED_EVENT, () => setVersion(value => value + 1));
    return () => listener.remove();
  }, [enabled]);
  // A refresh keeps showing the last status for the same account while it reloads.
  return { status: userId && result?.userId === userId ? result.status : null, loading: !!key && result?.key !== key,
    refresh: () => setVersion(value => value + 1) };
}

// Photo overlays keep fixed colours in both themes: they sit on arbitrary photos, not on the theme background.
// Contrast from the mockup check: #171123 on #CBB9FF 10.5:1, #FFFFFF on #2B2B36 (92%) about 14:1.
const LABEL_COLORS: Record<MeetupLabel, { backgroundColor: string; color: string }> = {
  new: { backgroundColor: 'rgba(43,43,54,0.92)', color: '#FFFFFF' },
  welcome: { backgroundColor: '#CBB9FF', color: '#171123' },
  newcomersOnly: { backgroundColor: '#CBB9FF', color: '#171123' },
};

export function MeetupLabelBadges({ labels, overlay = true }: { labels: MeetupLabel[]; overlay?: boolean }) {
  const { tr } = useLanguage();
  if (!labels.length) return null;
  // The card's accessibility label already reads these before the title.
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.badges, overlay && styles.overlay]}>
    {labels.map(label => <View key={label} style={[styles.badge, { backgroundColor: LABEL_COLORS[label].backgroundColor }]}>
      <ThemedText style={[styles.badgeText, { color: LABEL_COLORS[label].color }]}>{tr(MEETUP_LABEL_TEXT[label])}</ThemedText>
    </View>)}
  </View>;
}

/** "새 모임, 처음 와도 돼요, " for the card's accessibility label. */
export function useMeetupLabelPrefix(post: Pick<Post, 'createdAt' | 'room'>) {
  const { tr } = useLanguage();
  const labels = meetupLabels(post);
  return { labels, prefix: labels.map(label => `${tr(MEETUP_LABEL_TEXT[label])}, `).join('') };
}

/** Host option after capacity: one switch; turning it on reveals who can apply and a list preview. */
export function MeetupNewcomerOption({ welcome, only, onChange, disabled }: {
  welcome: boolean; only: boolean; onChange: (next: { welcome: boolean; only: boolean }) => void; disabled?: boolean;
}) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const { status } = useNewcomerStatus();
  const days = status?.periodDays ?? 60;
  return <View style={styles.option}>
    <ThemedText type="smallBold" style={Typography.menu}>{tr('처음 오는 분')}</ThemedText>
    <View style={[styles.optionCard, { backgroundColor: theme.card, borderColor: theme.line }]}>
      <View style={styles.switchRow}>
        <View style={styles.flex}>
          <ThemedText style={Typography.menu}>{tr('처음 오는 분 환영')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{tr('목록에 ‘처음 와도 돼요’가 붙고, 가입한 지 얼마 안 된 분께 먼저 추천돼요.')}</ThemedText>
        </View>
        <Switch analyticsId="meetup.newcomer.welcome" accessibilityLabel={tr('처음 오는 분 환영')} value={welcome} disabled={disabled}
          onValueChange={value => { play('selection'); onChange({ welcome: value, only: value && only }); }} />
      </View>
      {welcome && <>
        <View style={[styles.divider, { backgroundColor: theme.line }]} />
        <ThemedText type="smallBold">{tr('신청할 수 있는 사람')}</ThemedText>
        <View accessibilityRole="radiogroup" accessibilityLabel={tr('신청할 수 있는 사람')} style={styles.choices}>
          {([[false, 'meetup.newcomer.audience.anyone', '누구나'], [true, 'meetup.newcomer.audience.newcomers', '새 멤버만']] as const).map(([value, id, label]) =>
            <SelectionChip key={id} analyticsId={id} selected={only === value} disabled={disabled} accessibilityRole="radio" accessibilityState={{ checked: only === value, disabled: !!disabled }}
              baseColor={theme.backgroundElement} onPress={() => { play('selection'); onChange({ welcome, only: value }); }} style={[ControlStyles.pill, styles.choice]}>
              <ThemedText type="smallBold" style={{ color: only === value ? theme.accentInk : theme.text }}>{tr(label)}</ThemedText>
            </SelectionChip>)}
        </View>
        {only && <ThemedText type="small" themeColor="textSecondary">{tr('가입한 지 {0}일 안 된 분만 신청할 수 있어요. 인원이 덜 찰 수 있어요.', days)}</ThemedText>}
        <View style={[styles.preview, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="small" themeColor="textSecondary">{tr('목록에서는 이렇게 보여요')}</ThemedText>
          <MeetupLabelBadges overlay={false} labels={only ? ['newcomersOnly'] : ['welcome']} />
        </View>
      </>}
    </View>
  </View>;
}

const hiddenKey = (userId: string) => `gling.newcomer-card.hidden:${userId}`;
const celebratedKey = (userId: string) => `gling.newcomer-card.celebrated:${userId}`;

/** Today tab: progress toward the first meetup, only for my own newcomer period. */
export function NewcomerProgressCard() {
  const { tr } = useLanguage();
  const theme = useTheme(), router = useRouter();
  const { me, isAuthed } = useAuth();
  const { play } = useInteractionFeedback();
  const { status, refresh } = useNewcomerStatus(isAuthed);
  const [stored, setStored] = useState<{ hidden: boolean; celebrated: boolean } | null>(null);
  useFocusEffect(useCallback(() => { refresh(); }, [])); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    AsyncStorage.multiGet([hiddenKey(me.id), celebratedKey(me.id)])
      .then(([[, hidden], [, celebrated]]) => { if (active) setStored({ hidden: hidden === '1', celebrated: celebrated === '1' }); })
      .catch(() => { if (active) setStored({ hidden: false, celebrated: false }); });
    return () => { active = false; };
  }, [isAuthed, me.id]);
  const celebrate = !!status?.newcomer && status.attended && stored?.celebrated === false;
  useEffect(() => {
    // The celebration shows once; the next visit no longer finds the card.
    if (celebrate) void AsyncStorage.setItem(celebratedKey(me.id), '1').catch(() => {});
  }, [celebrate, me.id]);
  if (!status?.newcomer || !stored || stored.hidden || (status.attended && !celebrate)) return null;
  const openMeetups = () => { play('selection'); router.navigate('/(tabs)/meetups'); };
  const link = (label: string) => <Pressable analyticsId="today.newcomer.meetups" accessibilityRole="link" onPress={openMeetups} style={styles.link}>
    <ThemedText type="smallBold" themeColor="accent">{label}</ThemedText>
  </Pressable>;
  if (celebrate) return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <ThemedText accessibilityRole="header" style={Typography.section}>{tr('첫 모임 다녀오셨네요!')}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{tr('다음 모임도 마음 가는 대로 골라 보세요.')}</ThemedText>
    {link(tr('모임 보기 ›'))}
  </View>;
  const steps = [['가입', true], ['프로필', true], ['첫 모임 신청', status.requested], ['첫 모임 참석', false]] as const;
  const remaining = steps.filter(([, done]) => !done).length;
  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <View style={styles.cardHead}>
      <ThemedText accessibilityRole="header" type="smallBold" themeColor="accent" style={styles.flex}>{newcomerDaysLeft(status) === 1 ? tr('새로 온 멤버 · 하루 남음') : tr('새로 온 멤버 · {0}일 남음', newcomerDaysLeft(status))}</ThemedText>
      <Pressable analyticsId="today.newcomer.hide" accessibilityRole="button" accessibilityLabel={tr('새로 온 멤버 카드 숨기기')} style={styles.link}
        onPress={() => { play('selection'); setStored(current => current && { ...current, hidden: true }); void AsyncStorage.setItem(hiddenKey(me.id), '1').catch(() => {}); }}>
        <ThemedText type="small" themeColor="textSecondary">{tr('숨기기')}</ThemedText>
      </Pressable>
    </View>
    <View style={styles.steps} accessibilityRole="list">
      {steps.map(([label, done], index) => <View key={label} style={styles.step} accessible accessibilityLabel={`${tr(label)}, ${done ? tr('완료') : tr('아직')}`}>
        <View style={[styles.dot, done ? { backgroundColor: theme.accent } : { borderWidth: 1, borderColor: theme.line }]}>
          {done ? <SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={IconSize.chevron} tintColor={theme.accentInk} />
            : <ThemedText type="smallBold" themeColor="textSecondary">{index + 1}</ThemedText>}
        </View>
        <ThemedText type="small" style={styles.stepLabel} themeColor={done ? 'text' : 'textSecondary'}>{tr(label)}</ThemedText>
      </View>)}
    </View>
    <View style={styles.next}>
      <ThemedText type="small" style={styles.flex}>{remaining === 2 ? tr('첫 모임까지 두 단계 남았어요.') : tr('첫 모임까지 한 단계 남았어요.')}</ThemedText>
      {link(tr('모임 보기 ›'))}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  overlay: { position: 'absolute', top: 12, left: 12, right: 12 },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { ...Typography.label },
  option: { gap: Spacing.two },
  optionCard: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  divider: { height: StyleSheet.hairlineWidth },
  choices: { flexDirection: 'row', gap: Spacing.two },
  choice: { flex: 1 },
  preview: { borderRadius: 12, padding: Spacing.two, gap: Spacing.two },
  card: { borderWidth: 1, borderRadius: 20, padding: Spacing.three, gap: Spacing.three, marginTop: Spacing.three },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  steps: { flexDirection: 'row', gap: Spacing.two },
  step: { flex: 1, alignItems: 'center', gap: Spacing.one },
  dot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { textAlign: 'center' },
  next: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  link: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0 },
});
