import { Image } from 'expo-image';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Image as NativeImage, Platform, StyleSheet, View, type ImageSourcePropType, type ViewStyle } from 'react-native';

import { Colors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Gling's own clay artwork (owner 2026-11-05 "우리가 지금 칩 처럼 만들어야함"): the same Three.js renders as the map chips,
// app-3d-ui-2026-11-05/build/slice_for_app.py. The dark theme has its own lighting: a purple floor glow and a rim, because a black shadow disappears on a dark screen (owner 2026-11-06).
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
  more: require('@/assets/images/ui-3d/more.png'), home: require('@/assets/images/ui-3d/tab_home_on.png'),
  chip_all: require('@/assets/images/ui-3d/chip_all.png'), chip_life: require('@/assets/images/ui-3d/chip_life.png'),
  chip_dining: require('@/assets/images/ui-3d/chip_dining.png'), chip_business: require('@/assets/images/ui-3d/chip_business.png'),
  chip_festival: require('@/assets/images/ui-3d/chip_festival.png'), chip_housing: require('@/assets/images/ui-3d/chip_housing.png'),
  chip_settlement: require('@/assets/images/ui-3d/chip_settlement.png'), chip_meetup: require('@/assets/images/ui-3d/chip_meetup.png'),
  chip_places: require('@/assets/images/ui-3d/chip_places.png'),
} as const;

// A name missing here falls back to the light drawing.
const ICONS_DARK: Partial<Record<keyof typeof ICONS, number>> = {
  search: require('@/assets/images/ui-3d/search_d.png'), person: require('@/assets/images/ui-3d/person_d.png'), heart: require('@/assets/images/ui-3d/heart_d.png'), heart_on: require('@/assets/images/ui-3d/heart_on_d.png'), bubble: require('@/assets/images/ui-3d/bubble_d.png'), bookmark: require('@/assets/images/ui-3d/bookmark_d.png'), bookmark_on: require('@/assets/images/ui-3d/bookmark_on_d.png'), sliders: require('@/assets/images/ui-3d/sliders_d.png'), plus_ink: require('@/assets/images/ui-3d/plus_ink_d.png'), minus_ink: require('@/assets/images/ui-3d/minus_ink_d.png'), list: require('@/assets/images/ui-3d/list_d.png'), locate: require('@/assets/images/ui-3d/locate_d.png'), refresh: require('@/assets/images/ui-3d/refresh_d.png'), avatar: require('@/assets/images/ui-3d/avatar_d.png'), avatar_me: require('@/assets/images/ui-3d/avatar_me_d.png'), chevron: require('@/assets/images/ui-3d/chevron_d.png'), share: require('@/assets/images/ui-3d/share_d.png'), more: require('@/assets/images/ui-3d/more_d.png'),
  bell: require('@/assets/images/ui-3d/tab_bell_on_d.png'), meetups: require('@/assets/images/ui-3d/tab_meetups_on_d.png'), map: require('@/assets/images/ui-3d/tab_map_on_d.png'), home: require('@/assets/images/ui-3d/tab_home_on_d.png'),
};

// Three slices stretch the same on iOS and Android. cap = end width ÷ art height; drop = the shadow hanging below the control.
const PILLS = {
  on: { l: require('@/assets/images/ui-3d/pill_on_l.png'), m: require('@/assets/images/ui-3d/pill_on_m.png'), r: require('@/assets/images/ui-3d/pill_on_r.png'), dark: { l: require('@/assets/images/ui-3d/pill_on_d_l.png'), m: require('@/assets/images/ui-3d/pill_on_d_m.png'), r: require('@/assets/images/ui-3d/pill_on_d_r.png') }, cap: 0.5914, drop: '-5.7%' },
  white: { l: require('@/assets/images/ui-3d/pill_white_l.png'), m: require('@/assets/images/ui-3d/pill_white_m.png'), r: require('@/assets/images/ui-3d/pill_white_r.png'), dark: { l: require('@/assets/images/ui-3d/pill_white_d_l.png'), m: require('@/assets/images/ui-3d/pill_white_d_m.png'), r: require('@/assets/images/ui-3d/pill_white_d_r.png') }, cap: 0.5978, drop: '-6.4%' },
  cta: { l: require('@/assets/images/ui-3d/pill_cta_l.png'), m: require('@/assets/images/ui-3d/pill_cta_m.png'), r: require('@/assets/images/ui-3d/pill_cta_r.png'), dark: { l: require('@/assets/images/ui-3d/pill_cta_d_l.png'), m: require('@/assets/images/ui-3d/pill_cta_d_m.png'), r: require('@/assets/images/ui-3d/pill_cta_d_r.png') }, cap: 0.5803, drop: '-6.1%' },
  tray: { l: require('@/assets/images/ui-3d/pill_tray_l.png'), m: require('@/assets/images/ui-3d/pill_tray_m.png'), r: require('@/assets/images/ui-3d/pill_tray_r.png'), dark: { l: require('@/assets/images/ui-3d/pill_tray_d_l.png'), m: require('@/assets/images/ui-3d/pill_tray_d_m.png'), r: require('@/assets/images/ui-3d/pill_tray_d_r.png') }, cap: 0.5625, drop: '-6%' },
  line: { l: require('@/assets/images/ui-3d/pill_line_l.png'), m: require('@/assets/images/ui-3d/pill_line_m.png'), r: require('@/assets/images/ui-3d/pill_line_r.png'), dark: { l: require('@/assets/images/ui-3d/pill_line_d_l.png'), m: require('@/assets/images/ui-3d/pill_line_d_m.png'), r: require('@/assets/images/ui-3d/pill_line_d_r.png') }, cap: 0.5495, drop: '-12.4%' },
} as const;

