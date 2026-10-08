import { useEffect, useState } from 'react';
import { Animated, Easing, Image, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { Colors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** 현재 워드마크 원본을 부드럽게 강조하는 공용 로더. */
export function GlingLoader({
  accessibilityLabel = '불러오는 중',
  size = 38,
  style,
}: {
  accessibilityLabel?: string;
  /** 기존 호출 호환용. 로고 색은 브랜드 원본을 유지한다. */
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reducedMotion) return;
    const motion = Animated.loop(Animated.sequence([
      Animated.timing(progress, { toValue: 1, duration: 680, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(progress, { toValue: 0, duration: 680, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.delay(180),
    ]));
    motion.start();
    return () => motion.stop();
  }, [progress, reducedMotion]);

  return <View accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel} style={[styles.container, style]}>
    <Animated.View style={{ opacity: reducedMotion ? 1 : progress.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }), transform: reducedMotion ? undefined : [
      { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.04] }) },
    ] }}>
      <Image source={theme === Colors.light ? require('@/assets/brand/gling-night-wordmark-light.png') : require('@/assets/brand/gling-night-wordmark.png')}
        resizeMode="contain" style={{ width: size * 2.4, height: size }} />
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  container: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
});
