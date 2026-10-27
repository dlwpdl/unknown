import { useMemo, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useReducedMotion } from 'react-native-reanimated';

import { Pressable, ScrollView } from '@/components/analytics-controls';
import { DiscoveryMap } from '@/components/discovery-map';
import { ListingCard, type DetailedPost } from '@/components/listing-card';
import { SelectionChip } from '@/components/selection-chip';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles, IconSize, Typography, controlPresentation } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { DISCOVERY_CATEGORIES } from '@/lib/discovery';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import {
  CONDITIONS, formatMoney, groupListingsByArea, inBounds, LISTING_LABELS, ROOMS, type ListingCategory, type ListingFilters, type ListingView, type MapBounds,
} from '@/lib/listing-details';
import type { City, Post } from '@/lib/types';

type FilterKey = 'market' | 'rooms' | 'price' | 'moveIn' | 'deal' | 'condition';
const FILTERS: Record<'housing' | 'used', FilterKey[]> = { housing: ['market', 'rooms', 'price', 'moveIn'], used: ['deal', 'price', 'condition'] };
// Monthly rent and sale prices live on different scales, so 매매 gets its own steps.
const PRICES = { housing: [1500, 2000, 2500, 3000, 4000], sale: [500000, 800000, 1000000, 1500000, 2000000], used: [0, 20, 50, 100, 300] };
const MARKETS = { rent: '렌트', sale: '매매' } as const;
const monthEnd = (now: Date, offset: number) => {
  const date = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

function Segment({ options, value, onChange, label }: { options: { key: string; label: string; icon?: SymbolViewProps['name'] }[]; value: string; onChange: (key: string) => void; label: string }) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  return <View accessibilityRole="tablist" accessibilityLabel={label} style={[styles.segment, { backgroundColor: theme.backgroundElement }]}>
    {options.map(option => {
      const selected = option.key === value;
      return <Pressable key={option.key} analyticsId={`listing.segment.${option.key}`} accessibilityRole="tab" accessibilityLabel={option.label} accessibilityState={{ selected }}
        onPress={() => { play('selection'); if (!selected) onChange(option.key); }}
        style={({ pressed }) => [styles.segmentItem, { backgroundColor: selected ? theme.card : 'transparent', opacity: pressed ? 0.82 : 1 }]}>
        {option.icon ? <SymbolView name={option.icon} size={IconSize.inline + 2} tintColor={selected ? theme.accent : theme.textSecondary} />
          : <ThemedText type="label" style={{ color: selected ? theme.accent : theme.textSecondary }}>{option.label}</ThemedText>}
      </Pressable>;
    })}
  </View>;
}

// 목록 | 지도 for 부동산·중고거래. The map opens as its own screen so map gestures never fight the feed scroll.
export function ListingModeSwitch({ mode, onChange }: { mode: 'list' | 'map'; onChange: (mode: 'list' | 'map') => void }) {
  const { tr } = useLanguage();
  return <Segment label={tr('보기 방식')} value={mode} onChange={key => onChange(key as 'list' | 'map')} options={[{ key: 'list', label: tr('목록') }, { key: 'map', label: tr('지도') }]} />;
}

