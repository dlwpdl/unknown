import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

// Shared building blocks for the business pages: one title line, one hint line, and longer explanations folded away.

export function MerchantPageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return <View style={styles.header}>
    <View style={styles.grow}>
      <ThemedText type="subtitle" accessibilityRole="header">{title}</ThemedText>
      {!!subtitle && <ThemedText type="small" themeColor="textSecondary">{subtitle}</ThemedText>}
    </View>
    {action}
  </View>;
}

// Explanations that are true but not needed to act stay available one tap away instead of being deleted.
export function MerchantHelp({ items, label }: { items: string[]; label?: string }) {
  const { tr } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return <View style={[styles.help, { borderColor: theme.line }]}>
    <Pressable analyticsId="merchant.action" accessibilityRole="button" accessibilityLabel={label ?? tr('자세히 보기')} accessibilityState={{ expanded: open }}
      onPress={() => { play('selection'); setOpen(value => !value); }} style={({ pressed }) => [styles.helpToggle, { opacity: pressed ? 0.7 : 1 }]}>
      <ThemedText type="small" themeColor="textSecondary">{`ⓘ ${label ?? tr('자세히 보기')} ${open ? '▴' : '▾'}`}</ThemedText>
    </Pressable>
    {open && <View style={styles.helpList}>{items.map(item => <ThemedText key={item} type="small" themeColor="textSecondary">{`· ${item}`}</ThemedText>)}</View>}
  </View>;
}

export function MerchantStat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  const theme = useTheme();
  return <View style={[styles.stat, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{label}</ThemedText>
    <ThemedText type="subtitle" themeColor={accent ? 'accent' : 'text'} numberOfLines={1}>{value}</ThemedText>
  </View>;
}

export function MerchantStats({ children }: { children: ReactNode }) {
  return <View style={styles.stats}>{children}</View>;
}

export function MerchantMeter({ label, value, max }: { label: string; value: number; max: number }) {
  const theme = useTheme();
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return <View style={styles.meter} accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max, now: value }}>
    <View style={styles.meterLabel}><ThemedText type="small" themeColor="textSecondary">{label}</ThemedText><ThemedText type="smallBold">{`${value} / ${max}`}</ThemedText></View>
    <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}><View style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: theme.accent }]} /></View>
  </View>;
}

export type MerchantBadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';
export function MerchantBadge({ label, tone = 'neutral' }: { label: string; tone?: MerchantBadgeTone }) {
  const theme = useTheme();
  const color = tone === 'accent' ? theme.accent : tone === 'ok' ? '#7FD6A6' : tone === 'warn' ? '#F5C451' : tone === 'danger' ? theme.danger : theme.textSecondary;
  return <View style={[styles.badge, { backgroundColor: theme.backgroundElement }]}><ThemedText type="small" style={{ color }} numberOfLines={1}>{label}</ThemedText></View>;
}

// Segmented filter used for list pages (drafts, reviews).
export function MerchantSegments<T extends string>({ items, value, onChange, disabled }: { items: { key: T; label: string }[]; value: T; onChange: (key: T) => void; disabled?: boolean }) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  return <View style={[styles.segments, { backgroundColor: theme.backgroundElement }]} accessibilityRole="tablist">
    {items.map(item => {
      const selected = item.key === value;
      return <Pressable key={item.key} analyticsId="merchant.tabs" accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{ selected, disabled: !!disabled }} aria-selected={selected}
        disabled={disabled} onPress={() => { play('selection'); onChange(item.key); }}
        style={({ pressed }) => [styles.segment, selected && { backgroundColor: theme.card }, { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}>
        <ThemedText type="smallBold" themeColor={selected ? 'text' : 'textSecondary'}>{item.label}</ThemedText>
      </Pressable>;
    })}
  </View>;
}

// Where the owner is in a multi-step flow (e.g. 내용 → 원고 확인 → 게시할 곳).
export function MerchantSteps({ steps, current }: { steps: string[]; current: number }) {
  const theme = useTheme();
  return <View style={styles.steps} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: steps.length, now: current + 1 }}>
    {steps.map((step, index) => <View key={step} style={styles.step}>
      {index > 0 && <ThemedText type="small" themeColor="textSecondary" accessible={false}>›</ThemedText>}
      <View style={[styles.stepNumber, { backgroundColor: index === current ? theme.accent : theme.backgroundElement }]}><ThemedText type="small" style={{ color: index === current ? theme.accentInk : theme.textSecondary }}>{index + 1}</ThemedText></View>
      <ThemedText type="smallBold" themeColor={index === current ? 'text' : 'textSecondary'}>{step}</ThemedText>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 },
  grow: { flex: 1, minWidth: 200, gap: 2 },
  help: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6, gap: 6 },
  helpToggle: { minHeight: 36, justifyContent: 'center', alignSelf: 'flex-start' },
  helpList: { gap: 4 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  stat: { flexGrow: 1, flexBasis: 150, gap: 4, padding: 14, borderWidth: 1, borderRadius: 16 },
  meter: { gap: 6 },
  meterLabel: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  track: { height: 8, borderRadius: 99, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 99 },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'center' },
  segments: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, padding: 4, borderRadius: 12, alignSelf: 'flex-start' },
  segment: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 9 },
  steps: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepNumber: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
});
