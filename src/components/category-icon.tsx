import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
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
  // Map row settings (owner picks 2026-11-04): 보여 줄 곳, 전체, 지금 영업 중, Visited (the gling logo tag).
  scope: require('@/assets/images/map-categories/scope.png'), all: require('@/assets/images/map-categories/all.png'), open: require('@/assets/images/map-categories/open.png'),
  visited: require('@/assets/images/map-categories/visited.png'),
  // Sub-categories (subchip-icons-2026-11-04, owner: all 13 approved).
  lunch: require('@/assets/images/map-categories/lunch.png'), dinner: require('@/assets/images/map-categories/dinner.png'),
  late_night: require('@/assets/images/map-categories/late_night.png'), solo: require('@/assets/images/map-categories/solo.png'),
  date: require('@/assets/images/map-categories/date.png'), izakaya: require('@/assets/images/map-categories/izakaya.png'),
  pocha: require('@/assets/images/map-categories/pocha.png'), cocktail_bar: require('@/assets/images/map-categories/cocktail_bar.png'),
  wine_bar: require('@/assets/images/map-categories/wine_bar.png'), pub: require('@/assets/images/map-categories/pub.png'),
  dessert: require('@/assets/images/map-categories/dessert.png'), brunch: require('@/assets/images/map-categories/brunch.png'),
  work_friendly: require('@/assets/images/map-categories/work_friendly.png'),
} as const;
const easing = Easing.bezier(...ALIVE_BEZIER);

// A thin halo keeps the artwork readable over the map seen through the chip (mockup ⑪): white on light chips, dark on dark ones.
// iOS draws `filter: drop-shadow` only behind a React Native feature flag, so it gets a layer shadow, which follows the transparent edge.
const halo = (light: boolean) => Platform.OS === 'ios'
  ? { shadowColor: light ? '#FFFFFF' : '#0B0B12', shadowOpacity: light ? 0.95 : 0.9, shadowRadius: 1.2, shadowOffset: { width: 0, height: 0 } }
  : { filter: light ? 'drop-shadow(0 0 1.2px rgba(255,255,255,0.95)) drop-shadow(0 0 0.6px rgba(255,255,255,0.95))' : 'drop-shadow(0 0 1.2px rgba(11,11,18,0.9))' };

/** A map category's 3D icon, hidden from screen readers (the chip carries the name). Each new `play` value runs its gesture once. */
export function CategoryIcon({ id, play, size = 24 }: { id: string; play: number; size?: number }) {
  const light = useTheme() === Colors.light, reduced = useReducedMotion();
  const x = useSharedValue(0), y = useSharedValue(0), rotate = useSharedValue(0), scaleX = useSharedValue(1), scaleY = useSharedValue(1);
  const played = useRef(0);
  const motion = aliveMotion(id, size, reduced), originX = motion?.originX ?? 0, originY = motion?.originY ?? 0;
  useEffect(() => {
    if (!play || play === played.current) return;
    played.current = play;
    const gesture = aliveMotion(id, size, reduced);
    if (!gesture) return;
    for (const [key, value] of [['x', x], ['y', y], ['rotate', rotate], ['scaleX', scaleX], ['scaleY', scaleY]] as const) {
      const track = gesture.tracks[key];
      if (track) value.set(withSequence(withTiming(track[0][1], { duration: 0 }), ...aliveSteps(track).map(([to, duration]) => withTiming(to, { duration, easing }))));
    }
  }, [play, id, size, reduced, x, y, rotate, scaleX, scaleY]);
  const moving = useAnimatedStyle(() => ({ transform: [{ translateX: originX + x.get() }, { translateY: originY + y.get() }, { rotate: `${rotate.get()}deg` },
    { scaleX: scaleX.get() }, { scaleY: scaleY.get() }, { translateX: -originX }, { translateY: -originY }] }));
  if (!Object.hasOwn(ART, id)) return null;
  const box = { width: size, height: size };
  return <Animated.View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[box, halo(light), moving]}>
    <Image source={ART[id as keyof typeof ART]} contentFit="contain" style={box} accessible={false} />
  </Animated.View>;
}

