import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import { Keyboard, ScrollView, StyleSheet, TextInput, View, type GestureResponderEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SymbolView } from '@/components/symbol-view';

import { FlatList, Pressable } from '@/components/analytics-controls';
import { CityPlacePhoto } from '@/components/city-place-photo';
import { ClayPillFill, useClay } from '@/components/clay';
import { SelectionChip } from '@/components/selection-chip';
import { StateCard } from '@/components/state-card';
import { GlingLoader } from '@/components/gling-loader';
import { PriceSheet } from '@/components/price-sheet';
import { PostZoomLink } from '@/components/post-zoom-link';
import { ThemedText } from '@/components/themed-text';
import { ControlMotion, ControlStyles, IconSize, Typography } from '@/constants/design-system';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useLanguage } from '@/hooks/use-language';
import { useRevealChip } from '@/hooks/use-reveal-chip';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { priceLabel, priceSymbol } from '@/lib/discovery';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { getCityPlaces, type CityPlace } from '@/lib/city-places';
import { CITIES } from '@/lib/mock';
import { nearestNeighborhood, neighborhoodName } from '@/lib/neighborhoods';
import { supabase } from '@/lib/supabase';
import { loadUnifiedSearch, type UnifiedSearchItem, type UnifiedSearchKind } from '@/lib/unified-search';
import { addRecentSearch, parseRecentSearches, recentSearchKey, removeRecentSearch } from '@/lib/recent-searches';

type Kind = Exclude<UnifiedSearchKind, 'all'>;
const kinds: UnifiedSearchKind[] = ['all', 'business', 'place', 'person', 'post', 'meetup'];
const kindActions = { all: 'search.kind.all', business: 'search.kind.business', place: 'search.kind.place', person: 'search.kind.person', post: 'search.kind.post', meetup: 'search.kind.meetup' };
const resultActions = { business: 'search.result.business', place: 'search.result.place', person: 'search.result.person', post: 'search.result.post', meetup: 'search.result.meetup' };
const identity = (item: UnifiedSearchItem) => `${item.kind}:${item.cityId}:${item.id}`;
const NO_PRICES: number[] = [];
type ContextToken = readonly unknown[];
type Result = { token: ContextToken; items: UnifiedSearchItem[]; hasMore: boolean; nextOffset: number; priced?: boolean; loadingMore: boolean; moreFailed: boolean };
type Scope = { token: ContextToken; active: boolean; controller: AbortController; morePending: boolean; result: Result | null };

