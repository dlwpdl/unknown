import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

// Shared pieces for screens that used to stack grey notice paragraphs: who-sees-what, one-line notes, folded details, status.
export type WhoSeesRow = { icon: SymbolViewProps['name']; label: string; detail: string; hidden?: boolean; accessory?: ReactNode };

export function WhoSees({ title, rows }: { title: string; rows: WhoSeesRow[] }) {
  const theme = useTheme();
  return <View style={[styles.card, { backgroundColor: theme.card }]}>
    <ThemedText type="smallBold" accessibilityRole="header" style={styles.cardTitle}>{title}</ThemedText>
    {rows.map((row, index) => <View key={row.label} style={[styles.row, index > 0 && { borderTopWidth: 1, borderTopColor: theme.line }]}>
      <View style={[styles.icon, { backgroundColor: theme.backgroundSelected }]}><SymbolView name={row.icon} size={14} tintColor={row.hidden ? theme.textSecondary : theme.accent} /></View>
      <View style={styles.flex}>
        <ThemedText type="smallBold" themeColor={row.hidden ? 'textSecondary' : undefined}>{row.label}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{row.detail}</ThemedText>
      </View>
      {row.accessory}
    </View>)}
  </View>;
}

export function InfoNote({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  const theme = useTheme();
  return <View style={styles.note}>
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={styles.noteIcon}>
      <SymbolView name={tone === 'warn' ? { ios: 'exclamationmark.circle', android: 'error', web: 'error' } : { ios: 'info.circle', android: 'info', web: 'info' }} size={14} tintColor={tone === 'warn' ? theme.danger : theme.textSecondary} />
    </View>
    <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>{children}</ThemedText>
  </View>;
}

export function MoreDetails({ label, items, analyticsId }: { label: string; items: string[]; analyticsId: string }) {
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const [open, setOpen] = useState(false);
  return <View style={[styles.more, { borderTopColor: theme.line }]}>
    <Pressable analyticsId={analyticsId} accessibilityRole="button" aria-expanded={open} accessibilityState={{ expanded: open }}
      onPress={() => { play('selection'); setOpen(value => !value); }} style={({ pressed }) => [styles.moreButton, { opacity: pressed ? 0.65 : 1 }]}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.flex}>{label}</ThemedText>
      <SymbolView name={{ ios: open ? 'chevron.up' : 'chevron.down', android: open ? 'keyboard_arrow_up' : 'keyboard_arrow_down', web: open ? 'keyboard_arrow_up' : 'keyboard_arrow_down' }} size={14} tintColor={theme.textSecondary} />
    </Pressable>
    {open && items.map(item => <View key={item} style={styles.item}><ThemedText type="small" themeColor="textSecondary">•</ThemedText><ThemedText type="small" themeColor="textSecondary" style={styles.flex}>{item}</ThemedText></View>)}
  </View>;
}

export function StatusLine({ title, detail, tone = 'ok' }: { title: string; detail?: string; tone?: 'ok' | 'warn' }) {
  const theme = useTheme();
  return <View style={[styles.status, { borderColor: theme.line }]} accessibilityLiveRegion="polite">
    <View style={[styles.dot, { backgroundColor: tone === 'warn' ? theme.danger : theme.accent }]} />
    <View style={styles.flex}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {!!detail && <ThemedText type="small" themeColor="textSecondary">{detail}</ThemedText>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { borderRadius: 16, overflow: 'hidden' },
  cardTitle: { paddingHorizontal: Spacing.three, paddingTop: Spacing.three, paddingBottom: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: 10 },
  icon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  note: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  noteIcon: { paddingTop: 3 },
  more: { borderTopWidth: 1, paddingTop: Spacing.one, gap: Spacing.one },
  moreButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  item: { flexDirection: 'row', gap: Spacing.two },
  status: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
