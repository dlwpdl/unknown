import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Animated, Easing, Platform, type ViewProps } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';

export function TabContent({ style, ...props }: ViewProps) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(1));
  const [moving, setMoving] = useState(false);

  useFocusEffect(useCallback(() => {
    // Web already animates its shared TabSlot; native tabs keep their system bar.
    if (Platform.OS === 'web' || reducedMotion) return;
    progress.setValue(0);
    setMoving(true);
    const animation = Animated.timing(progress, {
      toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    });
    animation.start();
    // A native-driven value never reaches the committed props, so closing a sheet or moving the bubble bar repainted the 35% start frame (white veil, owner 2026-11-05). Drop the animated style once it lands.
    const settle = setTimeout(() => { progress.setValue(1); setMoving(false); }, 300);
    return () => { clearTimeout(settle); animation.stop(); progress.setValue(1); setMoving(false); };
  }, [progress, reducedMotion]));

  return <Animated.View {...props} style={[
    { backgroundColor: theme.background }, style,
    moving && {
      opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
      transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
    },
  ]} />;
}