export function UnifiedSearch({ initialCityId, initialQuery = '', initialKind = 'all' }: { initialCityId: string; initialQuery?: string; initialKind?: UnifiedSearchKind }) {
  const router = useRouter(), focused = useIsFocused(), hidden = useContentVisibility();
  const { isAuthed, isAuthLoading, me } = useAuth(), { play } = useInteractionFeedback();
  const [query, setQuery] = useState(initialQuery), [kind, setKind] = useState<UnifiedSearchKind>(initialKind);
  const [cityId, setCityId] = useState<string | null>(initialCityId), [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Result | null>(null), [failure, setFailure] = useState<ContextToken | null>(null);
  // Price narrows 장소 only (owner 2026-11-13 "장소찾을떄도 필터할수잇게? ... 가격별"), with the map's own price sheet.
  const [priceLevels, setPriceLevels] = useState<number[]>([]), [priceDraft, setPriceDraft] = useState<number[] | null>(null);
  const prices = kind === 'place' ? priceLevels : NO_PRICES, priceKey = prices.join(',');
  const needle = query.trim().replace(/^#/, '').trim(), viewer = me.id;
  const token = useMemo(() => [query, cityId, kind, viewer, isAuthed, isAuthLoading, focused, attempt, hidden, priceKey] as const, [query, cityId, kind, viewer, isAuthed, isAuthLoading, focused, attempt, hidden, priceKey]);
  const live = useRef<Scope | null>(null);
  const current = loaded?.token === token ? loaded : null;
  useLayoutEffect(() => {
    const scope: Scope = { token, active: focused, controller: new AbortController(), morePending: false, result: null };
    live.current = scope;
    return () => { scope.active = false; scope.controller.abort(); };
  }, [focused, token]);
  useLayoutEffect(() => { if (live.current?.token === token) live.current.result = current; }, [current, token]);
  const isCurrent = () => live.current?.token === token && live.current.active;
  // 최근 검색어: this phone only, per account.
  const recentKey = recentSearchKey(isAuthed ? viewer : null);
  const [recent, setRecent] = useState<{ key: string; items: string[] } | null>(null);
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(recentKey).then(raw => { if (active) setRecent({ key: recentKey, items: parseRecentSearches(raw) }); }).catch(() => {});
    return () => { active = false; };
  }, [recentKey]);
  const recentItems = recent?.key === recentKey ? recent.items : [];
  const saveRecent = (items: string[]) => {
    setRecent({ key: recentKey, items });
    void AsyncStorage.setItem(recentKey, JSON.stringify(items)).catch(() => {});
  };
  const visible = (item: UnifiedSearchItem) => item.kind === 'post' || item.kind === 'meetup' ? !hidden('post', item.id)
    : item.kind === 'person' ? !hidden('user', item.id) : item.kind === 'business' ? !hidden('user', item.merchantId ?? item.id) : !item.merchantId || !hidden('user', item.merchantId);
  useEffect(() => {
    const scope = live.current;
    if (!needle || isAuthLoading || !scope?.active || scope.token !== token) return;
    const timer = setTimeout(() => {
      if (!scope.active || live.current !== scope) return;
      void loadUnifiedSearch(supabase, { query: needle, cityId, kind, offset: 0, priceLevels: prices, signal: scope.controller.signal }).then(page => {
        if (scope.active && live.current === scope) setLoaded({ token, ...page, loadingMore: false, moreFailed: false });
      }).catch(() => { if (scope.active && live.current === scope && !scope.controller.signal.aborted) setFailure(token); });
    }, 250);
    return () => clearTimeout(timer);
  }, [cityId, isAuthLoading, kind, needle, token, prices]);
  function open(item: UnifiedSearchItem, event?: GestureResponderEvent) {
    const scope = live.current;
    // Post and meetup rows navigate through PostZoomLink right after this; a stale or hidden row cancels it.
    if (!isCurrent() || isAuthLoading || !scope?.result || scope.result.token !== token) return event?.preventDefault();
    const target = scope.result.items.find(value => identity(value) === identity(item));
    if (!target || !visible(target)) return event?.preventDefault();
    play('selection'); Keyboard.dismiss(); saveRecent(addRecentSearch(recentItems, query));
    if (target.kind === 'business' || (target.kind === 'place' && target.merchantId)) router.push({ pathname: '/company/[id]', params: { id: target.merchantId ?? target.id } });
    else if (target.kind === 'person') router.push({ pathname: '/user/[id]', params: { id: target.id } });
    else if (target.kind === 'place') router.push({ pathname: '/map', params: { cityId: target.cityId, placeId: target.placeId ?? target.id } });
  }
  function more() {
    const scope = live.current;
    if (!isCurrent() || isAuthLoading || kind === 'all' || !current?.hasMore || scope?.result !== current || scope.morePending) return;
    scope.morePending = true; play('selection');
    setLoaded(previous => previous?.token === token ? { ...previous, loadingMore: true, moreFailed: false } : previous);
    void loadUnifiedSearch(supabase, { query: needle, cityId, kind, offset: current.nextOffset, priceLevels: prices, signal: scope.controller.signal }).then(page => {
      if (!scope.active || live.current !== scope) return;
      setLoaded(previous => {
        if (previous?.token !== token) return previous;
        const unique = new Map(previous.items.map(value => [identity(value), value]));
        page.items.forEach(value => unique.set(identity(value), value));
        return { token, items: [...unique.values()], hasMore: page.hasMore, nextOffset: page.nextOffset, priced: previous.priced, loadingMore: false, moreFailed: false };
      });
    }).catch(() => {
      if (scope.active && live.current === scope && !scope.controller.signal.aborted) {
        setLoaded(previous => previous?.token === token ? { ...previous, loadingMore: false, moreFailed: true } : previous); play('warning');
      }
    }).finally(() => { scope.morePending = false; });
  }
  return <UnifiedSearchView query={query} kind={kind} cityId={cityId} currentCityId={initialCityId} items={current?.items.filter(visible) ?? []}
    loading={!!needle && (isAuthLoading || (!current && failure !== token))} failed={failure === token} hasMore={!!current?.hasMore && kind !== 'all'}
    moreLoading={!!current?.loadingMore} moreFailed={!!current?.moreFailed} priced={!!current?.priced} prices={prices} priceDraft={priceDraft}
    onPriceDraft={value => { if (isCurrent()) setPriceDraft(value); }} onPrices={value => { if (!isCurrent()) return; setPriceLevels(value); setPriceDraft(null); }}
    onBack={() => { if (!isCurrent()) return; play('selection'); Keyboard.dismiss(); if (router.canGoBack()) router.back(); else router.replace('/'); }}
    onQuery={value => { if (!isCurrent()) return; setQuery(value.slice(0, 100)); if (value.trim().startsWith('#')) setKind('post'); }}
    onClear={() => { if (!isCurrent()) return; play('selection'); setQuery(''); }}
    onKind={value => { if (!isCurrent() || !kinds.includes(value)) return; play('selection'); setKind(value); }}
    onScope={value => { if (!isCurrent() || (value !== null && value !== initialCityId)) return; play('selection'); setCityId(value); }}
    onRetry={() => { if (isCurrent()) setAttempt(value => value + 1); }} onMore={more} onOpen={open}
    onSubmit={() => { if (isCurrent()) saveRecent(addRecentSearch(recentItems, query)); }} recent={recentItems}
    onRecent={value => { if (!isCurrent()) return; play('selection'); setQuery(value); if (value.startsWith('#')) setKind('post'); }}
    onRemoveRecent={value => { if (!isCurrent()) return; play('selection'); saveRecent(removeRecentSearch(recentItems, value)); }}
    onClearRecent={() => { if (!isCurrent()) return; play('selection'); saveRecent([]); }} />;
}

