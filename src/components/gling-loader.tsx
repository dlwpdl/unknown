import { useEffect, useState } from 'react';
import { Animated, Easing, Image, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

/** 글링의 G와 금색 점이 서로 반응하는 로더. 화면과 버튼에서 같은 리듬을 쓴다. */
export function GlingLoader({
  accessibilityLabel = '불러오는 중',
  color = '#CBB9FF',
  size = 38,
  style,
}: {
  accessibilityLabel?: string;
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
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

  const dotSize = Math.max(3, size * 0.084);
  return <View accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel} style={[styles.container, style]}>
    <View style={{ width: size, height: size }}>
      <Animated.View style={{ opacity: reducedMotion ? 1 : progress, transform: reducedMotion ? undefined : [
        { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.09] }) },
        { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['-5deg', '6deg'] }) },
      ] }}>
        <Image source={require('@/assets/brand/gling-night-loader-ring.png')} resizeMode="contain" style={{ width: size, height: size, tintColor: color }} />
      </Animated.View>
      <Animated.View style={[styles.dot, {
        opacity: reducedMotion ? 1 : progress,
        width: dotSize,
        height: dotSize,
        borderRadius: dotSize / 2,
        left: size * (761 / 1024) - dotSize / 2,
        top: size * (240 / 1024) - dotSize / 2,
        transform: reducedMotion ? undefined : [
          { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.16] }) },
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, size * 0.09] }) },
          { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] }) },
        ],
      }]} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  container: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', backgroundColor: '#F9C76C' },
});
