import { Colors } from '@/constants/theme';
import { ControlMotion, ControlStyles, IconSize } from '@/constants/design-system';
import { useLanguage } from '@/hooks/use-language';
import { PageHeader } from '@/components/page-header';
import { PostAdLabel } from '@/components/post-ad-label';
import { hasAdLabel } from '@/lib/hashtags';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, AppState, KeyboardAvoidingView, Linking, Modal, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { SymbolView } from '@/components/symbol-view';
import { ClayBoxFill, ClayIcon, ClayPillFill, useClay, useClayBox } from '@/components/clay';
import { openBrowserAsync } from 'expo-web-browser';
import { safeTicketUrl } from '../../supabase/functions/_shared/ticketmaster';
import * as Location from 'expo-location';
import Reanimated, { SlideInDown, SlideOutDown, useReducedMotion } from 'react-native-reanimated';
import { FlatList, Pressable, ScrollView } from '@/components/analytics-controls';
import { animateLayout } from '@/components/disclosure';
import { DiscoveryMap } from '@/components/discovery-map';
import { DragSheet } from '@/components/drag-sheet';
import { LiveDock, LiveSheets, useKeepClearOfNotice, useLive, useLiveMarkers, useMeetupMarkers, type LiveOpen } from '@/components/live-bubbles';
import { MapListSheet, type SheetSnap } from '@/components/map-list-sheet';
import { FriendSavedLine, MapScopeSheet } from '@/components/map-scope';
import { PlaceHours } from '@/components/place-hours';
import { ReservationButton } from '@/components/reservation-button';
import { WebshopComparisonSheet, WebshopOrderButton } from '@/components/business-webshop';
import { CategoryIcon } from '@/components/category-icon';
import { CityPicker } from '@/components/city-picker';
import { SavedEntryButton, useSavedEntry } from '@/components/saved-entry';
import { CityPlacePhoto } from '@/components/city-place-photo';
import { FeedAd } from '@/components/feed-ad';
import { SelectionChip } from '@/components/selection-chip';
import { adsSupported } from '@/lib/ads';
import { contentAdPosition } from '@/lib/content-ad-placement';
import { GlingLoader } from '@/components/gling-loader';
import { StateCard } from '@/components/state-card';
import { TranslationControl } from '@/components/content-translation';
import { useContentTranslation, useTranslationVisibleIds } from '@/hooks/use-content-translation';
import { CONTENT_TRANSLATION_VIEWABILITY } from '@/lib/content-translation';
import { visibleTranslationSource } from '@/lib/translation-source';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useRevealChip } from '@/hooks/use-reveal-chip';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useAuth } from '@/lib/auth';
import { useCommunityCity } from '@/lib/community-city';
import { bindBusinessPlaces, loadCityBusinessLinks, loadCityBusinessMapPhotos, loadCityWebshops, type BusinessMapPhotos, type Webshop } from '@/lib/webshops';
import { DELIVERY_PARTNERS, deliveryPartnerPlace } from '@/lib/delivery-partners';
import { discoveryDistanceKm, sortDiscoveryItems } from '@/lib/discovery-sort';
import { DISCOVERY_CATEGORIES, PLACE_STATUS, PLACE_SUBCATEGORIES, PRICE_FILTERS, PRICE_LEVELS, TOP25_GOLD, discoveryDays, discoveryEvent, discoveryEventOnDays, discoveryMatches, discoveryPlace, discoveryRefines, mapAppUrl, mergeCityTop25, pinSubcategory, priceLabel, priceSymbol, type DiscoveryDate, type DiscoveryFilter, type DiscoveryItem } from '@/lib/discovery';
import type { DiscoveryBounds } from '@/lib/discovery-map-html';
import { inBounds } from '@/lib/listing-details';
import { cityClock, openState } from '@/lib/opening-hours';
import { getCityPlaces, getCityDiscoveryPlaces } from '@/lib/city-places';
import { CITIES } from '@/lib/mock';
import { useCityPlacesRevision } from '@/hooks/use-city-places';
import { loadDiscoveryPosts } from '@/lib/discovery-data';
import { getPostImageSource, type FeedCursor } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { isFreshLocation, type LocationFix } from '@/lib/location';
import { loadLiveMap } from '@/lib/live-bubbles';
import { mapCityCenter } from '@/lib/post-map-html';
import { postPublicAddress, type PostPin } from '@/lib/post-maps';
import { loadCityPlaceSaves, loadMapScope, type CityPlaceSave, type FriendSavedPlace, type MapScope, type MapScopePlaces, type PlaceStatus } from '@/lib/profile-friends';
import { supabase } from '@/lib/supabase';
import { safeMerchantSourceUrl } from '@/lib/merchant-source';
import { PUBLIC_SITE, publicCompanyUrl } from '@/lib/public-seo';
import { EVENT_CITIES, eventPriceLabel, eventTime, loadTicketmasterEvents, type EventCity } from '@/lib/ticketmaster';

const filters: { id: DiscoveryFilter; label: string }[] = [
  { id: 'all', label: '전체' }, { id: 'visited', label: 'gling Visited' },
  { id: 'top25', label: 'TOP 50' }, { id: 'delivery', label: '배달 할인' },
  { id: 'dining', label: '레스토랑' }, { id: 'cafe', label: '카페' },
  { id: 'festival', label: '페스티벌' }, { id: 'nightlife', label: '나이트라이프' },
  { id: 'places', label: '가볼 만한 곳' },
  { id: 'housing', label: '부동산' }, { id: 'used', label: '중고거래' },
  { id: 'events', label: '행사 전체' },
];
type Result = { key: string; page: number; items: DiscoveryItem[]; cursor: FeedCursor | null; postMore: boolean; eventMore: boolean; errors: string[]; limited: boolean };
const freshMapFix = (fix: LocationFix) => isFreshLocation(fix) && fix.accuracy! <= 250 && Date.now() - fix.measuredAt <= 120000;
const located = (item: DiscoveryItem): item is DiscoveryItem & PostPin => item.latitude !== null && item.longitude !== null;
// The embedded map's far stage, where city pills replace places; searching an area makes no sense there.
const FAR_ZOOM = 8;
type Registry = { links: Record<string, string>; shops: Webshop[]; photos: BusinessMapPhotos; failed: boolean; ready: boolean };
// One shared empty value each, so a screen without them still hands the memoized list below the same object every render.
const NO_REGISTRY: Registry = { links: {}, shops: [], photos: {}, failed: false, ready: false };
const NO_SAVED_PLACES = new Map<string, FriendSavedPlace | null>();
const placeKey = (item: DiscoveryItem) => item.place?.id ?? item.sourceId;

