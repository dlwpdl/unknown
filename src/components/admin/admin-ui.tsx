import { useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

// Shared admin building blocks for the 2026-10-25 redesign (output/design/gling-admin-redesign-20261025):
// tinted section headers, ⓘ instead of always-on grey text, one filled button per screen, fact cards and a decision dock.
const A = Colors.admin;

export type AdminTone = 'danger' | 'warning' | 'accent' | 'navy' | 'success' | 'neutral';
const toneColor: Record<AdminTone, { ink: string; tint: string }> = {
  danger: { ink: A.danger, tint: A.dangerBackground },
  warning: { ink: A.warning, tint: A.warningBackground },
  accent: { ink: A.accent, tint: A.backgroundSelected },
  navy: { ink: A.navy, tint: '#EEF2F8' },
  success: { ink: A.success, tint: A.successBackground },
  neutral: { ink: A.textSecondary, tint: A.backgroundElement },
};

export function AdminInfo({ text, label = '설명 보기', align = 'left' }: { text: string | string[]; label?: string; align?: 'left' | 'right' }) {
  const { play } = useInteractionFeedback();
  const [open, setOpen] = useState(false);
  const lines = Array.isArray(text) ? text : [text];
  return <View style={styles.infoWrap}>
    <Pressable analyticsId="admin.action" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }}
      onPress={() => { play('selection'); setOpen(value => !value); }} style={({ pressed }) => [styles.info, { opacity: pressed ? 0.6 : 1 }]}>
      <ThemedText type="small" style={styles.infoMark}>i</ThemedText>
    </Pressable>
    {open && <View style={[styles.infoPop, align === 'right' && styles.infoPopRight]} accessibilityLiveRegion="polite">{lines.map(line => <ThemedText key={line} type="small" style={styles.infoText}>{line}</ThemedText>)}</View>}
  </View>;
}

export function AdminCard({ icon, tone = 'neutral', title, count, info, infoAlign, action, children, style }: {
  icon?: string; tone?: AdminTone; title: string; count?: number | string; info?: string | string[]; infoAlign?: 'left' | 'right'; action?: ReactNode; children?: ReactNode; style?: ViewStyle;
}) {
  const t = toneColor[tone];
  return <View style={[styles.card, style]}>
    <View style={[styles.cardHead, { backgroundColor: t.tint }]}>
      {!!icon && <View style={[styles.cardIcon, { backgroundColor: A.card }]}><ThemedText type="smallBold" style={{ color: t.ink }}>{icon}</ThemedText></View>}
      <ThemedText type="smallBold" accessibilityRole="header" style={styles.cardTitle} numberOfLines={1}>{title}</ThemedText>
      {count != null && <ThemedText type="smallBold" style={[styles.cardCount, { color: t.ink }]}>{count}</ThemedText>}
      {!!info && <AdminInfo text={info} align={infoAlign} />}
      <View style={styles.grow} />
      {action}
    </View>
    {children != null && <View style={styles.cardBody}>{children}</View>}
  </View>;
}

export type AdminButtonKind = 'primary' | 'secondary' | 'danger' | 'text';
// Filled red is reserved for the confirm dialog of an irreversible action; on screens danger is an outline.
export function AdminButton({ label, kind = 'secondary', onPress, disabled, busy, accessibilityLabel }: {
  label: string; kind?: AdminButtonKind; onPress: () => void; disabled?: boolean; busy?: boolean; accessibilityLabel?: string;
}) {
  const { play } = useInteractionFeedback();
  const look = kind === 'primary' ? styles.primary : kind === 'danger' ? styles.danger : kind === 'text' ? styles.text : styles.secondary;
  const ink = kind === 'primary' ? A.accentInk : kind === 'danger' ? A.danger : kind === 'text' ? A.accent : A.text;
  return <Pressable analyticsId="admin.action" accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled: !!disabled, busy: !!busy }} disabled={disabled}
    onPress={() => { play(kind === 'danger' ? 'warning' : 'selection'); onPress(); }}
    style={({ pressed }) => [styles.button, look, { opacity: disabled ? 0.45 : pressed ? 0.75 : 1 }]}>
    <ThemedText type="smallBold" style={{ color: ink }} numberOfLines={1}>{label}</ThemedText>
  </Pressable>;
}

export function AdminMoreMenu({ items, label = '더 보기', up }: { items: { label: string; onPress: () => void; danger?: boolean; disabled?: boolean; silent?: boolean }[]; label?: string; up?: boolean }) {
  const { play } = useInteractionFeedback();
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return <View style={styles.moreWrap}>
    <Pressable analyticsId="admin.action" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }}
      onPress={() => { play('selection'); setOpen(value => !value); }} style={({ pressed }) => [styles.button, styles.secondary, styles.more, { opacity: pressed ? 0.75 : 1 }]}>
      <ThemedText type="smallBold">···</ThemedText>
    </Pressable>
    {open && <View style={[styles.menu, up && styles.menuUp]} accessibilityRole="menu">{items.map(item => <Pressable key={item.label} analyticsId="admin.action" accessibilityRole="menuitem" accessibilityLabel={item.label}
      disabled={item.disabled} onPress={() => { if (!item.silent) play(item.danger ? 'warning' : 'selection'); setOpen(false); item.onPress(); }}
      style={({ pressed }) => [styles.menuItem, { opacity: item.disabled ? 0.45 : pressed ? 0.7 : 1 }]}>
      <ThemedText type="small" style={item.danger ? { color: A.danger } : undefined}>{item.label}</ThemedText>
    </Pressable>)}</View>}
  </View>;
}

