import { useLayoutEffect, useMemo, useState } from 'react';
import { Modal, PanResponder, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useReducedMotion } from 'react-native-reanimated';

import { Pressable, ScrollView } from '@/components/analytics-controls';
import { ChillingDateInput } from '@/components/chilling-date-input';
import { DiscoveryMap } from '@/components/discovery-map';
import { ListingCard, type DetailedPost } from '@/components/listing-card';
import { SelectionChip } from '@/components/selection-chip';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles, IconSize, Typography, controlPresentation } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { DISCOVERY_CATEGORIES } from '@/lib/discovery';
import { localDay, parseLocalDay } from '@/lib/chilling-date';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import {
  CONDITIONS, formatMoney, JOB_DEALS, JOB_TYPES, formatMoveIn, groupListingsByArea, inBounds, LISTING_LABELS, ROOMS, type ListingCategory, type ListingFilters, type ListingView, type MapBounds,
} from '@/lib/listing-details';
import { neighborhoodGroups, neighborhoodName, neighborhoodsFor } from '@/lib/neighborhoods';
import type { City, Post } from '@/lib/types';

type FilterKey = 'market' | 'rooms' | 'price' | 'moveIn' | 'deal' | 'condition' | 'jobDeal' | 'jobTypes' | 'wage' | 'area';
const FILTERS: Record<ListingCategory, FilterKey[]> = { housing: ['market', 'rooms', 'price', 'moveIn'], used: ['deal', 'price', 'condition'], jobs: ['jobDeal', 'jobTypes', 'wage', 'area'] };
// 시급 range (owner 2026-11-01 "레인지로해야지"): BC/ON minimum wage to $40+, $1 steps; either end means no limit.
const WAGE = { min: 17, max: 40 } as const;
const THUMB = 28;
// Monthly rent and sale prices live on different scales, so 매매 gets its own steps.
const PRICES = { housing: [1500, 2000, 2500, 3000, 4000], sale: [500000, 800000, 1000000, 1500000, 2000000], used: [0, 20, 50, 100, 300], jobs: [] as number[] };
const MARKETS = { rent: '렌트', sale: '매매' } as const;

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

// 목록 | 사진 그리드, used by 중고거래 and the 비즈니스 feed.
export function ListingViewSwitch({ view, onView }: { view: ListingView; onView: (view: ListingView) => void }) {
  const { tr } = useLanguage();
  return <Segment label={tr('목록 모양')} value={view} onChange={key => onView(key as ListingView)} options={[
    { key: 'list', label: tr('목록으로 보기'), icon: { ios: 'list.bullet', android: 'format_list_bulleted', web: 'format_list_bulleted' } },
    { key: 'grid', label: tr('사진 그리드로 보기'), icon: { ios: 'square.grid.2x2', android: 'grid_view', web: 'grid_view' } },
  ]} />;
}