// Filter chips shared by the list and the map, plus the 중고거래 list/grid toggle.
export function ListingFilterBar({ category, filters, onChange, view, onView }: {
  category: ListingCategory; filters: ListingFilters; onChange: (next: ListingFilters) => void; view?: ListingView; onView?: (view: ListingView) => void;
}) {
  const theme = useTheme(), { tr, language } = useLanguage(), { play } = useInteractionFeedback();
  const [open, setOpen] = useState<FilterKey | null>(null);
  const [now] = useState(() => new Date());
  if (category === 'jobs') return null;
  const months = [0, 1, 2].map(offset => monthEnd(now, offset));
  const monthLabel = (iso: string, index: number) => {
    const month = Number(iso.slice(5, 7));
    return language === 'en' ? tr(index === 0 ? '{0} 안' : '{0}까지', ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1]) : `${month}월${index === 0 ? ' 안' : '까지'}`;
  };
  const priceLabel = (value: number) => category === 'used' && value === 0 ? tr('무료만') : tr('{0} 이하', formatMoney(value));
  const summary: Record<FilterKey, string | null> = {
    market: filters.market ? tr(MARKETS[filters.market]) : null,
    rooms: filters.rooms.length ? filters.rooms.map(room => tr(LISTING_LABELS.rooms[room])).join(' · ') : null,
    price: filters.maxPrice != null ? priceLabel(filters.maxPrice) : null,
    moveIn: filters.moveInBy ? monthLabel(filters.moveInBy, months.indexOf(filters.moveInBy)) : null,
    deal: filters.deal ? tr(LISTING_LABELS.used[filters.deal]) : null,
    condition: filters.conditions.length ? filters.conditions.map(item => tr(LISTING_LABELS.condition[item])).join(' · ') : null,
  };
  const names: Record<FilterKey, string> = { market: tr('렌트·매매'), rooms: tr('방 구성'), price: tr('가격'), moveIn: tr('입주일'), deal: tr('팝니다·삽니다'), condition: tr('상태') };
  const option = (key: string, label: string, selected: boolean, onPress: () => void, multi = false) => <SelectionChip key={key} analyticsId="listing.filter.option" selected={selected} baseColor={theme.card}
    accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityLabel={label} accessibilityState={{ selected, checked: selected }}
    onPress={() => { play('selection'); onPress(); }} style={[ControlStyles.pill, styles.optionChip, { borderColor: selected ? theme.accent : theme.line }]}>
    <ThemedText type="label" style={{ color: selected ? theme.accentInk : theme.text }}>{label}</ThemedText>
  </SelectionChip>;
  const toggle = <T extends string>(list: T[], item: T) => list.includes(item) ? list.filter(entry => entry !== item) : [...list, item];
  const clear = (key: FilterKey) => onChange({ ...filters, ...(key === 'market' ? { market: null, maxPrice: null } : key === 'rooms' ? { rooms: [] } : key === 'price' ? { maxPrice: null } : key === 'moveIn' ? { moveInBy: null } : key === 'deal' ? { deal: null } : { conditions: [] }) });

  return <View style={styles.filterWrap}>
    <View style={styles.filterRow}>
      <ScrollView analyticsId="listing.filters" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChips} style={styles.flex}>
        {FILTERS[category].filter(key => !(key === 'moveIn' && filters.market === 'sale')).map(key => {
          const active = summary[key] != null, expanded = open === key;
          return <Pressable key={key} analyticsId={`listing.filter.${key}`} accessibilityRole="button" accessibilityLabel={`${names[key]}${active ? `, ${summary[key]}` : ''}`} accessibilityState={{ expanded, selected: active }}
            onPress={() => { play('selection'); setOpen(expanded ? null : key); }}
            style={({ pressed }) => [ControlStyles.pill, styles.filterChip, { borderColor: active || expanded ? theme.accent : theme.line, backgroundColor: active ? theme.backgroundSelected : theme.card, opacity: pressed ? 0.82 : 1 }]}>
            <ThemedText type="label" numberOfLines={1} style={{ color: active ? theme.accent : theme.text }}>{summary[key] ?? names[key]}</ThemedText>
            <SymbolView name={{ ios: expanded ? 'chevron.up' : 'chevron.down', android: expanded ? 'expand_less' : 'expand_more', web: expanded ? 'expand_less' : 'expand_more' }} size={IconSize.chevron} tintColor={active ? theme.accent : theme.textSecondary} />
          </Pressable>;
        })}
      </ScrollView>
      {category === 'used' && view && onView && <Segment label={tr('목록 모양')} value={view} onChange={key => onView(key as ListingView)} options={[
        { key: 'list', label: tr('목록으로 보기'), icon: { ios: 'list.bullet', android: 'format_list_bulleted', web: 'format_list_bulleted' } },
        { key: 'grid', label: tr('사진 그리드로 보기'), icon: { ios: 'square.grid.2x2', android: 'grid_view', web: 'grid_view' } },
      ]} />}
    </View>
    {open && <View style={[styles.panel, { borderColor: theme.line, backgroundColor: theme.backgroundElement }]}>
      <View style={styles.options}>
        {open === 'market' && (['rent', 'sale'] as const).map(market => option(market, tr(MARKETS[market]), filters.market === market,
          // Switching market resets the price step (different scale); 매매 has no move-in date.
          () => onChange({ ...filters, market: filters.market === market ? null : market, maxPrice: null, moveInBy: market === 'sale' ? null : filters.moveInBy })))}
        {open === 'rooms' && ROOMS.map(room => option(room, tr(LISTING_LABELS.rooms[room]), filters.rooms.includes(room), () => onChange({ ...filters, rooms: toggle(filters.rooms, room) }), true))}
        {open === 'price' && PRICES[category === 'housing' && filters.market === 'sale' ? 'sale' : category].map(value => option(String(value), priceLabel(value), filters.maxPrice === value, () => onChange({ ...filters, maxPrice: filters.maxPrice === value ? null : value })))}
        {open === 'moveIn' && months.map((iso, index) => option(iso, monthLabel(iso, index), filters.moveInBy === iso, () => onChange({ ...filters, moveInBy: filters.moveInBy === iso ? null : iso })))}
        {open === 'deal' && (['sell', 'buy'] as const).map(deal => option(deal, tr(LISTING_LABELS.used[deal]), filters.deal === deal, () => onChange({ ...filters, deal: filters.deal === deal ? null : deal })))}
        {open === 'condition' && CONDITIONS.map(item => option(item, tr(LISTING_LABELS.condition[item]), filters.conditions.includes(item), () => onChange({ ...filters, conditions: toggle(filters.conditions, item) }), true))}
      </View>
      {summary[open] != null && <Pressable analyticsId="listing.filter.clear" accessibilityRole="button" onPress={() => { play('selection'); clear(open); }} style={styles.clear}>
        <ThemedText type="label" themeColor="accent">{tr('이 조건 지우기')}</ThemedText>
      </Pressable>}
    </View>}
  </View>;
}