// capInsets are in points of the @3x art and only iOS honours them, so Android keeps the flat box.
const DOME = require('@/assets/images/ui-3d/photo_dome.png'), DOME_DARK = require('@/assets/images/ui-3d/photo_dome_d.png');
const BOXES = {
  text: { art: require('@/assets/images/ui-3d/text.png'), dark: require('@/assets/images/ui-3d/text_d.png'), insets: { top: 20, left: 20, bottom: 23, right: 20 }, outset: 2.6 },
  tile: { art: require('@/assets/images/ui-3d/tile.png'), dark: require('@/assets/images/ui-3d/tile_d.png'), insets: { top: 18, left: 18, bottom: 18, right: 18 }, outset: 3 },
} as const;

export type ClayName = keyof typeof ICONS;
export type ClayPillKind = keyof typeof PILLS;
export type ClayBoxKind = keyof typeof BOXES;

// iOS only: Android's tab bar tints every icon, so it keeps the Material symbols. The bar itself and its selected glass are the system's, only the icons can be drawings.
const tab = (name: string, selected: number, plain: number) => ({ [name]: { default: plain, selected } });
export const CLAY_TABS = {
  ...tab('home', require('@/assets/images/ui-3d/tab_home_on.png'), require('@/assets/images/ui-3d/tab_home.png')),
  ...tab('meetups', require('@/assets/images/ui-3d/tab_meetups_on.png'), require('@/assets/images/ui-3d/tab_meetups.png')),
  ...tab('map', require('@/assets/images/ui-3d/tab_map_on.png'), require('@/assets/images/ui-3d/tab_map.png')),
  ...tab('chat', require('@/assets/images/ui-3d/tab_chat_on.png'), require('@/assets/images/ui-3d/tab_chat.png')),
  ...tab('bell', require('@/assets/images/ui-3d/tab_bell_on.png'), require('@/assets/images/ui-3d/tab_bell.png')),
};
export const CLAY_TABS_DARK = {
  ...tab('home', require('@/assets/images/ui-3d/tab_home_on_d.png'), require('@/assets/images/ui-3d/tab_home_d.png')),
  ...tab('meetups', require('@/assets/images/ui-3d/tab_meetups_on_d.png'), require('@/assets/images/ui-3d/tab_meetups_d.png')),
  ...tab('map', require('@/assets/images/ui-3d/tab_map_on_d.png'), require('@/assets/images/ui-3d/tab_map_d.png')),
  ...tab('chat', require('@/assets/images/ui-3d/tab_chat_on_d.png'), require('@/assets/images/ui-3d/tab_chat_d.png')),
  ...tab('bell', require('@/assets/images/ui-3d/tab_bell_on_d.png'), require('@/assets/images/ui-3d/tab_bell_d.png')),
};

const useDark = () => useTheme() === Colors.dark;
export function useClay() {
  return useTheme() !== Colors.admin && Platform.OS !== 'web';
}
export function useClayBox() {
  return useTheme() !== Colors.admin && Platform.OS === 'ios';
}

