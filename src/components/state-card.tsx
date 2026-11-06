import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { SymbolView } from '@/components/symbol-view';
import { ClayBoxFill, ClayIcon, ClayPillFill, useClay, useClayBox } from '@/components/clay';
import { Animated, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { Typography } from '@/constants/design-system';
import { Depth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

type StateKind = 'empty' | 'error' | 'blocked' | 'update' | 'pending' | 'success';

// 빈 화면·오류·권한 없음이 화면마다 다른 모양이면 사용자는 "고장"과 "비어 있음"을 구분하지 못한다.
const glyphs = {
  empty: { ios: 'tray', android: 'inbox', web: 'inbox' },
  error: { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' },
  blocked: { ios: 'lock', android: 'lock', web: 'lock' },
  update: { ios: 'arrow.triangle.2.circlepath', android: 'update', web: 'update' },
  pending: { ios: 'clock', android: 'schedule', web: 'schedule' },
  success: { ios: 'checkmark.circle', android: 'check_circle', web: 'check_circle' },
} as const;

const marks = {
  alert: { ios: 'exclamationmark', android: 'priority_high', web: 'priority_high' },
  minus: { ios: 'minus', android: 'remove', web: 'remove' },
  check: { ios: 'checkmark', android: 'check', web: 'check' },
} as const;

/** A small confirming pop as something appears. Reduced motion shows it straight away. */
export function PopIn({ children, style }: { children: ReactNode; style?: ComponentProps<typeof Animated.View>['style'] }) {
  const reduced = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(reduced ? 1 : 0.6));
  useEffect(() => { if (!reduced) Animated.spring(scale, { toValue: 1, damping: 11, stiffness: 320, mass: 0.7, useNativeDriver: true }).start(); }, [reduced, scale]);
  return <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>;
}

/** layout="start" is the state at the top of a task screen: left-aligned, with what's next under it. */
export function StateCard({ kind = 'empty', title, body, actionLabel, onAction, layout = 'center', mark, children, analyticsId = 'components_state-card.pressable.1' }: {
  kind?: StateKind; title: string; body: string; actionLabel?: string; onAction?: () => void; layout?: 'center' | 'start'; mark?: keyof typeof marks; children?: ReactNode; analyticsId?: string;
}) {
  const theme = useTheme();
  const clay = useClay(), clayBox = useClayBox();
  const { play } = useInteractionFeedback();
  if (layout === 'start') return <View accessibilityLiveRegion="polite" style={[styles.startCard, clayBox ? styles.clayCard : { borderColor: theme.line, backgroundColor: theme.card }]}>
    {clayBox && <ClayBoxFill kind="tile" />}
    {mark === 'check' ? <PopIn style={[styles.mark, { backgroundColor: theme.accent }]}><SymbolView name={marks.check} size={20} tintColor={theme.accentInk} /></PopIn>
      : mark ? <View style={[styles.mark, { backgroundColor: theme.backgroundSelected }]}><SymbolView name={marks[mark]} size={20} tintColor={theme.accent} /></View> : null}
    <ThemedText accessibilityRole="header" style={Typography.section}>{title}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary" style={styles.startBody}>{body}</ThemedText>
    {children}
  </View>;
  return <View style={[styles.card, clayBox ? styles.clayCard : [Depth.card, { borderColor: theme.line, backgroundColor: theme.card }]]}>
    {clayBox && <ClayBoxFill kind="tile" />}
    {clay && kind === 'empty' ? <ClayIcon clay="empty" claySize={60} size={60} /> : <View style={[styles.glyph, { backgroundColor: theme.backgroundElement }]}>
      <SymbolView name={glyphs[kind]} size={22} tintColor={kind === 'error' ? theme.accent : theme.textSecondary} />
    </View>}
    <ThemedText type="smallBold" style={styles.title}>{title}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary" style={styles.body}>{body}</ThemedText>
    {actionLabel && onAction && <Pressable lens analyticsId={analyticsId} accessibilityRole="button" accessibilityLabel={actionLabel}
      onPress={() => { play(kind === 'error' ? 'warning' : 'selection'); onAction(); }}
      style={({ pressed }) => [styles.action, { backgroundColor: clay ? 'transparent' : theme.accent, opacity: pressed ? 0.8 : 1 }]}>
      {clay && <ClayPillFill kind="cta" />}
      <ThemedText type="smallBold" style={[Typography.menu, { color: theme.accentInk }]}>{actionLabel}</ThemedText>
    </Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  clayCard: { backgroundColor: 'transparent', borderColor: 'transparent', overflow: 'visible' },
  card: { borderWidth: 1, borderRadius: 16, padding: Spacing.four, gap: Spacing.two, alignItems: 'center' },
  startCard: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.one + Spacing.half },
  startBody: { fontSize: 14, lineHeight: 20 },
  mark: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.one },
  glyph: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.one },
  title: { ...Typography.section, textAlign: 'center' },
  body: { fontSize: 14, lineHeight: 22, textAlign: 'center' },
  action: { minHeight: 44, borderRadius: 999, paddingHorizontal: Spacing.four, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.two },
});
