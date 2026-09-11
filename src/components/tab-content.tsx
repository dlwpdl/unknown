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
      toValue: 1, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true,
    });
    animation.start();
    return () => { animation.stop(); progress.setValue(1); };
  }, [progress, reducedMotion]));

  return <Animated.View {...props} style={[
    { backgroundColor: theme.background }, style,
    {
      opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }),
      transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }],
    },
  ]} />;
}
