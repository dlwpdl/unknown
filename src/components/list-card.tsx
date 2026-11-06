import { Children, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SymbolView } from '@/components/symbol-view';

import { Pressable } from '@/components/analytics-controls';
import { ClayBoxFill, ClayCoinFill, ClayPillFill, useClay, useClayBox } from '@/components/clay';
import { GlingLoader } from '@/components/gling-loader';
import { ThemedText } from '@/components/themed-text';
import { IconSize, Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

export function SectionLabel({ children }: { children: string }) {
  return <ThemedText accessibilityRole="header" themeColor="textSecondary" style={[Typography.label, styles.section]}>{children}</ThemedText>;
}

/** Rows grouped in one card, split by hairlines, instead of a separate box for each. */
export function ListCard({ children }: { children: ReactNode }) {
  const theme = useTheme(), clay = useClayBox();
  const rows = Children.toArray(children).map((child, index) => <View key={index} style={index ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line } : undefined}>{child}</View>);
  // The clay tile overhangs the card, so only the rows inside are clipped to its corners.
  if (clay) return <View><ClayBoxFill kind="tile" /><View style={styles.clayRows}>{rows}</View></View>;
  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>{rows}</View>;
}

export function Tag({ label, tone = 'accent' }: { label: string; tone?: 'accent' | 'quiet' | 'danger' }) {
  const theme = useTheme(), clay = useClay();
  return <View style={[styles.tag, clay ? styles.clayTag : { backgroundColor: tone === 'accent' ? theme.backgroundSelected : theme.backgroundElement }]}>
    {clay && <ClayPillFill kind="white" />}
    <ThemedText style={[Typography.caption, { color: tone === 'accent' ? theme.accent : tone === 'danger' ? theme.danger : theme.textSecondary }]}>{label}</ThemedText>
  </View>;
}

export function InitialAvatar({ name }: { name: string }) {
  const theme = useTheme(), clay = useClay();
  return <View accessible={false} style={[styles.avatar, !clay && { backgroundColor: theme.backgroundSelected }]}>{clay && <ClayCoinFill />}<ThemedText style={Typography.label}>{[...name][0] ?? ''}</ThemedText></View>;
}

/** What a screen shows until its first load finishes, so it never sits blank. */
export function ListLoading({ label }: { label: string }) {
  const theme = useTheme();
  return <View style={styles.loading}><GlingLoader color={theme.accent} accessibilityLabel={label} /></View>;
}

/** One row. With onPress it is a link with a chevron and a pressed tint; without, it just holds the content on its right. */
export function ListRow({ analyticsId, title, detail, leading, trailing, onPress, danger, label }: {
  analyticsId?: string; title: string; detail?: string; leading?: ReactNode; trailing?: ReactNode; onPress?: () => void; danger?: boolean; label?: string;
}) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  const content = <>
    {leading}
    <View style={styles.text}>
      <ThemedText style={[Typography.body, danger && { color: theme.danger }]}>{title}</ThemedText>
      {!!detail && <ThemedText themeColor="textSecondary" style={Typography.supporting}>{detail}</ThemedText>}
    </View>
    {trailing}
    {!!onPress && <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={IconSize.chevron} tintColor={theme.textSecondary} />}
  </>;
  if (!onPress) return <View style={styles.row}>{content}</View>;
  return <Pressable analyticsId={analyticsId ?? ''} accessibilityRole="button" accessibilityLabel={label ?? (detail ? `${title}, ${detail}` : title)} onPress={() => { play('selection'); onPress(); }}
    style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>{content}</Pressable>;
}

const styles = StyleSheet.create({
  loading: { minHeight: 160, alignItems: 'center', justifyContent: 'center' },
  section: { marginTop: Spacing.four, marginBottom: Spacing.two },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, overflow: 'hidden' },
  clayRows: { borderRadius: 16, overflow: 'hidden' },
  clayTag: { paddingHorizontal: 12, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 56, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  text: { flex: 1, minWidth: 0 },
  tag: { borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