// Filter chips shared by the list and the map, plus the 중고거래 list/grid toggle.
export function ListingFilterBar({ category, cityId, filters, onChange, view, onView }: {
  category: ListingCategory; cityId: string; filters: ListingFilters; onChange: (next: ListingFilters) => void; view?: ListingView; onView?: (view: ListingView) => void;
}) {
  const theme = useTheme(), { tr, language } = useLanguage(), { play } = useInteractionFeedback();
  const [open, setOpen] = useState<FilterKey | null>(null), [openGroups, setOpenGroups] = useState<string[]>([]);
  const [now] = useState(() => new Date());
  const areas = neighborhoodsFor(cityId), groups = neighborhoodGroups(cityId);
  const groupName = (group: { ko: string; en: string }) => language === 'en' ? group.en : group.ko;
  // A fully picked group reads as its name ("버나비·뉴웨스트"), otherwise each picked neighborhood.
  const picked = groups ? groups.flatMap(group => group.items.every(item => filters.areas.includes(item.id)) ? [groupName(group)]
    : group.items.filter(item => filters.areas.includes(item.id)).map(item => neighborhoodName(item, language)))
    : areas.filter(item => filters.areas.includes(item.id)).map(item => neighborhoodName(item, language));
  // Before a date is chosen the picker shows the 1st of next month; only a chosen date filters.
  const moveInShown = filters.moveInBy ?? localDay(new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString());
  const priceLabel = (value: number) => category === 'used' && value === 0 ? tr('무료만') : tr('{0} 이하', formatMoney(value));
  const summary: Record<FilterKey, string | null> = {
    market: filters.market ? tr(MARKETS[filters.market]) : null,
    rooms: filters.rooms.length ? filters.rooms.map(room => tr(LISTING_LABELS.rooms[room])).join(' · ') : null,
    price: filters.maxPrice != null ? priceLabel(filters.maxPrice) : null,
    moveIn: filters.moveInBy ? tr('{0}까지 입주', formatMoveIn(filters.moveInBy, language)) : null,
    deal: filters.deal ? tr(LISTING_LABELS.used[filters.deal]) : null,
    condition: filters.conditions.length ? filters.conditions.map(item => tr(LISTING_LABELS.condition[item])).join(' · ') : null,
    jobDeal: filters.jobDeal ? tr(LISTING_LABELS.jobs[filters.jobDeal]) : null,
    jobTypes: filters.jobTypes.length ? filters.jobTypes.map(item => tr(LISTING_LABELS.jobTypes[item])).join(' · ') : null,
    wage: filters.minWage != null && filters.maxWage != null ? tr('시급 {0}~{1}', formatMoney(filters.minWage), formatMoney(filters.maxWage))
      : filters.minWage != null ? tr('시급 {0} 이상', formatMoney(filters.minWage)) : filters.maxWage != null ? tr('시급 {0} 이하', formatMoney(filters.maxWage)) : null,
    area: picked.length > 1 ? tr('{0} 외 {1}', picked[0], picked.length - 1) : picked[0] ?? null,
  };
  const names: Record<FilterKey, string> = { market: tr('렌트·매매'), rooms: tr('방 구성'), price: tr('가격'), moveIn: tr('입주일'), deal: tr('팝니다·삽니다'), condition: tr('상태'),
    jobDeal: tr('구인·구직'), jobTypes: tr('근무 형태'), wage: tr('시급'), area: tr('근무 동네') };
  const option = (key: string, label: string, selected: boolean, onPress: () => void, multi = false, spoken = label) => <SelectionChip key={key} analyticsId="listing.filter.option" selected={selected} baseColor={theme.card}
    accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityLabel={spoken} accessibilityState={{ selected, checked: selected }}
    onPress={() => { play('selection'); onPress(); }} style={[ControlStyles.pill, styles.optionChip, { borderColor: selected ? theme.accent : theme.line }]}>
    <ThemedText type="label" style={{ color: selected ? theme.accentInk : theme.text }}>{label}</ThemedText>
  </SelectionChip>;
  const toggle = <T extends string>(list: T[], item: T) => list.includes(item) ? list.filter(entry => entry !== item) : [...list, item];
  const clear = (key: FilterKey) => onChange({ ...filters, ...(key === 'market' ? { market: null, maxPrice: null } : key === 'rooms' ? { rooms: [] } : key === 'price' ? { maxPrice: null } : key === 'moveIn' ? { moveInBy: null } : key === 'deal' ? { deal: null } : key === 'condition' ? { conditions: [] }
    : key === 'jobDeal' ? { jobDeal: null } : key === 'jobTypes' ? { jobTypes: [] } : key === 'wage' ? { minWage: null, maxWage: null } : { areas: [] }) });

  return <View style={styles.filterWrap}>
    <View style={styles.filterRow}>
      <ScrollView analyticsId="listing.filters" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChips} style={styles.flex}>
        {FILTERS[category].filter(key => !(key === 'moveIn' && filters.market === 'sale')).map(key => {
          const active = summary[key] != null, expanded = open === key;
          return <Pressable key={key} analyticsId={`listing.filter.${key}`} accessibilityRole="button" accessibilityLabel={`${names[key]}${active ? `, ${summary[key]}` : ''}`} accessibilityState={{ expanded, selected: active }}
            onPress={() => {
              play('selection'); setOpen(expanded ? null : key);
              if (key === 'area') setOpenGroups(groups?.filter(group => group.items.some(item => filters.areas.includes(item.id))).map(group => group.key) ?? []);
            }}
            style={({ pressed }) => [ControlStyles.pill, styles.filterChip, { borderColor: active || expanded ? theme.accent : theme.line, backgroundColor: active ? theme.backgroundSelected : theme.card, opacity: pressed ? 0.82 : 1 }]}>
            <ThemedText type="label" numberOfLines={1} style={{ color: active ? theme.accent : theme.text }}>{summary[key] ?? names[key]}</ThemedText>
            <SymbolView name={{ ios: expanded ? 'chevron.up' : 'chevron.down', android: expanded ? 'expand_less' : 'expand_more', web: expanded ? 'expand_less' : 'expand_more' }} size={IconSize.chevron} tintColor={active ? theme.accent : theme.textSecondary} />
          </Pressable>;
        })}
      </ScrollView>
      {category === 'used' && view && onView && <ListingViewSwitch view={view} onView={onView} />}
    </View>
    {open && <View style={[styles.panel, { borderColor: theme.line, backgroundColor: theme.backgroundElement }]}>
      {open !== 'moveIn' && open !== 'wage' && !(open === 'area' && groups) && <View style={styles.options}>
        {open === 'market' && (['rent', 'sale'] as const).map(market => option(market, tr(MARKETS[market]), filters.market === market,
          // Switching market resets the price step (different scale); 매매 has no move-in date.
          () => onChange({ ...filters, market: filters.market === market ? null : market, maxPrice: null, moveInBy: market === 'sale' ? null : filters.moveInBy })))}
        {open === 'rooms' && ROOMS.map(room => option(room, tr(LISTING_LABELS.rooms[room]), filters.rooms.includes(room), () => onChange({ ...filters, rooms: toggle(filters.rooms, room) }), true))}
        {open === 'price' && PRICES[category === 'housing' && filters.market === 'sale' ? 'sale' : category].map(value => option(String(value), priceLabel(value), filters.maxPrice === value, () => onChange({ ...filters, maxPrice: filters.maxPrice === value ? null : value })))}
        {open === 'deal' && (['sell', 'buy'] as const).map(deal => option(deal, tr(LISTING_LABELS.used[deal]), filters.deal === deal, () => onChange({ ...filters, deal: filters.deal === deal ? null : deal })))}
        {open === 'jobDeal' && JOB_DEALS.map(deal => option(deal, tr(LISTING_LABELS.jobs[deal]), filters.jobDeal === deal, () => onChange({ ...filters, jobDeal: filters.jobDeal === deal ? null : deal })))}
        {open === 'jobTypes' && JOB_TYPES.map(item => option(item, tr(LISTING_LABELS.jobTypes[item]), filters.jobTypes.includes(item), () => onChange({ ...filters, jobTypes: toggle(filters.jobTypes, item) }), true))}
        {open === 'area' && areas.map(item => option(item.id, neighborhoodName(item, language), filters.areas.includes(item.id), () => onChange({ ...filters, areas: toggle(filters.areas, item.id) }), true))}
        {open === 'condition' && CONDITIONS.map(item => option(item, tr(LISTING_LABELS.condition[item]), filters.conditions.includes(item), () => onChange({ ...filters, conditions: toggle(filters.conditions, item) }), true))}
      </View>}
      {open === 'area' && groups && <View>
        {/* 28 neighborhoods in one wall was hard to scan: one row per group, opened to pick the whole group or single neighborhoods (owner 2026-11-01). */}
        {groups.map((group, index) => {
          const name = groupName(group), ids = group.items.map(item => item.id), count = ids.filter(id => filters.areas.includes(id)).length;
          const all = count === ids.length, expanded = openGroups.includes(group.key);
          return <View key={group.key} style={index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line }}>
            {/* Reuses the area chip's server target: a new id needs a DB row first or the whole analytics batch is rejected. */}
            <Pressable analyticsId="listing.filter.area" accessibilityRole="button" accessibilityLabel={count ? `${name}, ${tr('{0}곳 선택', count)}` : name} accessibilityState={{ expanded }}
              onPress={() => { play('selection'); setOpenGroups(toggle(openGroups, group.key)); }} style={({ pressed }) => [styles.areaHead, { opacity: pressed ? 0.82 : 1 }]}>
              <ThemedText style={[Typography.menu, styles.flex]}>{name}</ThemedText>
              {count > 0 && <ThemedText type="label" themeColor="accent">{all ? tr('전체') : tr('{0}곳 선택', count)}</ThemedText>}
              <SymbolView name={{ ios: expanded ? 'chevron.up' : 'chevron.down', android: expanded ? 'expand_less' : 'expand_more', web: expanded ? 'expand_less' : 'expand_more' }} size={IconSize.chevron} tintColor={theme.textSecondary} />
            </Pressable>
            {expanded && <View style={[styles.options, styles.areaOptions]}>
              {option(`${group.key}.all`, tr('전체'), all, () => onChange({ ...filters, areas: all ? filters.areas.filter(id => !ids.includes(id)) : [...new Set([...filters.areas, ...ids])] }), true, tr('{0} 전체', name))}
              {group.items.map(item => option(item.id, neighborhoodName(item, language), filters.areas.includes(item.id), () => onChange({ ...filters, areas: toggle(filters.areas, item.id) }), true))}
            </View>}
          </View>;
        })}
      </View>}
      {open === 'wage' && <WageRange key={`${filters.minWage}-${filters.maxWage}`} min={filters.minWage} max={filters.maxWage} onChange={(minWage, maxWage) => onChange({ ...filters, minWage, maxWage })} />}
      {open === 'moveIn' && <ChillingDateInput dateOnly label={tr('이 날짜까지 들어갈 수 있는 집')} value={parseLocalDay(moveInShown)} minimumDate={now}
        onChange={iso => { const day = localDay(iso); if (day) { play('selection'); onChange({ ...filters, moveInBy: day }); } }} />}
      {summary[open] != null && <Pressable analyticsId="listing.filter.clear" accessibilityRole="button" onPress={() => { play('selection'); clear(open); }} style={styles.clear}>
        <ThemedText type="label" themeColor="accent">{tr('이 조건 지우기')}</ThemedText>
      </Pressable>}
    </View>}
  </View>;
}

