import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import type { MembershipSnapshot } from '@/lib/membership';

type Kind = 'meetup' | 'conversation';
const tierNames = { free: '베이직', plus: '플러스', premium: '프리미엄' };

export function relationshipSlotData(membership: MembershipSnapshot | null, kind: Kind) {
  if (!membership) return null;
  const [active, locked, available, limit, unlocks] = kind === 'meetup'
    ? [membership.meetupsUsed, membership.meetupSlotsLocked, membership.meetupSlotsAvailable, membership.meetupLimit, membership.meetupUnlocksAt] as const
    : [membership.conversationsUsed, membership.conversationSlotsLocked, membership.conversationSlotsAvailable, membership.conversationLimit, membership.conversationUnlocksAt] as const;
  if (![active, locked, available, limit].every((value) => Number.isInteger(value) && value >= 0)
    || ![3, 5, 10].includes(limit) || available !== Math.max(0, limit - active - locked)) return null;
  const unlockAt = locked > 0 ? unlocks?.filter((value) => Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(a) - Date.parse(b))[0] : undefined;
  return { active, locked, available, limit, unlockAt, overLimit: active + locked > limit };
}

export function RelationshipSlotCard({ kind, membership, loading = false, onMembershipPress }: {
  kind: Kind; membership: MembershipSnapshot | null; loading?: boolean; onMembershipPress?: () => void;
}) {
  const theme = useTheme();
  const data = relationshipSlotData(membership, kind);
  const title = kind === 'meetup' ? '모임 자리' : '1:1 대화 자리';
  const unknown = loading ? '자리를 확인하고 있어요' : '자리 정보를 다시 확인해 주세요';
  const summary = data
    ? `${title}, 전체 ${data.limit}개 중 남은 자리 ${data.available}개, 사용 중 ${data.active}개, 24시간 잠금 ${data.locked}개.${data.unlockAt ? ` ${t.chat.slotUnlock(data.unlockAt)}` : ''}`
    : `${title}, ${unknown}`;
  const colors = { active: theme.accent, locked: theme.navy };

  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <View style={styles.content}>
      <View style={styles.header}>
        <ThemedText type="smallBold">{title}</ThemedText>
        {membership && <View style={[styles.tier, { backgroundColor: theme.backgroundElement }]}><ThemedText type="small" themeColor="textSecondary">{tierNames[membership.tier]}</ThemedText></View>}
      </View>
      <View accessible accessibilityRole="image" accessibilityLabel={summary} accessibilityState={{ busy: loading && !data }} accessibilityLiveRegion="polite">
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
          <View style={styles.remaining}>
            <View style={styles.numberRow}><ThemedText style={[styles.number, { color: data?.available ? theme.accent : theme.text }]}>{data ? data.available : '—'}</ThemedText><ThemedText type="smallBold">자리 남음</ThemedText></View>
            <ThemedText type="small" themeColor="textSecondary">{data ? `전체 ${data.limit}자리` : loading ? '확인 중' : '확인 필요'}</ThemedText>
          </View>
          <View style={[styles.track, { backgroundColor: theme.line }]}>
            {data && <>
              <View style={{ width: `${Math.min(data.active, data.limit) / data.limit * 100}%`, backgroundColor: theme.accent }} />
              <View style={{ width: `${Math.min(data.locked, Math.max(0, data.limit - data.active)) / data.limit * 100}%`, backgroundColor: theme.navy }} />
            </>}
          </View>
          {data ? <View style={styles.legend}>
            {([['active', '사용 중', data.active], ['locked', '24h 잠금', data.locked]] as const).map(([state, label, count]) => <View key={state} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: colors[state] }]} /><ThemedText type="small" themeColor="textSecondary">{label}</ThemedText><ThemedText type="smallBold" style={styles.tabular}>{count}</ThemedText>
            </View>)}
          </View> : <ThemedText type="small" themeColor="textSecondary">{unknown}</ThemedText>}
          {data?.unlockAt && <View style={styles.unlock}><SymbolView name={{ ios: 'clock', android: 'schedule', web: 'schedule' }} size={14} tintColor={theme.navy} /><ThemedText type="small" themeColor="navy" style={styles.flex}>{t.chat.slotUnlock(data.unlockAt)}</ThemedText></View>}
        </View>
      </View>
      {data?.overLimit && <ThemedText type="small" themeColor="textSecondary">현재 한도보다 많은 자리를 사용하고 있어요. 기존 관계는 유지돼요.</ThemedText>}
    </View>
    {onMembershipPress && <Pressable accessibilityRole="button" onPress={onMembershipPress} style={({ pressed }) => [styles.action, { borderTopColor: theme.line, backgroundColor: theme.background, opacity: pressed ? 0.65 : 1 }]}>
      <ThemedText type="smallBold" themeColor="accent" style={styles.flex}>멤버십과 모임 자리 보기</ThemedText><View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden><SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={16} tintColor={theme.accent} /></View>
    </Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  content: { padding: Spacing.three, gap: Spacing.two },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  tier: { borderRadius: 6, paddingHorizontal: Spacing.two, paddingVertical: Spacing.half },
  remaining: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, marginBottom: Spacing.two },
  numberRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: Spacing.two },
  number: { fontSize: 24, lineHeight: 32, fontWeight: 700, fontVariant: ['tabular-nums'] },
  track: { flexDirection: 'row', height: Spacing.two, borderRadius: Spacing.one, overflow: 'hidden', marginBottom: Spacing.two },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.three, rowGap: Spacing.one },
  legendItem: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.one },
  dot: { width: Spacing.one, height: Spacing.one, borderRadius: Spacing.half },
  tabular: { fontVariant: ['tabular-nums'] },
  unlock: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, marginTop: Spacing.two },
  flex: { flexShrink: 1 },
  action: { minHeight: 44, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
});