// Category map: same MapLibre theme, controls and sheet as the discovery map, but only this category's posts.
export function ListingMapScreen({ visible, category, city, posts, filters, onFilters, onClose, onOpenPost }: {
  visible: boolean; category: 'housing' | 'used'; city: City; posts: Post[]; filters: ListingFilters; onFilters: (next: ListingFilters) => void;
  onClose: () => void; onOpenPost: (post: Post) => void;
}) {
  const theme = useTheme(), { tr, language } = useLanguage(), { play } = useInteractionFeedback(), reduced = useReducedMotion();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moved, setMoved] = useState<MapBounds | null>(null), [region, setRegion] = useState<MapBounds | null>(null);
  const [free, setFree] = useState(false); // after the first pan or tap the camera is the person's
  const color = DISCOVERY_CATEGORIES.find(item => item.id === category)!.color;
  const areas = useMemo(() => groupListingsByArea(posts, language).filter(area => !region || inBounds(region, area)), [posts, language, region]);
  const markers = useMemo(() => areas.map(area => ({ id: area.id, latitude: area.latitude, longitude: area.longitude, color, label: area.label })), [areas, color]);
  const selected = areas.find(area => area.id === selectedId) ?? null;
  // Open on the busiest neighborhood: the city centre can sit outside every listing.
  const busiest = areas.reduce<typeof areas[number] | null>((top, area) => !top || area.posts.length > top.posts.length ? area : top, null);
  const focus = free || !busiest ? null : { latitude: busiest.latitude, longitude: busiest.longitude };
  const count = areas.reduce((sum, area) => sum + area.posts.length, 0);
  const close = () => { play('selection'); setFree(false); setMoved(null); setRegion(null); setSelectedId(null); onClose(); };
  return <Modal visible={visible} animationType={reduced ? 'none' : 'slide'} onRequestClose={onClose}>
    <SafeAreaProvider style={styles.flex}>
    <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: theme.background }]}>
      <View style={styles.mapHeader}>
        <Pressable analyticsId="listing.map.close" accessibilityRole="button" accessibilityLabel={tr('목록으로 돌아가기')} onPress={close}
          style={({ pressed }) => [ControlStyles.icon, controlPresentation(theme, { tone: 'ghost', pressed }).container]}>
          <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={IconSize.toolbar} tintColor={theme.text} />
        </Pressable>
        <ThemedText accessibilityRole="header" style={[Typography.menu, styles.flex]} numberOfLines={1}>{tr(city.name)} · {tr(category === 'housing' ? '부동산' : '중고거래')}</ThemedText>
        <ListingModeSwitch mode="map" onChange={mode => { if (mode === 'list') { setFree(false); setMoved(null); setRegion(null); setSelectedId(null); onClose(); } }} />
      </View>
      <View style={styles.mapFilters}><ListingFilterBar category={category} filters={filters} onChange={next => { setSelectedId(null); onFilters(next); }} /></View>
      <View style={styles.flex}>
        {visible && <DiscoveryMap markers={markers} cityName={city.englishName} selectedId={selected?.id ?? null}
          center={focus} onSelect={id => { setFree(true); setSelectedId(id); }} onMoved={bounds => { setFree(true); setMoved(bounds); }} bottomInset={selected ? 300 : 72} />}
        {moved && moved !== region && <Pressable analyticsId="listing.map.search-here" accessibilityRole="button" onPress={() => { play('selection'); setRegion(moved); setSelectedId(null); }}
          style={({ pressed }) => [styles.searchHere, { backgroundColor: theme.card, borderColor: theme.line, opacity: pressed ? 0.82 : 1 }]}>
          <SymbolView name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }} size={IconSize.inline} tintColor={theme.accent} />
          <ThemedText type="label" themeColor="accent">{tr('이 지역에서 다시 찾기')}</ThemedText>
        </Pressable>}
        {selected ? <View style={[styles.sheet, { backgroundColor: theme.card, borderColor: theme.line }]}>
          <View style={styles.sheetHead}>
            <ThemedText accessibilityRole="header" type="label" style={styles.flex}>{selected.name ?? tr('이 근처')} · {tr('글 {0}개', selected.posts.length)}</ThemedText>
            <Pressable analyticsId="listing.map.sheet-close" accessibilityRole="button" accessibilityLabel={tr('닫기')} onPress={() => { play('selection'); setSelectedId(null); }}
              style={({ pressed }) => [ControlStyles.icon, controlPresentation(theme, { tone: 'ghost', pressed }).container]}>
              <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={IconSize.inline} tintColor={theme.text} />
            </Pressable>
          </View>
          <ScrollView analyticsId="listing.map.sheet" style={styles.sheetScroll}>
            {selected.posts.map(post => post.listingDetails ? <ListingCard key={post.id} post={post as DetailedPost} onPress={() => onOpenPost(post)} />
              : <Pressable key={post.id} analyticsId="listing.map.legacy" accessibilityRole="button" onPress={() => { play('selection'); onOpenPost(post); }} style={[styles.legacy, { borderBottomColor: theme.line }]}>
                <ThemedText style={Typography.body} numberOfLines={2}>{post.title}</ThemedText>
              </Pressable>)}
          </ScrollView>
        </View> : <Pressable analyticsId="listing.map.to-list" accessibilityRole="button" onPress={close}
          style={({ pressed }) => [styles.listLink, { backgroundColor: theme.card, borderColor: theme.line, opacity: pressed ? 0.82 : 1 }]}>
          <ThemedText type="label" accessibilityLiveRegion="polite">{tr('이 지도 안에 글 {0}개', count)}</ThemedText>
          <ThemedText type="label" themeColor="accent">{tr('목록으로 보기')} ›</ThemedText>
        </Pressable>}
        {markers.length === 0 && <View pointerEvents="none" style={[styles.empty, { backgroundColor: theme.card, borderColor: theme.line }]}>
          <ThemedText type="small" themeColor="textSecondary">{tr('지도에 표시할 글이 아직 없어요. 동네를 고른 글만 지도에 나와요.')}</ThemedText>
        </View>}
      </View>
    </SafeAreaView>
    </SafeAreaProvider>
  </Modal>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1 },
  segment: { flexDirection: 'row', borderRadius: 12, padding: 3, gap: 2, alignSelf: 'flex-start' },
  segmentItem: { minWidth: 44, minHeight: 38, borderRadius: 9, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  filterWrap: { gap: Spacing.two },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  filterChips: { flexDirection: 'row', gap: Spacing.two },
  filterChip: { flexDirection: 'row', gap: 4, borderWidth: 1, paddingHorizontal: 12, maxWidth: 220 },
  panel: { borderWidth: 1, borderRadius: 16, padding: 12, gap: Spacing.two },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  optionChip: { borderWidth: 1 },
  clear: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  mapHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.two, minHeight: 56 },
  mapFilters: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
  searchHere: { position: 'absolute', top: 12, alignSelf: 'center', minHeight: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  listLink: { position: 'absolute', bottom: 16, alignSelf: 'center', minHeight: 56, paddingHorizontal: 16, borderRadius: 24, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sheet: { position: 'absolute', bottom: 16, left: 16, right: 16, maxHeight: '45%', borderRadius: 18, borderWidth: 1, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8,
    shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sheetScroll: { flexShrink: 1 },
  legacy: { minHeight: 44, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  empty: { position: 'absolute', top: 72, left: 16, right: 16, borderRadius: 14, borderWidth: 1, padding: 12 },
});
