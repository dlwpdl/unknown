import { Image } from 'expo-image';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Image as NativeImage, Platform, StyleSheet, View, type ImageSourcePropType, type ViewStyle } from 'react-native';

import { Colors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Gling's own clay artwork (owner 2026-11-05 "우리가 지금 칩 처럼 만들어야함"): the same Three.js renders as the map chips,
// app-3d-ui-2026-11-05/build/slice_for_app.py. The art is lit for light surfaces, so the dark theme and the web keep the flat controls.
const ICONS = {
  search: require('@/assets/images/ui-3d/search.png'), person: require('@/assets/images/ui-3d/person.png'),
  pencil: require('@/assets/images/ui-3d/pencil.png'), trophy: require('@/assets/images/ui-3d/trophy.png'),
  heart: require('@/assets/images/ui-3d/heart.png'), heart_on: require('@/assets/images/ui-3d/heart_on.png'),
  bubble: require('@/assets/images/ui-3d/bubble.png'), bookmark: require('@/assets/images/ui-3d/bookmark.png'),
  bookmark_on: require('@/assets/images/ui-3d/bookmark_on.png'), sliders: require('@/assets/images/ui-3d/sliders.png'),
  plus: require('@/assets/images/ui-3d/plus.png'), plus_ink: require('@/assets/images/ui-3d/plus_ink.png'),
  minus_ink: require('@/assets/images/ui-3d/minus_ink.png'), list: require('@/assets/images/ui-3d/list.png'),
  locate: require('@/assets/images/ui-3d/locate.png'), refresh: require('@/assets/images/ui-3d/refresh.png'),
  empty: require('@/assets/images/ui-3d/empty.png'), avatar: require('@/assets/images/ui-3d/avatar.png'),
  avatar_me: require('@/assets/images/ui-3d/avatar_me.png'),
  bell: require('@/assets/images/ui-3d/tab_bell_on.png'), meetups: require('@/assets/images/ui-3d/tab_meetups_on.png'),
  map: require('@/assets/images/ui-3d/tab_map_on.png'),
  chevron: require('@/assets/images/ui-3d/chevron.png'), share: require('@/assets/images/ui-3d/share.png'),
  more: require('@/assets/images/ui-3d/more.png'),
  chip_all: require('@/assets/images/ui-3d/chip_all.png'), chip_life: require('@/assets/images/ui-3d/chip_life.png'),
  chip_dining: require('@/assets/images/ui-3d/chip_dining.png'), chip_business: require('@/assets/images/ui-3d/chip_business.png'),
  chip_festival: require('@/assets/images/ui-3d/chip_festival.png'), chip_housing: require('@/assets/images/ui-3d/chip_housing.png'),
  chip_settlement: require('@/assets/images/ui-3d/chip_settlement.png'), chip_meetup: require('@/assets/images/ui-3d/chip_meetup.png'),
  chip_places: require('@/assets/images/ui-3d/chip_places.png'),
} as const;

// Three slices stretch the same on iOS and Android. cap = end width ÷ art height; drop = the shadow hanging below the control.
const PILLS = {
  on: { l: require('@/assets/images/ui-3d/pill_on_l.png'), m: require('@/assets/images/ui-3d/pill_on_m.png'), r: require('@/assets/images/ui-3d/pill_on_r.png'), cap: 0.5914, drop: '-5.7%' },
  white: { l: require('@/assets/images/ui-3d/pill_white_l.png'), m: require('@/assets/images/ui-3d/pill_white_m.png'), r: require('@/assets/images/ui-3d/pill_white_r.png'), cap: 0.5978, drop: '-6.4%' },
  cta: { l: require('@/assets/images/ui-3d/pill_cta_l.png'), m: require('@/assets/images/ui-3d/pill_cta_m.png'), r: require('@/assets/images/ui-3d/pill_cta_r.png'), cap: 0.5803, drop: '-6.1%' },
  tray: { l: require('@/assets/images/ui-3d/pill_tray_l.png'), m: require('@/assets/images/ui-3d/pill_tray_m.png'), r: require('@/assets/images/ui-3d/pill_tray_r.png'), cap: 0.5625, drop: '-6%' },
  line: { l: require('@/assets/images/ui-3d/pill_line_l.png'), m: require('@/assets/images/ui-3d/pill_line_m.png'), r: require('@/assets/images/ui-3d/pill_line_r.png'), cap: 0.5495, drop: '-12.4%' },
} as const;

// capInsets are in points of the @3x art and only iOS honours them, so Android keeps the flat box.
const BOXES = {
  text: { art: require('@/assets/images/ui-3d/text.png'), insets: { top: 20, left: 20, bottom: 23, right: 20 }, outset: 2.6 },
  tile: { art: require('@/assets/images/ui-3d/tile.png'), insets: { top: 18, left: 18, bottom: 18, right: 18 }, outset: 3 },
} as const;

export type ClayName = keyof typeof ICONS;
export type ClayPillKind = keyof typeof PILLS;
export type ClayBoxKind = keyof typeof BOXES;

export function useClay() {
  return useTheme() === Colors.light && Platform.OS !== 'web';
}
export function useClayBox() {
  return useTheme() === Colors.light && Platform.OS === 'ios';
}

/** A control icon: the clay drawing where it applies, otherwise the same flat symbol as before. The layout box stays `size`, so nothing around it moves. */
export function ClayIcon({ clay, claySize, name, size = 21, tintColor }: { clay: ClayName; claySize?: number; name?: SymbolViewProps['name']; size?: number; tintColor?: string }) {
  if (!useClay()) return name ? <SymbolView name={name} size={size} tintColor={tintColor} /> : null;
  const drawn = claySize ?? Math.round(size * 1.24), pull = (size - drawn) / 2;
  return <Image source={ICONS[clay]} style={{ width: drawn, height: drawn, margin: pull }} contentFit="contain" accessible={false} />;
}

/** Stretched behind a control's content. The caller clears the control's own background. */
export function ClayPillFill({ kind }: { kind: ClayPillKind }) {
  const { l, m, r, cap, drop } = PILLS[kind];
  return <View pointerEvents="none" style={[styles.pill, { bottom: drop as ViewStyle['bottom'] }]}>
    <Image source={l} style={{ height: '100%', aspectRatio: cap, maxWidth: '50%' }} contentFit="fill" accessible={false} />
    <Image source={m} style={styles.middle} contentFit="fill" accessible={false} />
    <Image source={r} style={{ height: '100%', aspectRatio: cap, maxWidth: '50%' }} contentFit="fill" accessible={false} />
  </View>;
}

export function ClayBoxFill({ kind }: { kind: ClayBoxKind }) {
  const { art, insets, outset } = BOXES[kind];
  return <NativeImage pointerEvents="none" source={art as ImageSourcePropType} capInsets={insets} resizeMode="stretch" accessible={false}
    style={[StyleSheet.absoluteFill, { left: -outset, right: -outset, bottom: -outset, width: undefined, height: undefined }]} />;
}

/** The round coin behind a member's first letter when they have no photo. */
export function ClayCoinFill({ me = false }: { me?: boolean }) {
  return <Image source={me ? ICONS.avatar_me : ICONS.avatar} style={styles.coin} contentFit="fill" accessible={false} />;
}

const styles = StyleSheet.create({
  pill: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row' },
  middle: { flex: 1, height: '100%' },
  coin: { position: 'absolute', top: '-3%', left: '-3%', width: '106%', height: '106%' },
});
