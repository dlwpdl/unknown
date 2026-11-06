import { useLanguage } from '@/hooks/use-language';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GlingLoader } from '@/components/gling-loader';
import { Pressable, FlatList, ScrollView, Switch } from '@/components/analytics-controls';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Animated, DeviceEventEmitter, Easing, Keyboard, LayoutAnimation, Modal, Platform, StyleSheet, TextInput, UIManager, useWindowDimensions, View, type TextInputInstance } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { ChillingEvent } from '@/components/chilling-event';
import { DragSheet } from '@/components/drag-sheet';
import { GlassSurface } from '@/components/glass-surface';
import { MeetupKindSwitch } from '@/components/meetup-kind-switch';
import { ProfileAvatarButton } from '@/components/profile-avatar-button';
import { CityPicker } from '@/components/city-picker';
import { ListCard, ListRow, SectionLabel } from '@/components/list-card';
import { MyMeetups } from '@/components/my-meetups';
import { RaisedActionButton } from '@/components/raised-action-button';
import { relationshipSlotData } from '@/components/relationship-slot-card';
import { ClayCoinFill, ClayIcon, ClayPillFill, useClay } from '@/components/clay';
import { SelectionChip } from '@/components/selection-chip';
import { StateCard } from '@/components/state-card';
import { useScreenGlow } from '@/components/screen-glow';
import { TabContent } from '@/components/tab-content';
import { ThemedText } from '@/components/themed-text';
import { UserSheet, type SheetUser } from '@/components/user-sheet';
import { Spacing, TabBarHeight } from '@/constants/theme';
import { ControlMotion, ControlStyles, IconSize, Typography, controlPresentation } from '@/constants/design-system';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useChatIdentity } from '@/hooks/use-chat-identity';
import MerchantScreen from '@/app/profile/merchant';
import { useCommunityCity } from '@/lib/community-city';
import { loadPendingMeetupRequests, MEETUPS_CHANGED_EVENT } from '@/lib/community-data';
import { chillingCreateKindParams, discoveryCursor, hasOpenSeat, matchesChilling, matchesChillingWindow, parseChillingDiscoveryPreference, sortChillings, type ChillingDiscoveryKind, type ChillingDiscoveryView, type ChillingWindow } from '@/lib/chilling-discovery';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useMembership } from '@/lib/membership-provider';
import { appendUniquePosts, loadPublicFeed, type FeedCursor } from '@/lib/feed-data';
import { CITIES, TAGS } from '@/lib/mock';
import { cityPlacesRevision, subscribeCityPlaces } from '@/lib/city-places';
import { resolveMeetupDestination, matchesMeetupDestination, meetupDestinationQuery, type MeetupDestination, type MeetupDestinationParams } from '@/lib/meetup-destination';
import { loadTicketmasterEvent, meetupAllowed } from '@/lib/ticketmaster';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

export default function MeetupsScreen() {

  const { me, isAuthed } = useAuth();
  const { city } = useCommunityCity();
  const params = useLocalSearchParams();
  const placesRevision = useSyncExternalStore(subscribeCityPlaces, cityPlacesRevision, cityPlacesRevision);
  // A new destination object each render would re-key fetchPage and wipe the list; keep it stable per params.
  const { placeCityId, placeId, ticketmasterCityId, ticketmasterEventId } = params as MeetupDestinationParams;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const source = useMemo(() => resolveMeetupDestination({ placeCityId, placeId, ticketmasterCityId, ticketmasterEventId }), [placeCityId, placeId, ticketmasterCityId, ticketmasterEventId, placesRevision]);
  const business = useChatIdentity();
  if (business) return <BusinessHome />;
  return <MeetupDiscovery key={`${isAuthed ? me.id : 'guest'}:${city.id}:${params.placeCityId}:${params.placeId}:${params.ticketmasterCityId}:${params.ticketmasterEventId}`} destination={source.destination} sourceInvalid={source.invalid} routedMine={params.view === 'mine'} />;
}

// Acting as a business this tab is "내 가게": the same workspace as the profile entry, under the tab header.
function BusinessHome() {
  const { tr } = useLanguage(), glow = useScreenGlow(), screenGlow = glow.image();
  return <TabContent style={[styles.root, screenGlow != null && { backgroundImage: screenGlow }]} onLayout={glow.onLayout}><SafeAreaView edges={['top', 'left', 'right']} style={styles.root}>
    <View style={[styles.head, styles.headFixed]}>
      <ThemedText accessibilityRole="header" style={[styles.title, { flex: 1 }]}>{tr('내 가게')}</ThemedText>
      <ProfileAvatarButton />
    </View>
    <MerchantScreen />
  </SafeAreaView></TabContent>;
}

