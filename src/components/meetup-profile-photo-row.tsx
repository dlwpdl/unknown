import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, PanResponder, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useReducedMotion } from 'react-native-reanimated';

import { ControlMotion, IconSize } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { dropIndex } from '@/lib/meetup-profile-photos';

type Props = {
  index: number; count: number; offset: number; active: boolean; lifted: boolean; disabled: boolean;
  onLift: () => void; onOver: (to: number) => void; onDrop: (to: number) => void; onCancel: () => void; children: ReactNode;
};

/** One meetup photo row. Its handle follows the finger; screen readers use the move buttons in children, so the handle is hidden from them. */
export function MeetupProfilePhotoRow({ index, count, offset, active, lifted, disabled, onLift, onOver, onDrop, onCancel, children }: Props) {
  const theme = useTheme(), reduced = useReducedMotion();
  const [y] = useState(() => new Animated.Value(0));
  const height = useRef(0);
  const latest = useRef({ index, count, disabled, reduced, onLift, onOver, onDrop, onCancel });
  useLayoutEffect(() => { latest.current = { index, count, disabled, reduced, onLift, onOver, onDrop, onCancel }; });
  useLayoutEffect(() => {
    // The list order has already changed when a drag ends, so every row goes home without travelling.
    if (!active) y.setValue(0);
    else if (!lifted) {
      if (reduced) y.setValue(offset * height.current);
      else Animated.timing(y, { toValue: offset * height.current, duration: ControlMotion.settleMs, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
  }, [active, lifted, offset, reduced, y]);
  // eslint-disable-next-line react-hooks/refs -- these handlers read the refs during a gesture, never during render
  const [pan] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !latest.current.disabled,
    onMoveShouldSetPanResponder: () => !latest.current.disabled,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { y.stopAnimation(); latest.current.onLift(); },
    onPanResponderMove: (_, g) => {
      const { index: from, count: total, onOver: over } = latest.current;
      y.setValue(Math.max(-from * height.current, Math.min((total - 1 - from) * height.current, g.dy)));
      over(dropIndex(from, g.dy, height.current, total));
    },
    onPanResponderRelease: (_, g) => {
      const { index: from, count: total, reduced: still, onDrop: drop } = latest.current;
      const to = dropIndex(from, g.dy, height.current, total);
      if (still) { drop(to); return; }
      Animated.timing(y, { toValue: (to - from) * height.current, duration: ControlMotion.pressMs, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => drop(to));
    },
    onPanResponderTerminate: () => latest.current.onCancel(),
  }));
  return <Animated.View onLayout={event => { height.current = event.nativeEvent.layout.height; }}
    style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line }, lifted && { zIndex: 1, borderRadius: 16, backgroundColor: theme.backgroundSelected }, { transform: [{ translateY: y }] }]}>
    <View {...pan.panHandlers} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={[styles.handle, disabled && { opacity: ControlMotion.disabledOpacity }]}>
      <SymbolView name={{ ios: 'line.3.horizontal', android: 'drag_handle', web: 'drag_handle' }} size={IconSize.toolbar} tintColor={theme.textSecondary} />
    </View>
    {children}
  </Animated.View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.two, paddingRight: Spacing.one },
  handle: { width: 40, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
});