/** A control icon: the clay drawing where it applies, otherwise the same flat symbol as before. The layout box stays `size`, so nothing around it moves. */
export function ClayIcon({ clay, claySize, name, size = 21, tintColor }: { clay: ClayName; claySize?: number; name?: SymbolViewProps['name']; size?: number; tintColor?: string }) {
  const pill = useClay(), dark = useDark();
  if (!pill) return name ? <SymbolView name={name} size={size} tintColor={tintColor} /> : null;
  const drawn = claySize ?? Math.round(size * 1.24), pull = (size - drawn) / 2;
  return <Image source={(dark && ICONS_DARK[clay]) || ICONS[clay]} style={{ width: drawn, height: drawn, margin: pull }} contentFit="contain" accessible={false} />;
}

/** Stretched behind a control's content. The caller clears the control's own background. */
export function ClayPillFill({ kind }: { kind: ClayPillKind }) {
  const { cap, drop, dark, ...light } = PILLS[kind], { l, m, r } = useDark() ? dark : light;
  return <View pointerEvents="none" style={[styles.pill, { bottom: drop as ViewStyle['bottom'] }]}>
    <View style={{ height: '100%', aspectRatio: cap }} />
    <Image source={m} style={styles.middle} contentFit="fill" accessible={false} />
    <View style={{ height: '100%', aspectRatio: cap }} />
    {/* Each end is cut at the centre line: on a 44pt round button the two would overlap and their flat tops poke past each other's curve. A % maxWidth does not work here: Yoga resolves it against the text width. */}
    <View style={styles.leftHalf}><Image source={l} style={{ height: '100%', aspectRatio: cap }} contentFit="fill" accessible={false} /></View>
    <View style={styles.rightHalf}><Image source={r} style={[styles.rightEnd, { aspectRatio: cap }]} contentFit="fill" accessible={false} /></View>
  </View>;
}

export function ClayBoxFill({ kind }: { kind: ClayBoxKind }) {
  const { art, dark, insets, outset } = BOXES[kind], source = useDark() ? dark : art;
  return <NativeImage pointerEvents="none" source={source as ImageSourcePropType} capInsets={insets} resizeMode="stretch" accessible={false}
    style={[StyleSheet.absoluteFill, { left: -outset, right: -outset, bottom: -outset, width: undefined, height: undefined }]} />;
}

/** The round coin behind a member's first letter when they have no photo. */
export function ClayCoinFill({ me = false }: { me?: boolean }) {
  const dark = useDark(), name = me ? 'avatar_me' : 'avatar';
  return <Image source={(dark && ICONS_DARK[name]) || ICONS[name]} style={styles.coin} contentFit="fill" accessible={false} />;
}

/** A member's photo, domed: cut to a full circle under a highlight that overhangs it by 20% on each side, so its parent must not clip. */
export function ClayPhoto({ uri, size }: { uri: string; size: number }) {
  const pill = useClay(), dark = useDark(), round = { width: size, height: size, borderRadius: size / 2 };
  const photo = <Image source={{ uri }} style={round} contentFit="cover" accessible={false} />;
  if (!pill) return photo;
  return <View style={{ width: size, height: size }}>{photo}
    <Image source={dark ? DOME_DARK : DOME} style={{ position: 'absolute', top: -size * 0.2, left: -size * 0.2, width: size * 1.4, height: size * 1.4 }} contentFit="fill" accessible={false} />
  </View>;
}

/** Behind a control that used controlPresentation's colours: the same tone rules, as clay. Ghost controls have no surface. Pass `clay` to controlPresentation too so it clears its own. */
export function ClayControlFill({ tone = 'secondary', selected = false }: { tone?: 'primary' | 'secondary' | 'ghost'; selected?: boolean }) {
  if (!useClay() || tone === 'ghost') return null;
  return <ClayPillFill kind={tone === 'primary' ? 'cta' : selected ? 'on' : 'white'} />;
}

const styles = StyleSheet.create({
  // Sits 1pt low so the label rests on the top face rather than across the front edge (mockup v2, owner "이대로").
  pill: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', transform: [{ translateY: 1 }] },
  middle: { flex: 1, height: '100%' },
  leftHalf: { position: 'absolute', top: 0, bottom: 0, left: 0, right: '50%', overflow: 'hidden' },
  rightHalf: { position: 'absolute', top: 0, bottom: 0, left: '50%', right: 0, overflow: 'hidden' },
  rightEnd: { position: 'absolute', top: 0, bottom: 0, right: 0 },
  coin: { position: 'absolute', top: '-3%', left: '-3%', width: '106%', height: '106%' },
});
