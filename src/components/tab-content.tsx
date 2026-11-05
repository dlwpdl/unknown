import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Animated, Easing, Platform, type ViewProps } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';

export function TabContent({ style, ...props }: ViewProps) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(1));

  useFocusEffect(useCallback(() => {
    // Web already animates its shared TabSlot; native tabs keep their system bar.
    if (Platform.OS === 'web' || reducedMotion) return;
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    });
    animation.start();
    // iOS can drop a native-driver animation when a sheet or the live-bubble bar changes the screen mid-fade, leaving the tab stuck at 35% (a white veil, owner 2026-11-05). Land on 1 regardless.
    const settle = setTimeout(() => progress.setValue(1), 300);
    return () => { clearTimeout(settle); animation.stop(); progress.setValue(1); };
  }, [progress, reducedMotion]));

  return <Animated.View {...props} style={[
    { backgroundColor: theme.background }, style,
    {
      opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
      transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
    },
  ]} />;
}