export function AdminFacts({ items, columns = 4 }: { items: { label: string; value: ReactNode; tone?: AdminTone }[]; columns?: 2 | 3 | 4 }) {
  return <View style={styles.facts}>{items.map(item => <View key={item.label} style={[styles.fact, { flexBasis: `${100 / columns - 2}%` }]}>
    <ThemedText type="small" style={styles.factLabel} numberOfLines={1}>{item.label}</ThemedText>
    {typeof item.value === 'string' || typeof item.value === 'number'
      ? <ThemedText type="smallBold" style={item.tone ? { color: toneColor[item.tone].ink } : undefined} numberOfLines={2}>{item.value}</ThemedText> : item.value}
  </View>)}</View>;
}

// Decision area that stays at the bottom of a detail view while the evidence above scrolls.
export function AdminDock({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.dock, Platform.OS === 'web' ? ({ position: 'sticky', bottom: 0 } as unknown as ViewStyle) : null, style]}>{children}</View>;
}

export function AdminPill({ label, tone = 'neutral' }: { label: string; tone?: AdminTone }) {
  const t = toneColor[tone];
  return <View style={[styles.pill, { backgroundColor: t.tint }]}><ThemedText type="small" style={{ color: t.ink }} numberOfLines={1}>{label}</ThemedText></View>;
}

// IDs for copy/paste live in one folded line at the very bottom of a detail.
export function AdminTrace({ items }: { items: { label: string; value: string }[] }) {
  const { play } = useInteractionFeedback();
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return <View style={styles.trace}>
    <Pressable analyticsId="admin.action" accessibilityRole="button" accessibilityLabel="추적 정보" accessibilityState={{ expanded: open }} onPress={() => { play('selection'); setOpen(value => !value); }}>
      <ThemedText type="small" style={styles.factLabel}>{open ? '추적 정보 ▴' : '추적 정보 ▾'}</ThemedText>
    </Pressable>
    {open && items.map(item => <ThemedText key={item.label} type="small" selectable style={styles.traceLine}>{`${item.label} ${item.value}`}</ThemedText>)}
  </View>;
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  // On web 'clip' rounds the corners without becoming a scroll container, so a sticky AdminDock inside still sticks.
  card: { borderWidth: 1, borderColor: A.line, borderRadius: 14, backgroundColor: A.card, overflow: Platform.OS === 'web' ? 'clip' as 'hidden' : 'hidden', minWidth: 0 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: A.line },
  cardIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { flexShrink: 1, color: A.text },
  cardCount: { minWidth: 20 },
  cardBody: { padding: 16, gap: 12 },
  infoWrap: { position: 'relative', zIndex: 5 },
  info: { width: 22, height: 22, minWidth: 22, borderRadius: 11, borderWidth: 1, borderColor: A.line, alignItems: 'center', justifyContent: 'center', backgroundColor: A.card },
  infoMark: { color: A.textSecondary, fontWeight: '700', fontSize: 12, lineHeight: 14 },
  infoPop: { position: 'absolute', top: 28, left: -8, width: 280, padding: 12, gap: 6, borderRadius: 10, borderWidth: 1, borderColor: A.line, backgroundColor: A.card, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  // For ⓘ near the right edge (e.g. the conversation review column) the popover opens leftward.
  infoPopRight: { left: undefined, right: -8 },
  infoText: { color: A.textSecondary },
  button: { minHeight: 40, minWidth: 44, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: A.accent, borderColor: A.accent },
  secondary: { backgroundColor: A.card, borderColor: A.line },
  danger: { backgroundColor: A.card, borderColor: A.danger },
  text: { backgroundColor: 'transparent', borderColor: 'transparent', paddingHorizontal: 6 },
  moreWrap: { position: 'relative', zIndex: 6 },
  more: { paddingHorizontal: 10 },
  menu: { position: 'absolute', right: 0, top: 44, minWidth: 180, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: A.line, backgroundColor: A.card, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  menuUp: { top: undefined, bottom: 44 },
  menuItem: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 14 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  fact: { flexGrow: 1, minWidth: 120, gap: 4, padding: 12, borderRadius: 10, backgroundColor: A.backgroundElement },
  factLabel: { color: A.textSecondary },
  dock: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: A.line, backgroundColor: A.card },
  pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' },
  trace: { gap: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: A.line },
  traceLine: { color: A.textSecondary, fontFamily: Platform.OS === 'web' ? 'ui-monospace, Menlo, monospace' : undefined },
});