function MeetupDiscovery({ destination, sourceInvalid, routedMine = false }: { destination: MeetupDestination | null; sourceInvalid: boolean; routedMine?: boolean }) {
  const { tr, t, language } = useLanguage();
  const copy = (ko: string, en: string) => language === 'en' ? en : ko;
  const theme = useTheme(), router = useRouter(), insets = useSafeAreaInsets();
  const clay = useClay();
  // 오늘 탭과 같은 배경 빛(사장님 2026-11-04 '빛 넣을 탭: 지도 빼고 다'). 제목 줄은 투명이라 빛이 비친다.
  const glow = useScreenGlow(), screenGlow = glow.image();
  const reducedMotion = useReducedMotion();
  const { width: screenWidth, fontScale } = useWindowDimensions();
  // Large text stacks the header on purpose; at other sizes the controls stay beside the title and wrap only when they don't fit.
  const compactHeader = fontScale > 1.2;
  const { city: preferredCity } = useCommunityCity();
  const city = CITIES.find(city => city.id === destination?.cityId) ?? preferredCity;
  const { me, isAuthed, isAdmin, promptLogin } = useAuth();
  const { membership } = useMembership();
  const { play } = useInteractionFeedback();
  const slots = relationshipSlotData(membership, 'meetup');
  const hidden = useContentVisibility();
  const [kind, setKind] = useState<ChillingDiscoveryKind>('all');
  const [view, setView] = useState<ChillingDiscoveryView>('browse');
  const [category, setCategory] = useState('all');
  const [dateWindow, setDateWindow] = useState<ChillingWindow>('all');
  const [seatsOnly, setSeatsOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [sourceLabel, setSourceLabel] = useState(destination?.kind === 'place' ? destination.place.name : '');
  const [sourceError, setSourceError] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [cursor, setCursor] = useState<FeedCursor | null>(null);
  const [cityPicker, setCityPicker] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [user, setUser] = useState<SheetUser | null>(null);
  const [listOpacity] = useState(() => new Animated.Value(1));
  const [searchMotion] = useState(() => new Animated.Value(0));
  // One progress (0 둘러보기, 1 내 모임) moves the tab underline and both panes together.
  const [viewProgress] = useState(() => new Animated.Value(0));
  const [sliding, setSliding] = useState(false), [mineVisited, setMineVisited] = useState(false);
  const [tabFrames, setTabFrames] = useState<Partial<Record<ChillingDiscoveryView, { x: number; width: number }>>>({});
  if (view === 'mine' && !mineVisited) setMineVisited(true);
  const searchInput = useRef<TextInputInstance>(null);
  const version = useRef(0), busy = useRef(false);
  const failedCursor = useRef<FeedCursor | null>(null);
  const loadedFor = useRef<unknown>(null);
  const scope = isAuthed ? me.id : 'guest';
  const preferenceEdited = useRef(false), preferenceScope = useRef<string | null>(scope), routeWins = useRef(false);
  useLayoutEffect(() => { preferenceScope.current = scope; return () => { preferenceScope.current = null; }; }, [scope]);
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem('gling.meetup-discovery.v1:' + scope).catch(() => null).then(raw => {
      if (!active || preferenceScope.current !== scope || preferenceEdited.current) return;
      const saved = parseChillingDiscoveryPreference(raw);
      const next = routeWins.current ? 'mine' : destination || sourceInvalid ? 'browse' : saved.view;
      setKind(saved.kind); setView(next); viewProgress.setValue(next === 'mine' ? 1 : 0);
    });
    return () => { active = false; };
  }, [scope, destination, sourceInvalid, viewProgress]);
  // 참여 신청의 "내 모임에서 보기". 이미 떠 있는 탭에서도 동작하고 저장된 보기보다 앞선다. 값은 지워 다음 진입에 남기지 않는다.
  const [routedSeen, setRoutedSeen] = useState(false);
  if (routedMine !== routedSeen) { setRoutedSeen(routedMine); if (routedMine) { setView('mine'); setSliding(false); } }
  useEffect(() => {
    if (!routedMine) return;
    routeWins.current = true;
    viewProgress.setValue(1);
    router.setParams({ view: '' });
  }, [routedMine, router, viewProgress]);
  const remember = (nextKind: ChillingDiscoveryKind, nextView: ChillingDiscoveryView) => {
    if (preferenceScope.current !== scope) return false;
    preferenceEdited.current = true;
    void AsyncStorage.setItem('gling.meetup-discovery.v1:' + scope, JSON.stringify({ kind: nextKind, view: nextView })).catch(() => {});
    return true;
  };
  const fetchPage = useCallback(async (after: FeedCursor | null = null) => {
    if (after && busy.current) return;
    const request = ++version.current;
    busy.current = true; setLoading(true); setError(false);
    try {
      if (sourceInvalid) { setPosts([]); setCursor(null); return; }
      if (destination?.kind === 'event' && !after) {
        const { event } = await loadTicketmasterEvent(destination.cityId, destination.eventId);
        if (request !== version.current) return;
        if (event.id !== destination.eventId || !meetupAllowed(event)) throw new Error('INVALID_SOURCE_EVENT');
        setSourceLabel(event.name); setSourceError('');
      }
      const page = city.state === 'open' ? await loadPublicFeed(supabase, city.id, TAGS.find(t => t.kind === 'meetup')!.id, destination ? meetupDestinationQuery(destination) : query || null, after, { viewerScope: scope }) : [];
      if (request !== version.current) return;
      setPosts(current => after ? appendUniquePosts(current, page) : page);
      setCursor(discoveryCursor(page));
    } catch { if (request === version.current) { failedCursor.current = after; setError(true); if (destination?.kind === 'event') setSourceError('행사 정보나 모임을 확인하지 못했어요. 행사 상세를 다시 확인하거나 재시도해 주세요.'); } }
    finally { if (request === version.current) { busy.current = false; setLoading(false); } }
  }, [city.id, city.state, scope, query, destination, sourceInvalid]);
  // Coming back from a detail keeps loaded pages and scroll; only a new query/scope (or an interrupted load) reloads.
  useFocusEffect(useCallback(() => {
    if (loadedFor.current !== fetchPage) { loadedFor.current = fetchPage; setPosts([]); setCursor(null); void fetchPage(); }
    const listener = DeviceEventEmitter.addListener(MEETUPS_CHANGED_EVENT, () => void fetchPage());
    return () => { if (busy.current) loadedFor.current = null; version.current++; busy.current = false; listener.remove(); };
  }, [fetchPage]));
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => { setRefreshing(true); void fetchPage().finally(() => setRefreshing(false)); };
  // 호스트가 처리할 승인 대기만 헤더에 알린다. 승인·거절은 채팅 탭 참여 신청에서 한다.
  useFocusEffect(useCallback(() => {
    if (!isAuthed || !me.id) { setPendingCount(0); return; }
    let active = true;
    const load = async () => {
      try { const requests = await loadPendingMeetupRequests(supabase); if (active) setPendingCount(requests.length); }
      catch { if (active) setPendingCount(0); }
    };
    void load();
    const listener = DeviceEventEmitter.addListener(MEETUPS_CHANGED_EVENT, () => void load());
    return () => { active = false; listener.remove(); };
  }, [isAuthed, me.id]));
  const open = useCallback(async (id: string) => { router.push({ pathname: '/post/[id]', params: { id } }); }, [router]);
  const filtered = posts.filter(p => p.cityId === city.id && matchesChilling(p, kind, category) && matchesChillingWindow(p, dateWindow)
    && (!seatsOnly || hasOpenSeat(p.room)) && !hidden('listed_post', p.id, p.author.id)
    && (!destination || matchesMeetupDestination(p, destination))
    && (!destination || !query || `${p.title}\n${p.body}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const visible = sortChillings(filtered, kind);
  const initialLoading = loading && posts.length === 0;
  const narrowed = !!query || dateWindow !== 'all' || seatsOnly || category !== 'all';
  // 목록 화면은 목록이 먼저 보여야 한다. 상세 필터는 한 줄로 접고 시트에서만 편다.
  const activeFilters = (category !== 'all' ? 1 : 0) + (dateWindow !== 'all' ? 1 : 0) + (seatsOnly ? 1 : 0);
  const clearFilters = () => { setCategory('all'); setDateWindow('all'); setSeatsOnly(false); };
  const changeKind = (next: ChillingDiscoveryKind) => {
    if (!remember(next, view)) return;
    if (next === kind) return;
    listOpacity.stopAnimation();
    setKind(next); setCategory('all'); setDateWindow('all');
    if (reducedMotion) {
      listOpacity.setValue(1);
      return;
    }
    listOpacity.setValue(0.55);
    Animated.timing(listOpacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  };
  const switchView = (next: ChillingDiscoveryView) => {
    if (!remember(kind, next)) return;
    play('selection');
    if (next === view) return;
    setView(next);
    const toValue = next === 'mine' ? 1 : 0;
    if (reducedMotion) { viewProgress.setValue(toValue); return; }
    setSliding(true);
    Animated.timing(viewProgress, { toValue, duration: ControlMotion.expandMs, easing: Easing.out(Easing.cubic), useNativeDriver: true })
      .start(({ finished }) => { if (finished) setSliding(false); });
  };
  const toggleSearch = () => {
    if (!remember(kind, 'browse')) return;
    setView('browse');
    play('reaction');
    const animateHeight = () => {
      if (reducedMotion) return;
      if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    };
    if (!searchOpen) {
      animateHeight();
      searchMotion.setValue(0);
      setSearchOpen(true);
      if (reducedMotion) requestAnimationFrame(() => searchInput.current?.focus());
      else requestAnimationFrame(() => Animated.timing(searchMotion, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true })
        .start(({ finished }) => { if (finished) searchInput.current?.focus(); }));
    } else {
      Keyboard.dismiss();
      if (reducedMotion) { setSearchOpen(false); return; }
      Animated.timing(searchMotion, { toValue: 0, duration: 140, useNativeDriver: true }).start(({ finished }) => {
        if (finished) { animateHeight(); setSearchOpen(false); }
      });
    }
  };
  const action = (route: '/meetup-create' | '/meetup-profile') => {
    if (preferenceScope.current !== scope) return;
    if (route === '/meetup-create' && (sourceInvalid || (destination?.kind === 'event' && !sourceLabel))) return;
    if (!isAuthed) return promptLogin(destination && route === '/meetup-create' ? copy('이곳에 갈 모임을 만들려면 가입하거나 로그인해 주세요.', 'Sign in or join to start a meetup here.') : tr('모임 프로필을 만들고 함께 만나요.'));
    if (route === '/meetup-create') return router.push({ pathname: route, params: { ...chillingCreateKindParams(kind), ...(destination ? destination.kind === 'place'
      ? { placeId: destination.place.id, placeCityId: destination.cityId } : { ticketmasterEventId: destination.eventId, ticketmasterCityId: destination.cityId } : {}) } });
    router.push(route);
  };
  const clearDestination = () => { if (!remember(kind, 'browse')) return; setView('browse'); play('selection'); router.setParams({ placeId: '', placeCityId: '', ticketmasterEventId: '', ticketmasterCityId: '' }); };
  const createDisabled = sourceInvalid || (destination?.kind === 'event' && !sourceLabel);
  return <TabContent style={[styles.root, screenGlow != null && { backgroundImage: screenGlow }]} onLayout={glow.onLayout}><SafeAreaView edges={['top', 'left', 'right']} style={styles.root}>
    {/* 헤더는 스크롤과 함께 사라지면 안 된다(홈과 동일). 목록 밖에 두고 고정한다. */}
    <View style={[styles.head, styles.headFixed]}>
      <ThemedText accessibilityRole="header" style={[styles.title, compactHeader && styles.titleLarge]}>{t.tabs.meetups}</ThemedText>
      <View style={[styles.headActions, compactHeader && styles.headActionsLarge]}>
        <GlassSurface tone="control" clay="white" interactive={!destination} style={[styles.cityGlass, compactHeader && styles.cityGlassLarge]}>{destination ? <View style={styles.city}><ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.cityText}>{tr("{0}에서", tr(city.name))}</ThemedText></View> : <Pressable analyticsId="app_tabs_meetups.pressable.1" onPress={() => { play('selection'); setCityPicker(true); }} accessibilityRole="button" accessibilityLabel={tr("{0} 활동 지역 선택", tr(city.name))} style={({ pressed }) => [styles.city, clay && styles.cityClay, { backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent' }]}><ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.cityText}>{tr("{0}에서", tr(city.name))}</ThemedText><ClayIcon clay="chevron" name={{ ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' }} size={IconSize.chevron} tintColor={theme.textSecondary} /></Pressable>}</GlassSurface>
        {/* 만들기는 화면당 하나뿐인 primary. 하단에 떠 있으면 카드를 가려서 헤더에 고정한다. */}
        <Pressable analyticsId="app_tabs_meetups.pressable.3" accessibilityRole="button" accessibilityLabel={destination ? copy('이곳에 갈 모임 만들기', 'Start a meetup here') : tr("모임 만들기")} accessibilityState={{ disabled: createDisabled }} disabled={createDisabled}
          onPress={() => { play('selection'); action('/meetup-create'); }}
          style={({ pressed }) => [styles.circle, { backgroundColor: clay ? 'transparent' : theme.accent, opacity: createDisabled ? 0.4 : pressed ? 0.85 : 1 }]}>
          {clay && <ClayCoinFill me />}
          <ClayIcon clay="plus" claySize={22} name={{ ios: 'plus', android: 'add', web: 'add' }} size={20} tintColor={theme.accentInk} />
        </Pressable>
        <ProfileAvatarButton />
      </View>
    </View>
    <View accessibilityRole="tablist" accessibilityLabel={copy('모임 보기', 'Meetup views')} style={[styles.viewTabs, { borderBottomColor: theme.line }]}>
      {([['browse', copy('둘러보기', 'Browse')], ['mine', copy('내 모임', 'My meetups')]] as const).map(([value, label]) => <Pressable key={value}
        analyticsId={value === 'browse' ? 'meetup.discovery.browse' : 'meetup.discovery.mine'} accessibilityRole="tab" accessibilityState={{ selected: view === value }}
        onLayout={({ nativeEvent: { layout: { x, width } } }) => setTabFrames(frames => ({ ...frames, [value]: { x, width } }))}
        onPress={() => switchView(value)}
        style={({ pressed }) => [styles.viewTab, { opacity: pressed ? 0.82 : 1 }]}>
        <View style={styles.tabLabel}><ThemedText style={Typography.menu} themeColor={view === value ? 'text' : 'textSecondary'}>{label}</ThemedText>
          {value === 'mine' && pendingCount > 0 && <View accessibilityLabel={tr("참여 신청 {0}건", pendingCount === 50 ? '50+' : pendingCount)} style={[styles.badge, { backgroundColor: theme.accent }]}><ThemedText type="smallBold" style={[styles.badgeText, { color: theme.accentInk }]}>{pendingCount === 50 ? '50+' : pendingCount}</ThemedText></View>}</View>
      </Pressable>)}
      {!!tabFrames.browse && !!tabFrames.mine && (clay ? <Animated.View pointerEvents="none" style={[styles.tabLineClay, { width: tabFrames.browse.width, transform: [
        { translateX: viewProgress.interpolate({ inputRange: [0, 1], outputRange: [tabFrames.browse.x, tabFrames.mine.x + (tabFrames.mine.width - tabFrames.browse.width) / 2] }) },
        { scaleX: viewProgress.interpolate({ inputRange: [0, 1], outputRange: [1, tabFrames.mine.width / tabFrames.browse.width] }) },
      ] }]}><ClayPillFill kind="line" /></Animated.View> : <Animated.View pointerEvents="none" style={[styles.tabLine, { backgroundColor: theme.accent, transform: [
        { translateX: viewProgress.interpolate({ inputRange: [0, 1], outputRange: [tabFrames.browse.x + tabFrames.browse.width / 2 - 0.5, tabFrames.mine.x + tabFrames.mine.width / 2 - 0.5] }) },
        { scaleX: viewProgress.interpolate({ inputRange: [0, 1], outputRange: [tabFrames.browse.width, tabFrames.mine.width] }) },
      ] }]} />)}
    </View>
    {/* 내 모임은 처음 열 때 마운트한다. 둘러보기는 계속 살아 있어 돌아와도 스크롤이 그대로다. */}
    <View style={styles.panes}>
    <Animated.View pointerEvents={view === 'browse' ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, { display: view === 'browse' || sliding ? 'flex' : 'none', transform: [{ translateX: viewProgress.interpolate({ inputRange: [0, 1], outputRange: [0, -screenWidth] }) }] }]}>
    <FlatList analyticsId="app_tabs_meetups.flatlist.1" data={visible} keyExtractor={p => p.id} keyboardShouldPersistTaps="handled" refreshing={refreshing} onRefresh={refresh}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + TabBarHeight + Spacing.four }]}
      ListHeaderComponent={<>
        {destination && <View style={[styles.pending, { borderColor: theme.line, backgroundColor: theme.card, flexDirection: 'row', alignItems: 'center', gap: Spacing.two }]}>
          <View style={{ flex: 1, minWidth: 0 }}><ThemedText type="small" style={styles.support} themeColor="textSecondary">{tr(city.name)} · {destination.kind === 'place' ? copy('이 장소에 갈 모임', 'Meetups for this place') : copy('이 행사에 갈 모임', 'Meetups for this event')}</ThemedText><ThemedText style={Typography.section}>{sourceLabel || copy('행사 정보를 확인하고 있어요.', 'Checking event details…')}</ThemedText></View>
          <Pressable analyticsId="app_tabs_meetups.pressable.16" accessibilityRole="button" accessibilityLabel={copy('장소·행사 조건 해제', 'Clear place or event filter')} onPress={clearDestination} style={({ pressed }) => [ControlStyles.icon, controlPresentation(theme, { tone: 'ghost', pressed }).container]}><SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={IconSize.toolbar} tintColor={theme.text} /></Pressable>
        </View>}
        <View style={styles.filterRow}>
          <View style={styles.kindControl}><MeetupKindSwitch value={kind === 'all' ? null : kind} onChange={changeKind} onAll={() => changeKind('all')} analyticsId="app_tabs_meetups.pressable.4" /></View>
          <View style={styles.filterActions}><GlassSurface tone="control" clay="tile" interactive style={[styles.filterGlass, activeFilters > 0 && { borderColor: theme.accent }]}><Pressable analyticsId="app_tabs_meetups.pressable.14" accessibilityRole="button" accessibilityLabel={activeFilters ? tr("필터, {0}개 적용됨", (activeFilters)) : tr("필터")}
            onPress={() => { play('reaction'); setFiltersOpen(true); }}
            style={({ pressed }) => [styles.filterButton, { backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent' }]}>
            <ClayIcon clay="sliders" claySize={22} name={{ ios: 'slider.horizontal.3', android: 'tune', web: 'tune' }} size={16} tintColor={activeFilters ? theme.accent : theme.text} />
            <ThemedText type="smallBold" style={Typography.menu} themeColor={activeFilters ? 'accent' : 'text'}>{activeFilters ? tr("필터 · {0}", (activeFilters)) : tr("필터")}</ThemedText>
          </Pressable></GlassSurface>
      <GlassSurface tone="control" clay="white" interactive style={styles.circleGlass}><Pressable analyticsId="meetups.discovery.open" accessibilityRole="button" accessibilityLabel={tr('부동산·중고거래·장소·행사 통합 지도')}
        onPress={() => { play('reaction'); router.push('/map'); }} style={({ pressed }) => [styles.circle, { backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent' }]}>
        <ClayIcon clay="map" claySize={26} name={{ ios: 'map', android: 'map', web: 'map' }} size={21} tintColor={theme.text} />
      </Pressable></GlassSurface>
      <GlassSurface tone="control" clay="white" interactive style={styles.circleGlass}><Pressable analyticsId="app_tabs_meetups.pressable.13" accessibilityRole="button" accessibilityLabel={searchOpen ? tr("검색 닫기") : tr("모임 검색")} accessibilityState={{ expanded: searchOpen }}
        onPress={toggleSearch} style={({ pressed }) => [styles.circle, { backgroundColor: pressed || searchOpen ? 'rgba(255,255,255,0.13)' : 'transparent' }]}>
        {searchOpen || !clay ? <SymbolView name={{ ios: searchOpen ? 'xmark' : 'magnifyingglass', android: searchOpen ? 'close' : 'search', web: searchOpen ? 'close' : 'search' }} size={20} tintColor={searchOpen ? theme.accent : theme.text} /> : <ClayIcon clay="search" claySize={26} size={20} />}
      </Pressable></GlassSurface></View>
        </View>
        {searchOpen && <Animated.View style={[styles.searchRow, { opacity: reducedMotion ? 1 : searchMotion, transform: [{ translateY: searchMotion.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }, { scale: searchMotion.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) }] }]}>
          <TextInput ref={searchInput} value={search} onChangeText={setSearch} onSubmitEditing={() => { setQuery(search.trim()); Keyboard.dismiss(); }} returnKeyType="search"
            accessibilityLabel={tr("모임 검색어")} placeholder={tr("모임·동네·키워드 검색")} placeholderTextColor={theme.textSecondary} maxLength={40}
            style={[ControlStyles.field, styles.search, { color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]} />
          <RaisedActionButton compact analyticsId="app_tabs_meetups.pressable.8" label={tr("검색")} onPress={() => { play('reaction'); setQuery(search.trim()); Keyboard.dismiss(); }} />
        </Animated.View>}
        {!!query && <Pressable analyticsId="app_tabs_meetups.pressable.9" accessibilityRole="button" accessibilityLabel={tr("검색어 {0} 해제", (query))}
          onPress={() => { play('selection'); setSearch(''); setQuery(''); }} style={({ pressed }) => [styles.clear, { opacity: pressed ? 0.65 : 1 }]}><ThemedText type="small" style={Typography.menu} themeColor="accent">{tr("“{0}” 검색 중 · 지우기", (query))}</ThemedText></Pressable>}
      </>}
      renderItem={({ item, index }) => <Reanimated.View entering={reducedMotion ? undefined : FadeInDown.delay(Math.min(index, 5) * 65).duration(360)}><Animated.View style={{ opacity: listOpacity }}><ChillingEvent post={item} city={tr(city.name)} onOpen={() => void open(item.id)} onAuthor={() => setUser({ ...item.author, mine: item.author.id === me.id })} /></Animated.View></Reanimated.View>}
      ListEmptyComponent={sourceInvalid ? <StateCard kind="error" title={copy('장소·행사 정보를 확인하지 못했어요', 'Couldn’t verify this place or event')} body={copy('원래 상세에서 다시 열거나 전체 모임을 둘러보세요.', 'Open it again from its details, or browse all meetups.')} actionLabel={copy('전체 모임 보기', 'Browse all meetups')} onAction={clearDestination} /> : initialLoading ? <View style={styles.loadingState}><GlingLoader color={theme.accent} accessibilityLabel={tr("모임 불러오는 중")} /></View>
        : !loading && !error ? <Animated.View style={{ opacity: listOpacity }}>{city.state !== 'open'
        ? <StateCard title={tr("이 지역은 아직 준비 중이에요")} body={tr("다른 동네를 골라보거나, 곧 문을 열 때 알려드릴게요.")} />
        : cursor ? <StateCard title={copy('아직 모든 모임을 확인하지 않았어요', 'More meetups to check')} body={copy('현재 페이지에는 조건에 맞는 모임이 없어요. 아래에서 더 확인해 보세요.', 'No matches on this page. Load more to keep looking.')} />
          : destination ? <StateCard title={copy('선택한 조건에 맞는 모임이 아직 없어요', 'No meetups match these filters yet')} body={copy('모임 종류·검색어·필터를 바꾸거나, 이곳에 갈 모임을 직접 열어보세요.', 'Try another meetup type or filter, or start a meetup here.')} actionLabel={createDisabled ? undefined : copy('이곳에 갈 모임 만들기', 'Start a meetup here')} onAction={() => action('/meetup-create')} />
          : narrowed ? <StateCard title={tr("조건에 맞는 모임이 없어요")} body={tr("검색어나 필터를 바꾸면 더 찾을 수 있어요.")} actionLabel={tr("필터 초기화")} onAction={() => { setSearch(''); setQuery(''); clearFilters(); }} />
            : <StateCard title={tr("아직 등록된 모임이 없어요")} body={tr("가까운 동네에서 첫 모임을 열어보세요. 한 명이 신청하면 바로 알려드려요.")} actionLabel={tr("모임 만들기")} onAction={() => action('/meetup-create')} />}</Animated.View> : undefined}
      ListFooterComponent={initialLoading ? undefined : <View style={{ gap: 16, paddingTop: Spacing.four }}>{loading && <GlingLoader color={theme.accent} accessibilityLabel={tr("모임 더 불러오는 중")} />}
        {error && <StateCard kind="error" title={tr("모임을 불러오지 못했어요")} body={sourceError ? copy(sourceError, 'Couldn’t verify the event or load meetups. Check the event details or try again.') : tr("연결이 잠시 끊겼어요. 다시 시도해 주세요.")} actionLabel={tr("다시 시도")} onAction={() => { play('selection'); void fetchPage(failedCursor.current); }} />}
        {!loading && !error && cursor && <Pressable analyticsId="app_tabs_meetups.pressable.6" accessibilityRole="button" onPress={() => { play('selection'); void fetchPage(cursor); }} style={styles.more}><ThemedText style={Typography.menu} themeColor="accent">{tr("모임 더 보기")}</ThemedText></Pressable>}
        <Pressable analyticsId="ticketmaster.discover" accessibilityRole="button" onPress={() => { play('selection'); router.push('/events'); }} style={styles.more}><ThemedText style={styles.support} themeColor="accent">{copy('이 지역 공연과 행사 보기', 'Local shows and events')} ›</ThemedText></Pressable>
      </View>} />
    </Animated.View>
    {mineVisited && <Animated.View pointerEvents={view === 'mine' ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, { display: view === 'mine' || sliding ? 'flex' : 'none', transform: [{ translateX: viewProgress.interpolate({ inputRange: [0, 1], outputRange: [screenWidth, 0] }) }] }]}>
      <ScrollView analyticsId="components_my-meetups.scrollview.1" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + TabBarHeight + Spacing.four }]}>
        {pendingCount > 0 && <View style={styles.pendingCard}><ListCard><ListRow analyticsId="app_tabs_meetups.pressable.7" title={tr("참여 신청 {0}건", pendingCount === 50 ? '50+' : pendingCount)} detail={tr("프로필을 검토하고 승인·거절해요")} label={tr("참여 신청 {0}건 처리하기", pendingCount === 50 ? '50+' : pendingCount)}
            trailing={<View style={[styles.dot, { backgroundColor: theme.accent }]} />} onPress={() => router.push({ pathname: '/chat', params: { view: 'requests' } })} /></ListCard></View>}
        <MyMeetups onOpen={open} hideTitle summaryRows={[
          <ListRow key="profile" analyticsId="app_tabs_meetups.pressable.2" title={tr("내 모임 프로필")} onPress={() => action('/meetup-profile')} />,
          !!slots && <ListRow key="slots" analyticsId="app_tabs_meetups.pressable.12" title={isAdmin ? tr('관리자 계정 · 제한 없음') : tr("모임 자리 {0} / {1}", slots.active, slots.limit)} detail={tr("멤버십과 모임 자리 보기")} onPress={() => router.push('/profile/membership')} />,
        ]} />
      </ScrollView>
    </Animated.View>}
    </View>
    <Modal visible={cityPicker} animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={() => { play('selection'); setCityPicker(false); }}><View style={[styles.root, { backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}><CityPicker onClose={() => setCityPicker(false)} /></View></Modal>
    {/* 카테고리·일정·자리 남음은 시트에서만 편다(목록이 먼저 보여야 한다). 값은 켜는 즉시 적용된다. */}
    <DragSheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} title={tr("필터")}>
      <ScrollView analyticsId="app_tabs_meetups.scrollview.1">
        <SectionLabel>{tr("카테고리")}</SectionLabel>
        <View accessibilityRole="radiogroup" accessibilityLabel={tr("카테고리")} style={styles.sheetChips}>{[['all',tr("전체")],['party',tr("파티")],['festival',tr("페스티벌")],['sports',tr("스포츠")],['casual',tr("가볍게")],['hobby',tr("취미")],['travel',tr("여행")],['language',tr("언어교환")]].map(([value,label]) => <SelectionChip analyticsId="app_tabs_meetups.pressable.5" key={value} label={label} selected={category === value} accessibilityRole="radio" aria-checked={category === value} accessibilityState={{ selected: category === value }} onPress={() => { play('selection'); setCategory(value); }} />)}</View>
        {kind === 'once' && <><SectionLabel>{tr("일정")}</SectionLabel>
          <View accessibilityRole="radiogroup" accessibilityLabel={tr("일정")} style={styles.sheetChips}>{([['all',tr("일정 전체")],['today',tr("오늘")],['week',tr("7일 이내")]] as const).map(([value,label]) => <SelectionChip analyticsId="app_tabs_meetups.pressable.10" key={value} label={label} selected={dateWindow === value} accessibilityRole="radio" aria-checked={dateWindow === value} accessibilityState={{ selected: dateWindow === value }} onPress={() => { play('selection'); setDateWindow(value); }} />)}</View></>}
        {/* 켜짐/꺼짐은 칩이 아니라 스위치로 — 모양이 의미를 따라간다. */}
        <View style={styles.switchRow}>
          <View style={styles.flexText}>
            <ThemedText type="smallBold" style={Typography.menu}>{tr("자리 남음만 보기")}</ThemedText>
            <ThemedText type="small" style={styles.support} themeColor="textSecondary">{tr("정원이 찬 모임은 숨겨요.")}</ThemedText>
          </View>
          <Switch analyticsId="app_tabs_meetups.switch.1" accessibilityLabel={tr("자리 남음만 보기")} value={seatsOnly} onValueChange={value => { play('selection'); setSeatsOnly(value); }} />
        </View>
      </ScrollView>
      <View style={styles.sheetActions}>
        <View style={styles.sheetAction}><RaisedActionButton analyticsId="app_tabs_meetups.pressable.16" tone="secondary" label={tr("필터 초기화")} onPress={() => { play('selection'); clearFilters(); }} /></View>
        <View style={styles.sheetAction}><RaisedActionButton analyticsId="app_tabs_meetups.pressable.15" label={tr("목록 보기")} onPress={() => { play('selection'); setFiltersOpen(false); }} /></View>
      </View>
    </DragSheet>
    <UserSheet user={user} onClose={() => setUser(null)} />
  </SafeAreaView></TabContent>;
}
const styles = StyleSheet.create({
  pendingCard: { marginBottom: Spacing.three },
  viewTabs: { width: '100%', maxWidth: 640, alignSelf: 'center', flexDirection: 'row', gap: Spacing.four, paddingHorizontal: 22, marginBottom: 8, borderBottomWidth: 1 },
  viewTab: { minHeight: 52, justifyContent: 'center', paddingTop: Spacing.two, paddingBottom: Spacing.two + 3 },
  // Width 1 scaled to the tab's width: transforms keep it on the native driver with the panes.
  tabLine: { position: 'absolute', left: 0, bottom: 0, width: 1, height: 3 },
  tabLineClay: { position: 'absolute', left: 0, bottom: 0, height: 6 },
  panes: { flex: 1, overflow: 'hidden' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  support: { ...Typography.supporting, fontSize: 14, lineHeight: 20 },
  root: { flex: 1 }, content: { padding: 22, width: '100%', maxWidth: 640, alignSelf: 'center' }, head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 },
  loadingState: { minHeight: 160, alignItems: 'center', justifyContent: 'center' },
  flexText: { flexShrink: 1, gap: 2 },
  // 목록 밖에 고정되는 헤더: 좌우 여백은 목록과 맞춘다.
  headFixed: { marginBottom: 0, paddingHorizontal: 22, paddingTop: Spacing.one, paddingBottom: 10, width: '100%', maxWidth: 640, alignSelf: 'center', flexWrap: 'wrap' }, titleLarge: { width: '100%' },
  // City, create and profile move together; on their own line the city label shrinks (one line, truncated) before anything else.
  headActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 'auto', flexShrink: 1 }, headActionsLarge: { flexGrow: 1 },
  city: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.one, borderRadius: 12, paddingHorizontal: Spacing.two, flexShrink: 1 }, cityClay: { paddingHorizontal: 16 }, cityText: { fontSize: 14, lineHeight: 20, flexShrink: 1 }, cityGlass: { marginLeft: 'auto', flexShrink: 1, borderRadius: 12 }, cityGlassLarge: { flex: 1, minWidth: 0 }, title: Typography.screenTitle, circle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, circleGlass: { borderRadius: 22 }, filterGlass: { borderRadius: 12 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 20 },
  // Row direction keeps the switch's flex:1 horizontal; narrow screens wrap filter+search together.
  kindControl: { flexGrow: 1, flexBasis: 200, minWidth: 200, flexDirection: 'row' }, filterActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 'auto' },
  filterButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, paddingHorizontal: 14 },
  pending: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 2, marginBottom: 16 },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: Spacing.three }, search: { flex: 1, fontSize: 16 },
  clear: { minHeight: 44, justifyContent: 'center' },
  tabLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, badgeText: { fontSize: 12, lineHeight: 16 },
  more: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  sheetChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: Spacing.one },
  switchRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, marginTop: Spacing.three },
  sheetActions: { flexDirection: 'row', gap: 8, marginTop: Spacing.two },
  sheetAction: { flex: 1, minWidth: 0 },
});
