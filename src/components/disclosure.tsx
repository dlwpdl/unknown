import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, LayoutAnimation, StyleSheet, View } from 'react-native';
import { SymbolView } from '@/components/symbol-view';
import { useReducedMotion } from 'react-native-reanimated';

import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { ControlMotion, IconSize, Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

/** Call right before a state change that adds or removes content, so what is below slides instead of jumping. */
export function animateLayout(reduced: boolean) {
  if (!reduced) LayoutAnimation.configureNext(LayoutAnimation.create(ControlMotion.expandMs, 'easeInEaseOut', 'opacity'));
}

/** A heading that opens the detail under it. The chevron turns and the content below slides. */
export function Disclosure({ analyticsId, title, children, onOpen }: { analyticsId: string; title: string; children: ReactNode; onOpen?: () => void }) {
  const theme = useTheme(), { play } = useInteractionFeedback(), reduced = useReducedMotion();
  const [open, setOpen] = useState(false), [turn] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) turn.setValue(open ? 1 : 0);
    else Animated.timing(turn, { toValue: open ? 1 : 0, duration: ControlMotion.expandMs, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [open, reduced, turn]);
  return <View>
    <Pressable analyticsId={analyticsId} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: open }} style={styles.row}
      onPress={() => { play('selection'); animateLayout(reduced); if (!open) onOpen?.(); setOpen(value => !value); }}>
      <ThemedText style={[Typography.body, styles.title]}>{title}</ThemedText>
      <Animated.View style={{ transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }] }}>
        <SymbolView name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }} size={IconSize.chevron} tintColor={theme.textSecondary} />
      </Animated.View>
    </Pressable>
    {open && <View style={styles.body}>{children}</View>}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 },
  title: { flex: 1 },
  body: { paddingBottom: Spacing.two, gap: Spacing.two },
});
