import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import type { MembershipSnapshot } from '@/lib/membership';

type Kind = 'meetup' | 'conversation';
type SlotState = 'active' | 'locked' | 'available';
const tierNames = { free: '베이직', plus: '플러스', premium: '프리미엄' };

export function relationshipSlotData(membership: MembershipSnapshot | null, kind: Kind) {
  if (!membership) return null;
  const [active, locked, available, limit, unlocks] = kind === 'meetup'
    ? [membership.meetupsUsed, membership.meetupSlotsLocked, membership.meetupSlotsAvailable, membership.meetupLimit, membership.meetupUnlocksAt] as const
    : [membership.conversationsUsed, membership.conversationSlotsLocked, membership.conversationSlotsAvailable, membership.conversationLimit, membership.conversationUnlocksAt] as const;
  if (![active, locked, available, limit].every((value) => Number.isInteger(value) && value >= 0)
    || ![3, 5, 10].includes(limit) || available !== Math.max(0, limit - active - locked)) return null;
  const slots: SlotState[] = Array.from({ length: limit }, (_, index) => index < active ? 'active' : index < active + locked ? 'locked' : 'available');
  const unlockAt = locked > 0 ? unlocks?.filter((value) => Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(a) - Date.parse(b))[0] : undefined;
  return { active, locked, available, limit, slots, unlockAt, overLimit: active + locked > limit };
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
  const colors = { active: theme.accent, locked: theme.navy, available: theme.textSecondary };

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
          <View style={styles.track}>
            {data ? data.slots.map((state, index) => <View key={index} style={[styles.slot, {
              backgroundColor: state === 'active' ? theme.accent : state === 'locked' ? theme.backgroundElement : theme.card,
              borderColor: colors[state], borderStyle: state === 'available' ? 'dashed' : 'solid',
            }]}>
              <SymbolView size={12} tintColor={state === 'active' ? theme.accentInk : colors[state]} name={state === 'active'
                ? { ios: 'checkmark', android: 'check', web: 'check' }
                : state === 'locked' ? { ios: 'lock.fill', android: 'lock', web: 'lock' }
                  : { ios: 'plus', android: 'add', web: 'add' }} />
            </View>) : <View style={[styles.unknownTrack, { backgroundColor: theme.backgroundElement }]} />}
          </View>
          {data ? <View style={styles.legend}>
            {([['active', '사용 중', data.active], ['locked', '24h 잠금', data.locked], ['available', '남음', data.available]] as const).map(([state, label, count]) => <View key={state} style={styles.legendItem}>
              <ThemedText type="small" style={{ color: state === 'active' ? theme.text : colors[state] }}>{label}</ThemedText><ThemedText type="smallBold" style={styles.tabular}>{count}</ThemedText>
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
  number: { fontSize: 28, lineHeight: 36, fontWeight: 700, fontVariant: ['tabular-nums'] },
  track: { flexDirection: 'row', gap: Spacing.one, marginBottom: Spacing.two },
  slot: { flex: 1, height: 24, borderWidth: 1, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  unknownTrack: { width: '100%', height: 24, borderRadius: 4 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.three, rowGap: Spacing.one },
  legendItem: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: Spacing.one },
  tabular: { fontVariant: ['tabular-nums'] },
  unlock: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, marginTop: Spacing.two },
  flex: { flexShrink: 1 },
  action: { minHeight: 44, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
});