type ViewProps = {
  query: string; kind: UnifiedSearchKind; cityId: string | null; currentCityId: string; items: UnifiedSearchItem[];
  loading: boolean; failed: boolean; hasMore: boolean; moreLoading: boolean; moreFailed: boolean;
  // 장소 price filter: priced says some matching place has a price; priceDraft null keeps the sheet closed.
  priced: boolean; prices: number[]; priceDraft: number[] | null; onPriceDraft: (draft: number[] | null) => void; onPrices: (levels: number[]) => void;
  onBack: () => void; onQuery: (query: string) => void; onClear: () => void; onKind: (kind: UnifiedSearchKind) => void;
  onScope: (city: string | null) => void; onRetry: () => void; onMore: () => void; onOpen: (item: UnifiedSearchItem, event?: GestureResponderEvent) => void;
  recent?: string[]; onSubmit?: () => void; onRecent?: (query: string) => void; onRemoveRecent?: (query: string) => void; onClearRecent?: () => void;
};
type Row = { type: 'heading'; kind: Kind; full: boolean } | { type: 'item'; item: UnifiedSearchItem };
export function UnifiedSearchView(props: ViewProps) {
  const theme = useTheme(), { language, tr } = useLanguage(), { play } = useInteractionFeedback(), ko = language === 'ko', clay = useClay();
  const kindRow = useRevealChip(props.kind, !useReducedMotion());
  // '글' as everywhere else in the app (QA A-search-01).
  const labels = ko ? { all: '전체', business: '비즈니스', place: '장소', person: '사람', post: '글', meetup: '모임' }
    : { all: 'All', business: 'Businesses', place: 'Places', person: 'People', post: 'Posts', meetup: 'Meetups' };
  const cityName = (id: string) => tr(CITIES.find(value => value.id === id)?.name ?? id);
  // A catalog place shows its photo and 'neighbourhood · street' instead of a grey pin and an address in whatever form it came (QA I-search-02).
  const catalogPlace = (item: UnifiedSearchItem): CityPlace | null => {
    if (item.kind !== 'place' || !item.placeId) return null;
    try { return getCityPlaces(item.cityId).find(place => place.id === item.placeId) ?? null; } catch { return null; }
  };
  const placeLine = (item: UnifiedSearchItem, place: CityPlace | null) => {
    const area = place && nearestNeighborhood(place.cityId, place);
    return area ? [neighborhoodName(area, language), item.subtitle.split(',')[0].trim()].filter(Boolean).join(' · ') : item.subtitle;
  };
  // Posts and meetups grow out of the pressed row (owner 2026-11-02); the row's object style survives the link's Slot.
  const zoom = (item: UnifiedSearchItem, row: React.ReactElement<{ onPress?: (event?: GestureResponderEvent) => void }>) => item.kind === 'post' || item.kind === 'meetup' ? <PostZoomLink id={item.id}>{row}</PostZoomLink> : row;
  const rows: Row[] = props.kind === 'all' ? (kinds.filter(value => value !== 'all') as Kind[]).flatMap(kind => {
    const values = props.items.filter(item => item.kind === kind).slice(0, 3);
    return values.length ? [{ type: 'heading' as const, kind, full: values.length === 3 }, ...values.map(item => ({ type: 'item' as const, item }))] : [];
  }) : props.items.map(item => ({ type: 'item', item }));
  const empty = props.loading ? <View style={styles.state}><GlingLoader /><ThemedText accessibilityLiveRegion="polite" themeColor="textSecondary">{ko ? '검색하고 있어요…' : 'Searching…'}</ThemedText></View>
    : props.failed ? <View style={styles.state}><StateCard kind="error" title={ko ? '검색 결과를 불러오지 못했어요' : 'Couldn’t load results'} body={ko ? '연결을 확인하고 다시 시도해 주세요.' : 'Check your connection and try again.'} actionLabel={ko ? '다시 시도' : 'Try again'} onAction={props.onRetry} /></View>
    : props.prices.length && props.query.trim() ? <View style={styles.state}><StateCard kind="empty" title={tr('이 가격대에 맞는 곳이 없어요')} body={tr('필터를 풀면 다른 곳도 보여요.')} actionLabel={tr('가격 필터 풀기')} onAction={() => props.onPrices([])} /></View>
      // No results offers the wider search as buttons, not only as advice (QA I-search-03); before typing, a search glyph and plain words (QA I-search-01).
      : props.query.trim() ? <View style={styles.state}><StateCard kind="empty" title={ko ? '검색 결과가 없어요' : 'No results found'}
        body={ko ? '검색어를 바꾸거나 더 넓게 찾아봐요.' : 'Try another search term or a wider search.'}
        {...props.cityId !== null ? { analyticsId: 'search.scope.canada', actionLabel: ko ? '캐나다 전체에서 찾기' : 'Search all of Canada', onAction: () => props.onScope(null) } : {}}>
        {props.kind !== 'all' && <Pressable analyticsId="search.kind.all" accessibilityRole="button" onPress={() => props.onKind('all')}
          style={({ pressed }) => [ControlStyles.pill, styles.wider, clay && { overflow: 'visible', paddingHorizontal: 18 }, { borderColor: clay ? 'transparent' : theme.line, opacity: pressed ? 0.8 : 1 }]}>
          {clay && <ClayPillFill kind="white" />}<ThemedText type="label" themeColor="accent">{ko ? '모든 종류로 보기' : 'Show every type'}</ThemedText></Pressable>}
      </StateCard></View>
      : props.recent?.length ? <View style={styles.recent}>
        <View style={styles.group}><ThemedText type="section" accessibilityRole="header" style={styles.groupTitle}>{ko ? '최근 검색어' : 'Recent searches'}</ThemedText>
          <Pressable analyticsId="search.recent.clear" accessibilityRole="button" onPress={props.onClearRecent} style={styles.groupMore}><ThemedText type="label" themeColor="accent">{ko ? '모두 지우기' : 'Clear all'}</ThemedText></Pressable></View>
        {props.recent.map(value => <View key={value} style={[styles.recentRow, { borderBottomColor: theme.line }]}>
          <Pressable analyticsId="search.recent.open" accessibilityRole="button" accessibilityLabel={ko ? `${value} 검색` : `Search ${value}`} onPress={() => props.onRecent?.(value)} style={styles.recentOpen}>
            <SymbolView name={{ ios: 'clock', android: 'schedule', web: 'schedule' }} size={16} tintColor={theme.textSecondary} />
            <ThemedText type="menu" numberOfLines={1} style={styles.groupTitle}>{value}</ThemedText>
          </Pressable>
          <Pressable analyticsId="search.recent.remove" accessibilityRole="button" accessibilityLabel={ko ? `${value} 지우기` : `Remove ${value}`} onPress={() => props.onRemoveRecent?.(value)} style={ControlStyles.icon}>
            <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={14} tintColor={theme.textSecondary} />
          </Pressable>
        </View>)}
      </View>
      : <View style={styles.state}><StateCard kind="search" title={ko ? '이름이나 궁금한 걸 적어 봐요' : 'Type a name or what you’re curious about'}
        body={ko ? '비즈니스, 장소, 이웃, 글과 모임이 한 번에 나와요.' : 'Businesses, places, people, posts and meetups show up together.'} /></View>;
  const resultRow = (item: UnifiedSearchItem) => {
    const row = { item }, place = catalogPlace(item), subtitle = item.kind === 'place' ? placeLine(item, place) : item.subtitle;
    return zoom(row.item, <Pressable analyticsId={resultActions[row.item.kind]} testID={`search.item.${identity(row.item)}`} accessibilityRole="button" accessibilityLabel={[labels[row.item.kind], row.item.title, row.item.priceLevel ? tr('가격대 {0}단계', row.item.priceLevel) : '', row.item.subtitle, props.cityId === null ? cityName(row.item.cityId) : ''].filter(Boolean).join(', ')} onPress={event => props.onOpen(row.item, event)} style={StyleSheet.flatten([styles.result, { borderColor: theme.line, backgroundColor: theme.card }])}>
            {row.item.imageUri ? <Image source={{ uri: row.item.imageUri }} style={styles.image} contentFit="cover" transition={ControlMotion.settleMs} accessible={false} />
              : place ? <CityPlacePhoto place={place} style={styles.image} />
              // A person without a photo gets the first letter of their name, like everywhere else in the app (QA I-search-04).
              : row.item.kind === 'person' ? <View style={[styles.image, { backgroundColor: theme.backgroundSelected }]}><ThemedText style={Typography.label}>{[...row.item.title][0] ?? ''}</ThemedText></View>
              : <View style={[styles.image, { backgroundColor: theme.backgroundElement }]}><SymbolView name={{ ios: row.item.kind === 'business' ? 'storefront' : row.item.kind === 'place' ? 'mappin.and.ellipse' : 'text.bubble', android: 'search', web: 'search' }} size={22} tintColor={theme.textSecondary} /></View>}
            <View style={styles.resultText}><ThemedText type="menu" numberOfLines={2}>{row.item.title}</ThemedText>{!!(subtitle || row.item.priceLevel) && <ThemedText type="supporting" themeColor="textSecondary" numberOfLines={2}>{[row.item.priceLevel ? priceSymbol(row.item.priceLevel) : '', subtitle].filter(Boolean).join(' · ')}</ThemedText>}{props.cityId === null && <ThemedText type="caption" themeColor="accent">{cityName(row.item.cityId)}</ThemedText>}</View><SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={14} tintColor={theme.textSecondary} />
          </Pressable>);
  };
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={[styles.safe, { backgroundColor: theme.background }]}>
    <View style={styles.content}>
      <View style={styles.header}><Pressable analyticsId="search.back" accessibilityRole="button" accessibilityLabel={ko ? '이전 화면으로' : 'Go back'} onPress={props.onBack} style={ControlStyles.icon}>
        <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={IconSize.toolbar} tintColor={theme.text} /></Pressable><ThemedText type="sheetTitle" accessibilityRole="header" style={styles.heading}>{ko ? '통합검색' : 'Search'}</ThemedText></View>
      <View style={[styles.field, ControlStyles.field, { borderColor: theme.line, backgroundColor: theme.backgroundElement }]}><SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={IconSize.toolbar} tintColor={theme.textSecondary} />
        <TextInput value={props.query} onChangeText={props.onQuery} onFocus={() => play('selection')} onSubmitEditing={() => { play('selection'); Keyboard.dismiss(); props.onSubmit?.(); }}
          placeholder={ko ? '비즈니스·장소·사람·이야기 검색' : 'Search businesses, places and people'} accessibilityLabel={ko ? '통합검색어' : 'Search query'} placeholderTextColor={theme.textSecondary} maxLength={100} autoFocus returnKeyType="search" autoCorrect={false} style={[styles.input, { color: theme.text }]} />
        {!!props.query && <Pressable analyticsId="search.input.clear" accessibilityRole="button" accessibilityLabel={ko ? '검색어 지우기' : 'Clear search'} onPress={props.onClear} style={ControlStyles.icon}><SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={16} tintColor={theme.textSecondary} /></Pressable>}
      </View>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={ko ? '검색 지역' : 'Search area'}>
        <SelectionChip analyticsId="search.scope.city" selected={props.cityId !== null} accessibilityRole="radio" accessibilityState={{ checked: props.cityId !== null }} onPress={() => props.onScope(props.currentCityId)} style={ControlStyles.pill} baseColor={clay ? 'transparent' : theme.backgroundElement}>{clay && props.cityId === null && <ClayPillFill kind="white" />}<ThemedText type="label" style={{ color: props.cityId !== null ? theme.accentInk : theme.text }}>{cityName(props.currentCityId)}</ThemedText></SelectionChip>
        <SelectionChip analyticsId="search.scope.canada" selected={props.cityId === null} accessibilityRole="radio" accessibilityState={{ checked: props.cityId === null }} onPress={() => props.onScope(null)} style={ControlStyles.pill} baseColor={clay ? 'transparent' : theme.backgroundElement}>{clay && props.cityId !== null && <ClayPillFill kind="white" />}<ThemedText type="label" style={{ color: props.cityId === null ? theme.accentInk : theme.text }}>{ko ? '캐나다 전체' : 'All Canada'}</ThemedText></SelectionChip>
      </View>
      {/* One line that scrolls sideways: a sixth chip wrapping alone onto a second line looked broken (QA Q20). */}
      <ScrollView testID="search.kinds" {...kindRow.scroll} horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.kindRow} contentContainerStyle={styles.kindChips} accessibilityRole="radiogroup" accessibilityLabel={ko ? '검색 종류' : 'Result type'}>{kinds.map(kind => <SelectionChip key={kind} onLayout={kindRow.chip(kind)} analyticsId={kindActions[kind]} selected={props.kind === kind} accessibilityRole="radio" accessibilityState={{ checked: props.kind === kind }} onPress={() => props.onKind(kind)} style={ControlStyles.pill} baseColor={clay ? 'transparent' : theme.backgroundElement}>{clay && props.kind !== kind && <ClayPillFill kind="white" />}<ThemedText type="label" style={{ color: props.kind === kind ? theme.accentInk : theme.text }}>{labels[kind]}</ThemedText></SelectionChip>)}</ScrollView>
      {props.kind === 'place' && (props.priced || props.prices.length > 0) && <View style={styles.priceRow}>
        <SelectionChip analyticsId="search.price" selected={props.prices.length > 0} accessibilityRole="button" accessibilityLabel={props.prices.length ? tr('가격 {0}, 바꾸기', priceLabel(props.prices)) : tr('가격 필터')}
          accessibilityState={{ selected: props.prices.length > 0, expanded: props.priceDraft !== null }} onPress={() => { play('selection'); props.onPriceDraft(props.prices); }} style={ControlStyles.pill} baseColor={clay ? 'transparent' : theme.backgroundElement}>
          {clay && !props.prices.length && <ClayPillFill kind="white" />}<ThemedText type="label" style={{ color: props.prices.length ? theme.accentInk : theme.text }}>{props.prices.length ? priceLabel(props.prices) : tr('가격')} ⌄</ThemedText></SelectionChip>
        {props.prices.length > 0 && <ThemedText type="caption" themeColor="textSecondary">{tr('가격 정보가 있는 곳만 보여요')}</ThemedText>}
      </View>}
      <FlatList analyticsId="search.results" data={rows} keyExtractor={row => row.type === 'heading' ? `heading:${row.kind}` : identity(row.item)} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.results}
        ListEmptyComponent={empty ?? undefined} renderItem={({ item: row }) => row.type === 'heading' ? <View style={styles.group}><ThemedText type="section" accessibilityRole="header" style={styles.groupTitle}>{labels[row.kind]}</ThemedText>{/* All shows up to three per kind, so fewer than three means there is nothing more (QA I-search-04). */}{row.full && <Pressable analyticsId="search.group.more" accessibilityRole="button" accessibilityLabel={ko ? `${labels[row.kind]} 더 보기` : `More ${labels[row.kind].toLowerCase()}`} onPress={() => props.onKind(row.kind)} style={styles.groupMore}><ThemedText type="label" themeColor="accent">{ko ? '더 보기' : 'See more'}</ThemedText></Pressable>}</View>
          : resultRow(row.item)}
        ListFooterComponent={props.hasMore ? <View style={styles.footer}>{props.moreFailed && <ThemedText accessibilityLiveRegion="polite" themeColor="textSecondary">{ko ? '다음 결과를 불러오지 못했어요. 다시 시도해 주세요.' : 'Couldn’t load more results. Try again.'}</ThemedText>}<Pressable analyticsId="search.more" accessibilityRole="button" disabled={props.moreLoading} onPress={props.onMore} style={[ControlStyles.action, clay && { overflow: 'visible', paddingHorizontal: 18 }, { borderWidth: 1, borderColor: clay ? 'transparent' : theme.line, opacity: props.moreLoading ? 0.6 : 1 }]}>{clay && <ClayPillFill kind="white" />}<ThemedText type="menu" themeColor="accent">{props.moreLoading ? ko ? '불러오는 중…' : 'Loading…' : props.moreFailed ? ko ? '다시 불러오기' : 'Try again' : ko ? '더 보기' : 'Load more'}</ThemedText></Pressable></View> : undefined} />
    </View>
    <PriceSheet draft={props.priceDraft} onDraft={props.onPriceDraft} onApply={props.onPrices} analyticsId="search.price" />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, content: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.four, paddingTop: Spacing.two }, heading: { flex: 1, minWidth: 0 },
  field: { flexDirection: 'row', alignItems: 'center', marginHorizontal: Spacing.four, marginTop: Spacing.three, gap: Spacing.two },
  input: { flex: 1, minWidth: 0, minHeight: 48, paddingVertical: Spacing.three, ...Typography.body },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingHorizontal: Spacing.four, marginTop: Spacing.three },
  // The row clips sideways scrolling, so vertical padding keeps the clay chip shadow; the margin plus padding equals the wrapped row's gap.
  kindRow: { flexGrow: 0, flexShrink: 0, marginTop: Spacing.two }, kindChips: { gap: Spacing.two, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
  priceRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.four },
  results: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, paddingTop: Spacing.two }, state: { paddingTop: Spacing.five, gap: Spacing.three },
  group: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.three }, groupTitle: { flex: 1, minWidth: 0 }, groupMore: { minHeight: 44, minWidth: 44, paddingHorizontal: Spacing.two, justifyContent: 'center' },
  recent: { paddingTop: Spacing.two },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  recentOpen: { flex: 1, minWidth: 0, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  result: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, borderWidth: 1, borderRadius: 16, marginTop: Spacing.two, minHeight: 72 },
  image: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, wider: { borderWidth: 1 }, resultText: { flex: 1, minWidth: 0, gap: Spacing.one }, footer: { paddingVertical: Spacing.four, gap: Spacing.three },
});
