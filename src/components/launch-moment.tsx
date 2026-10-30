import { useLanguage } from '@/hooks/use-language';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

// Full-screen overlay above the app (not a Modal: an initially visible Modal can fail to present at launch).
export function LaunchMoment({ ready, onComplete }: { ready: boolean; onComplete: () => void }) {
  const { tr } = useLanguage();
  const reducedMotion = useReducedMotion();
  const [entered, setEntered] = useState(false);
  const [laidOut, setLaidOut] = useState(false);
  const [nativeHidden, setNativeHidden] = useState(false);
  const completed = useRef(false), complete = useRef(onComplete);
  const [opacity] = useState(() => new Animated.Value(1));
  const [wordmarkOpacity] = useState(() => new Animated.Value(0));
  const [wordmarkY] = useState(() => new Animated.Value(0));
  const [wordmarkScale] = useState(() => new Animated.Value(1));
  const [glowOpacity] = useState(() => new Animated.Value(0));
  const [glowScale] = useState(() => new Animated.Value(0.85));

  useEffect(() => { complete.current = onComplete; }, [onComplete]);

  useEffect(() => {
    if (!laidOut) return;
    let active = true;
    const hidden = () => { if (active) setNativeHidden(true); };
    // The native splash shares this background, so a lost hide callback only needs a short escape.
    const fallback = setTimeout(hidden, 800);
    try { void SplashScreen.hideAsync().then(hidden, hidden); } catch { hidden(); }
    return () => { active = false; clearTimeout(fallback); };
  }, [laidOut]);

  useEffect(() => {
    if (!ready || !entered || completed.current) return;
    let active = true;
    const finish = () => { if (active && !completed.current) { completed.current = true; complete.current(); } };
    if (reducedMotion) { finish(); return; }
    // A lost native completion must not retain the now-transparent startup overlay.
    const fallback = setTimeout(finish, 800);
    const exit = Animated.timing(opacity, { toValue: 0, duration: 300, easing: Easing.in(Easing.cubic), useNativeDriver: true });
    exit.start(({ finished }) => { if (finished) finish(); });
    return () => { active = false; clearTimeout(fallback); exit.stop(); };
  }, [entered, opacity, ready, reducedMotion]);

  useEffect(() => {
    if (!entered || ready || reducedMotion) return;
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(wordmarkOpacity, { toValue: 0.72, duration: 900, useNativeDriver: true }),
      Animated.timing(wordmarkOpacity, { toValue: 1, duration: 900, useNativeDriver: true }),
    ]));
    pulse.start();
    return () => pulse.stop();
  }, [entered, ready, reducedMotion, wordmarkOpacity]);

  useEffect(() => {
    if (!nativeHidden || entered) return;
    let active = true;
    let hold: ReturnType<typeof setTimeout>;
    const settle = () => { if (active) setEntered(true); };
    if (reducedMotion) {
      hold = setTimeout(settle, 600);
      return () => { active = false; clearTimeout(hold); };
    }
    const fallback = setTimeout(settle, 1500);
    const entry = Animated.parallel([
      Animated.timing(wordmarkOpacity, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(glowScale, { toValue: 1.25, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(glowOpacity, { toValue: 0.85, duration: 480, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(wordmarkY, { toValue: -10, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(wordmarkY, { toValue: 0, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.timing(wordmarkScale, { toValue: 1.045, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(wordmarkScale, { toValue: 1, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
    ]);
    entry.start(({ finished }) => { if (active && finished) hold = setTimeout(settle, 250); });
    return () => { active = false; clearTimeout(hold); clearTimeout(fallback); entry.stop(); };
  }, [entered, glowOpacity, glowScale, nativeHidden, reducedMotion, wordmarkOpacity, wordmarkScale, wordmarkY]);

  return <Animated.View
    accessible accessibilityViewIsModal accessibilityLabel={tr("글링을 여는 중")}
    onLayout={() => setLaidOut(true)}
    style={[styles.screen, { opacity }]}>
    {!reducedMotion && <Animated.Image source={require('@/assets/brand/gling-night-splash-light.png')} resizeMode="cover" fadeDuration={0} style={[styles.light, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />}
    <Animated.View style={[styles.wordmark, { opacity: reducedMotion ? 1 : wordmarkOpacity, transform: [{ translateY: wordmarkY }, { scale: wordmarkScale }] }]}>
      <Image source={require('@/assets/brand/gling-night-wordmark.png')} resizeMode="contain" fadeDuration={0} style={styles.wordmarkImage} />
    </Animated.View>
  </Animated.View>;
}

const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFill, zIndex: 1000, elevation: 1000, backgroundColor: '#0B0B12', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  light: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  wordmark: { alignItems: 'center', justifyContent: 'center' },
  wordmarkImage: { width: 305, height: 132 },
});
