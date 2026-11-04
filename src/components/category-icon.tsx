import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import { Platform, StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import { Colors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ALIVE_BEZIER, aliveMotion, aliveSteps } from '@/lib/category-motion';

// Owner 2026-11-04 ⑪: Gling's own 3D artwork (category-icon-chips-2026-11-03/own3d/s, 144px, transparent).
const ART = {
  top25: require('@/assets/images/map-categories/top25.png'), delivery: require('@/assets/images/map-categories/delivery.png'),
  dining: require('@/assets/images/map-categories/dining.png'), cafe: require('@/assets/images/map-categories/cafe.png'),
  festival: require('@/assets/images/map-categories/festival.png'), nightlife: require('@/assets/images/map-categories/nightlife.png'),
  places: require('@/assets/images/map-categories/places.png'), housing: require('@/assets/images/map-categories/housing.png'),
  used: require('@/assets/images/map-categories/used.png'), events: require('@/assets/images/map-categories/events.png'),
} as const;
const SIZE = 24;
const easing = Easing.bezier(...ALIVE_BEZIER);

// A thin halo keeps the artwork readable over the map seen through the chip (mockup ⑪): white on light chips, dark on dark ones.
// iOS draws `filter: drop-shadow` only behind a React Native feature flag, so it gets a layer shadow, which follows the transparent edge.
const halo = (light: boolean) => Platform.OS === 'ios'
  ? { shadowColor: light ? '#FFFFFF' : '#0B0B12', shadowOpacity: light ? 0.95 : 0.9, shadowRadius: 1.2, shadowOffset: { width: 0, height: 0 } }
  : { filter: light ? 'drop-shadow(0 0 1.2px rgba(255,255,255,0.95)) drop-shadow(0 0 0.6px rgba(255,255,255,0.95))' : 'drop-shadow(0 0 1.2px rgba(11,11,18,0.9))' };

/** A map category's 3D icon, hidden from screen readers (the chip carries the name). Each new `play` value runs its gesture once. */
export function CategoryIcon({ id, play }: { id: string; play: number }) {
  const light = useTheme() === Colors.light, reduced = useReducedMotion();
  const x = useSharedValue(0), y = useSharedValue(0), rotate = useSharedValue(0), scaleX = useSharedValue(1), scaleY = useSharedValue(1);
  const played = useRef(0);
  const motion = aliveMotion(id, SIZE, reduced), originX = motion?.originX ?? 0, originY = motion?.originY ?? 0;
  useEffect(() => {
    if (!play || play === played.current) return;
    played.current = play;
    const gesture = aliveMotion(id, SIZE, reduced);
    if (!gesture) return;
    for (const [key, value] of [['x', x], ['y', y], ['rotate', rotate], ['scaleX', scaleX], ['scaleY', scaleY]] as const) {
      const track = gesture.tracks[key];
      if (track) value.set(withSequence(withTiming(track[0][1], { duration: 0 }), ...aliveSteps(track).map(([to, duration]) => withTiming(to, { duration, easing }))));
    }
  }, [play, id, reduced, x, y, rotate, scaleX, scaleY]);
  const moving = useAnimatedStyle(() => ({ transform: [{ translateX: originX + x.get() }, { translateY: originY + y.get() }, { rotate: `${rotate.get()}deg` },
    { scaleX: scaleX.get() }, { scaleY: scaleY.get() }, { translateX: -originX }, { translateY: -originY }] }));
  if (!Object.hasOwn(ART, id)) return null;
  return <Animated.View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.icon, halo(light), moving]}>
    <Image source={ART[id as keyof typeof ART]} contentFit="contain" style={styles.icon} accessible={false} />
  </Animated.View>;
}

const styles = StyleSheet.create({ icon: { width: SIZE, height: SIZE } });
