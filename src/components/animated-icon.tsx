import { usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, interpolateColor, ReduceMotion, useAnimatedStyle,
  useDerivedValue, useReducedMotion, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Colors, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { LAUNCH_DURATION, launchFrame } from '@/lib/launch-motion';

const WORDMARK = require('@/assets/brand/gling-wordmark.png');

export function AnimatedSplashOverlay() {
  const theme = useTheme();
  const dark = theme === Colors.dark;
  const reducedMotion = useReducedMotion();
  const pathname = usePathname();
  const initialPath = useRef(pathname);
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const [visible, setVisible] = useState(true);
  const [laidOut, setLaidOut] = useState(false);
  const [loaded, setLoaded] = useState(0);
  const elapsed = useSharedValue(0);
  const home = pathname === '/';
  // Match FeedScreen's centered 64 × 36 image in its padded, minimum-44pt row.
  const targetX = Math.max(0, (width - MaxContentWidth) / 2) + Spacing.three;
  const targetY = insets.top + Spacing.two + (Math.max(44, 20 * fontScale) - 64 * 320 / 720) / 2;
  const frame = useDerivedValue(() => launchFrame(elapsed.value, width, height,
    home ? { x: targetX, y: targetY, scale: 64 / 720 } : null));
  const dismiss = useCallback(() => {
    void SplashScreen.hideAsync().catch(() => {});
    setVisible(false);
  }, []);

  useEffect(() => {
    if (!visible) return;
    // A failed local asset must never strand the app behind its launch screen.
    const fallback = setTimeout(dismiss, 3000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'background') dismiss();
    });
    return () => { clearTimeout(fallback); subscription.remove(); cancelAnimation(elapsed); };
  }, [dismiss, elapsed, visible]);

  useEffect(() => {
    if (pathname !== initialPath.current) dismiss();
  }, [dismiss, pathname]);

  useEffect(() => {
    if (!visible || !laidOut || (!reducedMotion && loaded !== 15)) return;
    void SplashScreen.hideAsync().catch(() => {});
    elapsed.set(withTiming(LAUNCH_DURATION, {
      duration: reducedMotion ? 120 : LAUNCH_DURATION,
      easing: Easing.linear,
      reduceMotion: ReduceMotion.Never, // Reduced motion uses only the 120ms curtain fade below.
    }, finished => { if (finished) scheduleOnRN(dismiss); }));
    return () => cancelAnimation(elapsed);
  }, [dismiss, elapsed, laidOut, loaded, reducedMotion, visible]);

  const curtainStyle = useAnimatedStyle(() => ({
    opacity: reducedMotion ? 1 - elapsed.value / LAUNCH_DURATION : frame.value.curtainOpacity,
  }));
  const logoStyle = useAnimatedStyle(() => ({
    left: frame.value.x, top: frame.value.y, opacity: frame.value.logoOpacity,
    transform: [{ scale: frame.value.scale }],
  }));
  const glyphStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: frame.value.gx }, { translateY: frame.value.gy }, { scale: frame.value.gScale }],
  }));
  const clipStyle = useAnimatedStyle(() => ({
    left: 86 - frame.value.clipWidth / 2, top: 160 - frame.value.clipHeight / 2,
    width: frame.value.clipWidth, height: frame.value.clipHeight,
  }));
  const clipContentStyle = useAnimatedStyle(() => ({
    left: frame.value.clipWidth / 2 - 86, top: frame.value.clipHeight / 2 - 160,
  }));
  const inkStyle = useAnimatedStyle(() => ({
    tintColor: interpolateColor(frame.value.ink, [0, 1], [theme.accent, dark ? theme.text : '#11171E']),
  }));
  const prefixStyle = useAnimatedStyle(() => ({
    left: 512 * (1 - frame.value.prefix), width: 512 * frame.value.prefix, opacity: frame.value.prefix,
  }));
  const prefixImageStyle = useAnimatedStyle(() => ({ left: -512 * (1 - frame.value.prefix) }));
  const orbitStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${frame.value.rotation}deg` }] }));
  const dotStyle = useAnimatedStyle(() => ({
    tintColor: dark ? interpolateColor(frame.value.ink, [0, 1], ['#DA2E1E', theme.text]) : undefined,
  }));
  const headerMaskStyle = useAnimatedStyle(() => ({ opacity: frame.value.headerMaskOpacity }));

  if (!visible) return null;
  return (
    <View style={styles.overlay} onLayout={() => setLaidOut(true)} onTouchStart={dismiss}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {!reducedMotion && home && <Animated.View style={[
        { position: 'absolute', left: targetX, top: targetY, width: 64, height: 64 * 320 / 720, backgroundColor: theme.background },
        headerMaskStyle,
      ]} />}
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }, curtainStyle]} />
      {!reducedMotion && <Animated.View style={[styles.wordmark, logoStyle]}>
        <Animated.View style={[styles.prefix, prefixStyle]}>
          <Animated.Image source={WORDMARK} resizeMode="stretch"
            style={[styles.image, dark && { tintColor: theme.text }, prefixImageStyle]}
            onLoad={() => setLoaded(value => value | 1)} onError={dismiss} />
        </Animated.View>
        <Animated.View style={[styles.glyph, glyphStyle]}>
          <Animated.View style={[styles.clip, clipStyle]}>
            <Animated.View style={[styles.glyphContent, clipContentStyle]}>
              <View style={styles.glyphTop}>
                <Animated.Image source={WORDMARK} resizeMode="stretch" style={[styles.image, { left: -512 }, inkStyle]}
                  onLoad={() => setLoaded(value => value | 2)} onError={dismiss} />
              </View>
              <View style={styles.glyphBottom}>
                <Animated.Image source={WORDMARK} resizeMode="stretch" style={[styles.image, { left: -512, top: -118 }, inkStyle]}
                  onLoad={() => setLoaded(value => value | 4)} onError={dismiss} />
              </View>
            </Animated.View>
          </Animated.View>
          <Animated.View style={[styles.orbit, orbitStyle]}>
            <View style={styles.dot}>
              <Animated.Image source={WORDMARK} resizeMode="stretch" style={[styles.image, { left: -649, top: -68 }, dotStyle]}
                onLoad={() => setLoaded(value => value | 8)} onError={dismiss} />
            </View>
          </Animated.View>
        </Animated.View>
      </Animated.View>}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 1000, elevation: 1000 },
  wordmark: { position: 'absolute', width: 720, height: 320, transformOrigin: [0, 0, 0] },
  image: { position: 'absolute', width: 720, height: 320 },
  prefix: { position: 'absolute', top: 0, height: 320, overflow: 'hidden' },
  glyph: { position: 'absolute', left: 512, top: 0, width: 208, height: 320, transformOrigin: [86, 164, 0] },
  clip: { position: 'absolute', overflow: 'hidden', borderRadius: '50%' },
  glyphContent: { position: 'absolute', width: 208, height: 320 },
  glyphTop: { position: 'absolute', width: 133, height: 118, overflow: 'hidden' },
  glyphBottom: { position: 'absolute', top: 118, width: 208, height: 202, overflow: 'hidden' },
  orbit: { position: 'absolute', width: 208, height: 320, transformOrigin: [86, 164, 0] },
  dot: { position: 'absolute', left: 137, top: 68, width: 38, height: 38, overflow: 'hidden' },
});
