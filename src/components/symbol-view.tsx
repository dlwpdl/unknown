import { SymbolView as NativeSymbol, type SymbolViewProps } from 'expo-symbols';
import { View } from 'react-native';

import { ClayIcon, useClay, type ClayName } from '@/components/clay';
import { useTheme } from '@/hooks/use-theme';

// The whole app's icons go through here (owner 2026-11-06 "전체적으로 빠진거없나봐봐"): a symbol with a clay drawing draws it, any other stays the system symbol.
// Keyed by the iOS name. Adding a drawing here changes every screen that uses the symbol.
const ART: Record<string, { clay: ClayName; turn?: string }> = {
  'chevron.down': { clay: 'chevron' }, 'chevron.up': { clay: 'chevron', turn: '180deg' }, 'chevron.right': { clay: 'chevron', turn: '-90deg' }, 'chevron.left': { clay: 'chevron', turn: '90deg' },
  ellipsis: { clay: 'more' }, magnifyingglass: { clay: 'search' }, map: { clay: 'map' }, 'map.fill': { clay: 'map' },
  'person.2': { clay: 'meetups' }, 'person.2.fill': { clay: 'meetups' }, 'square.and.arrow.up': { clay: 'share' }, 'arrow.clockwise': { clay: 'refresh' },
  'slider.horizontal.3': { clay: 'sliders' }, 'line.3.horizontal.decrease': { clay: 'sliders' }, plus: { clay: 'plus_ink' }, minus: { clay: 'minus_ink' },
  'list.bullet': { clay: 'list' }, pencil: { clay: 'pencil' }, 'square.and.pencil': { clay: 'pencil' }, bookmark: { clay: 'bookmark' }, 'bookmark.fill': { clay: 'bookmark_on' },
  person: { clay: 'person' }, 'person.crop.circle': { clay: 'person' }, heart: { clay: 'heart' }, 'heart.fill': { clay: 'heart_on' },
  'bubble.right': { clay: 'bubble' }, 'bubble.left.fill': { clay: 'bubble' }, 'text.bubble': { clay: 'bubble' }, 'bubble.left.and.bubble.right': { clay: 'bubble' },
  bell: { clay: 'bell' }, 'bell.fill': { clay: 'bell' }, 'trophy.fill': { clay: 'trophy' }, location: { clay: 'locate' }, 'location.fill': { clay: 'locate' }, scope: { clay: 'locate' },
  'fork.knife': { clay: 'chip_dining' }, house: { clay: 'home' }, tray: { clay: 'empty' },
};

export function SymbolView(props: SymbolViewProps) {
  const clay = useClay(), theme = useTheme();
  const key = typeof props.name === 'string' ? props.name : props.name?.ios;
  const art = clay && key ? ART[key] : undefined;
  if (!art) return <NativeSymbol {...props} />;
  // A plus sitting on a filled button keeps the button's ink, as its tint asked.
  const icon = <ClayIcon clay={art.clay === 'plus_ink' && props.tintColor === theme.accentInk ? 'plus' : art.clay} size={props.size ?? 24} />;
  return art.turn ? <View style={{ transform: [{ rotate: art.turn }] }}>{icon}</View> : icon;
}