// Two thumbs on one track. Drag or use VoiceOver adjust; the list filters when a thumb is let go.
// `live` is a plain object like drag-sheet's SheetLive: the pan handlers read and write it outside render.
function WageRange({ min, max, onChange }: { min: number | null; max: number | null; onChange: (min: number | null, max: number | null) => void }) {
  const theme = useTheme(), { tr } = useLanguage(), { play } = useInteractionFeedback();
  const [values, setValues] = useState({ lo: min ?? WAGE.min, hi: max ?? WAGE.max });
  const [track, setTrack] = useState(0);
  const [live] = useState(() => ({ ...values, track: 0, start: 0, onChange, play }));
  useLayoutEffect(() => { Object.assign(live, { track, onChange, play }); });
  const span = WAGE.max - WAGE.min;
  const [api] = useState(() => {
    const place = (which: 'lo' | 'hi', raw: number) => {
      if (which === 'lo') live.lo = Math.min(Math.max(raw, WAGE.min), live.hi);
      else live.hi = Math.max(Math.min(raw, WAGE.max), live.lo);
      setValues({ lo: live.lo, hi: live.hi });
    };
    const commit = () => { live.play('selection'); live.onChange(live.lo > WAGE.min ? live.lo : null, live.hi < WAGE.max ? live.hi : null); };
    const pans = (['lo', 'hi'] as const).map(which => PanResponder.create({
      onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false, // the feed scroll must not steal a sideways drag
      onPanResponderGrant: () => { live.start = live[which]; },
      onPanResponderMove: (_, g) => { if (live.track) place(which, Math.round(live.start + g.dx / live.track * span)); },
      onPanResponderRelease: commit, onPanResponderTerminate: commit,
    }));
    return { pans, step: (which: 'lo' | 'hi', by: number) => { place(which, live[which] + by); commit(); } };
  });
  const x = (value: number) => (value - WAGE.min) / span * track;
  const top = (value: number) => value >= WAGE.max ? `${formatMoney(value)}+` : formatMoney(value);
  return <View style={styles.wage}>
    <ThemedText type="label" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{`${formatMoney(values.lo)} ~ ${top(values.hi)}`}</ThemedText>
    <View style={styles.wageTrack} onLayout={event => setTrack(Math.max(0, event.nativeEvent.layout.width - THUMB))}>
      <View style={[styles.wageRail, { backgroundColor: theme.line }]} />
      <View style={[styles.wageRail, { backgroundColor: theme.accent, left: x(values.lo) + THUMB / 2, width: Math.max(0, x(values.hi) - x(values.lo)) }]} />
      {(['lo', 'hi'] as const).map((which, index) => <View key={which} {...api.pans[index].panHandlers} hitSlop={8}
        accessible accessibilityRole="adjustable" accessibilityLabel={which === 'lo' ? tr('최저 시급') : tr('최고 시급')}
        accessibilityValue={{ min: WAGE.min, max: WAGE.max, now: values[which], text: top(values[which]) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={event => api.step(which, event.nativeEvent.actionName === 'increment' ? 1 : -1)}
        style={[styles.wageThumb, { left: x(values[which]), backgroundColor: theme.card, borderColor: theme.accent }]} />)}
    </View>
    <View style={styles.wageEnds}><ThemedText type="small" themeColor="textSecondary">{formatMoney(WAGE.min)}</ThemedText><ThemedText type="small" themeColor="textSecondary">{top(WAGE.max)}</ThemedText></View>
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
      <View style={styles.mapFilters}><ListingFilterBar category={category} cityId={city.id} filters={filters} onChange={next => { setSelectedId(null); onFilters(next); }} /></View>
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
  areaHead: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.one },
  areaOptions: { paddingBottom: Spacing.three },
  wage: { gap: Spacing.two, paddingHorizontal: Spacing.one },
  wageTrack: { height: 44, justifyContent: 'center' },
  wageRail: { position: 'absolute', left: THUMB / 2, right: THUMB / 2, height: 4, borderRadius: 2 },
  wageThumb: { position: 'absolute', width: THUMB, height: THUMB, borderRadius: THUMB / 2, borderWidth: 2 },
  wageEnds: { flexDirection: 'row', justifyContent: 'space-between' },
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
