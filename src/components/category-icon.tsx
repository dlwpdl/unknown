import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';

import { Colors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ALIVE_BEZIER, aliveMotion, aliveSteps } from '@/lib/category-motion';
import { PLACE_SUBCATEGORIES } from '@/lib/discovery';

// Owner 2026-11-04 ⑪: Gling's own 3D artwork (category-icon-chips-2026-11-03/own3d/s, 144px, transparent).
const ART = {
  top25: require('@/assets/images/map-categories/top25.png'), delivery: require('@/assets/images/map-categories/delivery.png'),
  dining: require('@/assets/images/map-categories/dining.png'), cafe: require('@/assets/images/map-categories/cafe.png'),
  festival: require('@/assets/images/map-categories/festival.png'), nightlife: require('@/assets/images/map-categories/nightlife.png'),
  places: require('@/assets/images/map-categories/places.png'), housing: require('@/assets/images/map-categories/housing.png'),
  used: require('@/assets/images/map-categories/used.png'), events: require('@/assets/images/map-categories/events.png'),
  // Map row settings (owner picks 2026-11-04): 보여 줄 곳, 전체, 지금 영업 중, Visited (the gling logo tag).
  scope: require('@/assets/images/map-categories/scope.png'), all: require('@/assets/images/map-categories/all.png'), open: require('@/assets/images/map-categories/open.png'),
  visited: require('@/assets/images/map-categories/visited.png'), bubble: require('@/assets/images/map-categories/bubble.png'),
  // Sub-categories (subchip-icons-2026-11-04, owner: all 13 approved).
  lunch: require('@/assets/images/map-categories/lunch.png'), dinner: require('@/assets/images/map-categories/dinner.png'),
  late_night: require('@/assets/images/map-categories/late_night.png'), solo: require('@/assets/images/map-categories/solo.png'),
  date: require('@/assets/images/map-categories/date.png'), izakaya: require('@/assets/images/map-categories/izakaya.png'),
  pocha: require('@/assets/images/map-categories/pocha.png'), cocktail_bar: require('@/assets/images/map-categories/cocktail_bar.png'),
  wine_bar: require('@/assets/images/map-categories/wine_bar.png'), pub: require('@/assets/images/map-categories/pub.png'),
  dessert: require('@/assets/images/map-categories/dessert.png'), brunch: require('@/assets/images/map-categories/brunch.png'),
  work_friendly: require('@/assets/images/map-categories/work_friendly.png'),
  // Sub-categories added 2026-11-05 (subchip-icons-2026-11-05, owner 9cb7200d "세부칩에 들어갈 아이콘도 싹다 만들어").
  park: require('@/assets/images/map-categories/park.png'), beach: require('@/assets/images/map-categories/beach.png'),
  garden: require('@/assets/images/map-categories/garden.png'), viewpoint: require('@/assets/images/map-categories/viewpoint.png'),
  trail: require('@/assets/images/map-categories/trail.png'), museum: require('@/assets/images/map-categories/museum.png'),
  gallery: require('@/assets/images/map-categories/gallery.png'), library: require('@/assets/images/map-categories/library.png'),
  zoo_aquarium: require('@/assets/images/map-categories/zoo_aquarium.png'), historic: require('@/assets/images/map-categories/historic.png'),
  market: require('@/assets/images/map-categories/market.png'), theatre: require('@/assets/images/map-categories/theatre.png'),
  club: require('@/assets/images/map-categories/club.png'), bar: require('@/assets/images/map-categories/bar.png'),
  brewery: require('@/assets/images/map-categories/brewery.png'), live_music: require('@/assets/images/map-categories/live_music.png'),
  korean: require('@/assets/images/map-categories/korean.png'), japanese: require('@/assets/images/map-categories/japanese.png'),
  chinese: require('@/assets/images/map-categories/chinese.png'), vietnamese: require('@/assets/images/map-categories/vietnamese.png'),
  thai: require('@/assets/images/map-categories/thai.png'), indian: require('@/assets/images/map-categories/indian.png'),
  italian: require('@/assets/images/map-categories/italian.png'), mexican: require('@/assets/images/map-categories/mexican.png'),
  burger: require('@/assets/images/map-categories/burger.png'), pizza: require('@/assets/images/map-categories/pizza.png'),
  seafood: require('@/assets/images/map-categories/seafood.png'), vegan: require('@/assets/images/map-categories/vegan.png'),
  bakery: require('@/assets/images/map-categories/bakery.png'), bubble_tea: require('@/assets/images/map-categories/bubble_tea.png'),
  roastery: require('@/assets/images/map-categories/roastery.png'),
  // Sub-categories added 2026-11-11 (subchip-icons-2026-11-11, owner "8개 다 좋아요").
  breakfast: require('@/assets/images/map-categories/breakfast.png'), ice_cream: require('@/assets/images/map-categories/ice_cream.png'),
  matcha: require('@/assets/images/map-categories/matcha.png'), karaoke: require('@/assets/images/map-categories/karaoke.png'),
  speakeasy: require('@/assets/images/map-categories/speakeasy.png'), jazz: require('@/assets/images/map-categories/jazz.png'),
  sports_bar: require('@/assets/images/map-categories/sports_bar.png'), happy_hour: require('@/assets/images/map-categories/happy_hour.png'),
  // Leisure chips added 2026-11-11 (leisure-icons-2026-11-11, owner "4개 다 좋아요").
  cinema: require('@/assets/images/map-categories/cinema.png'), bowling: require('@/assets/images/map-categories/bowling.png'),
  arcade: require('@/assets/images/map-categories/arcade.png'), escape_room: require('@/assets/images/map-categories/escape_room.png'),
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
  // A sub-category without its own picture yet borrows its map category's (owner 2026-11-05: its own is being drawn).
  const art = Object.hasOwn(ART, id) ? id : PLACE_SUBCATEGORIES.find(option => option.id === id)?.filter;
  if (!art || !Object.hasOwn(ART, art)) return null;
  const box = { width: size, height: size };
  // Owner 2026-11-12 (map lag ⑤): draw the icon and its halo once and reuse that bitmap; the gesture only moves/scales it.
  return <Animated.View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    shouldRasterizeIOS renderToHardwareTextureAndroid style={[box, halo(light), moving]}>
    <Image source={ART[art as keyof typeof ART]} contentFit="contain" style={box} accessible={false} />
  </Animated.View>;
}