export default function MapScreen({ onClose, initialFilter, tab = false }: { onClose?: () => void; initialFilter?: DiscoveryFilter; tab?: boolean } = {}) {
  const { city: selectedCity } = useCommunityCity();
  const { cityId, placeId } = useLocalSearchParams<{ cityId?: string; placeId?: string }>();
  const city = (!onClose && CITIES.find(value => value.id === cityId)) || selectedCity;
  const { isAuthed, me } = useAuth();
  return <CityMap key={`${city.id}:${isAuthed ? me.id : 'guest'}`} city={city} placeId={onClose ? undefined : placeId} onClose={onClose} initialFilter={initialFilter} tab={tab} />;
}
function CityMap({ city, placeId, onClose, initialFilter, tab }: { city: (typeof CITIES)[number]; placeId?: string; onClose?: () => void; initialFilter?: DiscoveryFilter; tab: boolean }) {
  const { tr, language } = useLanguage();
  const searchLabel = language === 'en' ? 'Search businesses, places and people' : '비즈니스·장소·사람·이야기 검색';
  const theme = useTheme(), router = useRouter(), reduced = useReducedMotion();
  const clay = useClay(), clayBox = useClayBox();
  const top25Ink = theme === Colors.light ? '#68543A' : TOP25_GOLD;
  const { isAuthed, me, promptLogin } = useAuth(), hidden = useContentVisibility();
  const isFocused = useIsFocused(), targetFocusRef = useRef<string | null>(null);
  const { play } = useInteractionFeedback();
  const { category, placeRequest, cityId: routeCityId, bubbleRequest } = useLocalSearchParams<{ category?: string; placeRequest?: string; cityId?: string; bubbleRequest?: string }>();
  const { selectCity } = useCommunityCity();
  const initialCategory = initialFilter ?? (onClose ? 'all' : category);
  // A comma list opens with the same union the chips make (home 'Rent·used map' sends housing,used).
  const [selectedFilters, setSelectedFilters] = useState<DiscoveryFilter[]>(() => (initialCategory ?? '').split(',')
    .filter((id): id is DiscoveryFilter => id !== 'all' && filters.some(value => value.id === id)));
  const filter: DiscoveryFilter = selectedFilters.length === 1 ? selectedFilters[0] : 'all';
  // The chip just turned on (here or in the filter sheet) scrolls into the row when it sits off screen or cut at the edge (QA Q07).
  // Turning a chip off leaves the row where it is, so the next chip is still under the finger.
  const [revealedFilter, setRevealedFilter] = useState<string>(selectedFilters.at(-1) ?? 'all');
  const filterRow = useRevealChip(revealedFilter, !reduced);
  const top25Only = selectedFilters.length === 1 && selectedFilters[0] === 'top25';
  const deliveryOnly = selectedFilters.length === 1 && selectedFilters[0] === 'delivery';
  const visitedOnly = selectedFilters.length === 1 && selectedFilters[0] === 'visited';
  const eventCategory = selectedFilters.some(value => value === 'festival' || value === 'events');
  const includeEvents = !selectedFilters.length || eventCategory;
  const [sheet, setSheet] = useState<SheetSnap>('closed'), [query, setQuery] = useState(''), [search, setSearch] = useState('');
  const [chosenDateFilter, setDateFilter] = useState<DiscoveryDate | null>(null), [date, setDate] = useState('');
  const dateFilter: DiscoveryDate = eventCategory ? chosenDateFilter ?? (selectedFilters.includes('festival') ? 'week' : 'today') : 'all';
  const [dateOpen, setDateOpen] = useState(false), [dateDraft, setDateDraft] = useState(''), [dateError, setDateError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false), [cityOpen, setCityOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null), [center, setCenter] = useState<(PostPin & { requestId: number }) | null>(null);
  const [sortBy, setSortBy] = useState<'near' | 'discount' | 'saves'>('near');
  const [openNow, setOpenNow] = useState(false), [showUnknown, setShowUnknown] = useState(false);
  // 보여 줄 곳 (owner 2026-11-04): 모두, or only the places I or my friends saved. Saved data loads only while one is chosen.
  const [scope, setScope] = useState<MapScope>('all'), [scopeOpen, setScopeOpen] = useState(false);
  const [scopeResult, setScopeResult] = useState<{ key: string; value: MapScopePlaces | null } | null>(null);
  const [priceLevels, setPriceLevels] = useState<number[]>([]), [priceDraft, setPriceDraft] = useState<number[] | null>(null), [subcategories, setSubcategories] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<PlaceStatus | null>(null);
  // The last pressed category chip and a press count, so its icon plays its gesture once per press.
  const [bump, setBump] = useState({ id: '', n: 0 });
  const [moved, setMoved] = useState<{ bounds: DiscoveryBounds; zoom?: number } | null>(null), [region, setRegion] = useState<DiscoveryBounds | null>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const viewerScope = isAuthed ? me.id : 'guest', registryKey = `${city.id}:${viewerScope}`;
  const [registrySnapshot, setRegistry] = useState<Registry & { key: string }>({ key: '', ...NO_REGISTRY });
  const registry = registrySnapshot.key === registryKey ? registrySnapshot : NO_REGISTRY;

  const [closedCardId, setClosedCardId] = useState<string | null | undefined>(undefined);
  const cardOpen = closedCardId !== selectedId;
  const [userLocation, setUserLocation] = useState<PostPin | null>(null);
  const [cardHeight, setCardHeight] = useState(0);
  // Stays mounted after closing so iOS can open the webshop once the sheet has dismissed.
  const [webshopOrder, setWebshopOrder] = useState<{ shop: Webshop; name: string; open: boolean } | null>(null);
  const [mapFiltersHeight, setMapFiltersHeight] = useState(0);
  const [visibleResultIds, setVisibleResultIds] = useTranslationVisibleIds();
  const trackTranslationResults = useCallback(({ viewableItems }: { viewableItems: { item: DiscoveryItem }[] }) =>
    setVisibleResultIds(viewableItems.map(({ item }) => item.id)), [setVisibleResultIds]);
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
  const scopeKey = `${city.id}:${viewerScope}:${scope}:${attempt}`, scopeData = scopeResult?.key === scopeKey ? scopeResult : null;
  useEffect(() => {
    if (scope === 'all' || !isAuthed || !isFocused) return;
    let active = true;
    void loadMapScope(supabase, scope, city.id, me.id).then(value => { if (active) setScopeResult({ key: scopeKey, value }); }, () => { if (active) setScopeResult({ key: scopeKey, value: null }); });
    return () => { active = false; };
  }, [scope, isAuthed, isFocused, scopeKey, city.id, me.id]);
  // M5 (owner 2026-11-05): my own saves get a small mark on their pins in every scope; 내가 저장한 곳 already holds that list, and a failed read just leaves pins plain.
  const [mineResult, setMineResult] = useState<{ key: string; places: MapScopePlaces['places'] } | null>(null);
  const [savedNow, setSavedNow] = useState<Record<string, boolean>>({});
  const mineKey = `${city.id}:${viewerScope}:${attempt}`, mineScope = scope === 'mine';
  useEffect(() => {
    if (mineScope || !isAuthed || !isFocused) return;
    let active = true;
    void loadMapScope(supabase, 'mine', city.id, me.id).then(value => { if (active) setMineResult({ key: mineKey, places: value.places }); }, () => {});
    return () => { active = false; };
  }, [mineScope, isAuthed, isFocused, mineKey, city.id, me.id]);
  // M3 (owner 2026-11-05): saver totals for this city (CityMap remounts per city). An older server answers null and a failed read keeps what we had, so the map still works without them.
  const [placeSaves, setPlaceSaves] = useState<Map<string, CityPlaceSave> | null>(null);
  useEffect(() => {
    if (!isFocused) return;
    let active = true;
    void loadCityPlaceSaves(supabase, city.id).then(value => { if (active) setPlaceSaves(value); }, () => {});
    return () => { active = false; };
  }, [isFocused, city.id, attempt]);
  // M7 (owner 2026-11-05): the compass runs only while this map is on screen after a location fix (that fix already asked for permission).
  // The map component owns the readings, so a turn redraws only the map, not this screen (map lag 2026-11-11).
  const compass = isFocused && !!userLocation;
  // 동네 말풍선 지도 (owner 2026-11-05): bubbles and nearby meetups on this map, its own chips, a card under the map and its sheets.
  // Not in the chat sheet's map (onClose), and only for members; the bubble parts only while the live map loaded (server, or the dev example).
  const live = useLive(), liveOn = !onClose && isAuthed && live.status === 'ready' && !!live.map, meetupsOn = !onClose && isAuthed;
  const [showBubbles, setShowBubbles] = useState(true), [showMeetups, setShowMeetups] = useState(true);
  const [liveOpen, setLiveOpen] = useState<LiveOpen | null>(null), [dockHeight, setDockHeight] = useState(0), [openedRequest, setOpenedRequest] = useState<string | null>(null);
  const [cityLongitude, cityLatitude] = mapCityCenter(city.englishName);
  const listClear = useKeepClearOfNotice(); // a live notice sits above the list pill too, now that it shares the row over the dock
  useEffect(() => {
    if (!isFocused || !isAuthed || onClose) return;
    const load = () => void loadLiveMap(supabase, me.id, city.id, { latitude: cityLatitude, longitude: cityLongitude }).catch(() => {});
    load();
    const timer = setInterval(() => { if (AppState.currentState === 'active') load(); }, 45000);
    return () => clearInterval(timer);
  }, [isFocused, isAuthed, onClose, me.id, city.id, cityLatitude, cityLongitude]);
  // A request notification opens /discover?bubbleRequest=<id>: show that request once it is in the loaded map.
  if (bubbleRequest && openedRequest !== bubbleRequest && live.map?.received.some(request => request.id === bubbleRequest)) { setOpenedRequest(bubbleRequest); setLiveOpen({ kind: 'received', requestId: bubbleRequest }); }
  const loading = !current || pendingKey === key || selectedFilters.includes('delivery') && !registry.ready || scope !== 'all' && isAuthed && !scopeData;
  const refresh = () => { morePending.current = false; setAttempt(value => value + 1); setNow(Date.now()); setRegion(null); setMoved(null); };

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

  // Map lag 2026-11-11 (owner "화면 통째로 다시 계산"): the places, list and pins below are rebuilt only when something they show changes,
  // not on a pan, a layout pass or a live-map refresh. A new place catalog comes in as a new revision.
  const placesRevision = useCityPlacesRevision();
  const { catalogItems, targetItem } = useMemo(() => {
    void placesRevision;
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
    return { catalogItems, targetItem };
  }, [city.id, placeId, placesRevision]);
  const targetId = targetItem?.id, targetLatitude = targetItem?.latitude, targetLongitude = targetItem?.longitude, targetRecommended = !!targetItem?.top25, targetVisited = !!targetItem?.glingVisited;
  useEffect(() => {
    if (!isFocused || !targetId || targetLatitude == null || targetLongitude == null) return;
    const requestKey = targetId + ':' + (placeRequest ?? '');
    if (targetFocusRef.current === requestKey) return;
    targetFocusRef.current = requestKey;
    locationRevision.current++; setLocating(false); setLocationError('');
    setSelectedFilters(targetVisited ? ['visited'] : targetRecommended ? ['top25'] : []); setRevealedFilter(targetVisited ? 'visited' : targetRecommended ? 'top25' : 'all');
    setQuery(''); setSearch(''); setSheet('closed');
    setSelectedId(targetId);
    setCenter({ latitude: targetLatitude, longitude: targetLongitude, requestId: locationRevision.current });
  }, [isFocused, targetId, targetLatitude, targetLongitude, targetRecommended, targetVisited, placeRequest]);
  const publicItems = useMemo(() => [...catalogItems, ...(current?.items ?? [])].filter(item => (item.source !== 'post' || !!item.post && item.post.kind === 'listing' && ['housing', 'used'].includes(item.category))
    && (!item.post || (!hidden('post', item.post.id, item.post.author.id) && (item.post.kind !== 'listing' || (['open', 'partial'].includes(item.post.listingStatus ?? '') && Date.parse(item.post.expiresAt ?? '') > now))))
    && (!item.event || discoveryEvent(item.event, item.cityId, now) !== null)), [catalogItems, current?.items, hidden, now]);
  const cityItems = useMemo(() => bindBusinessPlaces(mergeCityTop25(publicItems, city.id), registry.links, registry.shops, registry.photos), [publicItems, city.id, registry.links, registry.shops, registry.photos]);
  const top25Ready = cityItems.some(item => item.top25);
  const visitedReady = cityItems.some(item => item.glingVisited);
  // A saved scope keeps only catalog places whose key someone saved; categories, open-now, price and sub-filters still apply inside it.
  const scopePlaces = scope === 'all' ? null : scopeData?.value?.places ?? NO_SAVED_PLACES;
  const savesOf = useCallback((item: DiscoveryItem) => item.source === 'place' ? placeSaves?.get(placeKey(item)) : undefined, [placeSaves]);
  const { scopedItems, priceReady, subcategoryOptions, activePrices, activeSubcategories, statusOptions, activeStatus, shown, discountOrder, savesReady, savesOrder, order, items, unknownItems } = useMemo(() => {
    const scopedItems = scopePlaces ? cityItems.filter(item => item.source === 'place' && scopePlaces.has(placeKey(item))) : cityItems;
    const matches = scopedItems.filter(item => discoveryMatches(item, selectedFilters, query) && discoveryEventOnDays(item, days));
    // Price and sub-filter chips show only when some place here has the value, and a choice only counts while its chip shows.
    const priceReady = selectedFilters.some(id => PRICE_FILTERS.includes(id)) && matches.some(item => !!item.place?.priceLevel);
    const subcategoryOptions = PLACE_SUBCATEGORIES.filter(option => selectedFilters.includes(option.filter) && matches.some(item => item.place?.subcategories?.includes(option.id)));
    const activePrices = priceReady ? priceLevels : [], activeSubcategories = subcategories.filter(id => subcategoryOptions.some(option => option.id === id));
    // M1 (owner 2026-11-05): 뜨는 중·인기 follow the same rule, and an older server has no statuses, so no chips.
    const statusOptions = (['trending', 'popular'] as const).filter(id => matches.some(item => savesOf(item)?.status === id));
    const activeStatus = statusFilter && statusOptions.includes(statusFilter) ? statusFilter : null;
    const refined = matches.filter(item => discoveryRefines(item, activePrices, activeSubcategories) && (!activeStatus || savesOf(item)?.status === activeStatus) && (!region || located(item) && inBounds(region, item)));
    // 지금 영업 중 uses the city's own clock: closed places leave, places with unknown hours wait in the list's last row, and events and posts (no hours) leave too.
    const clock = cityClock(city.id, now), hours = (item: DiscoveryItem) => item.place ? openState(item.place.openingHours, clock) : 'unknown';
    const shown = openNow ? refined.filter(item => hours(item) === 'open') : refined;
    const discountOrder = deliveryOnly && sortBy === 'discount';
    // 저장 많은 순 exists only while some place here has a saver; without any (older server, nothing saved yet) the list stays nearest first.
    const savesReady = shown.some(item => !!savesOf(item)?.saverCount), savesOrder = savesReady && sortBy === 'saves';
    const order = discountOrder ? 'discount' : savesOrder ? 'saves' : 'near';
    const items = sortDiscoveryItems(shown, userLocation, order, item => savesOf(item)?.saverCount ?? 0).slice(0, 500);
    const unknownItems = openNow ? sortDiscoveryItems(refined.filter(item => item.source === 'place' && hours(item) === 'unknown'), userLocation, 'near').slice(0, 500) : [];
    return { scopedItems, priceReady, subcategoryOptions, activePrices, activeSubcategories, statusOptions, activeStatus, shown, discountOrder, savesReady, savesOrder, order, items, unknownItems };
  }, [cityItems, scopePlaces, selectedFilters, query, days, priceLevels, subcategories, statusFilter, savesOf, region, city.id, now, openNow, deliveryOnly, sortBy, userLocation]);
  const limited = !!current?.limited || shown.length > 500;
  const listData = useMemo(() => showUnknown && unknownItems.length ? [...items, ...unknownItems] : items, [showUnknown, unknownItems, items]);
  const hasVerifiedDiscount = items.some(item => Number.isFinite(item.webshopDiscount) && item.webshopDiscount! > 0 && item.webshopDiscount! <= 100);
  const pins = useMemo(() => items.filter(located), [items]);
  // Owner 2026-11-11 (A안): a business with a published webshop gets the order button on its card; the registry already holds the shop.
  const orderButton = useCallback((item: DiscoveryItem) => {
    const shop = item.merchantId ? registry.shops.find(value => value.merchantId === item.merchantId && value.cityId === item.cityId) : undefined;
    return shop ? <WebshopOrderButton shop={shop} notice={false} onPress={() => setWebshopOrder({ shop, name: item.title, open: true })} /> : null;
  }, [registry.shops]);
  // Only show the detail card for a pin the user actually picked; the map stays clear otherwise.
  const selected = items.find(item => item.id === selectedId) ?? null;
  const mySaved = mineScope ? scopePlaces : mineResult?.key === mineKey ? mineResult.places : null;
  const markers = useMemo(() => pins.map(item => {
    const category = DISCOVERY_CATEGORIES.find(value => value.id === item.category)!;
    // The second line leads with the place's state when it has one (M1), then the first kind of place or the category.
    const subcategory = pinSubcategory(item.place?.subcategories);
    const state = savesOf(item)?.status, status = state ? PLACE_STATUS[state] : null;
    return { id: item.id, latitude: item.latitude, longitude: item.longitude, color: category.color,
      label: `${hasAdLabel(item.post?.hashtags) ? 'AD · ' : ''}${item.title}`.slice(0,80), sublabel: `${status ? `${tr(status.label)} · ` : ''}${tr(subcategory?.label ?? category.label)}`.slice(0, 40), icon: category.art,
      ...(item.top25 || item.glingVisited ? { featured: true } : {}), ...(item.top25 ? { top25: true } : {}), ...(item.webshopDiscount ? { discount: item.webshopDiscount } : {}), ...(status ? { statusColor: status.color } : {}),
      ...(item.source === 'place' && (savedNow[`${viewerScope}:${placeKey(item)}`] ?? !!mySaved?.has(placeKey(item))) ? { saved: true } : {}) };
  }), [pins, savesOf, tr, savedNow, viewerScope, mySaved]);
  const liveMarkers = useLiveMarkers(liveOn ? live.map : null, now, showBubbles, city.id);
  const meetupMarkers = useMeetupMarkers(city.id, viewerScope, now, meetupsOn && showMeetups && isFocused);
  // The map takes at most 500 pins; bubbles and meetups come first so a full city never pushes them out.
  const mapMarkers = useMemo(() => [...liveMarkers, ...meetupMarkers, ...markers].slice(0, 500), [liveMarkers, meetupMarkers, markers]);
  const more = scope === 'all' && current && !limited && (!top25Only || top25Ready) && (current.postMore || current.eventMore);
  const open = useCallback((item: DiscoveryItem) => {
    play('selection');
    if (item.merchantId && !onClose) { router.push({ pathname: '/company/[id]', params: { id: item.merchantId } }); return; }
    if (onClose) {
      const source = (item.merchantId ? publicCompanyUrl(item.merchantId) : null) ?? item.place?.sourceUrl ?? (item.event ? safeTicketUrl(item.event.ticketUrl) : null) ?? item.top25?.sourceUrl
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
  }, [play, onClose, router, tr, city.id]);
  const selectPin = (id: string) => {
    if (id.startsWith('bubble:')) { const bubbleId = id.slice('bubble:'.length); play('selection'); setLiveOpen(live.map?.mine?.id === bubbleId ? { kind: 'compose', session: Date.now() } : { kind: 'request', bubbleId }); return; }
    if (id.startsWith('meetup:')) { play('selection'); router.push({ pathname: '/post/[id]', params: { id: id.slice('meetup:'.length) } }); return; }
    locationRevision.current++; setLocating(false); setLocationError(''); setSelectedId(id); setCenter(null); setSheet('closed');
  };
  const chooseCity = (id: string) => {
    const next = CITIES.find(value => value.id === id && value.state === 'open');
    if (!next) return;
    if (routeCityId && !onClose) router.setParams({ cityId: next.id }); else void selectCity(next);
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
      // No ring (owner 2026-11-08): the map gliding to the dot is the answer, and the list's own lookup was never a tap.
      setSelectedId(null); setCenter({ latitude: fix.latitude, longitude: fix.longitude, requestId: revision });
    } catch (error) {
      if (revision !== locationRevision.current) return;
      play('warning'); setLocationError(error instanceof Error && error.message === 'PERMISSION' ? "위치 권한이 꺼져 있어요. 선택한 도시의 지도는 계속 볼 수 있어요." : "현재 위치를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally { if (timer) clearTimeout(timer); if (revision === locationRevision.current) setLocating(false); }
  };
  // Opening the list from its own buttons asks for location once, as the full-screen list did; a category tap only raises it.
  const showList = (snap: SheetSnap) => { play('selection'); setSelectedId(null); setSheet(snap); if (!userLocation) void locate(); };
  const showMap = () => { play('selection'); setSheet('closed'); };
  const toggleFilter = (value: DiscoveryFilter) => {
    play('selection'); setBump(current => ({ id: value, n: current.n + 1 }));
    if (value !== 'all' && !selectedFilters.includes(value) && !filtersOpen && (sheet === 'closed' || sheet === 'peek')) { setSelectedId(null); setSheet('half'); }
    setSubcategories([]);
    if (value === 'all' || !selectedFilters.includes(value)) setRevealedFilter(value);
    setSelectedFilters(current => value === 'all' ? [] : current.includes(value) ? current.filter(id => id !== value) : [...current, value]); setSortBy(value => value === 'saves' ? value : 'near');
    setDateFilter(null); setDate(''); setDateOpen(false); setDateError('');
  };
  const chooseDate = (value: DiscoveryDate) => {
    play('selection'); animateLayout(reduced); // The date field below fades in or out instead of jumping.
    if (value === 'date') { setDateDraft(date || discoveryDays('today', city.id)[0]); setDateError(''); setDateOpen(true); }
    else { setDateFilter(value); setDateOpen(false); setDateError(''); }
  };
  const closeFilters = () => { play('selection'); setFiltersOpen(false); setDateOpen(false); setDateError(''); };
  const scopeName = scope === 'mine' ? '내가 저장한 곳' : scope === 'friends' ? '친구가 저장한 곳' : '모두';
  const chipBackground = sheet !== 'full' && !filtersOpen ? `${theme.backgroundElement}C7` : theme.backgroundElement;
  const filterChip = (value: typeof filters[number]) => {
    const selected = value.id === 'all' ? !selectedFilters.length : selectedFilters.includes(value.id);
    // Visited's picture already carries the gling logo (owner pick 2026-11-04), so the name under it is just "Visited".
    return artChip({ id: value.id, label: value.id === 'visited' ? 'Visited' : tr(value.label), accessibilityLabel: tr(value.label), selected, analyticsId: 'discovery.filter', onPress: () => toggleFilter(value.id), ink: value.id === 'top25' ? top25Ink : undefined, onLayout: filterRow.chip(value.id) });
  };
  // A chip with a 3D picture is just the picture and its name, no chip behind (owner 2026-11-04, mockup ⑪): the chosen one lifts and its name fills.
  // A setting (보여 줄 곳) only gets a purple outline on the card color, so it never reads as a chosen category.
  // Every name sits on the card color so map labels never run into it (owner 2026-11-04 "글이 백그라운드가없으니 지도에 뜨는 글과 겹쳐서").
  const artChip = ({ id, label, selected, analyticsId, onPress, accessibilityLabel = label, expanded, outline, size = 40, ink = theme.text, onLayout }: { id: string; label: string; selected: boolean; analyticsId: string; onPress: () => void; accessibilityLabel?: string; expanded?: boolean; outline?: boolean; size?: number; ink?: string; onLayout?: ReturnType<typeof filterRow.chip> }) =>
    <Pressable key={id} analyticsId={analyticsId} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={expanded === undefined ? { selected } : { selected, expanded }}
      onPress={onPress} onLayout={onLayout} style={({ pressed }) => [styles.artChip, { opacity: pressed ? 0.82 : 1 }]}>
      <View style={selected ? styles.artLift : null}><CategoryIcon id={id} size={size} play={bump.id === id ? bump.n : 0} /></View>
      <ThemedText numberOfLines={1} style={[styles.artLabel, !selected ? { color: ink, backgroundColor: `${theme.card}F0` }
        : outline ? { backgroundColor: theme.card, borderWidth: 1.5, borderColor: theme.accent, color: theme.accent } : { backgroundColor: theme.accent, color: theme.accentInk }]}>{label}</ThemedText>
    </Pressable>;
  const quickFilters = <>
    <ScrollView horizontal analyticsId="discovery.filter" {...filterRow.scroll} showsHorizontalScrollIndicator={false} style={[styles.filterRow, styles.artRow]} contentContainerStyle={[styles.filters, styles.artRowItems]}>
      {artChip({ id: 'scope', label: `${tr(scope === 'all' ? '보여 줄 곳' : scopeName)} ⌄`, selected: scope !== 'all', outline: true, expanded: scopeOpen, analyticsId: 'discovery.scope',
        accessibilityLabel: tr('보여 줄 곳, {0}', tr(scopeName)), onPress: () => { play('selection'); setScopeOpen(true); } })}
      {liveOn && artChip({ id: 'bubble', label: tr('말풍선'), selected: showBubbles, analyticsId: 'livemap.filter', onPress: () => { play('selection'); setShowBubbles(value => !value); } })}
      {meetupsOn && artChip({ id: 'events', label: tr('근처 모임'), selected: showMeetups, analyticsId: 'livemap.filter',
        onPress: () => { play('selection'); setBump(value => ({ id: 'events', n: value.n + 1 })); setShowMeetups(value => !value); } })}
      {filterChip(filters[0])}
      {artChip({ id: 'open', label: tr('지금 영업 중'), selected: openNow, analyticsId: 'discovery.open-now', onPress: () => { play('selection'); setOpenNow(value => !value); setShowUnknown(false); } })}
      {(['visited', 'top25', 'delivery', 'dining', 'cafe', 'festival', 'nightlife', 'places', 'housing', 'used'] as const).map(id => filterChip(filters.find(value => value.id === id)!))}
    </ScrollView>
    {Object.hasOwn(EVENT_CITIES, city.id) && eventCategory && <ScrollView horizontal analyticsId="discovery.date" showsHorizontalScrollIndicator={false} style={styles.eventDateRow} contentContainerStyle={styles.eventDates}>
      <ThemedText type="small" themeColor="textSecondary" style={[styles.mapDateLabel, { backgroundColor: chipBackground }]}>{tr('행사 날짜')}</ThemedText>
      {([{ id: 'today', label: tr('오늘') }, { id: 'week', label: tr('다가오는 7일') }, { id: 'weekend', label: tr('이번 주말') }] as const).map(value => <Pressable key={value.id} analyticsId="discovery.date" accessibilityRole="button" accessibilityState={{ selected: dateFilter === value.id }} onPress={() => chooseDate(value.id)} style={[styles.dateChip, { borderColor: dateFilter === value.id ? theme.accent : theme.line, backgroundColor: dateFilter === value.id ? theme.accent : chipBackground }]}><ThemedText type="smallBold" style={{ color: dateFilter === value.id ? theme.accentInk : theme.text }}>{value.label}</ThemedText></Pressable>)}
      {(dateFilter === 'all' || dateFilter === 'date') && <Pressable analyticsId="discovery.date" accessibilityRole="button" accessibilityLabel={tr('행사 날짜 변경')} onPress={() => { play('selection'); setFiltersOpen(true); }} style={[styles.dateChip, { borderColor: theme.accent, backgroundColor: chipBackground }]}><ThemedText type="smallBold" themeColor="accent">{dateFilter === 'all' ? tr('행사 · 전체 날짜') : date}</ThemedText></Pressable>}
    </ScrollView>}
  </>;
  const chooseNearest = () => { play('selection'); setSortBy('near'); if (!userLocation) void locate(); };
  const chooseDiscount = () => { play('selection'); setSortBy('discount'); };
  const chooseSaves = () => { play('selection'); setSortBy('saves'); };
  const cardShown = !!selected && located(selected) && cardOpen;
  const dockShown = liveOn && showBubbles && sheet === 'closed' && !cardShown, dockSpace = dockShown ? Math.min(dockHeight + 12, 400) : 0;
  // One floating row above the dock or place card: the list pill, the map credits (ⓘ, drawn by the map at this inset) and the card toggle share it (owner 691cf630 "정렬좀 잘해줘").
  // Cards, the list row and the ⓘ share a 20pt side line, close to the iOS 26 tab bar's edge.
  const rowBottom = cardShown ? Math.min(cardHeight + 24, 1000) : 12 + dockSpace;
  // M2 (owner 2026-11-05): the open card saves with the place screen's own 가 보고 싶어요/가 봤어요 sheet, read only while the card shows.
  // 가 봤어요 then opens the place for its review, except in the chat sheet where that page would open behind it. A confirmed state also moves the pin mark (M5).
  const cardPlace = cardShown ? selected.place : undefined;
  const savedEntry = useSavedEntry(cardPlace ? { kind: 'place', id: cardPlace.id, cityId: cardPlace.cityId } : null, !!cardPlace);
  // What the card just confirmed wins over the read made when the map opened; marks are kept per account so a sign-in switch never shows the last person's saves.
  const cardMark = `${viewerScope}:${cardPlace?.id}`, cardSaved = savedEntry.state?.saved;
  if (cardPlace && cardSaved !== undefined && savedNow[cardMark] !== cardSaved) setSavedNow(current => ({ ...current, [cardMark]: cardSaved }));
  const saveButton = cardPlace && <SavedEntryButton entry={savedEntry} kind="place" analyticsId="save.place"
    onBeen={onClose ? undefined : () => router.push({ pathname: '/places/[id]', params: { id: cardPlace.id, cityId: cardPlace.cityId, review: '1' } })} />;
  const listShown = sheet === 'half' || sheet === 'full';
  // Sheet stops are its top edge inside the map area: under the floating chips when full, half way, or only its summary.
  const sheetStops = { full: mapFiltersHeight, half: Math.max(mapFiltersHeight, Math.round(contentHeight * 0.5)), peek: Math.max(mapFiltersHeight, contentHeight - 96), closed: contentHeight };
  const sheetCover = sheet === 'closed' ? 0 : Math.min(Math.max(contentHeight - sheetStops[sheet], 0), 1000);
  const sortLabel = discountOrder ? tr('할인율 높은 순') : savesOrder ? tr('저장 많은 순') : locating ? tr('위치 확인 중') : userLocation ? tr('가까운 순') : tr('위치 사용 필요');
  const refine = items.length || loading || deliveryUnavailable || current?.errors.length ? null
    : activePrices.length ? { title: tr('이 가격대에 맞는 곳이 없어요'), action: tr('가격 필터 풀기'), clear: () => setPriceLevels([]) }
    : activeSubcategories.length ? { title: tr('고른 분류에 맞는 곳이 없어요'), action: tr('세부 분류 풀기'), clear: () => setSubcategories([]) }
    : activeStatus ? { title: tr(PLACE_STATUS[activeStatus].empty), action: tr('{0} 필터 풀기', tr(PLACE_STATUS[activeStatus].label)), clear: () => setStatusFilter(null) }
    : region ? { title: tr('이 지역에는 조건에 맞는 곳이 없어요'), action: tr('도시 전체 보기'), clear: () => setRegion(null) }
    : openNow ? { title: tr('지금 영업 중인 곳이 없어요'), action: tr('영업 중 필터 끄기'), clear: () => setOpenNow(false) } : null;
  // An empty saved scope says why first: signed out, no friends yet, or nothing saved in this city.
  const scopeCard = scope === 'all' || loading || scopedItems.length ? null
    : !isAuthed ? <StateCard analyticsId="discovery.scope.empty" title={tr('로그인하면 저장한 곳이 지도에 떠요')} body={tr('내가 저장한 곳과 친구가 저장한 곳을 한 지도에서 같이 볼 수 있어요.')}
      actionLabel={tr('로그인')} onAction={() => promptLogin(tr('로그인하면 저장한 곳이 지도에 떠요'))} />
    : !scopeData?.value ? <StateCard kind="error" analyticsId="discovery.scope.empty" title={tr('저장한 곳을 불러오지 못했어요')} body={tr('연결을 확인하고 다시 시도해 주세요.')} actionLabel={tr('다시 시도')} onAction={refresh} />
    : scope === 'friends' && scopeData.value.friendCount === 0 ? <StateCard analyticsId="discovery.scope.empty" title={tr('아직 친구가 없어요')} body={tr('이웃 프로필에서 친구를 맺으면 그 친구가 저장한 곳이 여기에 모여요.')}
      actionLabel={tr('친구 목록 보기')} onAction={() => router.push('/profile/friends')} />
    : <StateCard analyticsId="discovery.scope.empty" title={scope === 'friends' ? tr('친구가 저장한 곳이 아직 없어요') : tr('아직 저장한 곳이 없어요')}
      body={scope === 'friends' ? tr('친구가 이 도시에서 장소를 저장하면 여기에 떠요.') : tr('지도에서 마음에 드는 곳을 저장하면 여기에 모여요.')} actionLabel={tr('모두 보기')} onAction={() => setScope('all')} />;
  const refineCard = scopeCard || refine && <StateCard kind="empty" title={refine.title} body={unknownItems.length ? tr('영업시간을 모르는 곳은 목록 맨 아래에 모아 뒀어요.') : tr('필터를 풀면 다른 곳도 보여요.')} actionLabel={refine.action} onAction={refine.clear} />;
  const priceChip = priceReady && <SelectionChip key="price" selected={activePrices.length > 0} baseColor={theme.backgroundElement} analyticsId="discovery.price" accessibilityRole="button"
    accessibilityLabel={activePrices.length ? tr('가격 {0}, 바꾸기', priceLabel(activePrices)) : tr('가격 필터')} accessibilityState={{ selected: activePrices.length > 0, expanded: priceDraft !== null }}
    onPress={() => { play('selection'); setPriceDraft(activePrices); }} style={[styles.chip, { borderColor: activePrices.length ? theme.accent : theme.line }]}>
    <ThemedText type="smallBold" style={{ color: activePrices.length ? theme.accentInk : theme.text }}>{activePrices.length ? priceLabel(activePrices) : tr('가격')} ⌄</ThemedText>
  </SelectionChip>;
  const subcategoryChip = (option: typeof PLACE_SUBCATEGORIES[number]) => {
    const on = activeSubcategories.includes(option.id);
    return artChip({ id: option.id, label: tr(option.label), selected: on, size: 32, analyticsId: 'discovery.subcategory',
      onPress: () => { play('selection'); setSubcategories(value => value.includes(option.id) ? value.filter(id => id !== option.id) : [...value, option.id]); } });
  };
  // shortcut: reuses the registered 'discovery.subcategory' target since a new one must reach the server before the app; register 'discovery.status' when a migration ships.
  const statusChip = (id: PlaceStatus) => {
    const on = activeStatus === id, label = tr(PLACE_STATUS[id].label);
    return <SelectionChip key={id} selected={on} baseColor={theme.backgroundElement} analyticsId="discovery.subcategory" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }}
      onPress={() => { play('selection'); setStatusFilter(on ? null : id); }} style={[styles.chip, { borderColor: on ? theme.accent : theme.line }]}>
      <View style={[styles.dot, { backgroundColor: PLACE_STATUS[id].color }]} /><ThemedText type="smallBold" style={{ color: on ? theme.accentInk : theme.text }}>{label}</ThemedText>
    </SelectionChip>;
  };
  const sortRow = <View style={styles.sortRow}>
    {deliveryOnly || savesReady ? ([['near', tr('가까운 순')], ...(deliveryOnly ? [['discount', tr('할인율 높은 순')]] : []), ...(savesReady ? [['saves', tr('저장 많은 순')]] : [])] as const).map(([key, label]) => <SelectionChip key={key} analyticsId="discovery.current" selected={order === key} baseColor={theme.backgroundElement} disabled={key === 'discount' && !hasVerifiedDiscount}
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: order === key, disabled: key === 'discount' && !hasVerifiedDiscount }}
      onPress={key === 'near' ? chooseNearest : key === 'discount' ? chooseDiscount : chooseSaves} style={[styles.sortChip, { borderColor: order === key ? theme.accent : theme.line }]}>
      <ThemedText type="smallBold" style={{ color: order === key ? theme.accentInk : theme.text }}>{label}</ThemedText></SelectionChip>) : <ThemedText type="smallBold">{tr('가까운 순')}</ThemedText>}
    {!userLocation && <Pressable analyticsId="discovery.current" accessibilityRole="button" accessibilityLabel={tr('내 위치 사용')} disabled={locating} onPress={() => { play('selection'); void locate(); }} style={[styles.sortChip, clay ? styles.sortChipClay : { borderColor: theme.line }]}>
      {clay && <ClayPillFill kind="white" />}<ThemedText type="small">{locating ? tr('위치 확인 중') : tr('내 위치 사용')}</ThemedText></Pressable>}
    <ThemedText type="caption" themeColor="textSecondary">{userLocation ? tr('내 위치 기준 · 직선거리') : tr('위치를 켜면 가까운 순으로 정렬해요')}</ThemedText>
    {deliveryOnly && registry.ready && !registry.failed && !hasVerifiedDiscount && <ThemedText type="caption" themeColor="textSecondary">{tr('아직 할인율을 확인한 가게가 없어요')}</ThemedText>}
  </View>;
  // Owner 2026-11-05 "메인칩셋아래에 서브칩들": this row sits right under the big chips, so it shows without opening the list.
  const refineRow = (!!priceChip || statusOptions.length > 0 || subcategoryOptions.length > 0) && <ScrollView horizontal analyticsId="discovery.subcategory" showsHorizontalScrollIndicator={false} style={[styles.filterRow, styles.artRow]} contentContainerStyle={[styles.filters, styles.artRowItems]}>{priceChip}{statusOptions.map(statusChip)}{subcategoryOptions.map(subcategoryChip)}</ScrollView>;
  const sheetHeader = <>
    <View style={styles.sheetSummary}>
      <View style={styles.flex}>
        <ThemedText type="smallBold" accessibilityRole="header" accessibilityLiveRegion="polite">{tr(limited ? '목록 {0}개+' : '목록 {0}개', items.length)}{region ? ` · ${tr('이 지역')}` : ''}</ThemedText>
        <ThemedText type="caption" themeColor="accent">{sortLabel}</ThemedText>
      </View>
      <Pressable analyticsId="discovery.mode" accessibilityRole="button" accessibilityLabel={tr('목록 닫기')} onPress={showMap} style={styles.icon}><SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={IconSize.inline} tintColor={theme.textSecondary} /></Pressable>
    </View>
    {sortRow}
  </>;
  const unknownRow = useMemo(() => openNow && unknownItems.length > 0 && <Pressable analyticsId="discovery.unknown-hours" accessibilityRole="button" accessibilityState={{ expanded: showUnknown }}
    onPress={() => { play('selection'); animateLayout(reduced); setShowUnknown(value => !value); }} style={[styles.unknownRow, { borderColor: theme.line }]}>
    <ThemedText type="smallBold" style={styles.flex}>{tr('영업시간을 모르는 곳 {0}곳', unknownItems.length)}</ThemedText>
    <SymbolView name={showUnknown ? { ios: 'chevron.up', android: 'expand_less', web: 'expand_less' } : { ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }} size={IconSize.inline} tintColor={theme.textSecondary} />
  </Pressable>, [openNow, unknownItems.length, showUnknown, theme, reduced, play, tr]);
  // One card renderer while the cards' inputs stay the same, so a pan or a layout pass does not redraw every mounted card (map lag 2026-11-11).
  const renderCard = useCallback(({ item, index }: { item: DiscoveryItem; index: number }) => <>{showUnknown && index === items.length && unknownRow}<View style={[styles.listCard, clayBox ? styles.listCardClay : { backgroundColor: theme.card, borderColor: theme.line }]}>{clayBox && <ClayBoxFill kind="tile" />}<DiscoveryCard item={item} now={now} distance={discoveryDistanceKm(item, userLocation)} externalInfo={!!onClose} translationVisible={visibleResultIds.has(item.id)} viewerScope={viewerScope} savedBy={scopePlaces?.get(placeKey(item))} saves={savesOf(item)} onOpen={() => open(item)} /><GlingVisitNote item={item} />{orderButton(item)}{located(item) && <Directions item={item} />}</View>{adsSupported && !loading && !current?.errors.length && !selectedFilters.includes('top25') && index === 3 && contentAdPosition(index, items.length) && <FeedAd key={`ad-after-${item.id}`} surface="map" />}</>,
    [showUnknown, items.length, unknownRow, clayBox, theme, now, userLocation, onClose, visibleResultIds, viewerScope, scopePlaces, savesOf, open, orderButton, loading, current?.errors.length, selectedFilters]);
  const searchHere = !!moved && moved.bounds !== region && (moved.zoom ?? FAR_ZOOM) >= FAR_ZOOM && sheet !== 'full' && !cardShown;
  // As a tab there is no back button; the bottom edge already stops above the tab bar (iOS inset includes it, Android content ends at it).
  // The route opened from a list wears the shared round-back bar (owner 2026-11-04 "위쪽: 동그란 뒤로 + 가운데 제목"); the tab and the chat sheet keep their own row.
  const routeHeader = !tab && !onClose;
  const headerActions = <>{sheet === 'full' && <Pressable analyticsId="discovery.refresh" accessibilityRole="button" accessibilityLabel={tr("지도 결과 새로고침")} onPress={() => { play('selection'); refresh(); }} style={styles.icon}><SymbolView name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }} size={21} tintColor={theme.text} /></Pressable>}
      <Pressable analyticsId="discovery.mode" accessibilityRole="button" accessibilityLabel={listShown ? tr("지도 보기") : tr("리스트 보기")} onPress={() => listShown ? showMap() : showList('full')} style={styles.icon}><ClayIcon clay={listShown ? 'map' : 'list'} claySize={28} name={listShown ? { ios: 'map', android: 'map', web: 'map' } : { ios: 'list.bullet', android: 'format_list_bulleted', web: 'format_list_bulleted' }} size={21} tintColor={theme.text} /></Pressable></>;
  return <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={routeHeader ? ['bottom', 'left', 'right'] : ['top', 'bottom', 'left', 'right']}>
    {routeHeader ? <PageHeader title={tr('{0} 지도', tr(city.name))} analyticsId="discovery.back" right={<View style={styles.headerActions}>{headerActions}</View>} />
    : <View style={[styles.header, tab && styles.tabHeader]}>
      {!tab && <Pressable analyticsId="discovery.back" accessibilityRole="button" accessibilityLabel={tr("지도를 닫고 이전 화면으로")} onPress={() => { play('selection'); if (onClose) onClose(); else if (router.canGoBack()) router.back(); else router.replace('/'); }} style={styles.icon}><SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={21} tintColor={theme.text} /></Pressable>}
      {/* M6 (owner 2026-11-05): the title opens the same city picker as the home screen; the small arrow says it can be pressed.
        shortcut: reuses the registered 'discovery.open' target (the home map button removed 2026-11-01) since new targets need a migration; register 'discovery.city' when one ships. */}
      <View style={styles.heading}><Pressable analyticsId="discovery.open" accessibilityRole="button" accessibilityLabel={tr('{0} 지도, 도시 바꾸기', tr(city.name))} accessibilityState={{ expanded: cityOpen }}
        onPress={() => { play('selection'); setCityOpen(true); }} style={[styles.titleButton, clay && styles.titleButtonClay]}>
        {clay && <ClayPillFill kind="white" />}
        <ThemedText numberOfLines={1} style={[styles.title, styles.titleText, clay && styles.titleTextClay]}>{tr('{0} 지도', tr(city.name))}</ThemedText>
        <ClayIcon clay="chevron" name={{ ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' }} size={IconSize.chevron} tintColor={theme.textSecondary} />
      </Pressable></View>
      {headerActions}
    </View>}
    <View style={[styles.search, { backgroundColor: theme.backgroundElement, borderColor: theme.line }]}>
      {onClose ? <>
      <ClayIcon clay="search" claySize={24} name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={18} tintColor={theme.textSecondary} />
      <TextInput value={query} onChangeText={setQuery} onFocus={() => play('selection')} placeholder={tr("등록된 장소·매물·행사 검색")} accessibilityLabel={tr("등록된 장소 매물 행사 검색")} placeholderTextColor={theme.textSecondary} maxLength={100} returnKeyType="search" style={[styles.input, { color: theme.text }]} />
      </> : <Pressable analyticsId="search.entry.map" accessibilityRole="button" accessibilityLabel={searchLabel} onPress={() => { play('selection'); router.push({ pathname: '/search', params: { cityId: city.id, ...(query ? { query } : {}) } }); }} style={({ pressed }) => [styles.unifiedSearch, { opacity: pressed ? 0.82 : 1 }]}>
        <ClayIcon clay="search" claySize={24} name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={18} tintColor={theme.textSecondary} /><ThemedText style={styles.unifiedSearchText} themeColor={query ? 'text' : 'textSecondary'}>{query || searchLabel}</ThemedText>
      </Pressable>}
      {!!query && <Pressable analyticsId="discovery.search" accessibilityRole="button" accessibilityLabel={tr("검색어 지우기")} onPress={() => { play('selection'); setQuery(''); }} style={styles.icon}><ThemedText>×</ThemedText></Pressable>}
      <Pressable analyticsId="discovery.filter" accessibilityRole="button" accessibilityLabel={tr("분류와 날짜 필터 열기")} accessibilityState={{ expanded: filtersOpen }} onPress={() => { play('selection'); setFiltersOpen(true); }} style={styles.icon}>
        <ClayIcon clay="sliders" claySize={28} name={{ ios: 'slider.horizontal.3', android: 'tune', web: 'tune' }} size={21} tintColor={selectedFilters.length || dateFilter !== 'all' ? theme.accent : theme.text} />
        {(selectedFilters.length > 0 || dateFilter !== 'all') && <View style={[styles.filterDot, { backgroundColor: theme.accent }]} />}
      </Pressable>
    </View>
    {deliveryUnavailable && <StateCard kind="error" title={tr('웹샵 할인 정보를 불러오지 못했어요')} body={tr('연결을 확인하고 다시 시도해주세요. 가게의 기존 정보는 계속 볼 수 있어요.')} actionLabel={tr('다시 시도')} onAction={() => { play('selection'); refresh(); }} />}
    {!!locationError && <ThemedText accessibilityRole="alert" type="small" style={styles.notice}>{tr(locationError)}</ThemedText>}
    {!!current?.errors.length && <View style={styles.notice}><ThemedText type="small" accessibilityRole="alert">{current.errors.map(error => tr(error)).join(' ')} {tr("새로고침으로 다시 시도할 수 있어요.")}</ThemedText></View>}
    <View style={styles.content} onLayout={event => setContentHeight(event.nativeEvent.layout.height)}>
      <DiscoveryMap markers={mapMarkers} cityName={city.englishName} cities={CITIES.map(value => ({ id: value.id, name: tr(value.name), englishName: value.englishName, open: value.state === 'open' }))} selectedId={selected?.id} center={center} userLocation={userLocation} compass={compass} topInset={mapFiltersHeight}
        bottomInset={cardShown || sheet === 'closed' ? rowBottom : sheetCover} onSelect={selectPin} onMoved={(bounds, zoom) => setMoved({ bounds, zoom })} onCity={chooseCity} />
      <View testID="map-filter-overlay" pointerEvents="box-none" onLayout={event => setMapFiltersHeight(event.nativeEvent.layout.height)} style={sheet === 'full' ? [styles.mapFilters, { backgroundColor: theme.background }] : styles.mapFilters}>
        {/* Map labels stop running into the chip names (owner 2026-11-06 "칩 줄 뒤에 옅은 그라데이션"); the chips themselves stay as they are. */}
        {sheet !== 'full' && <View pointerEvents="none" style={[styles.mapFiltersFade, { backgroundImage: `linear-gradient(to bottom, ${theme.background}F2 0%, ${theme.background}B3 ${refineRow ? 80 : 62}%, ${theme.background}00 100%)` }]} />}
        {quickFilters}
        {refineRow}
      </View>
      <View style={[styles.mapControls, { top: mapFiltersHeight + 12 }]}>
        <Pressable analyticsId="discovery.current" accessibilityRole="button" accessibilityLabel={locating ? tr("현재 위치 확인 중") : tr("내 위치로 지도 이동")} disabled={locating} onPress={() => { play('selection'); void locate(); }} style={[styles.mapControl, { backgroundColor: clayBox ? 'transparent' : theme.card, borderColor: clayBox ? 'transparent' : theme.line }]}>{clayBox && <ClayBoxFill kind="tile" />}{locating ? <GlingLoader size={12} accessibilityLabel={tr("현재 위치 확인 중")} /> : <ClayIcon clay="locate" claySize={24} name={{ ios: 'location', android: 'my_location', web: 'my_location' }} size={21} tintColor={theme.text} />}</Pressable>
        <Pressable analyticsId="discovery.refresh" accessibilityRole="button" accessibilityLabel={tr("지도 결과 새로고침")} onPress={() => { play('selection'); refresh(); }} style={[styles.mapControl, { backgroundColor: clayBox ? 'transparent' : theme.card, borderColor: clayBox ? 'transparent' : theme.line }]}>{clayBox && <ClayBoxFill kind="tile" />}<ClayIcon clay="refresh" claySize={24} name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }} size={21} tintColor={theme.text} /></Pressable>
      </View>
      {searchHere && <Pressable analyticsId="discovery.search-here" accessibilityRole="button" onPress={() => { play('selection'); setRegion(moved.bounds); setSelectedId(null); }}
        style={({ pressed }) => [styles.searchHere, { top: mapFiltersHeight + 12, backgroundColor: theme.card, borderColor: theme.line, opacity: pressed ? 0.82 : 1 }]}>
        <SymbolView name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }} size={IconSize.inline} tintColor={theme.accent} />
        <ThemedText type="smallBold" themeColor="accent">{tr('이 지역에서 다시 찾기')}</ThemedText>
      </Pressable>}
      {sheet === 'closed' && <Pressable ref={listClear} analyticsId="discovery.mode" accessibilityRole="button" accessibilityLabel={tr("리스트 보기")} onPress={() => showList('half')} style={[styles.listLink, { backgroundColor: clay ? 'transparent' : theme.card, borderColor: clay ? 'transparent' : theme.line, bottom: rowBottom }]}>{clay && <ClayPillFill kind="white" />}<ClayIcon clay="list" claySize={24} name={{ ios: 'list.bullet', android: 'format_list_bulleted', web: 'format_list_bulleted' }} size={18} tintColor={theme.text} /><View style={styles.listLinkText}><ThemedText type="smallBold" accessibilityLiveRegion="polite">{tr(limited || more ? '목록 {0}개+' : '목록 {0}개', items.length)}</ThemedText><ThemedText type="caption" themeColor="accent">{sortLabel}</ThemedText></View></Pressable>}
      {cardShown ? <Reanimated.View entering={reduced ? undefined : SlideInDown.duration(ControlMotion.expandMs)} exiting={reduced ? undefined : SlideOutDown.duration(ControlMotion.sheetCloseMs)}
        onLayout={event => setCardHeight(event.nativeEvent.layout.height)} style={[styles.selected, { backgroundColor: theme.card, borderColor: theme.line }]}>
          <ScrollView analyticsId="discovery.detail" accessibilityLabel={tr("선택한 장소 상세, 스크롤로 더 보기")} style={styles.selectedScroll} contentContainerStyle={styles.selectedContent}>
            <View style={styles.cardRow}><View style={styles.flex}><DiscoveryCard item={selected} now={now} distance={discoveryDistanceKm(selected, userLocation)} externalInfo={!!onClose} viewerScope={viewerScope} savedBy={scopePlaces?.get(placeKey(selected))} saves={savesOf(selected)} onOpen={() => open(selected)} /></View>{saveButton}</View>
            {!!savedEntry.error && <ThemedText type="small" accessibilityRole="alert">{savedEntry.error}</ThemedText>}<Top25Note item={selected} /><GlingVisitNote item={selected} /></ScrollView>{orderButton(selected)}<Directions item={selected} reserveFromBusiness />
      </Reanimated.View>
        : sheet === 'closed' && !loading && !deliveryUnavailable && items.length === 0 && <View style={[styles.mapEmpty, { bottom: rowBottom }]}>{refineCard || <StateCard kind={current?.errors.length ? 'error' : 'empty'} title={current?.errors.length ? tr("결과를 불러오지 못했어요") : visitedOnly ? visitedReady ? tr("조건에 맞는 글링 방문 장소가 없어요") : tr("아직 글링이 방문한 장소가 없어요") : top25Only ? top25Ready ? tr("조건에 맞는 TOP 50 장소가 없어요") : tr("이 도시의 TOP 50을 준비하고 있어요") : deliveryOnly ? tr("아직 배달 할인 가게가 없어요") : tr("아직 표시할 공개 위치가 없어요")} body={current?.errors.length ? tr("연결을 확인하고 다시 시도해 주세요.") : visitedOnly ? visitedReady ? tr("검색어나 분류를 바꾸면 다른 장소를 볼 수 있어요.") : tr("직접 다녀온 장소만 모아 보여드려요. 다른 분류에서 먼저 둘러보세요.") : top25Only ? tr("검색어나 분류를 바꾸면 다른 장소를 볼 수 있어요.") : deliveryOnly ? tr("가게가 직접 받는 주문 페이지를 준비하고 있어요.") : tr("직접 첨부한 핀과 위치가 확인된 행사만 지도에 표시해요.")} actionLabel={current?.errors.length ? tr("다시 시도") : visitedOnly ? tr("전체 장소 보기") : tr("리스트 보기")} onAction={current?.errors.length ? refresh : visitedOnly ? () => { setSelectedFilters([]); setRevealedFilter('all'); setDateFilter(null); setDate(''); } : () => showList('half')} />}</View>}
      {selected && located(selected) && <Pressable analyticsId="discovery.detail" accessibilityRole="button" accessibilityLabel={cardOpen ? tr('장소 카드 접기') : tr('장소 카드 펼치기')} accessibilityState={{ expanded: cardOpen }} onPress={() => { play('selection'); setClosedCardId(cardOpen ? selectedId : undefined); }} style={[styles.cardToggle, { backgroundColor: theme.card, borderColor: theme.line, bottom: rowBottom + 6 }]}>
        <SymbolView name={cardOpen ? { ios: 'chevron.down', android: 'expand_more', web: 'expand_more' } : { ios: 'chevron.up', android: 'expand_less', web: 'expand_less' }} size={IconSize.toolbar} tintColor={theme.text} />
      </Pressable>}
      {dockShown && <View style={styles.liveDock} onLayout={event => setDockHeight(event.nativeEvent.layout.height)}>
        <LiveDock map={live.map!} demo={live.demo} now={now} onCompose={() => setLiveOpen({ kind: 'compose', session: Date.now() })} onReceived={requestId => setLiveOpen({ kind: 'received', requestId })} />
      </View>}
      <MapListSheet snap={cardShown ? 'closed' : sheet} positions={sheetStops} onSnap={setSheet} header={sheetHeader}>
        <FlatList analyticsId="discovery.list" refreshing={false} onRefresh={() => { play('selection'); refresh(); }} onViewableItemsChanged={trackTranslationResults} viewabilityConfig={CONTENT_TRANSLATION_VIEWABILITY} data={listData} keyExtractor={item => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: 24 + Math.max(sheetStops[sheet] - sheetStops.full, 0) }]}
          ListHeaderComponent={<ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">{tr('지도 {0}개 · 목록 {1}개', pins.length, items.length)}{limited ? tr(" · 500개까지 표시") : ''}</ThemedText>}
          renderItem={renderCard}
          ListEmptyComponent={loading || deliveryUnavailable ? undefined : refineCard || <StateCard kind={current?.errors.length ? 'error' : 'empty'} title={current?.errors.length ? tr("결과를 불러오지 못했어요") : visitedOnly ? visitedReady ? tr("조건에 맞는 글링 방문 장소가 없어요") : tr("아직 글링이 방문한 장소가 없어요") : top25Only ? top25Ready ? tr("조건에 맞는 TOP 50 장소가 없어요") : tr("이 도시의 TOP 50을 준비하고 있어요") : deliveryOnly ? tr("아직 배달 할인 가게가 없어요") : tr("조건에 맞는 항목이 없어요")} body={current?.errors.length ? tr("연결을 확인하고 다시 시도해 주세요.") : visitedOnly ? visitedReady ? tr("검색어나 분류를 바꾸면 다른 장소를 볼 수 있어요.") : tr("직접 다녀온 장소만 모아 보여드려요. 다른 분류에서 먼저 둘러보세요.") : deliveryOnly ? tr("가게가 직접 받는 주문 페이지를 준비하고 있어요.") : tr("다른 분류나 날짜를 선택해 보세요. 장소 위치는 글을 쓸 때 첨부할 수 있어요.")} actionLabel={current?.errors.length ? tr("다시 시도") : visitedOnly ? tr("전체 장소 보기") : undefined} onAction={current?.errors.length ? refresh : visitedOnly ? () => { setSelectedFilters([]); setRevealedFilter('all'); setDateFilter(null); setDate(''); } : undefined} />}
          ListFooterComponent={<>{!showUnknown && unknownRow}{more && <Pressable analyticsId="discovery.more" accessibilityRole="button" disabled={loading} onPress={() => { if (morePending.current || loading) return; morePending.current = true; play('selection'); loadPage(current); }} style={[styles.more, { borderColor: theme.line }]}><ThemedText themeColor="accent">{loading ? tr("불러오는 중…") : tr("더 보기")}</ThemedText></Pressable>}{limited && <ThemedText type="small" themeColor="textSecondary">{tr("500개까지 표시했어요. 검색어나 분류로 범위를 줄여 주세요.")}</ThemedText>}<ThemedText type="small" themeColor="textSecondary" style={styles.source}>{tr("글링 공개 위치 · 장소 자료: OpenStreetMap · 행사 정보: Ticketmaster")}{items.some(item => !located(item)) ? tr("\n위치 확인 전 항목은 지도 핀 없이 목록에 표시해요.") : ''}</ThemedText></>} />
      </MapListSheet>
      {/* The sheet shows its open-failure line in place once closed; on the map that line floats as a capsule instead of pushing the map. */}
      {webshopOrder && <View pointerEvents="box-none" style={[styles.webshopError, { backgroundColor: theme.card }]}><WebshopComparisonSheet key={webshopOrder.shop.merchantId} client={supabase} shop={webshopOrder.shop} name={webshopOrder.name} origin="map" visible={webshopOrder.open} onClose={() => setWebshopOrder(value => value && { ...value, open: false })} /></View>}
      {loading && <View pointerEvents="none" style={[styles.loading, styles.mapLoading]}><GlingLoader color={theme.accent} accessibilityLabel={tr("지도 결과 불러오는 중")} /></View>}
    </View>
    <Modal visible={filtersOpen} transparent animationType={reduced ? 'none' : 'fade'} onRequestClose={closeFilters}>
      <KeyboardAvoidingView behavior="padding" style={styles.overlay}>
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
          <View style={[styles.sheetActions, { borderColor: theme.line }]}><Pressable analyticsId="discovery.filter" accessibilityRole="button" onPress={() => { play('selection'); setSelectedFilters([]); setRevealedFilter('all'); setDateFilter(null); setDate(''); setDateOpen(false); setDateError(''); }} style={styles.date}><ThemedText>{tr("초기화")}</ThemedText></Pressable><Pressable analyticsId="discovery.filter" accessibilityRole="button" accessibilityLabel={tr("지도 보기")} onPress={() => { if (dateOpen) { try { const selected = discoveryDays('date', city.id, dateDraft)[0]; const today = discoveryDays('today', city.id)[0]; if (selected < today || Date.parse(`${selected}T00:00:00Z`) > Date.parse(`${today}T00:00:00Z`) + 365 * 86400000) throw new Error(); setDate(selected); setDateFilter('date'); } catch { play('warning'); setDateError("오늘부터 1년 안의 날짜를 YYYY-MM-DD로 입력해 주세요."); return; } } play('selection'); setSheet('closed'); setFiltersOpen(false); setDateOpen(false); setDateError(''); }} style={[styles.apply, { backgroundColor: theme.accent }]}><ThemedText type="smallBold" style={{ color: theme.accentInk }}>{tr("지도 보기")}</ThemedText></Pressable></View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
    <Modal visible={cityOpen} animationType={reduced ? 'none' : 'slide'} onRequestClose={() => { play('selection'); setCityOpen(false); }}>
      {/* A Modal is a new native root on iOS, so it needs its own provider for the top inset (same as feed-screen). */}<SafeAreaProvider><SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}><CityPicker onClose={() => setCityOpen(false)} /></SafeAreaView></SafeAreaProvider>
    </Modal>
    {!onClose && <LiveSheets open={liveOpen} onChange={setLiveOpen} city={city} mapCenter={userLocation ?? { latitude: cityLatitude, longitude: cityLongitude }} now={now} />}
    <MapScopeSheet visible={scopeOpen} scope={scope} onClose={() => setScopeOpen(false)} onPick={value => { setScopeOpen(false); setSelectedId(null); setScope(value); }} />
    <DragSheet visible={priceDraft !== null} onClose={() => setPriceDraft(null)} title={tr('가격')}>
      <View style={styles.priceOptions}>{PRICE_LEVELS.map(level => {
        const on = !!priceDraft?.includes(level);
        return <SelectionChip key={level} selected={on} baseColor={theme.backgroundElement} analyticsId="discovery.price" accessibilityRole="button" accessibilityLabel={tr('가격대 {0}단계', level)} accessibilityState={{ selected: on }}
          onPress={() => { play('selection'); setPriceDraft(value => value && (value.includes(level) ? value.filter(other => other !== level) : [...value, level])); }} style={[styles.priceOption, { borderColor: on ? theme.accent : theme.line }]}>
          <ThemedText type="smallBold" style={{ color: on ? theme.accentInk : theme.text }}>{priceSymbol(level)}</ThemedText>
        </SelectionChip>;
      })}</View>
      <ThemedText type="caption" themeColor="textSecondary">{tr('여러 개 같이 고를 수 있어요. 가격 정보가 있는 곳만 남아요.')}</ThemedText>
      <View style={[styles.sheetActions, { borderColor: theme.line }]}>
        <Pressable analyticsId="discovery.price" accessibilityRole="button" onPress={() => { play('selection'); setPriceDraft([]); }} style={styles.date}><ThemedText>{tr("초기화")}</ThemedText></Pressable>
        <Pressable analyticsId="discovery.price" accessibilityRole="button" accessibilityLabel={tr('가격 적용')} onPress={() => { play('selection'); setPriceLevels(priceDraft ?? []); setPriceDraft(null); }} style={[styles.apply, { backgroundColor: theme.accent }]}><ThemedText type="smallBold" style={{ color: theme.accentInk }}>{tr("적용")}</ThemedText></Pressable>
      </View>
    </DragSheet>
  </SafeAreaView>;
}

