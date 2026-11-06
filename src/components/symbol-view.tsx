import { SymbolView as NativeSymbol, type SymbolViewProps } from 'expo-symbols';

import { ClayIcon, useClay, type ClayName } from '@/components/clay';
import { useTheme } from '@/hooks/use-theme';

// The whole app's icons go through here (owner 2026-11-06 "전체적으로 빠진거없나봐봐"): a symbol with a clay drawing draws it, any other stays the system symbol.
// Keyed by the iOS name. Adding a drawing here changes every screen that uses the symbol.
const ART: Record<string, { clay: ClayName }> = {
  'chevron.down': { clay: 'chevron' }, 'chevron.up': { clay: 'chevron_up' }, 'chevron.right': { clay: 'chevron_right' }, 'chevron.left': { clay: 'chevron_left' },
  ellipsis: { clay: 'more' }, magnifyingglass: { clay: 'search' }, map: { clay: 'map' }, 'map.fill': { clay: 'map' },
  'person.2': { clay: 'meetups' }, 'person.2.fill': { clay: 'meetups' }, 'square.and.arrow.up': { clay: 'share' }, 'arrow.clockwise': { clay: 'refresh' },
  'slider.horizontal.3': { clay: 'sliders' }, 'line.3.horizontal.decrease': { clay: 'sliders' }, plus: { clay: 'plus_ink' }, minus: { clay: 'minus_ink' },
  'list.bullet': { clay: 'list' }, pencil: { clay: 'pencil' }, 'square.and.pencil': { clay: 'pencil' }, bookmark: { clay: 'bookmark' }, 'bookmark.fill': { clay: 'bookmark_on' },
  person: { clay: 'person' }, 'person.crop.circle': { clay: 'person' }, heart: { clay: 'heart' }, 'heart.fill': { clay: 'heart_on' },
  'bubble.right': { clay: 'bubble' }, 'bubble.left.fill': { clay: 'bubble' }, 'text.bubble': { clay: 'bubble' }, 'bubble.left.and.bubble.right': { clay: 'bubble' },
  bell: { clay: 'bell' }, 'bell.fill': { clay: 'bell' }, 'trophy.fill': { clay: 'trophy' }, location: { clay: 'locate' }, 'location.fill': { clay: 'locate' }, scope: { clay: 'target' },
  xmark: { clay: 'close' }, 'xmark.circle.fill': { clay: 'close' }, checkmark: { clay: 'check' }, 'checkmark.circle.fill': { clay: 'check' }, 'checkmark.circle': { clay: 'check' }, mappin: { clay: 'pin' },
  'mappin.and.ellipse': { clay: 'pin' }, storefront: { clay: 'store' }, photo: { clay: 'photo' }, 'photo.on.rectangle': { clay: 'photo' }, camera: { clay: 'camera' }, 'camera.fill': { clay: 'camera' },
  trash: { clay: 'trash' }, sparkles: { clay: 'sparkle' }, 'info.circle': { clay: 'info' }, calendar: { clay: 'calendar' }, clock: { clay: 'clock' }, 'clock.arrow.circlepath': { clay: 'clock' },
  shippingbox: { clay: 'box' }, 'paperplane.fill': { clay: 'send' }, 'person.badge.plus': { clay: 'person_add' }, gearshape: { clay: 'gear' }, flag: { clay: 'flag' }, 'exclamationmark.circle': { clay: 'warn' },
  'exclamationmark.triangle': { clay: 'warn' }, 'exclamationmark.triangle.fill': { clay: 'warn' }, 'doc.text': { clay: 'doc' }, 'checkmark.seal': { clay: 'seal' }, 'checkmark.seal.fill': { clay: 'seal' }, lock: { clay: 'lock' },
  link: { clay: 'link' }, phone: { clay: 'phone' }, globe: { clay: 'globe' }, gift: { clay: 'gift' }, envelope: { clay: 'envelope' }, megaphone: { clay: 'megaphone' },
  'flame.fill': { clay: 'flame' }, 'arrow.up.right': { clay: 'open' },
  'fork.knife': { clay: 'chip_dining' }, house: { clay: 'home' }, tray: { clay: 'empty' },
};

export function SymbolView(props: SymbolViewProps) {
  const clay = useClay(), theme = useTheme();
  const key = typeof props.name === 'string' ? props.name : props.name?.ios;
  const art = clay && key ? ART[key] : undefined;
  if (!art) return <NativeSymbol {...props} />;
  // accentInk means the symbol sits on a filled purple surface, where most drawings would vanish: only the plus has an ink drawing, the rest keep the system symbol there.
  const onFill = props.tintColor === theme.accentInk;
  if (onFill && art.clay !== 'plus_ink') return <NativeSymbol {...props} />;
  return <ClayIcon clay={onFill ? 'plus' : art.clay} size={props.size ?? 24} />;
}
