import { useState } from 'react';
import { Linking, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';

import { Pressable } from '@/components/analytics-controls';
import { PostPinMap } from '@/components/post-pin-map';
import { ThemedText } from '@/components/themed-text';
import { ControlMotion, IconSize, Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { getPostImageSource, relativeTime } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { areaName, dealLabel, formatMoveIn, LISTING_LABELS, listingPriceLabel, listingStatusLabel, type ListingDetails } from '@/lib/listing-details';
import { CITIES } from '@/lib/mock';
import { findNeighborhood } from '@/lib/neighborhoods';
import { postLocationUrl } from '@/lib/post-maps';
import type { Post } from '@/lib/types';

export type DetailedPost = Post & { listingDetails: ListingDetails };
const wanting = (details: ListingDetails) => details.deal === 'rent_wanted' || details.deal === 'buy' || details.deal === 'seeking';

function Badge({ label, tone }: { label: string; tone: 'accent' | 'want' | 'done' }) {
  const theme = useTheme();
  const color = tone === 'accent' ? theme.accent : tone === 'want' ? theme.navy : theme.textSecondary;
  return <View style={[styles.badge, { backgroundColor: tone === 'accent' ? theme.backgroundSelected : theme.backgroundElement }]}>
    <ThemedText type="micro" style={[styles.badgeText, { color }]}>{label}</ThemedText>
  </View>;
}

function Tags({ items }: { items: string[] }) {
  const theme = useTheme();
  if (!items.length) return null;
  return <View style={styles.tags}>{items.map(item => <View key={item} style={[styles.tag, { backgroundColor: theme.backgroundElement }]}>
    <ThemedText type="caption" style={styles.tagText}>{item}</ThemedText>
  </View>)}</View>;
}

// Shared words for a listing: the card, the map sheet and the detail all read the same labels.
export function useListingText(post: DetailedPost) {
  const { language, tr, locale } = useLanguage();
  const details = post.listingDetails, category = details.type;
  const area = areaName(post.cityId, details.area, language);
  const time = post.createdAt ? relativeTime(post.createdAt, undefined, locale) : post.createdAtLabel;
  const closed = post.listingStatus === 'closed';
  const moveIn = details.type === 'housing' && details.moveIn ? details.moveIn === 'now' ? tr('바로 입주') : tr('{0} 입주', formatMoveIn(details.moveIn, language)) : null;
  return {
    details, category, area, time, closed, moveIn,
    deal: dealLabel(details, language),
    price: listingPriceLabel(details, post.price, language),
    status: tr(listingStatusLabel(category, post.listingStatus)),
    rooms: details.type === 'housing' && details.rooms ? tr(LISTING_LABELS.rooms[details.rooms]) : null,
    includes: details.type === 'housing' ? (details.includes ?? []).map(item => tr(LISTING_LABELS.includes[item])) : [],
    jobTypes: details.type === 'jobs' ? (details.jobTypes ?? []).map(item => tr(LISTING_LABELS.jobTypes[item])) : [],
    condition: details.type === 'used' && details.condition ? tr(LISTING_LABELS.condition[details.condition]) : null,
  };
}

// Feed card, direction A: badge + 동네·시간, title, price, chips, and a 72px photo (중고거래 puts the photo first).
export function ListingCard({ post, onPress, variant = 'row' }: { post: DetailedPost; onPress: () => void; variant?: 'row' | 'tile' }) {
  const theme = useTheme(), { tr } = useLanguage(), { play } = useInteractionFeedback();
  const { isAuthed, me } = useAuth(), { fontScale } = useWindowDimensions();
  const text = useListingText(post), { details, category } = text;
  const photo = getPostImageSource(post, isAuthed ? me.id : 'guest');
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const showPhoto = photo && failedPhoto !== photo.uri;
  const free = details.type === 'used' && details.deal === 'sell' && post.price === 0;
  const where = category === 'jobs' && post.business ? post.business.name : text.area;
  const label = [text.deal, post.title, text.price, where, text.closed ? text.status : null].filter(Boolean).join(', ');
  const press = () => { play('selection'); onPress(); };
  const image = (style: object) => showPhoto ? <Image source={photo} contentFit="cover" style={style} accessible={false} onError={() => setFailedPhoto(photo.uri)} />
    : <View style={[style, styles.fallback, { backgroundColor: theme.backgroundElement }]} accessible={false}>
      {details.type === 'used' && details.deal === 'buy' ? <ThemedText type="label" themeColor="textSecondary">{text.deal}</ThemedText>
        : <SymbolView name={category === 'housing' ? { ios: 'house', android: 'home', web: 'home' } : { ios: 'shippingbox', android: 'inventory_2', web: 'inventory_2' }} size={IconSize.toolbar} tintColor={theme.textSecondary} />}
    </View>;

  if (variant === 'tile') return <Pressable analyticsId="listing.card.tile" accessibilityRole="button" accessibilityLabel={label} onPress={press}
    style={({ pressed }) => [styles.tile, { opacity: pressed ? ControlMotion.pressedOpacity : text.closed ? 0.55 : 1 }]}>
    <View>
      {image(styles.square)}
      {(text.closed || free) && <View style={styles.tileBadge}><Badge label={text.closed ? text.status : tr('나눔')} tone={text.closed ? 'done' : 'accent'} /></View>}
    </View>
    {text.price && <ThemedText style={styles.tilePrice}>{text.price}</ThemedText>}
    <ThemedText type="supporting" numberOfLines={fontScale > 1.2 ? 2 : 1}>{post.title}</ThemedText>
    <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>{[text.area, text.time].filter(Boolean).join(' · ')}</ThemedText>
  </Pressable>;

  const meta = <View style={styles.meta}>
    <Badge label={text.closed ? text.status : text.deal} tone={text.closed ? 'done' : wanting(details) ? 'want' : 'accent'} />
    <ThemedText type="small" themeColor="textSecondary" style={styles.flex} numberOfLines={1}>{[where, text.time].filter(Boolean).join(' · ')}</ThemedText>
  </View>;
  return <Pressable analyticsId={`listing.card.${category}`} accessibilityRole="button" accessibilityLabel={label} onPress={press}
    style={({ pressed }) => [styles.row, { borderBottomColor: theme.line, opacity: pressed ? ControlMotion.pressedOpacity : text.closed ? 0.55 : 1 }]}>
    {category === 'used' && image(styles.thumb)}
    <View style={styles.copy}>
      {category !== 'used' && meta}
      <ThemedText numberOfLines={fontScale > 1.2 ? undefined : 2} style={[styles.title, category === 'jobs' && Typography.menu]}>{post.title}</ThemedText>
      {category === 'used' && <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{[text.area, text.time].filter(Boolean).join(' · ')}</ThemedText>}
      {category === 'jobs'
        ? <ThemedText type="smallBold" themeColor="accent">{[text.price, text.jobTypes.join(', '), post.business ? text.area : null].filter(Boolean).join(' · ')}</ThemedText>
        : text.price && <View style={styles.meta}><ThemedText style={styles.price}>{text.price}</ThemedText>
          {category === 'used' && text.closed && <Badge label={text.status} tone="done" />}
          {category === 'used' && !text.closed && details.type === 'used' && details.deal === 'buy' && <Badge label={text.deal} tone="want" />}</View>}
      {category === 'jobs' && <ThemedText type="small" themeColor="textSecondary">{[details.type === 'jobs' ? details.hours : null, tr('댓글 {0}', post.comments)].filter(Boolean).join(' · ')}</ThemedText>}
      <Tags items={category === 'housing' ? [text.rooms, text.moveIn, ...text.includes].filter((item): item is string => !!item)
        : category === 'used' && text.condition ? [text.condition] : []} />
    </View>
    {category !== 'used' && showPhoto && image(styles.thumb)}
  </Pressable>;
}

function Row({ icon, label, value }: { icon: SymbolViewProps['name']; label: string; value: string }) {
  const theme = useTheme();
  return <View style={[styles.infoRow, { borderTopColor: theme.line }]} accessible accessibilityLabel={`${label}, ${value}`}>
    <SymbolView name={icon} size={IconSize.inline} tintColor={theme.textSecondary} />
    <ThemedText type="small" themeColor="textSecondary" style={styles.infoLabel}>{label}</ThemedText>
    <ThemedText type="small" style={styles.flex}>{value}</ThemedText>
  </View>;
}

// Detail, direction A: one info card under the title, then the neighborhood circle map.
export function ListingInfo({ post }: { post: DetailedPost }) {
  const theme = useTheme(), { tr, language } = useLanguage();
  const text = useListingText(post), { details } = text;
  const rows: { icon: SymbolViewProps['name']; label: string; value: string | null }[] = details.type === 'housing' ? [
    { icon: { ios: 'house', android: 'home', web: 'home' }, label: tr('방 구성'), value: text.rooms },
    { icon: { ios: 'calendar', android: 'calendar_today', web: 'calendar_today' }, label: tr(wanting(details) ? '입주 희망일' : '입주 가능일'), value: details.moveIn ? details.moveIn === 'now' ? tr('바로 입주') : tr('{0}부터', formatMoveIn(details.moveIn, language)) : null },
    { icon: { ios: 'mappin', android: 'location_on', web: 'location_on' }, label: tr('동네'), value: text.area },
  ] : details.type === 'jobs' ? [
    { icon: { ios: 'mappin', android: 'location_on', web: 'location_on' }, label: tr('근무지'), value: text.area },
    { icon: { ios: 'clock', android: 'schedule', web: 'schedule' }, label: tr('근무 시간'), value: details.hours ?? null },
    { icon: { ios: 'list.bullet', android: 'list', web: 'list' }, label: tr('하는 일'), value: details.duties ?? null },
    { icon: { ios: 'envelope', android: 'mail', web: 'mail' }, label: tr('지원 방법'), value: details.apply?.length ? details.apply.map(item => tr(LISTING_LABELS.apply[item])).join(', ') : null },
  ] : [
    { icon: { ios: 'shippingbox', android: 'inventory_2', web: 'inventory_2' }, label: tr('물건 상태'), value: text.condition },
    { icon: { ios: 'mappin', android: 'location_on', web: 'location_on' }, label: tr('만날 곳'), value: text.area },
  ];
  const chips = details.type === 'housing' ? text.includes : details.type === 'jobs' ? text.jobTypes : details.type === 'used' && details.offers ? [tr('가격 제안 받아요')] : [];
  return <View style={styles.info}>
    <View style={styles.meta}>
      <Badge label={text.deal} tone={wanting(details) ? 'want' : 'accent'} />
      <Badge label={text.status} tone={text.closed ? 'done' : 'accent'} />
    </View>
    {text.price && <ThemedText style={styles.detailPrice}>{text.price}</ThemedText>}
    {rows.some(row => row.value) && <View style={[styles.infoCard, { borderColor: theme.line, backgroundColor: theme.card }]}>
      {rows.filter((row): row is typeof row & { value: string } => !!row.value).map((row, index) => <View key={row.label} style={index === 0 && styles.firstRow}><Row icon={row.icon} label={row.label} value={row.value} /></View>)}
    </View>}
    <Tags items={chips} />
    {details.type !== 'jobs' && <ListingAreaMap post={post} />}
  </View>;
}

// A circle around the neighborhood centre, never a point. Opening it searches the neighborhood name.
export function ListingAreaMap({ post }: { post: DetailedPost }) {
  const theme = useTheme(), { tr, language } = useLanguage(), { play } = useInteractionFeedback();
  const area = findNeighborhood(post.cityId, post.listingDetails.area);
  if (!area) return null;
  const city = CITIES.find(item => item.id === post.cityId);
  const url = postLocationUrl(area.en, city?.englishName);
  const name = language === 'en' ? area.en : area.ko;
  return <View style={styles.areaWrap}>
    <Pressable analyticsId="listing.area.open" accessibilityRole="link" accessibilityLabel={tr('{0} 근처 지도 크게 보기', name)} disabled={!url}
      onPress={() => { play('selection'); if (url) void Linking.openURL(url).catch(() => play('warning')); }}
      style={({ pressed }) => [styles.area, { borderColor: theme.line, opacity: pressed ? ControlMotion.pressedOpacity : 1 }]}>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.areaMap}>
        <PostPinMap pin={{ latitude: area.latitude, longitude: area.longitude }} cityName={city?.englishName} preview area />
      </View>
      <View style={styles.areaCaption}>
        <ThemedText type="smallBold" style={styles.flex}>{tr('{0} 근처', name)}</ThemedText>
        <ThemedText type="smallBold" themeColor="accent">{tr('크게 보기')}</ThemedText>
        <SymbolView name={{ ios: 'arrow.up.right', android: 'north_east', web: 'north_east' }} size={IconSize.chevron} tintColor={theme.accent} />
      </View>
    </Pressable>
    <ThemedText type="small" themeColor="textSecondary">{tr('정확한 위치는 글쓴이가 대화에서 알려 줘요.')}</ThemedText>
    <ThemedText type="caption" themeColor="textSecondary">OpenFreeMap © OpenMapTiles · © OpenStreetMap</ThemedText>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  copy: { flex: 1, minWidth: 0, gap: 6 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  flex: { flex: 1, flexShrink: 1 },
  title: { ...Typography.body, fontWeight: '700' },
  price: { ...Typography.section, fontSize: 17, lineHeight: 24 },
  detailPrice: { ...Typography.sheetTitle, fontSize: 22, lineHeight: 30 },
  badge: { minHeight: 22, paddingHorizontal: 8, borderRadius: 6, justifyContent: 'center' },
  badgeText: { letterSpacing: 0 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  tag: { minHeight: 24, paddingHorizontal: 8, borderRadius: 6, justifyContent: 'center' },
  tagText: { fontWeight: '600' },
  thumb: { width: 72, height: 72, borderRadius: 12 },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  tile: { flex: 1, gap: 4, minWidth: 0 },
  square: { width: '100%', aspectRatio: 1, borderRadius: 12 },
  tileBadge: { position: 'absolute', left: 6, top: 6 },
  tilePrice: { ...Typography.body, fontWeight: '700' },
  info: { gap: Spacing.two, marginTop: Spacing.two },
  infoCard: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  firstRow: { marginTop: -StyleSheet.hairlineWidth },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  infoLabel: { width: 84 },
  areaWrap: { gap: 6, marginTop: Spacing.one },
  area: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  areaMap: { height: 150 },
  areaCaption: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 12 },
});
