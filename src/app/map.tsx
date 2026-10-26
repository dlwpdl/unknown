import { Colors } from '@/constants/theme';
import { ControlStyles, IconSize, Typography } from '@/constants/design-system';
import { useLanguage } from '@/hooks/use-language';
import { PostAdLabel } from '@/components/post-ad-label';
import { hasAdLabel } from '@/lib/hashtags';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, AppState, KeyboardAvoidingView, Linking, Modal, Platform, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { openBrowserAsync } from 'expo-web-browser';
import { safeTicketUrl } from '../../supabase/functions/_shared/ticketmaster';
import * as Location from 'expo-location';
import { useReducedMotion } from 'react-native-reanimated';
import { FlatList, Pressable, ScrollView } from '@/components/analytics-controls';
import { DiscoveryMap } from '@/components/discovery-map';
import { CityPlacePhoto } from '@/components/city-place-photo';
import { FeedAd } from '@/components/feed-ad';
import { SelectionChip } from '@/components/selection-chip';
import { adsSupported } from '@/lib/ads';
import { contentAdPosition } from '@/lib/content-ad-placement';
import { GlingLoader } from '@/components/gling-loader';
import { StateCard } from '@/components/state-card';
import { TranslationControl } from '@/components/content-translation';
import { useContentTranslation } from '@/hooks/use-content-translation';
import { CONTENT_TRANSLATION_VIEWABILITY } from '@/lib/content-translation';
import { visibleTranslationSource } from '@/lib/translation-source';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useAuth } from '@/lib/auth';
import { useCommunityCity } from '@/lib/community-city';
import { bindBusinessPlaces, loadCityBusinessLinks, loadCityBusinessMapPhotos, loadCityWebshops, type BusinessMapPhotos, type Webshop } from '@/lib/webshops';
import { DELIVERY_PARTNERS, deliveryPartnerPlace } from '@/lib/delivery-partners';
import { discoveryDistanceKm, sortDiscoveryItems } from '@/lib/discovery-sort';
import { DISCOVERY_CATEGORIES, TOP25_GOLD, discoveryDays, discoveryEvent, discoveryEventOnDays, discoveryMatches, discoveryPlace, directionsUrl, mergeCityTop25, type DiscoveryDate, type DiscoveryFilter, type DiscoveryItem } from '@/lib/discovery';
import { getCityPlaces, getCityDiscoveryPlaces } from '@/lib/city-places';
import { CITIES } from '@/lib/mock';
import { useCityPlacesRevision } from '@/hooks/use-city-places';
import { loadDiscoveryPosts } from '@/lib/discovery-data';
import { getPostImageSource, type FeedCursor } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { isFreshLocation, type LocationFix } from '@/lib/location';
import { postPublicAddress, type PostPin } from '@/lib/post-maps';
import { supabase } from '@/lib/supabase';
import { safeMerchantSourceUrl } from '@/lib/merchant-source';
import { PUBLIC_SITE } from '@/lib/public-seo';
import { EVENT_CITIES, eventPriceLabel, eventTime, loadTicketmasterEvents, type EventCity } from '@/lib/ticketmaster';

const filters: { id: DiscoveryFilter; label: string; color?: string }[] = [
  { id: 'all', label: '전체' }, { id: 'visited', label: 'gling Visited', color: '#CBB9FF' },
  { id: 'top25', label: 'TOP 50', color: TOP25_GOLD }, { id: 'delivery', label: '배달 할인', color: '#8FD9C4' },
  { id: 'dining', label: '레스토랑', color: '#D79681' }, { id: 'cafe', label: '카페', color: '#D7BD92' },
  { id: 'festival', label: '페스티벌', color: '#CBB9FF' }, { id: 'nightlife', label: '나이트라이프', color: '#DD737F' },
  { id: 'places', label: '가볼 만한 곳', color: '#A8C39B' },
  { id: 'housing', label: '부동산', color: '#70BFAF' }, { id: 'used', label: '중고거래', color: '#E9B86C' },
  { id: 'events', label: '행사 전체', color: '#5F7CF3' },
];
type Result = { key: string; page: number; items: DiscoveryItem[]; cursor: FeedCursor | null; postMore: boolean; eventMore: boolean; errors: string[]; limited: boolean };
const freshMapFix = (fix: LocationFix) => isFreshLocation(fix) && fix.accuracy! <= 250 && Date.now() - fix.measuredAt <= 120000;
const located = (item: DiscoveryItem): item is DiscoveryItem & PostPin => item.latitude !== null && item.longitude !== null;

