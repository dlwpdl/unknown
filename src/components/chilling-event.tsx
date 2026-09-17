import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { chillingKind, chillingSchedule, type ChillingKind, type ChillingSchedule } from '@/lib/chilling';

const kinds = [
  { kind: 'once', title: '반짝', description: '한 번 만나요' },
  { kind: 'group', title: '우리 모임', description: '계속 만나요' },
] as const;

// Kept out of the live route until the HTML direction is approved.
export function ChillingKindTabs({ value, onChange }: { value: ChillingKind; onChange: (kind: ChillingKind) => void }) {
  const theme = useTheme();
  return <View accessibilityRole="tablist" accessibilityLabel="칠링 만남 종류" style={styles.tabs}>
    {kinds.map(({ kind, title, description }) => <Pressable
      key={kind} accessibilityRole="tab" accessibilityState={{ selected: kind === value }}
      accessibilityLabel={`${title}, ${description}`} onPress={() => onChange(kind)}
      style={({ pressed }) => [styles.tab, { borderBottomColor: kind === value ? theme.accent : theme.line, opacity: pressed ? 0.65 : 1 }]}>
      <ThemedText type="smallBold" style={{ color: kind === value ? theme.accent : theme.text }}>{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{description}</ThemedText>
    </Pressable>)}
  </View>;
}

export function ChillingEventSchedule({ room }: { room: ChillingSchedule }) {
  const once = chillingKind(room) === 'once';
  return <View style={styles.schedule}>
    <ThemedText type="smallBold" themeColor="accent">{once ? '반짝 · 일회성' : '우리 모임 · 지속'}</ThemedText>
    <ThemedText type="small">{chillingSchedule(room)}</ThemedText>
    {once && room.timezone && <ThemedText type="small" themeColor="textSecondary">{room.timezone} 기준</ThemedText>}
  </View>;
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: Spacing.two },
  tab: { flex: 1, minHeight: 64, justifyContent: 'center', gap: Spacing.one, padding: Spacing.two, borderBottomWidth: 2 },
  schedule: { gap: Spacing.one },
});
