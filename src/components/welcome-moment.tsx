import { useEffect, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';

import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

const confetti = [
  [-144, -250, '#F9C76C', -32], [-68, -310, '#CBB9FF', 18], [48, -290, '#F35CBB', 43], [142, -232, '#83D9E7', -18],
  [-158, -92, '#F35CBB', 28], [152, -82, '#F9C76C', -38], [-138, 92, '#83D9E7', 45], [132, 116, '#CBB9FF', 16],
  [-98, 244, '#F9C76C', -20], [20, 280, '#F35CBB', 35], [112, 235, '#83D9E7', -42], [-10, -350, '#F9C76C', 12],
] as const;

export function WelcomeMoment({ nickname, onContinue }: { nickname: string; onContinue: () => void }) {
  const reducedMotion = useReducedMotion();
  const { play } = useInteractionFeedback();
  const [burst] = useState(() => new Animated.Value(reducedMotion ? 1 : 0));
  const [rise] = useState(() => new Animated.Value(reducedMotion ? 0 : 24));

  useEffect(() => {
    if (reducedMotion) return;
    Animated.parallel([
      Animated.timing(burst, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(rise, { toValue: 0, speed: 13, bounciness: 7, useNativeDriver: true }),
    ]).start();
  }, [burst, reducedMotion, rise]);

  return <SafeAreaView style={styles.screen}>
    <Image source={require('@/assets/brand/gling-night-splash-light.png')} resizeMode="cover" style={styles.light} />
    <View style={styles.content}>
      {!reducedMotion && confetti.map(([x, y, color, angle], index) => <Animated.View key={index} pointerEvents="none" style={[styles.confetti, {
        backgroundColor: color,
        opacity: burst.interpolate({ inputRange: [0, 0.2, 0.75, 1], outputRange: [0, 1, 0.75, 0] }),
        transform: [
          { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, x] }) },
          { translateY: burst.interpolate({ inputRange: [0, 1], outputRange: [0, y] }) },
          { rotate: burst.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${angle}deg`] }) },
        ],
      }]} />)}
      <Animated.View style={{ alignItems: 'center', transform: [{ translateY: rise }] }}>
        <Animated.View style={{ transform: reducedMotion ? undefined : [{ scale: burst.interpolate({ inputRange: [0, 0.65, 1], outputRange: [0.72, 1.08, 1] }) }] }}>
          <Image source={require('@/assets/brand/gling-night-wordmark.png')} resizeMode="contain" style={styles.mark} />
        </Animated.View>
        <ThemedText accessibilityRole="header" style={styles.title}>글링에 오신 걸 환영해요, {nickname}님!</ThemedText>
        <ThemedText style={styles.subtitle}>페스티벌도, 동네의 작은 한잔도. 마음 맞는 사람을 여기서 만나요.</ThemedText>
      </Animated.View>
    </View>
    <Pressable analyticsId="onboarding.welcome.start" accessibilityRole="button" onPress={() => { play('selection'); onContinue(); }} style={({ pressed }) => [styles.button, { opacity: pressed ? 0.72 : 1, transform: [{ scale: pressed && !reducedMotion ? 0.97 : 1 }] }]}>
      <ThemedText type="smallBold" style={styles.buttonText}>글링 시작하기</ThemedText>
    </Pressable>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B0B12', justifyContent: 'center', paddingHorizontal: 28, paddingBottom: 28 },
  light: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  confetti: { position: 'absolute', width: 11, height: 22, borderRadius: 3 },
  mark: { width: 250, height: 110, marginBottom: 20 },
  title: { color: '#F6F3F0', fontSize: 27, lineHeight: 36, fontWeight: '800', textAlign: 'center', letterSpacing: -1 },
  subtitle: { color: '#D2CBDB', fontSize: 15, lineHeight: 23, textAlign: 'center', marginTop: 12, maxWidth: 285 },
  button: { minHeight: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 28, backgroundColor: '#CBB9FF' },
  buttonText: { color: '#171123', fontSize: 16 },
});