export default function MapScreen({ onClose, initialFilter }: { onClose?: () => void; initialFilter?: DiscoveryFilter } = {}) {
  const { city: selectedCity } = useCommunityCity();
  const { cityId, placeId } = useLocalSearchParams<{ cityId?: string; placeId?: string }>();
  const city = (!onClose && CITIES.find(value => value.id === cityId)) || selectedCity;
  const { isAuthed, me } = useAuth();
  return <CityMap key={`${city.id}:${isAuthed ? me.id : 'guest'}`} city={city} placeId={onClose ? undefined : placeId} onClose={onClose} initialFilter={initialFilter} />;
}
function CityMap({ city, placeId, onClose, initialFilter }: { city: (typeof CITIES)[number]; placeId?: string; onClose?: () => void; initialFilter?: DiscoveryFilter }) {
  const { tr, language } = useLanguage();
  const searchLabel = language === 'en' ? 'Search businesses, places and people' : '비즈니스·장소·사람·이야기 검색';
  const theme = useTheme(), router = useRouter(), reduced = useReducedMotion();
  const top25Ink = theme === Colors.light ? '#68543A' : TOP25_GOLD;
  const { isAuthed, me, promptLogin } = useAuth(), hidden = useContentVisibility();
  const isFocused = useIsFocused(), targetFocusRef = useRef<string | null>(null);
  const { play } = useInteractionFeedback();
  const { category, placeRequest } = useLocalSearchParams<{ category?: string; placeRequest?: string }>();
  const initialCategory = initialFilter ?? (onClose ? 'all' : category);
  const [selectedFilters, setSelectedFilters] = useState<DiscoveryFilter[]>(initialCategory !== 'all' && filters.some(value => value.id === initialCategory) ? [initialCategory as DiscoveryFilter] : []);
  const filter: DiscoveryFilter = selectedFilters.length === 1 ? selectedFilters[0] : 'all';
  const top25Only = selectedFilters.length === 1 && selectedFilters[0] === 'top25';
  const deliveryOnly = selectedFilters.length === 1 && selectedFilters[0] === 'delivery';
  const visitedOnly = selectedFilters.length === 1 && selectedFilters[0] === 'visited';
  const eventCategory = selectedFilters.some(value => value === 'festival' || value === 'events');
  const includeEvents = !selectedFilters.length || eventCategory;
  const [mode, setMode] = useState<'map' | 'list'>('map'), [query, setQuery] = useState(''), [search, setSearch] = useState('');
  const [chosenDateFilter, setDateFilter] = useState<DiscoveryDate | null>(null), [date, setDate] = useState('');
  const dateFilter: DiscoveryDate = eventCategory ? chosenDateFilter ?? (selectedFilters.includes('festival') ? 'week' : 'today') : 'all';
  const [dateOpen, setDateOpen] = useState(false), [dateDraft, setDateDraft] = useState(''), [dateError, setDateError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null), [center, setCenter] = useState<(PostPin & { requestId: number }) | null>(null);
  const [sortBy, setSortBy] = useState<'near' | 'discount'>('near');
  const viewerScope = isAuthed ? me.id : 'guest', registryKey = `${city.id}:${viewerScope}`;
  const [registrySnapshot, setRegistry] = useState<{ key: string; links: Record<string, string>; shops: Webshop[]; photos: BusinessMapPhotos; failed: boolean; ready: boolean }>({ key: '', links: {}, shops: [], photos: {}, failed: false, ready: false });
  const registry = registrySnapshot.key === registryKey ? registrySnapshot : { links: {}, shops: [], photos: {}, failed: false, ready: false };

  const [closedCardId, setClosedCardId] = useState<string | null | undefined>(undefined);
  const cardOpen = closedCardId !== selectedId;
  const [userLocation, setUserLocation] = useState<PostPin | null>(null);
  const [cardHeight, setCardHeight] = useState(0);
  const [mapFiltersHeight, setMapFiltersHeight] = useState(0);
  const [visibleResultIds, setVisibleResultIds] = useState<Set<string>>(new Set());
  const trackTranslationResults = useCallback(({ viewableItems }: { viewableItems: { item: DiscoveryItem }[] }) =>
    setVisibleResultIds(new Set(viewableItems.map(({ item }) => item.id))), []);
  const [locating, setLocating] = useState(false), [locationError, setLocationError] = useState('');
  const [attempt, setAttempt] = useState(0), [now, setNow] = useState(() => Date.now());
  const [result, setResult] = useState<Result | null>(null), [pendingKey, setPendingKey] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null), locationRevision = useRef(0), morePending = useRef(false);
  useEffect(() => {
    if (!isFocused) return;
    const controller = new AbortController();
    void Promise.allSettled([loadCityBusinessLinks(supabase, city.id, controller.signal), loadCityWebshops(supabase, city.id, controller.signal), loadCityBusinessMapPhotos(supabase, city.id, controller.signal)]).then(([links, shops, photos]) => {
      if (!controller.signal.aborted) setRegistry({ key: registryKey, links: links.status === 'fulfilled' ? links.value : {}, shops: shops.status === 'fulfilled' ? shops.value : [], photos: photos.status === 'fulfilled' ? photos.value : {}, failed: links.status === 'rejected' || shops.status === 'rejected', ready: true });
    });
    return () => controller.abort();
  }, [city.id, attempt, isFocused, registryKey]);
  const days = useMemo(() => discoveryDays(dateFilter, city.id, date, now), [dateFilter, city.id, date, now]);
  const daysKey = days.join(',');
  const key = `${city.id}:${viewerScope}:${selectedFilters.slice().sort().join(',') || 'all'}:${search}:${daysKey}:${attempt}`;
  const current = result?.key === key ? result : null;
  const deliveryUnavailable = selectedFilters.includes('delivery') && registry.failed;
  const loading = !current || pendingKey === key || selectedFilters.includes('delivery') && !registry.ready;
  const refresh = () => { morePending.current = false; setAttempt(value => value + 1); setNow(Date.now()); };

  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 300); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    const timer = setInterval(() => { if (AppState.currentState === 'active') setNow(Date.now()); }, 60000);
    const listener = AppState.addEventListener('change', state => {
      if (state === 'background') { locationRevision.current++; setLocating(false); }
      else if (state === 'active') setNow(Date.now());
    });
    const revision = locationRevision;
    return () => { clearInterval(timer); listener.remove(); revision.current++; };
  }, []);
  const loadPage = useCallback((previous: Result | null) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const page = previous ? previous.page + 1 : 0, days = daysKey ? daysKey.split(',') : [];
    if (!previous) setResult(null);
    setPendingKey(key);
    const showPosts = isAuthed && (!previous || previous.postMore);
    const showEvents = includeEvents && Object.hasOwn(EVENT_CITIES, city.id) && (!previous || previous.eventMore);
    const posts = showPosts ? loadDiscoveryPosts(supabase, city.id, filter, search, previous?.cursor ?? null, viewerScope, controller.signal)
      : Promise.resolve({ items: [], cursor: previous?.cursor ?? null, hasMore: false });
    const events = showEvents ? Promise.allSettled((days.length ? days : [undefined]).map(day =>
      loadTicketmasterEvents({ cityId: city.id as EventCity, category: 'all', page, ...(day ? { date: day } : {}) })))
      .then(async results => {
        const pages = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
        let partialError = pages.length !== results.length;
        if (page === 0) {
          try { pages.push(await loadTicketmasterEvents({ cityId: city.id as EventCity, category: 'all', page: 0, festival: true })); }
          catch { partialError = true; }
        }
        if (!pages.length) throw new Error('EVENTS_UNAVAILABLE');
        return { items: pages.flatMap(value => value.events.map(event => discoveryEvent(event, city.id)).filter(item => item !== null)), hasMore: pages.some(value => value.hasMore) && page < 19, partialError };
      }) : Promise.resolve({ items: [], hasMore: false, partialError: false });
    void Promise.allSettled([posts, events]).then(([postResult, eventResult]) => {
      if (controller.signal.aborted || request.current !== controller) return;
      const added = [...(postResult.status === 'fulfilled' ? postResult.value.items : []), ...(eventResult.status === 'fulfilled' ? eventResult.value.items : [])];
      const unique = [...new Map([...(previous?.items ?? []), ...added].map(item => [item.id, item])).values()];
      setResult({ key, page, items: unique.slice(0, 500), limited: unique.length > 500 || (unique.length === 500 && (postResult.status === 'fulfilled' && postResult.value.hasMore || eventResult.status === 'fulfilled' && eventResult.value.hasMore)),
        cursor: postResult.status === 'fulfilled' ? postResult.value.cursor : previous?.cursor ?? null,
        postMore: postResult.status === 'fulfilled' && postResult.value.hasMore,
        eventMore: eventResult.status === 'fulfilled' && eventResult.value.hasMore,
        errors: [...new Set([...(previous?.errors ?? []), postResult.status === 'rejected' ? "게시물 위치를 불러오지 못했어요." : '', eventResult.status === 'rejected' ? "행사 정보를 불러오지 못했어요." : eventResult.value.partialError ? "일부 페스티벌 정보를 불러오지 못했어요." : ''].filter(Boolean))] });
      morePending.current = false;
      setPendingKey(null);
    });
  }, [key, isAuthed, filter, city.id, search, viewerScope, daysKey, includeEvents]);
  useFocusEffect(useCallback(() => {
    loadPage(null);
    return () => { request.current?.abort(); request.current = null; morePending.current = false; locationRevision.current++; setLocating(false); };
  }, [loadPage]));

  useCityPlacesRevision();
  const catalogPlaces = getCityDiscoveryPlaces(city.id);
  const targetPlace = placeId ? getCityPlaces(city.id).find(place => place.id === placeId) ?? deliveryPartnerPlace(city.id, placeId) : undefined;
  const targetItem = targetPlace ? discoveryPlace(targetPlace) : null;
  const catalogItems = catalogPlaces.map(discoveryPlace).filter(item => item !== null);
  for (const partner of DELIVERY_PARTNERS.filter(value => value.cityId === city.id)) {
    const place = deliveryPartnerPlace(city.id, `partner:${partner.id}`);
    const item = place ? discoveryPlace(place) : null;
    if (item && !catalogItems.some(value => value.id === item.id)) catalogItems.push(item);
  }
  if (targetItem && !catalogItems.some(item => item.id === targetItem.id)) catalogItems.push(targetItem);
  const targetId = targetItem?.id, targetLatitude = targetItem?.latitude, targetLongitude = targetItem?.longitude, targetRecommended = !!targetItem?.top25, targetVisited = !!targetItem?.glingVisited;
  useEffect(() => {
    if (!isFocused || !targetId || targetLatitude == null || targetLongitude == null) return;
    const requestKey = targetId + ':' + (placeRequest ?? '');
    if (targetFocusRef.current === requestKey) return;
    targetFocusRef.current = requestKey;
    locationRevision.current++; setLocating(false); setLocationError('');
    setSelectedFilters(targetVisited ? ['visited'] : targetRecommended ? ['top25'] : []);
    setQuery(''); setSearch(''); setMode('map');
    setSelectedId(targetId);
    setCenter({ latitude: targetLatitude, longitude: targetLongitude, requestId: locationRevision.current });
  }, [isFocused, targetId, targetLatitude, targetLongitude, targetRecommended, targetVisited, placeRequest]);
  const publicItems = [...catalogItems, ...(current?.items ?? [])].filter(item => (item.source !== 'post' || !!item.post && item.post.kind === 'listing' && ['housing', 'used'].includes(item.category))
    && (!item.post || (!hidden('post', item.post.id, item.post.author.id) && (item.post.kind !== 'listing' || (['open', 'partial'].includes(item.post.listingStatus ?? '') && Date.parse(item.post.expiresAt ?? '') > now))))
    && (!item.event || discoveryEvent(item.event, item.cityId, now) !== null));
  const cityItems = bindBusinessPlaces(mergeCityTop25(publicItems, city.id), registry.links, registry.shops, registry.photos);
  const top25Ready = cityItems.some(item => item.top25);
  const visitedReady = cityItems.some(item => item.glingVisited);
  const matches = cityItems.filter(item => discoveryMatches(item, selectedFilters, query) && discoveryEventOnDays(item, days));
  const limited = !!current?.limited || matches.length > 500;
  const discountOrder = deliveryOnly && sortBy === 'discount';
  const items = sortDiscoveryItems(matches, userLocation, discountOrder ? 'discount' : 'near').slice(0, 500);
  const hasVerifiedDiscount = items.some(item => Number.isFinite(item.webshopDiscount) && item.webshopDiscount! > 0 && item.webshopDiscount! <= 100);
  const pins = items.filter(located);
  // Only show the detail card for a pin the user actually picked; the map stays clear otherwise.
  const selected = items.find(item => item.id === selectedId) ?? null;
  const markers = pins.map(item => {
    const category = DISCOVERY_CATEGORIES.find(value => value.id === item.category)!;
    return { id: item.id, latitude: item.latitude, longitude: item.longitude, color: category.color,
      label: `${hasAdLabel(item.post?.hashtags) ? 'AD · ' : ''}${item.title}`.slice(0,80), ...(item.top25 ? { top25: true } : {}), ...(item.webshopDiscount ? { discount: item.webshopDiscount } : {}) };
  });
  const more = current && !limited && (!top25Only || top25Ready) && (current.postMore || current.eventMore);
  const open = (item: DiscoveryItem) => {
    play('selection');
    if (item.merchantId && !onClose) { router.push({ pathname: '/company/[id]', params: { id: item.merchantId } }); return; }
    if (onClose) {
      const source = (item.merchantId ? `${PUBLIC_SITE}/company?id=${item.merchantId}` : null) ?? item.place?.sourceUrl ?? (item.event ? safeTicketUrl(item.event.ticketUrl) : null) ?? item.top25?.sourceUrl
        ?? (item.post && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(item.post.id) ? `${PUBLIC_SITE}/post?id=${encodeURIComponent(item.post.id)}` : '');
      const url = safeMerchantSourceUrl(source);
      if (url) void openBrowserAsync(url).catch(() => { play('warning'); Alert.alert(tr("장소 정보를 열지 못했어요"), tr("인터넷 연결을 확인하고 다시 시도해 주세요.")); });
      else { play('warning'); Alert.alert(tr("장소 정보를 열지 못했어요"), tr("인터넷 연결을 확인하고 다시 시도해 주세요.")); }
      return;
    }
    if (item.source === 'place' && !item.post) {
      if (item.place) router.push({ pathname: '/places/[id]', params: { id: item.place.id, cityId: item.place.cityId } });
      else if (item.glingVisited?.sourceUrl) void Linking.openURL(item.glingVisited.sourceUrl).catch(() => { play('warning'); Alert.alert(tr("장소 정보를 열지 못했어요"), tr("인터넷 연결을 확인하고 다시 시도해 주세요.")); });
      else if (item.top25) void Linking.openURL(item.top25.sourceUrl).catch(() => { play('warning'); Alert.alert(tr("장소 정보를 열지 못했어요"), tr("인터넷 연결을 확인하고 다시 시도해 주세요.")); });
      else Alert.alert(tr('장소 정보 준비 중'), tr('이 장소의 상세 정보를 준비하고 있어요.'));
    } else if (item.source === 'event') router.push({ pathname: '/events/[id]', params: { id: item.sourceId, cityId: city.id } });
    else router.push({ pathname: '/post/[id]', params: { id: item.post?.id ?? item.sourceId } });
  };
  const selectPin = (id: string) => {
    locationRevision.current++; setLocating(false); setLocationError(''); setSelectedId(id); setCenter(null);
  };
  const locate = async () => {
    if (locating) return;
    const revision = ++locationRevision.current; setLocating(true); setLocationError('');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (revision !== locationRevision.current) return;
      if (!permission.granted) throw new Error('PERMISSION');
      const value = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')), 15000); })]);
      if (revision !== locationRevision.current || AppState.currentState !== 'active') return;
      const fix = { latitude: value.coords.latitude, longitude: value.coords.longitude, accuracy: value.coords.accuracy, measuredAt: value.timestamp, mocked: value.mocked ?? false };
      if (!freshMapFix(fix)) throw new Error('INACCURATE');
      setUserLocation({ latitude: fix.latitude, longitude: fix.longitude });
      setSelectedId(null); setCenter({ latitude: fix.latitude, longitude: fix.longitude, requestId: revision }); play('success');
    } catch (error) {
      if (revision !== locationRevision.current) return;
      play('warning'); setLocationError(error instanceof Error && error.message === 'PERMISSION' ? "위치 권한이 꺼져 있어요. 선택한 도시의 지도는 계속 볼 수 있어요." : "현재 위치를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally { if (timer) clearTimeout(timer); if (revision === locationRevision.current) setLocating(false); }
  };
  const changeMode = (value: 'map' | 'list') => { play('selection'); setMode(value); if (value === 'list' && !userLocation) void locate(); };
  const toggleFilter = (value: DiscoveryFilter) => {
    play('selection');
    setSelectedFilters(current => value === 'all' ? [] : current.includes(value) ? current.filter(id => id !== value) : [...current, value]); setSortBy('near');
    setDateFilter(null); setDate(''); setDateOpen(false); setDateError('');
  };
  const chooseDate = (value: DiscoveryDate) => {
    play('selection');
    if (value === 'date') { setDateDraft(date || discoveryDays('today', city.id)[0]); setDateError(''); setDateOpen(true); }
    else { setDateFilter(value); setDateOpen(false); setDateError(''); }
  };
  const closeFilters = () => { play('selection'); setFiltersOpen(false); setDateOpen(false); setDateError(''); };
  const chipBackground = mode === 'map' && !filtersOpen ? `${theme.backgroundElement}C7` : theme.backgroundElement;
  const filterChip = (value: typeof filters[number]) => {
    const selected = value.id === 'all' ? !selectedFilters.length : selectedFilters.includes(value.id);
    return <SelectionChip key={value.id} selected={selected} baseColor={chipBackground} analyticsId="discovery.filter" accessibilityRole="button" accessibilityLabel={tr(value.label)} accessibilityState={{ selected }} onPress={() => toggleFilter(value.id)} style={[styles.chip, value.id === 'visited' && styles.visitedChip, { borderColor: selected ? theme.accent : theme.line }]}>
      {value.id === 'visited' ? <><GlingVisitedBadge selected={selected} /><View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.visitedSelection, { opacity: selected ? 1 : 0 }]}><SymbolView name={{ ios: 'checkmark', android: 'check', web: 'check' }} size={IconSize.inline} tintColor={theme.accentInk} /></View></> : <>
      {selected && value.id !== 'all' ? <ThemedText type="smallBold" style={{ color: theme.accentInk }}>✓</ThemedText> : (value.id === 'top25' || value.id === 'delivery') && <View style={[styles.dot, { backgroundColor: value.color }]} />}
      <ThemedText type="smallBold" style={{ color: selected ? theme.accentInk : value.id === 'top25' ? top25Ink : theme.text }}>{tr(value.label)}</ThemedText>
      </>}
    </SelectionChip>;
  };
  const quickFilters = <>
    <ScrollView horizontal analyticsId="discovery.filter" showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={styles.filters}>
      {(['all', 'visited', 'top25', 'delivery', 'dining', 'cafe', 'festival', 'nightlife', 'places', 'housing', 'used'] as const).map(id => filterChip(filters.find(value => value.id === id)!))}
    </ScrollView>
    {Object.hasOwn(EVENT_CITIES, city.id) && eventCategory && <ScrollView horizontal analyticsId="discovery.date" showsHorizontalScrollIndicator={false} style={styles.eventDateRow} contentContainerStyle={styles.eventDates}>
      <ThemedText type="small" themeColor="textSecondary" style={mode === 'map' ? [styles.mapDateLabel, { backgroundColor: chipBackground }] : undefined}>{tr('행사 날짜')}</ThemedText>
      {([{ id: 'today', label: tr('오늘') }, { id: 'week', label: tr('다가오는 7일') }, { id: 'weekend', label: tr('이번 주말') }] as const).map(value => <Pressable key={value.id} analyticsId="discovery.date" accessibilityRole="button" accessibilityState={{ selected: dateFilter === value.id }} onPress={() => chooseDate(value.id)} style={[styles.dateChip, { borderColor: dateFilter === value.id ? theme.accent : theme.line, backgroundColor: dateFilter === value.id ? theme.accent : chipBackground }]}><ThemedText type="smallBold" style={{ color: dateFilter === value.id ? theme.accentInk : theme.text }}>{value.label}</ThemedText></Pressable>)}
      {(dateFilter === 'all' || dateFilter === 'date') && <Pressable analyticsId="discovery.date" accessibilityRole="button" accessibilityLabel={tr('행사 날짜 변경')} onPress={() => { play('selection'); setFiltersOpen(true); }} style={[styles.dateChip, { borderColor: theme.accent, backgroundColor: chipBackground }]}><ThemedText type="smallBold" themeColor="accent">{dateFilter === 'all' ? tr('행사 · 전체 날짜') : date}</ThemedText></Pressable>}
    </ScrollView>}
  </>;
  const chooseNearest = () => { play('selection'); setSortBy('near'); if (!userLocation) void locate(); };
  const chooseDiscount = () => { play('selection'); setSortBy('discount'); };
  return <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top', 'bottom', 'left', 'right']}>
    <View style={styles.header}>
      <Pressable analyticsId="discovery.back" accessibilityRole="button" accessibilityLabel={tr("지도를 닫고 이전 화면으로")} onPress={() => { play('selection'); if (onClose) onClose(); else if (router.canGoBack()) router.back(); else router.replace('/'); }} style={styles.icon}><SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={21} tintColor={theme.text} /></Pressable>
      <View style={styles.heading}><ThemedText accessibilityRole="header" style={styles.title}>{tr('{0} 지도', tr(city.name))}</ThemedText></View>
      {mode === 'list' && <Pressable analyticsId="discovery.refresh" accessibilityRole="button" accessibilityLabel={tr("지도 결과 새로고침")} onPress={() => { play('selection'); refresh(); }} style={styles.icon}><SymbolView name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }} size={21} tintColor={theme.text} /></Pressable>}
      <Pressable analyticsId="discovery.mode" accessibilityRole="button" accessibilityLabel={mode === 'map' ? tr("리스트 보기") : tr("지도 보기")} onPress={() => changeMode(mode === 'map' ? 'list' : 'map')} style={styles.icon}><SymbolView name={mode === 'map' ? { ios: 'list.bullet', android: 'format_list_bulleted', web: 'format_list_bulleted' } : { ios: 'map', android: 'map', web: 'map' }} size={21} tintColor={theme.text} /></Pressable>
    </View>
    <View style={[styles.search, { backgroundColor: theme.backgroundElement, borderColor: theme.line }]}>
      {onClose ? <>
      <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={18} tintColor={theme.textSecondary} />
      <TextInput value={query} onChangeText={setQuery} onFocus={() => play('selection')} placeholder={tr("등록된 장소·매물·행사 검색")} accessibilityLabel={tr("등록된 장소 매물 행사 검색")} placeholderTextColor={theme.textSecondary} maxLength={100} returnKeyType="search" style={[styles.input, { color: theme.text }]} />
      </> : <Pressable analyticsId="search.entry.map" accessibilityRole="button" accessibilityLabel={searchLabel} onPress={() => { play('selection'); router.push({ pathname: '/search', params: { cityId: city.id, ...(query ? { query } : {}) } }); }} style={({ pressed }) => [styles.unifiedSearch, { opacity: pressed ? 0.82 : 1 }]}>
        <SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={18} tintColor={theme.textSecondary} /><ThemedText style={styles.unifiedSearchText} themeColor={query ? 'text' : 'textSecondary'}>{query || searchLabel}</ThemedText>
      </Pressable>}
      {!!query && <Pressable analyticsId="discovery.search" accessibilityRole="button" accessibilityLabel={tr("검색어 지우기")} onPress={() => { play('selection'); setQuery(''); }} style={styles.icon}><ThemedText>×</ThemedText></Pressable>}
      <Pressable analyticsId="discovery.filter" accessibilityRole="button" accessibilityLabel={tr("분류와 날짜 필터 열기")} accessibilityState={{ expanded: filtersOpen }} onPress={() => { play('selection'); setFiltersOpen(true); }} style={styles.icon}>
        <SymbolView name={{ ios: 'slider.horizontal.3', android: 'tune', web: 'tune' }} size={21} tintColor={selectedFilters.length || dateFilter !== 'all' ? theme.accent : theme.text} />
        {(selectedFilters.length > 0 || dateFilter !== 'all') && <View style={[styles.filterDot, { backgroundColor: theme.accent }]} />}
      </Pressable>
    </View>
    {mode === 'list' && quickFilters}
    {deliveryUnavailable && <StateCard kind="error" title={tr('웹샵 할인 정보를 불러오지 못했어요')} body={tr('연결을 확인하고 다시 시도해주세요. 가게의 기존 정보는 계속 볼 수 있어요.')} actionLabel={tr('다시 시도')} onAction={() => { play('selection'); refresh(); }} />}
    {!!locationError && <ThemedText accessibilityRole="alert" type="small" style={styles.notice}>{tr(locationError)}</ThemedText>}
    {mode === 'list' && <View style={styles.sortRow}>
      {deliveryOnly ? ([['near', tr('가까운 순')], ['discount', tr('할인율 높은 순')]] as const).map(([key, label]) => <SelectionChip key={key} analyticsId="discovery.current" selected={sortBy === key} baseColor={theme.backgroundElement} disabled={key === 'discount' && !hasVerifiedDiscount}
        accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: sortBy === key, disabled: key === 'discount' && !hasVerifiedDiscount }}
        onPress={key === 'near' ? chooseNearest : chooseDiscount} style={[styles.sortChip, { borderColor: sortBy === key ? theme.accent : theme.line }]}>
        <ThemedText type="smallBold" style={{ color: sortBy === key ? theme.accentInk : theme.text }}>{label}</ThemedText></SelectionChip>) : <ThemedText type="smallBold">{tr('가까운 순')}</ThemedText>}
      {!userLocation && <Pressable analyticsId="discovery.current" accessibilityRole="button" accessibilityLabel={tr('내 위치 사용')} disabled={locating} onPress={() => { play('selection'); void locate(); }} style={[styles.sortChip, { borderColor: theme.line }]}><ThemedText type="small">{locating ? tr('위치 확인 중') : tr('내 위치 사용')}</ThemedText></Pressable>}
      <ThemedText type="caption" themeColor="textSecondary">{userLocation ? tr('내 위치 기준 · 직선거리') : tr('위치를 켜면 가까운 순으로 정렬해요')}</ThemedText>
      {deliveryOnly && registry.ready && !registry.failed && !hasVerifiedDiscount && <ThemedText type="caption" themeColor="textSecondary">{tr('아직 할인율을 확인한 가게가 없어요')}</ThemedText>}
    </View>}
    {mode === 'list' && <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite" style={styles.notice}>{tr('지도 {0}개 · 목록 {1}개', pins.length, items.length)}{limited ? tr(" · 500개까지 표시") : ''}</ThemedText>}
    {!!current?.errors.length && <View style={styles.notice}><ThemedText type="small" accessibilityRole="alert">{current.errors.map(error => tr(error)).join(' ')} {tr("새로고침으로 다시 시도할 수 있어요.")}</ThemedText></View>}
    <View style={styles.content}>
      {mode === 'map' ? <>
        <DiscoveryMap markers={markers} cityName={city.englishName} selectedId={selected?.id} center={center} userLocation={userLocation} topInset={mapFiltersHeight} bottomInset={selected && located(selected) && cardOpen ? Math.min(cardHeight + 56, 1000) : 0} onSelect={selectPin} />
        <View testID="map-filter-overlay" pointerEvents="box-none" onLayout={event => setMapFiltersHeight(event.nativeEvent.layout.height)} style={styles.mapFilters}>{quickFilters}</View>
        <View style={[styles.mapControls, { top: mapFiltersHeight + 12 }]}>

          <Pressable analyticsId="discovery.current" accessibilityRole="button" accessibilityLabel={locating ? tr("현재 위치 확인 중") : tr("내 위치로 지도 이동")} disabled={locating} onPress={() => { play('selection'); void locate(); }} style={[styles.mapControl, { backgroundColor: theme.card, borderColor: theme.line }]}>{locating ? <GlingLoader size={12} accessibilityLabel={tr("현재 위치 확인 중")} /> : <SymbolView name={{ ios: 'location', android: 'my_location', web: 'my_location' }} size={21} tintColor={theme.text} />}</Pressable>
          <Pressable analyticsId="discovery.refresh" accessibilityRole="button" accessibilityLabel={tr("지도 결과 새로고침")} onPress={() => { play('selection'); refresh(); }} style={[styles.mapControl, { backgroundColor: theme.card, borderColor: theme.line }]}><SymbolView name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }} size={21} tintColor={theme.text} /></Pressable>
        </View>
        <Pressable analyticsId="discovery.mode" accessibilityRole="button" accessibilityLabel={tr("리스트 보기")} onPress={() => changeMode('list')} style={[styles.listLink, { backgroundColor: theme.card, borderColor: theme.line, bottom: selected && located(selected) && cardOpen ? Math.min(cardHeight + 64, 1000) : 56 }]}><SymbolView name={{ ios: 'list.bullet', android: 'format_list_bulleted', web: 'format_list_bulleted' }} size={18} tintColor={theme.text} /><View style={styles.listLinkText}><ThemedText type="smallBold" accessibilityLiveRegion="polite">{tr('목록 {0}개', items.length)}{limited ? '+' : ''}</ThemedText><ThemedText type="caption" themeColor="accent">{discountOrder ? tr('할인율 높은 순') : locating ? tr('위치 확인 중') : userLocation ? tr('가까운 순') : tr('위치 사용 필요')}</ThemedText></View></Pressable>
        {selected && located(selected) && cardOpen ? <View onLayout={event => setCardHeight(event.nativeEvent.layout.height)} style={[styles.selected, { backgroundColor: theme.card, borderColor: theme.line }]}>
            <ScrollView analyticsId="discovery.detail" accessibilityLabel={tr("선택한 장소 상세, 스크롤로 더 보기")} style={styles.selectedScroll} contentContainerStyle={styles.selectedContent}><DiscoveryCard item={selected} distance={discoveryDistanceKm(selected, userLocation)} externalInfo={!!onClose} viewerScope={viewerScope} onOpen={() => open(selected)} /><Top25Note item={selected} /><GlingVisitNote item={selected} /></ScrollView><Directions item={selected} />
        </View>

          : !loading && !deliveryUnavailable && items.length === 0 && <View style={styles.mapEmpty}><StateCard kind={current?.errors.length ? 'error' : 'empty'} title={current?.errors.length ? tr("결과를 불러오지 못했어요") : items.length ? tr("주소가 있는 항목은 목록에서 볼 수 있어요") : visitedOnly ? visitedReady ? tr("조건에 맞는 글링 방문 장소가 없어요") : tr("아직 글링이 방문한 장소가 없어요") : top25Only ? top25Ready ? tr("조건에 맞는 TOP 50 장소가 없어요") : tr("이 도시의 TOP 50을 준비하고 있어요") : deliveryOnly ? tr("아직 배달 할인 가게가 없어요") : tr("아직 표시할 공개 위치가 없어요")} body={current?.errors.length ? tr("연결을 확인하고 다시 시도해 주세요.") : visitedOnly ? visitedReady ? tr("검색어나 분류를 바꾸면 다른 장소를 볼 수 있어요.") : tr("직접 다녀온 장소만 모아 보여드려요. 다른 분류에서 먼저 둘러보세요.") : top25Only ? tr("검색어나 분류를 바꾸면 다른 장소를 볼 수 있어요.") : deliveryOnly ? tr("가게가 직접 받는 주문 페이지를 준비하고 있어요.") : tr("직접 첨부한 핀과 위치가 확인된 행사만 지도에 표시해요.")} actionLabel={current?.errors.length ? tr("다시 시도") : visitedOnly ? tr("전체 장소 보기") : tr("리스트 보기")} onAction={current?.errors.length ? refresh : visitedOnly ? () => { setSelectedFilters([]); setDateFilter(null); setDate(''); } : () => changeMode('list')} /></View>}
        {selected && located(selected) && <Pressable analyticsId="discovery.detail" accessibilityRole="button" accessibilityLabel={cardOpen ? tr('장소 카드 접기') : tr('장소 카드 펼치기')} accessibilityState={{ expanded: cardOpen }} onPress={() => { play('selection'); setClosedCardId(cardOpen ? selectedId : undefined); }} style={[styles.cardToggle, { backgroundColor: theme.card, borderColor: theme.line, bottom: cardOpen ? Math.min(cardHeight + 70, 1000) : 62 }]}>
          <SymbolView name={cardOpen ? { ios: 'chevron.down', android: 'expand_more', web: 'expand_more' } : { ios: 'chevron.up', android: 'expand_less', web: 'expand_less' }} size={IconSize.toolbar} tintColor={theme.text} />
        </Pressable>}

      </> : <FlatList analyticsId="discovery.list" onViewableItemsChanged={trackTranslationResults} viewabilityConfig={CONTENT_TRANSLATION_VIEWABILITY} data={items} keyExtractor={item => item.id} contentContainerStyle={styles.list} renderItem={({ item, index }) => <><View style={[styles.listCard, { backgroundColor: theme.card, borderColor: theme.line }]}><DiscoveryCard item={item} distance={discoveryDistanceKm(item, userLocation)} externalInfo={!!onClose} translationVisible={visibleResultIds.has(item.id)} viewerScope={viewerScope} onOpen={() => open(item)} /><GlingVisitNote item={item} />{located(item) && <Directions item={item} />}</View>{adsSupported && !loading && !current?.errors.length && !selectedFilters.includes('top25') && index === 3 && contentAdPosition(index, items.length) && <FeedAd key={`ad-after-${item.id}`} surface="map" />}</>}
        ListEmptyComponent={loading || deliveryUnavailable ? undefined : <StateCard kind={current?.errors.length ? 'error' : 'empty'} title={current?.errors.length ? tr("결과를 불러오지 못했어요") : visitedOnly ? visitedReady ? tr("조건에 맞는 글링 방문 장소가 없어요") : tr("아직 글링이 방문한 장소가 없어요") : top25Only ? top25Ready ? tr("조건에 맞는 TOP 50 장소가 없어요") : tr("이 도시의 TOP 50을 준비하고 있어요") : deliveryOnly ? tr("아직 배달 할인 가게가 없어요") : tr("조건에 맞는 항목이 없어요")} body={current?.errors.length ? tr("연결을 확인하고 다시 시도해 주세요.") : visitedOnly ? visitedReady ? tr("검색어나 분류를 바꾸면 다른 장소를 볼 수 있어요.") : tr("직접 다녀온 장소만 모아 보여드려요. 다른 분류에서 먼저 둘러보세요.") : deliveryOnly ? tr("가게가 직접 받는 주문 페이지를 준비하고 있어요.") : tr("다른 분류나 날짜를 선택해 보세요. 장소 위치는 글을 쓸 때 첨부할 수 있어요.")} actionLabel={current?.errors.length ? tr("다시 시도") : visitedOnly ? tr("전체 장소 보기") : undefined} onAction={current?.errors.length ? refresh : visitedOnly ? () => { setSelectedFilters([]); setDateFilter(null); setDate(''); } : undefined} />}
        ListFooterComponent={<>{more && <Pressable analyticsId="discovery.more" accessibilityRole="button" disabled={loading} onPress={() => { if (morePending.current || loading) return; morePending.current = true; play('selection'); loadPage(current); }} style={[styles.more, { borderColor: theme.line }]}><ThemedText themeColor="accent">{loading ? tr("불러오는 중…") : tr("더 보기")}</ThemedText></Pressable>}{limited && <ThemedText type="small" themeColor="textSecondary">{tr("500개까지 표시했어요. 검색어나 분류로 범위를 줄여 주세요.")}</ThemedText>}<ThemedText type="small" themeColor="textSecondary" style={styles.source}>{tr("글링 공개 위치 · 장소 자료: OpenStreetMap · 행사 정보: Ticketmaster")}{items.some(item => !located(item)) ? tr("\n위치 확인 전 항목은 지도 핀 없이 목록에 표시해요.") : ''}</ThemedText></>} />}
      {loading && <View pointerEvents="none" style={[styles.loading, mode === 'map' && styles.mapLoading]}><GlingLoader variant="capsule" accessibilityLabel={tr("지도 결과 불러오는 중")} /></View>}
    </View>
    {mode === 'map' && more && <Pressable analyticsId="discovery.more" accessibilityRole="button" disabled={loading} onPress={() => { if (morePending.current || loading) return; morePending.current = true; play('selection'); loadPage(current); }} style={[styles.moreMap, { borderColor: theme.line }]}><ThemedText type="smallBold" themeColor="accent">{loading ? tr("불러오는 중…") : tr("이 도시의 결과 더 보기")}</ThemedText></Pressable>}
    <Modal visible={filtersOpen} transparent animationType={reduced ? 'none' : 'fade'} onRequestClose={closeFilters}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
        <Pressable analyticsId="discovery.filter" accessibilityRole="button" accessibilityLabel={tr("필터 닫기")} onPress={closeFilters} style={StyleSheet.absoluteFill} />
        <SafeAreaView accessibilityViewIsModal style={[styles.filterSheet, { backgroundColor: theme.card, borderColor: theme.line }]} edges={['bottom', 'left', 'right']}>
          <View style={styles.sheetHeading}><ThemedText accessibilityRole="header" type="smallBold">{tr("분류와 날짜")}</ThemedText><Pressable analyticsId="discovery.filter" accessibilityRole="button" accessibilityLabel={tr("필터 닫기")} onPress={closeFilters} style={styles.icon}><ThemedText>×</ThemedText></Pressable></View>
          <ScrollView analyticsId="discovery.filter" keyboardShouldPersistTaps="handled" style={styles.sheetScroll} contentContainerStyle={styles.sheetContent}>
            <View style={styles.categoryGrid}>{filters.map(filterChip)}</View>
            <Pressable analyticsId="discovery.filter" accessibilityRole="button" accessibilityLabel={tr("TOP 50 선정 배지 안내")} onPress={() => { play('selection'); Alert.alert(tr("도시의 TOP 50"), tr("사진 명소와 들러 볼 만한 식당을 도시별 최대 50곳 골랐어요. 장소별 선정 출처도 확인할 수 있어요.")); }} style={styles.info}><SymbolView name={{ ios: 'info.circle', android: 'info', web: 'info' }} size={18} tintColor={theme.textSecondary} /><ThemedText type="small" themeColor="textSecondary">{tr("TOP 50 선정 배지 안내")}</ThemedText></Pressable>
            {Object.hasOwn(EVENT_CITIES, city.id) && eventCategory && <>
              <ThemedText type="smallBold">{tr("행사 날짜")}</ThemedText>
              <View style={styles.dates}>{([{ id: 'all', label: tr("전체 날짜") }, { id: 'today', label: tr("오늘") }, { id: 'week', label: tr('다가오는 7일') }, { id: 'weekend', label: tr("이번 주말") }, { id: 'date', label: tr("날짜 지정") }] as const).map(value => <Pressable key={value.id} analyticsId="discovery.date" accessibilityRole="button" accessibilityState={{ selected: value.id === 'date' ? dateOpen || dateFilter === 'date' : !dateOpen && dateFilter === value.id }} onPress={() => chooseDate(value.id)} style={[styles.date, { borderColor: theme.line, backgroundColor: (value.id === 'date' ? dateOpen || dateFilter === 'date' : !dateOpen && dateFilter === value.id) ? theme.backgroundSelected : theme.backgroundElement }]}><ThemedText type="small">{value.id === 'date' && dateFilter === 'date' && !dateOpen ? date.slice(5).replace('-', '/') : value.label}</ThemedText></Pressable>)}</View>
              {dateFilter === 'date' && !dateOpen && <ThemedText type="small" themeColor="textSecondary">{date}</ThemedText>}
              {dateOpen && <><ThemedText type="small" themeColor="textSecondary">{tr('{0} 현지 날짜로 입력해 주세요.', tr(city.name))}</ThemedText><TextInput value={dateDraft} onChangeText={value => { setDateDraft(value); setDateError(''); }} onFocus={() => play('selection')} placeholder="YYYY-MM-DD" accessibilityLabel={tr("행사 날짜 연도-월-일")} placeholderTextColor={theme.textSecondary} keyboardType="numbers-and-punctuation" maxLength={10} style={[styles.dateInput, { color: theme.text, borderColor: theme.line }]} />{!!dateError && <ThemedText type="small" accessibilityRole="alert">{tr(dateError)}</ThemedText>}</>}
            </>}
            {!isAuthed && <Pressable analyticsId="discovery.login" accessibilityRole="button" onPress={() => { closeFilters(); promptLogin(tr("로그인하면 이 도시의 공개 거래 위치와 장소를 함께 볼 수 있어요.")); }} style={styles.info}><ThemedText type="small" themeColor="accent">{tr("로그인하고 매물·거래 위치도 함께 보기 ›")}</ThemedText></Pressable>}
          </ScrollView>
          <View style={[styles.sheetActions, { borderColor: theme.line }]}><Pressable analyticsId="discovery.filter" accessibilityRole="button" onPress={() => { play('selection'); setSelectedFilters([]); setDateFilter(null); setDate(''); setDateOpen(false); setDateError(''); }} style={styles.date}><ThemedText>{tr("초기화")}</ThemedText></Pressable><Pressable analyticsId="discovery.filter" accessibilityRole="button" accessibilityLabel={tr("지도 보기")} onPress={() => { if (dateOpen) { try { const selected = discoveryDays('date', city.id, dateDraft)[0]; const today = discoveryDays('today', city.id)[0]; if (selected < today || Date.parse(`${selected}T00:00:00Z`) > Date.parse(`${today}T00:00:00Z`) + 365 * 86400000) throw new Error(); setDate(selected); setDateFilter('date'); } catch { play('warning'); setDateError("오늘부터 1년 안의 날짜를 YYYY-MM-DD로 입력해 주세요."); return; } } changeMode('map'); setFiltersOpen(false); setDateOpen(false); setDateError(''); }} style={[styles.apply, { backgroundColor: theme.accent }]}><ThemedText type="smallBold" style={{ color: theme.accentInk }}>{tr("지도 보기")}</ThemedText></Pressable></View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>

  </SafeAreaView>;
}

