import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

export function LaunchMoment({ ready, onComplete }: { ready: boolean; onComplete: () => void }) {
  const reducedMotion = useReducedMotion();
  const [entered, setEntered] = useState(false);
  const started = useRef(false);
  const ending = useRef(false);
  const [opacity] = useState(() => new Animated.Value(1));
  const [wordmarkOpacity] = useState(() => new Animated.Value(0));
  const [wordmarkY] = useState(() => new Animated.Value(0));
  const [wordmarkScale] = useState(() => new Animated.Value(1));
  const [glowOpacity] = useState(() => new Animated.Value(0));
  const [glowScale] = useState(() => new Animated.Value(0.85));

  useEffect(() => {
    if (!ready || !entered || ending.current) return;
    ending.current = true;
    if (reducedMotion) { onComplete(); return; }
    Animated.timing(opacity, { toValue: 0, duration: 340, easing: Easing.in(Easing.cubic), useNativeDriver: true })
      .start(() => onComplete());
  }, [entered, onComplete, opacity, ready, reducedMotion]);

  useEffect(() => {
    if (!entered || ready || reducedMotion) return;
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(wordmarkOpacity, { toValue: 0.72, duration: 900, useNativeDriver: true }),
      Animated.timing(wordmarkOpacity, { toValue: 1, duration: 900, useNativeDriver: true }),
    ]));
    pulse.start();
    return () => pulse.stop();
  }, [entered, ready, reducedMotion, wordmarkOpacity]);

  return <Animated.View
    accessible accessibilityLabel="글링을 여는 중"
    onLayout={() => {
      if (started.current) return;
      started.current = true;
      void SplashScreen.hideAsync().catch(() => {});
      if (reducedMotion) { setEntered(true); return; }
      Animated.parallel([
        Animated.timing(wordmarkOpacity, { toValue: 1, duration: 920, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(glowScale, { toValue: 1.25, duration: 920, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(glowOpacity, { toValue: 0.85, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(wordmarkY, { toValue: -10, duration: 460, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(wordmarkY, { toValue: 0, duration: 460, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(wordmarkScale, { toValue: 1.045, duration: 460, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(wordmarkScale, { toValue: 1, duration: 460, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]),
      ]).start(() => setEntered(true));
    }}
    style={[styles.screen, { opacity }]}>
    {!reducedMotion && <>
      <Animated.Image source={require('@/assets/brand/gling-night-splash-light.png')} resizeMode="cover" style={[styles.light, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />
    </>}
    <Animated.View style={[styles.wordmark, { opacity: reducedMotion ? 1 : wordmarkOpacity, transform: [{ translateY: wordmarkY }, { scale: wordmarkScale }] }]}>
      <Image source={require('@/assets/brand/gling-night-wordmark.png')} resizeMode="contain" style={styles.wordmarkImage} />
    </Animated.View>
  </Animated.View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B0B12', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  light: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  wordmark: { alignItems: 'center', justifyContent: 'center' },
  wordmarkImage: { width: 305, height: 132 },
});