function DiscoveryCard({ item, viewerScope, onOpen, translationVisible = true, externalInfo = false, distance = null, now, savedBy, saves }: { item: DiscoveryItem; distance?: number | null; viewerScope: string; onOpen: () => void; translationVisible?: boolean; externalInfo?: boolean; now?: number; savedBy?: FriendSavedPlace | null; saves?: CityPlaceSave }) {
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
  const status = saves?.status ? PLACE_STATUS[saves.status] : null;
  const saveLine = [status ? tr(status.label) : '', saves?.saverCount ? tr('저장 {0}명', saves.saverCount.toLocaleString(appLocale)) : ''].filter(Boolean).join(' · ');
  return <View><Pressable analyticsId="discovery.card" accessibilityRole={externalInfo ? 'link' : 'button'} accessibilityLabel={`${hasAdLabel(item.post?.hashtags) ? tr("광고") + ", " : ""}${item.glingVisited ? tr("글링 직접 방문 장소, ") : ''}${item.top25 ? tr("TOP 50 선정 장소, ") : ''}${tr(category.label)}, ${headline}, ${housing ? `${displayTitle}, ` : ''}${address}, ${distanceLabel ? distanceLabel + ', ' : ''}${discountLabel ? discountLabel + ', ' : ''}${externalInfo ? tr('공개 정보, 외부 페이지 열기') : item.source === 'place' && !item.post && !item.place ? tr("선정 출처 열기") : tr("상세 보기")}`} onPress={onOpen} style={styles.cardBody}>
    <View style={[styles.thumbnail, { backgroundColor: theme.backgroundElement }]}>{item.place && (item.place.mapPhotoUri || !item.post && item.place.photo) ? <CityPlacePhoto place={item.place} style={StyleSheet.absoluteFill} /> : image ? <Image source={image} style={StyleSheet.absoluteFill} contentFit="cover" accessible={false} /> : <SymbolView name={{ ios: 'mappin.and.ellipse', android: 'location_on', web: 'location_on' }} size={26} tintColor={category.color} />}</View>
    <View style={styles.cardText}>{discountLabel && <ThemedText type="smallBold" style={{ color: theme === Colors.light ? '#276B57' : '#8FD9C4' }}>{discountLabel}</ThemedText>}<View style={styles.badge}><PostAdLabel hashtags={item.post?.hashtags} /><View style={[styles.dot, { backgroundColor: category.color }]} /><ThemedText type="small" themeColor="textSecondary">{tr(category.label)}{item.place?.priceLevel ? ` · ${priceSymbol(item.place.priceLevel)}` : ''}{!located(item) ? tr(" · 위치 확인 전") : ''}</ThemedText>{item.glingVisited && <GlingVisitedBadge />}{item.top25 && <View style={styles.top25Badge}><ThemedText style={styles.top25BadgeText}>✦ TOP 50</ThemedText></View>}</View><ThemedText type="smallBold" numberOfLines={2} style={housing ? styles.housingPrice : undefined}>{headline}</ThemedText>{housing && <ThemedText type="small" numberOfLines={2}>{displayTitle}</ThemedText>}<ThemedText type="small" themeColor="textSecondary" numberOfLines={housing ? 2 : 1}>{address}</ThemedText>{distanceLabel && <ThemedText type="small" themeColor="accent">{distanceLabel}</ThemedText>}{item.event && <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{eventTime(item.event, appLocale)}</ThemedText>}{!housing && !!price && <ThemedText type="smallBold" themeColor="accent">{price}</ThemedText>}</View>
    <ThemedText type={externalInfo ? 'small' : 'default'} themeColor="textSecondary">{externalInfo ? tr('공개 정보 ↗') : '›'}</ThemedText>
  </Pressable>{!!saveLine && <View accessible accessibilityLabel={saveLine} style={styles.saveLine}>{!!status && <View style={[styles.dot, { backgroundColor: status.color }]} />}<ThemedText type="small" themeColor="textSecondary">{saveLine}</ThemedText></View>}{!!savedBy && <FriendSavedLine entry={savedBy} />}{!!item.place?.openingHours && <PlaceHours openingHours={item.place.openingHours} cityId={item.cityId} now={now} />}{translatable && <TranslationControl translation={translation} />}</View>;
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
function GlingVisitedBadge() {
  return <View accessible={false} style={[styles.visitedBadge, styles.visitedCard]}>
    <Image source={require('@/assets/brand/gling-night-wordmark-light.png')} contentFit="contain" style={styles.visitedLogo} accessible={false} />
    <ThemedText style={styles.visitedText}>Visited</ThemedText>
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
// Only the open map card reads the business profile; list rows offer a booking-site website alone, so scrolling never fans out profile reads.
function Directions({ item, reserveFromBusiness = false }: { item: DiscoveryItem & PostPin; reserveFromBusiness?: boolean }) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  const { tr } = useLanguage();
  const navigate = (app: 'google' | 'waze') => {
    play('selection');
    void Linking.openURL(mapAppUrl(item, app)).catch(() => { play('warning'); Alert.alert(tr("지도 앱을 열지 못했어요"), tr("인터넷 연결을 확인한 뒤 다시 시도해 주세요.")); });
  };
  return <View style={styles.directions}><ReservationButton merchantId={reserveFromBusiness ? item.merchantId : undefined} website={item.place?.website} style={styles.reserve} />{(['google', 'waze'] as const).map(app => <Pressable key={app} analyticsId={`discovery.${app}`} accessibilityRole="link" accessibilityLabel={tr('{0}에서 장소 보기, 외부 앱 열기', app === 'google' ? 'Google Maps' : 'Waze')} onPress={() => navigate(app)} hitSlop={4} style={[styles.direction, { backgroundColor: theme.backgroundElement, borderColor: theme.line }]}><ThemedText type="smallBold">{app === 'google' ? 'Google Maps' : 'Waze'} ↗</ThemedText></Pressable>)}</View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  sheetSummary: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 8, paddingBottom: 6 },
  unknownRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14 },
  searchHere: { position: 'absolute', alignSelf: 'center', minHeight: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  priceOptions: { flexDirection: 'row', gap: 8, paddingVertical: 8 }, priceOption: { flex: 1, minHeight: 48, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  screen: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8 }, tabHeader: { paddingLeft: 16 }, headerActions: { flexDirection: 'row', alignItems: 'center' },
  icon: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, heading: { flex: 1, gap: 2 },
  titleButtonClay: { paddingHorizontal: 18, gap: 6 }, titleTextClay: { fontSize: 16, lineHeight: 22, fontWeight: '700', letterSpacing: 0 },
  titleButton: { alignSelf: 'flex-start', maxWidth: '100%', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 }, titleText: { flexShrink: 1 }, title: { fontSize: 20, lineHeight: 28, fontWeight: '800', letterSpacing: -0.5 },
  unifiedSearch: { flex: 1, minWidth: 0, minHeight: 46, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }, unifiedSearchText: { flex: 1, minWidth: 0 },
  search: { marginHorizontal: 16, marginBottom: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 4 }, input: { minHeight: 46, flex: 1, minWidth: 0, paddingHorizontal: 10, fontSize: 14 },
  mapFilters: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 12, zIndex: 1 },
  mapFiltersFade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: -18 },
  mapDateLabel: { borderRadius: 12, paddingHorizontal: 8, paddingVertical: 6, overflow: 'hidden' },
  filterRow: { flexGrow: 0, flexShrink: 0, maxHeight: 58 }, artRow: { maxHeight: 74 }, artRowItems: { alignItems: 'center' },
  artChip: { minWidth: 52, minHeight: 44, alignItems: 'center', gap: 1, paddingHorizontal: 2 }, artLift: { transform: [{ translateY: -2 }, { scale: 1.06 }] },
  artLabel: { fontSize: 12, lineHeight: 16, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, overflow: 'hidden' }, filters: { paddingHorizontal: 16, gap: 8, paddingBottom: 8 }, chip: { minHeight: 44, paddingHorizontal: 13, borderRadius: 24, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 7 }, dot: { width: 8, height: 8, borderRadius: 4 },
  filterDot: { width: 6, height: 6, borderRadius: 3, position: 'absolute', right: 6, top: 6 },
  visitedBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#CBB9FF', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3 }, visitedLogo: { width: 35, height: 16 }, visitedText: { color: '#171123', fontSize: 9, lineHeight: 14, fontWeight: '800', letterSpacing: 0.8 },
  top25Badge: { borderRadius: 5, borderWidth: 1, borderColor: '#68543A', backgroundColor: '#2A2319', paddingHorizontal: 5, paddingVertical: 2 }, top25BadgeText: { color: TOP25_GOLD, fontSize: 10, lineHeight: 14, fontWeight: '800' }, top25Note: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 4, gap: 5 }, top25Source: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  dates: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' }, date: { minHeight: 44, paddingHorizontal: 12, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  eventDateRow: { flexGrow: 0, flexShrink: 0 }, eventDates: { paddingHorizontal: 16, paddingBottom: 10, gap: 8, alignItems: 'center' }, dateChip: { minHeight: 44, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  cardToggle: { ...ControlStyles.icon, position: 'absolute', right: 20, bottom: 18, borderWidth: 1, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  visitedCard: { marginLeft: 6 }, saveLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  sortRow: { flexWrap: 'wrap', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  sortChip: { ...ControlStyles.pill, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  sortChipClay: { borderWidth: 0, overflow: 'visible', paddingHorizontal: 18 },
  notice: { marginHorizontal: 16, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 },
  content: { flex: 1, minHeight: 180 }, mapControls: { position: 'absolute', right: 22, top: 22, gap: 8 }, mapControl: { minWidth: 44, minHeight: 44, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  listLinkText: { flexShrink: 1, alignItems: 'center' },
  listLink: { position: 'absolute', alignSelf: 'center', minHeight: 56, maxWidth: '55%', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 24, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  selected: { position: 'absolute', bottom: 12, left: 20, right: 20, maxWidth: 560, maxHeight: '45%', borderRadius: 18, borderWidth: 1, padding: 12, gap: 12, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 }, selectedScroll: { flexShrink: 1, minHeight: 0 }, selectedContent: { gap: 12 }, cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  cardBody: { minHeight: 84, flexDirection: 'row', alignItems: 'center', gap: 12 }, thumbnail: { width: 72, height: 84, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, cardText: { flex: 1, minWidth: 0, gap: 3 }, badge: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  housingPrice: { fontSize: 18, lineHeight: 25, fontWeight: '700' },
  directions: { flexDirection: 'row', gap: 8 }, reserve: { flex: 1, borderRadius: 10 }, direction: { flex: 1, minHeight: 37, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  liveDock: { position: 'absolute', left: 20, right: 20, bottom: 12, maxWidth: 560, alignSelf: 'center' },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 12 }, listCard: { padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, gap: 12 }, listCardClay: { backgroundColor: 'transparent', borderColor: 'transparent', overflow: 'visible' }, mapEmpty: { position: 'absolute', bottom: 12, left: 20, right: 20 },
  loading: { position: 'absolute', top: 20, left: 16, right: 16, alignItems: 'center' },
  mapLoading: { top: 0, bottom: 0, justifyContent: 'center' },
  webshopError: { position: 'absolute', top: 20, alignSelf: 'center', maxWidth: '90%', paddingHorizontal: 14, borderRadius: 14, overflow: 'hidden' },
  more: { minHeight: 48, borderWidth: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 12 }, source: { fontSize: 11, lineHeight: 17, paddingTop: 16 },
  overlay: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' }, filterSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, width: '100%', maxWidth: 560, maxHeight: '90%', alignSelf: 'center' }, sheetHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 20, paddingRight: 8, paddingTop: 8 }, sheetScroll: { flexGrow: 0, flexShrink: 1 }, sheetContent: { padding: 20, paddingTop: 8, gap: 16 }, categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, info: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }, sheetActions: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, padding: 16, borderTopWidth: StyleSheet.hairlineWidth }, dateInput: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 17 }, apply: { flex: 1, minHeight: 44, minWidth: 90, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