function DiscoveryCard({ item, viewerScope, onOpen, translationVisible = true, externalInfo = false, distance = null }: { item: DiscoveryItem; distance?: number | null; viewerScope: string; onOpen: () => void; translationVisible?: boolean; externalInfo?: boolean }) {
  const theme = useTheme();
  const { tr, locale: appLocale } = useLanguage();
  const translatable = !!item.post && item.source === 'post';
  const source = item.post ? visibleTranslationSource('post', item.post.title, item.post.body, !!item.post.room) : { title: item.title, body: '' };
  const translation = useContentTranslation('post', item.post?.id ?? '', source, translatable && translationVisible);
  const displayTitle = translatable ? translation.display.title : item.title;
  const category = DISCOVERY_CATEGORIES.find(value => value.id === item.category)!;
  const image = item.post ? getPostImageSource(item.post, viewerScope) : item.imageUri ? { uri: item.imageUri } : undefined;
  const price = item.event ? eventPriceLabel(item.event, appLocale) : item.price === null ? '' : item.price === 0 ? tr("나눔") : `CA$${item.price.toLocaleString('en-CA')}`;
  const housing = item.source === 'post' && item.post?.kind === 'listing' && item.category === 'housing';
  const headline = housing ? price || tr('가격 미등록') : displayTitle;
  const address = housing && item.post ? postPublicAddress(item.post.body) ?? tr('상세주소 미등록') : item.label;
  const distanceLabel = distance !== null && Number.isFinite(distance) && distance >= 0 ? distance < .1 ? tr('100m 이내') : tr('약 {0}km', distance.toFixed(1)) : null;
  const discountLabel = Number.isFinite(item.webshopDiscount) && item.webshopDiscount! > 0 && item.webshopDiscount! <= 100 ? tr('확인한 대표 메뉴 최대 할인 {0}%', item.webshopDiscount) : null;
  return <View><Pressable analyticsId="discovery.card" accessibilityRole={externalInfo ? 'link' : 'button'} accessibilityLabel={`${hasAdLabel(item.post?.hashtags) ? tr("광고") + ", " : ""}${item.glingVisited ? tr("글링 직접 방문 장소, ") : ''}${item.top25 ? tr("TOP 50 선정 장소, ") : ''}${tr(category.label)}, ${headline}, ${housing ? `${displayTitle}, ` : ''}${address}, ${distanceLabel ? distanceLabel + ', ' : ''}${discountLabel ? discountLabel + ', ' : ''}${externalInfo ? tr('공개 정보, 외부 페이지 열기') : item.source === 'place' && !item.post && !item.place ? tr("선정 출처 열기") : tr("상세 보기")}`} onPress={onOpen} style={styles.cardBody}>
    <View style={[styles.thumbnail, { backgroundColor: theme.backgroundElement }]}>{item.place && (item.place.mapPhotoUri || !item.post && item.place.photo) ? <CityPlacePhoto place={item.place} style={StyleSheet.absoluteFill} /> : image ? <Image source={image} style={StyleSheet.absoluteFill} contentFit="cover" accessible={false} /> : <SymbolView name={{ ios: 'mappin.and.ellipse', android: 'location_on', web: 'location_on' }} size={26} tintColor={category.color} />}</View>
    <View style={styles.cardText}>{discountLabel && <ThemedText type="smallBold" style={{ color: theme === Colors.light ? '#276B57' : '#8FD9C4' }}>{discountLabel}</ThemedText>}<View style={styles.badge}><PostAdLabel hashtags={item.post?.hashtags} /><View style={[styles.dot, { backgroundColor: category.color }]} /><ThemedText type="small" themeColor="textSecondary">{tr(category.label)}{!located(item) ? tr(" · 위치 확인 전") : ''}</ThemedText>{item.glingVisited && <GlingVisitedBadge />}{item.top25 && <View style={styles.top25Badge}><ThemedText style={styles.top25BadgeText}>✦ TOP 50</ThemedText></View>}</View><ThemedText type="smallBold" numberOfLines={2} style={housing ? styles.housingPrice : undefined}>{headline}</ThemedText>{housing && <ThemedText type="small" numberOfLines={2}>{displayTitle}</ThemedText>}<ThemedText type="small" themeColor="textSecondary" numberOfLines={housing ? 2 : 1}>{address}</ThemedText>{distanceLabel && <ThemedText type="small" themeColor="accent">{distanceLabel}</ThemedText>}{item.event && <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{eventTime(item.event, appLocale)}</ThemedText>}{!housing && !!price && <ThemedText type="smallBold" themeColor="accent">{price}</ThemedText>}</View>
    <ThemedText type={externalInfo ? 'small' : 'default'} themeColor="textSecondary">{externalInfo ? tr('공개 정보 ↗') : '›'}</ThemedText>
  </Pressable>{translatable && <TranslationControl translation={translation} />}</View>;
}
function Top25Note({ item }: { item: DiscoveryItem }) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  const top25Ink = theme === Colors.light ? '#68543A' : TOP25_GOLD;
  const { tr, language } = useLanguage();
  if (!item.top25) return null;
  return <View style={[styles.top25Note, { borderTopColor: theme.line }]}>
    <ThemedText type="smallBold" style={{ color: top25Ink }}>{tr("TOP 50 선정 이유")}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{language === 'en' ? item.top25.reasonEn ?? item.top25.reason : item.top25.reason}</ThemedText>
    {!!item.post && <ThemedText type="small" themeColor="textSecondary">{tr("글링 추천 글에서도 소개한 장소예요.")}</ThemedText>}
    <Pressable analyticsId="discovery.card" accessibilityRole="link" accessibilityLabel={tr('{0} TOP 50 선정 출처 열기, 외부 사이트', item.title)} onPress={() => { play('selection'); void Linking.openURL(item.top25!.sourceUrl).catch(() => { play('warning'); Alert.alert(tr("선정 출처를 열지 못했어요"), tr("인터넷 연결을 확인하고 다시 시도해 주세요.")); }); }} style={styles.top25Source}><ThemedText type="small" style={{ color: top25Ink }}>{tr("선정 출처 보기 ↗")}</ThemedText></Pressable>
  </View>;
}
function GlingVisitedBadge({ selected }: { selected?: boolean }) {
  const theme = useTheme(), filter = selected !== undefined;
  const lightLogo = filter && (selected ? theme !== Colors.dark : theme === Colors.dark);
  return <View accessible={false} style={[styles.visitedBadge, filter ? styles.visitedInline : styles.visitedCard]}>
    <Image source={lightLogo ? require('@/assets/brand/gling-night-wordmark.png') : require('@/assets/brand/gling-night-wordmark-light.png')} contentFit="contain" style={styles.visitedLogo} accessible={false} />
    <ThemedText style={[styles.visitedText, filter && styles.visitedFilterText, filter && { color: selected ? theme.accentInk : theme.text }]}>Visited</ThemedText>
  </View>;
}
function GlingVisitNote({ item }: { item: DiscoveryItem }) {
  const theme = useTheme(), { play } = useInteractionFeedback(), { tr } = useLanguage();
  if (!item.glingVisited) return null;
  return <View style={[styles.top25Note, { borderTopColor: theme.line }]}>
    <ThemedText type="small" themeColor="textSecondary">{tr("글링이 직접 다녀온 곳이에요.")}</ThemedText>
    {!!item.glingVisited!.sourceUrl && <Pressable analyticsId="discovery.card" accessibilityRole="link" accessibilityLabel={tr("{0} 글링 방문 영상 보기, 외부 사이트", item.title)}
      onPress={() => { play('selection'); void Linking.openURL(item.glingVisited!.sourceUrl).catch(() => { play('warning'); Alert.alert(tr("방문 영상을 열지 못했어요"), tr("인터넷 연결을 확인하고 다시 시도해 주세요.")); }); }} style={styles.top25Source}>
      <ThemedText type="smallBold" themeColor="accent">{tr("글링 방문 영상 보기 ↗")}</ThemedText>
    </Pressable>}
  </View>;
}
function Directions({ item }: { item: DiscoveryItem & PostPin }) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  const { tr } = useLanguage();
  const navigate = (app: 'google' | 'waze') => {
    play('selection');
    void Linking.openURL(directionsUrl(item, app)).catch(() => { play('warning'); Alert.alert(tr("길찾기를 열지 못했어요"), tr("인터넷 연결을 확인한 뒤 다시 시도해 주세요.")); });
  };
  return <View style={styles.directions}>{(['google', 'waze'] as const).map(app => <Pressable key={app} analyticsId={`discovery.${app}`} accessibilityRole="link" accessibilityLabel={tr('{0}에서 길찾기, 외부 앱 열기', app === 'google' ? 'Google Maps' : 'Waze')} onPress={() => navigate(app)} hitSlop={4} style={[styles.direction, { backgroundColor: theme.backgroundElement, borderColor: theme.line }]}><ThemedText type="smallBold">{app === 'google' ? 'Google Maps' : 'Waze'} ↗</ThemedText></Pressable>)}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  icon: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, heading: { flex: 1, gap: 2 }, title: { fontSize: 20, lineHeight: 28, fontWeight: '800', letterSpacing: -0.5 },
  unifiedSearch: { flex: 1, minWidth: 0, minHeight: 46, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }, unifiedSearchText: { flex: 1, minWidth: 0 },
  search: { marginHorizontal: 16, marginBottom: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 4 }, input: { minHeight: 46, flex: 1, minWidth: 0, paddingHorizontal: 10, fontSize: 14 },
  mapFilters: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 12, zIndex: 1 },
  mapDateLabel: { borderRadius: 12, paddingHorizontal: 8, paddingVertical: 6, overflow: 'hidden' },
  filterRow: { flexGrow: 0, flexShrink: 0, maxHeight: 58 }, filters: { paddingHorizontal: 16, gap: 8, paddingBottom: 8 }, chip: { minHeight: 44, paddingHorizontal: 13, borderRadius: 24, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 7 }, dot: { width: 8, height: 8, borderRadius: 4 },
  filterDot: { width: 6, height: 6, borderRadius: 3, position: 'absolute', right: 6, top: 6 },
  visitedBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#CBB9FF', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3 }, visitedLogo: { width: 35, height: 16 }, visitedText: { color: '#171123', fontSize: 9, lineHeight: 14, fontWeight: '800', letterSpacing: 0.8 },
  visitedChip: { ...ControlStyles.pill, paddingHorizontal: 10, gap: 8 }, visitedInline: { backgroundColor: 'transparent', paddingHorizontal: 0, paddingVertical: 0, gap: 8 }, visitedFilterText: { ...Typography.label }, visitedSelection: { width: IconSize.inline, height: IconSize.inline, alignItems: 'center', justifyContent: 'center' },
  top25Badge: { borderRadius: 5, borderWidth: 1, borderColor: '#68543A', backgroundColor: '#2A2319', paddingHorizontal: 5, paddingVertical: 2 }, top25BadgeText: { color: TOP25_GOLD, fontSize: 10, lineHeight: 14, fontWeight: '800' }, top25Note: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 4, gap: 5 }, top25Source: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  dates: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' }, date: { minHeight: 44, paddingHorizontal: 12, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  eventDateRow: { flexGrow: 0, flexShrink: 0 }, eventDates: { paddingHorizontal: 16, paddingBottom: 10, gap: 8, alignItems: 'center' }, dateChip: { minHeight: 44, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  deliveryBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0008' },
  deliverySheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: 20, gap: 6 },
  deliveryOrder: { marginTop: 14, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  deliveryClose: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  cardToggle: { ...ControlStyles.icon, position: 'absolute', right: 16, bottom: 56, borderWidth: 1, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  visitedCard: { marginLeft: 6 },
  sortRow: { flexWrap: 'wrap', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  sortChip: { ...ControlStyles.pill, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  notice: { marginHorizontal: 16, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 },
  content: { flex: 1, minHeight: 180 }, mapControls: { position: 'absolute', right: 22, top: 22, gap: 8 }, mapControl: { minWidth: 44, minHeight: 44, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  listLinkText: { flexShrink: 1, alignItems: 'center' },
  listLink: { position: 'absolute', alignSelf: 'center', minHeight: 56, maxWidth: '55%', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 24, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  selected: { position: 'absolute', bottom: 56, left: 16, right: 16, maxHeight: '45%', borderRadius: 18, borderWidth: 1, padding: 12, gap: 12, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 }, selectedScroll: { flexShrink: 1, minHeight: 0 }, selectedContent: { gap: 12 },
  cardBody: { minHeight: 84, flexDirection: 'row', alignItems: 'center', gap: 12 }, thumbnail: { width: 72, height: 84, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, cardText: { flex: 1, minWidth: 0, gap: 3 }, badge: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  housingPrice: { fontSize: 18, lineHeight: 25, fontWeight: '700' },
  directions: { flexDirection: 'row', gap: 8 }, direction: { flex: 1, minHeight: 37, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 12 }, listCard: { padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, gap: 12 }, mapEmpty: { position: 'absolute', bottom: 56, left: 16, right: 16 },
  loading: { position: 'absolute', top: 20, left: 16, right: 16, alignItems: 'center' },
  mapLoading: { top: 0, bottom: 0, justifyContent: 'center' },
  more: { minHeight: 48, borderWidth: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 12 }, moreMap: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth }, source: { fontSize: 11, lineHeight: 17, paddingTop: 16 },
  overlay: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' }, filterSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, width: '100%', maxWidth: 560, maxHeight: '90%', alignSelf: 'center' }, sheetHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 20, paddingRight: 8, paddingTop: 8 }, sheetScroll: { flexGrow: 0, flexShrink: 1 }, sheetContent: { padding: 20, paddingTop: 8, gap: 16 }, categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, info: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }, sheetActions: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, padding: 16, borderTopWidth: StyleSheet.hairlineWidth }, dateInput: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 17 }, apply: { flex: 1, minHeight: 44, minWidth: 90, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
