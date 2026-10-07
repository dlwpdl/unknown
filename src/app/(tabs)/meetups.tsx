import { GlingLoader } from '@/components/gling-loader';
import { Pressable, FlatList, Switch } from '@/components/analytics-controls';
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Animated, DeviceEventEmitter, Easing, Keyboard, LayoutAnimation, Modal, Platform, StyleSheet, TextInput, UIManager, useWindowDimensions, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { ChillingEvent } from '@/components/chilling-event';
import { GlassSurface } from '@/components/glass-surface';
import { MeetupKindSwitch } from '@/components/meetup-kind-switch';
import { CityPicker } from '@/components/city-picker';
import { MyMeetups } from '@/components/my-meetups';
import { relationshipSlotData } from '@/components/relationship-slot-card';
import { StateCard } from '@/components/state-card';
import { TabContent } from '@/components/tab-content';
import { ThemedText } from '@/components/themed-text';
import { UserSheet, type SheetUser } from '@/components/user-sheet';
import { Depth, Spacing, TabBarHeight } from '@/constants/theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useCommunityCity } from '@/lib/community-city';
import { loadPendingMeetupRequests, MEETUPS_CHANGED_EVENT } from '@/lib/community-data';
import { discoveryCursor, hasOpenSeat, matchesChilling, matchesChillingWindow, sortChillings, type ChillingWindow } from '@/lib/chilling-discovery';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useMembership } from '@/lib/membership-provider';
import { type ChillingKind } from '@/lib/chilling';
import { appendUniquePosts, loadPublicFeed, type FeedCursor } from '@/lib/feed-data';
import { TAGS } from '@/lib/mock';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

export default function MeetupsScreen() {
  const { me, isAuthed } = useAuth();
  const { city } = useCommunityCity();
  const { ticketmasterEventId } = useLocalSearchParams<{ ticketmasterEventId?: string }>();
  const eventId = typeof ticketmasterEventId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(ticketmasterEventId) ? ticketmasterEventId : '';
  return <MeetupDiscovery key={`${isAuthed ? me.id : 'guest'}:${city.id}:${eventId}`} eventId={eventId} />;
}

function MeetupDiscovery({ eventId }: { eventId: string }) {
  const theme = useTheme(), router = useRouter(), insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const { height: screenHeight, fontScale } = useWindowDimensions();
  const { city } = useCommunityCity();
  const { me, isAuthed, promptLogin } = useAuth();
  const { membership } = useMembership();
  const { play } = useInteractionFeedback();
  const slots = relationshipSlotData(membership, 'meetup');
  const hidden = useContentVisibility();
  const [kind, setKind] = useState<ChillingKind>('once');
  const [category, setCategory] = useState('all');
  const [dateWindow, setDateWindow] = useState<ChillingWindow>('all');
  const [seatsOnly, setSeatsOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState(eventId);
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
  const [sheetOffset] = useState(() => new Animated.Value(screenHeight));
  const searchInput = useRef<TextInput>(null);
  const version = useRef(0), busy = useRef(false);
  const failedCursor = useRef<FeedCursor | null>(null);
  const scope = isAuthed ? me.id : 'guest';
  const fetchPage = useCallback(async (after: FeedCursor | null = null) => {
    if (after && busy.current) return;
    const request = ++version.current;
    busy.current = true; setLoading(true); setError(false);
    try {
      const page = city.state === 'open' ? await loadPublicFeed(supabase, city.id, TAGS.find(t => t.kind === 'meetup')!.id, query || null, after, { viewerScope: scope }) : [];
      if (request !== version.current) return;
      setPosts(current => after ? appendUniquePosts(current, page) : page);
      setCursor(discoveryCursor(page));
    } catch { if (request === version.current) { failedCursor.current = after; setError(true); } }
    finally { if (request === version.current) { busy.current = false; setLoading(false); } }
  }, [city.id, city.state, scope, query]);
  useFocusEffect(useCallback(() => {
    setPosts([]); setCursor(null); void fetchPage();
    const listener = DeviceEventEmitter.addListener(MEETUPS_CHANGED_EVENT, () => void fetchPage());
    return () => { version.current++; busy.current = false; listener.remove(); };
  }, [fetchPage]));
  // 호스트가 처리할 승인 대기만 헤더에 알린다. 승인·거절은 대화 탭 요청함에서 한다.
  useFocusEffect(useCallback(() => {
    if (!isAuthed) { setPendingCount(0); return; }
    let active = true;
    const load = async () => {
      try { const requests = await loadPendingMeetupRequests(supabase, me.id); if (active) setPendingCount(requests.length); }
      catch { if (active) setPendingCount(0); }
    };
    void load();
    const listener = DeviceEventEmitter.addListener(MEETUPS_CHANGED_EVENT, () => void load());
    return () => { active = false; listener.remove(); };
  }, [isAuthed, me.id]));
  const open = useCallback(async (id: string) => { router.push({ pathname: '/post/[id]', params: { id } }); }, [router]);
  const filtered = posts.filter(p => p.cityId === city.id && matchesChilling(p, kind, category) && matchesChillingWindow(p, dateWindow)
    && (!seatsOnly || hasOpenSeat(p.room)) && !hidden('post', p.id, p.author.id));
  const visible = sortChillings(filtered, kind);
  const initialLoading = loading && posts.length === 0;
  const narrowed = !!query || dateWindow !== 'all' || seatsOnly || category !== 'all';
  // 목록 화면은 목록이 먼저 보여야 한다. 상세 필터는 한 줄로 접고 시트에서만 편다.
  const activeFilters = (category !== 'all' ? 1 : 0) + (dateWindow !== 'all' ? 1 : 0) + (seatsOnly ? 1 : 0);
  const clearFilters = () => { setCategory('all'); setDateWindow('all'); setSeatsOnly(false); };
  const changeKind = (next: ChillingKind) => {
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
  const closeFilters = () => {
    if (reducedMotion) { setFiltersOpen(false); return; }
    Animated.timing(sheetOffset, { toValue: screenHeight, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true })
      .start(({ finished }) => { if (finished) setFiltersOpen(false); });
  };
  const toggleSearch = () => {
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
    if (!isAuthed) return promptLogin(eventId && route === '/meetup-create' ? '이 행사에 갈 모임을 만들려면 가입하거나 로그인해 주세요.' : '모임 프로필을 만들고 함께 만나요.');
    if (route === '/meetup-create' && eventId) return router.push({ pathname: route, params: { ticketmasterEventId: eventId, ticketmasterCityId: city.id } });
    router.push(route);
  };
  return <TabContent style={styles.root}><SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, { backgroundColor: theme.background }]}>
    {/* 헤더는 스크롤과 함께 사라지면 안 된다(홈과 동일). 목록 밖에 두고 고정한다. */}
    <View style={[styles.head, styles.headFixed, fontScale > 1.2 && styles.headLarge, { backgroundColor: theme.background }]}>
      <ThemedText accessibilityRole="header" style={[styles.title, fontScale > 1.2 && styles.titleLarge]}>모임<ThemedText style={styles.title} themeColor="accent">.</ThemedText></ThemedText>
      <GlassSurface tone="control" interactive style={[styles.cityGlass, fontScale > 1.2 && styles.cityGlassLarge]}><Pressable analyticsId="app_tabs_meetups.pressable.1" onPress={() => { play('selection'); setCityPicker(true); }} accessibilityRole="button" accessibilityLabel={`${city.name} 활동 지역 선택`} style={({ pressed }) => [styles.city, { backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent' }]}><ThemedText type="small" themeColor="textSecondary" numberOfLines={1} maxFontSizeMultiplier={1.3} style={styles.cityText}>{city.name}에서</ThemedText><SymbolView name={{ ios: 'chevron.down', android: 'keyboard_arrow_down', web: 'keyboard_arrow_down' }} size={14} tintColor={theme.textSecondary} /></Pressable></GlassSurface>
      <GlassSurface tone="control" interactive style={styles.circleGlass}><Pressable analyticsId="app_tabs_meetups.pressable.13" accessibilityRole="button" accessibilityLabel={searchOpen ? '검색 닫기' : '모임 검색'} accessibilityState={{ expanded: searchOpen }}
        onPress={toggleSearch} style={({ pressed }) => [styles.circle, { backgroundColor: pressed || searchOpen ? 'rgba(255,255,255,0.13)' : 'transparent' }]}>
        <SymbolView name={{ ios: searchOpen ? 'xmark' : 'magnifyingglass', android: searchOpen ? 'close' : 'search', web: searchOpen ? 'close' : 'search' }} size={20} tintColor={searchOpen ? theme.accent : theme.text} />
      </Pressable></GlassSurface>
      <GlassSurface tone="control" interactive style={styles.circleGlass}><Pressable analyticsId="app_tabs_meetups.pressable.2" accessibilityRole="button" accessibilityLabel="내 모임 프로필" onPress={() => { play('selection'); action('/meetup-profile'); }} style={({ pressed }) => [styles.circle, { backgroundColor: pressed ? 'rgba(255,255,255,0.13)' : 'transparent' }]}><ThemedText type="smallBold">{isAuthed ? me.nickname.slice(0, 1) : '나'}</ThemedText></Pressable></GlassSurface>
      {/* 만들기는 화면당 하나뿐인 primary — 하단 고정 라벨 버튼이 맡고, 헤더에서는 뺐다. */}
    </View>
    {searchOpen && <Animated.View style={[styles.searchRow, { backgroundColor: theme.background, borderBottomColor: theme.line, opacity: reducedMotion ? 1 : searchMotion, transform: [{ translateY: searchMotion.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }, { scale: searchMotion.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) }] }]}>
      <TextInput ref={searchInput} value={search} onChangeText={setSearch} onSubmitEditing={() => { setQuery(search.trim()); Keyboard.dismiss(); }} returnKeyType="search"
        accessibilityLabel="모임 검색어" placeholder="모임·동네·키워드 검색" placeholderTextColor={theme.textSecondary} maxLength={40}
        style={[styles.search, { color: theme.text, borderColor: theme.line, backgroundColor: theme.card }]} />
      <Pressable analyticsId="app_tabs_meetups.pressable.8" accessibilityRole="button" accessibilityLabel="검색"
        onPress={() => { play('reaction'); setQuery(search.trim()); Keyboard.dismiss(); }} style={({ pressed }) => [styles.searchButton, Depth.control, { backgroundColor: theme.accent, borderBottomColor: theme.accentDepth, transform: [{ translateY: pressed ? 2 : 0 }] }]}>
        <ThemedText type="smallBold" style={{ color: theme.accentInk }}>검색</ThemedText>
      </Pressable>
    </Animated.View>}
    <FlatList analyticsId="app_tabs_meetups.flatlist.1" data={visible} keyExtractor={p => p.id} keyboardShouldPersistTaps="handled" refreshing={loading && posts.length > 0} onRefresh={() => void fetchPage()}
      // 하단 고정 '모임 만들기' 버튼이 마지막 카드를 가리지 않도록 그만큼 비워 둔다.
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + TabBarHeight + 84, flexGrow: initialLoading ? 1 : undefined, justifyContent: initialLoading ? 'center' : undefined }]}
      ListHeaderComponent={initialLoading ? null : <>
        <Pressable analyticsId="ticketmaster.discover" accessibilityRole="button" accessibilityLabel="이 지역 공연과 행사 보기" onPress={() => { play('selection'); router.push('/events'); }} style={({ pressed }) => [styles.pending, Depth.card, { borderColor: theme.line, backgroundColor: theme.card, opacity: pressed ? 0.9 : 1, transform: [{ translateY: pressed ? 2 : 0 }] }]}>
          <ThemedText type="smallBold">함께 가고 싶은 공연·행사</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{city.name}에서 찾고, 같이 갈 모임을 열어요 ›</ThemedText>
        </Pressable>
        {pendingCount > 0 && <Pressable analyticsId="app_tabs_meetups.pressable.7" accessibilityRole="button" accessibilityLabel={`참여 신청 ${pendingCount}건 처리하기`}
          onPress={() => { play('selection'); router.push({ pathname: '/chat', params: { view: 'requests' } }); }} style={({ pressed }) => [styles.pending, Depth.card, { borderColor: theme.accent, backgroundColor: theme.card, opacity: pressed ? 0.9 : 1, transform: [{ translateY: pressed ? 2 : 0 }] }]}>
          <ThemedText type="smallBold" themeColor="accent">참여 신청 {pendingCount}건</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">프로필을 검토하고 승인·거절해요 ›</ThemedText>
        </Pressable>}
        <View style={styles.filterRow}>
          <MeetupKindSwitch value={kind} onChange={changeKind} analyticsId="app_tabs_meetups.pressable.4" />
          <GlassSurface tone="control" interactive style={[styles.filterGlass, activeFilters > 0 && { borderColor: theme.accent }]}><Pressable analyticsId="app_tabs_meetups.pressable.14" accessibilityRole="button" accessibilityLabel={activeFilters ? `필터, ${activeFilters}개 적용됨` : '필터'}
            onPress={() => { play('reaction'); setFiltersOpen(true); }}
            style={({ pressed }) => [styles.filterButton, { backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent' }]}>
            <SymbolView name={{ ios: 'slider.horizontal.3', android: 'tune', web: 'tune' }} size={16} tintColor={activeFilters ? theme.accent : theme.text} />
            <ThemedText type="smallBold" themeColor={activeFilters ? 'accent' : 'text'}>{activeFilters ? `필터 · ${activeFilters}` : '필터'}</ThemedText>
          </Pressable></GlassSurface>
        </View>
        {slots && <Pressable analyticsId="app_tabs_meetups.pressable.12" accessibilityRole="button" accessibilityLabel={`모임 자리 ${slots.active} / ${slots.limit}, 남은 자리 ${slots.available}`}
          onPress={() => { play('selection'); router.push('/profile/membership'); }} style={({ pressed }) => [styles.slots, { opacity: pressed ? 0.7 : 1 }]}>
          <ThemedText type="small" themeColor="textSecondary">동시 모임 자리 <ThemedText type="smallBold">{slots.active}/{slots.limit}</ThemedText> 사용 중 · 남은 {slots.available}개</ThemedText>
          <ThemedText type="smallBold" themeColor="accent">{slots.available === 0 ? '자리 늘리기 ›' : '멤버십 ›'}</ThemedText>
        </Pressable>}
        {!!query && <Pressable analyticsId="app_tabs_meetups.pressable.9" accessibilityRole="button" accessibilityLabel={query === eventId ? '행사 모임 검색 해제' : `검색어 ${query} 해제`}
          onPress={() => { play('selection'); setSearch(''); setQuery(''); if (eventId) router.setParams({ ticketmasterEventId: '' }); }} style={({ pressed }) => [styles.clear, { opacity: pressed ? 0.65 : 1 }]}><ThemedText type="small" themeColor="accent">{query === eventId ? '이 행사 모임 검색 중 · 지우기' : `“${query}” 검색 중 · 지우기`}</ThemedText></Pressable>}
        <Animated.View style={[styles.sectionRow, { opacity: listOpacity }]}>
          <ThemedText accessibilityRole="header" style={styles.section}>{kind === 'once' ? '다가오는 칠링' : '함께할 모임'}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.sectionNote}>{kind === 'once' ? '이번 한 번, 가볍게 만나봐요.' : '취향이 맞는 사람들과, 오래 봐요.'}</ThemedText>
        </Animated.View>
      </>}
      renderItem={({ item, index }) => <Reanimated.View entering={reducedMotion ? undefined : FadeInDown.delay(Math.min(index, 5) * 65).duration(360)}><Animated.View style={{ opacity: listOpacity }}><ChillingEvent post={item} city={city.name} onOpen={() => void open(item.id)} onAuthor={() => setUser({ ...item.author, mine: item.author.id === me.id })} /></Animated.View></Reanimated.View>}
      ListEmptyComponent={initialLoading ? <View style={styles.loadingState}><GlingLoader color={theme.accent} accessibilityLabel="만남 불러오는 중" /></View>
        : !loading && !error ? <Animated.View style={{ opacity: listOpacity }}>{city.state !== 'open'
        ? <StateCard title="이 지역은 아직 준비 중이에요" body="다른 동네를 골라보거나, 곧 문을 열 때 알려드릴게요." />
        : eventId && query === eventId ? <StateCard title="이 행사에 갈 모임이 아직 없어요" body="아래 버튼으로 첫 모임을 열어 함께 갈 사람을 찾아보세요." />
          : narrowed ? <StateCard title="조건에 맞는 만남이 없어요" body="검색어나 필터를 바꾸면 더 찾을 수 있어요." actionLabel="필터 초기화" onAction={() => { setSearch(''); setQuery(''); clearFilters(); }} />
          : cursor ? <StateCard title="이 페이지에는 조건에 맞는 만남이 없어요" body="아래에서 다음 만남을 더 살펴보세요." />
            : <StateCard title="아직 등록된 만남이 없어요" body="가까운 동네에서 첫 모임을 열어보세요. 한 명이 신청하면 바로 알려드려요." />}</Animated.View> : null}
      ListFooterComponent={initialLoading ? null : <View style={{ gap: 16, paddingTop: Spacing.four }}>{loading && <GlingLoader color={theme.accent} accessibilityLabel="만남 더 불러오는 중" />}
        {error && <StateCard kind="error" title="만남을 불러오지 못했어요" body="연결이 잠시 끊겼어요. 다시 시도해 주세요." actionLabel="다시 시도" onAction={() => void fetchPage(failedCursor.current)} />}
        {!loading && !error && cursor && <Pressable analyticsId="app_tabs_meetups.pressable.6" accessibilityRole="button" onPress={() => { play('selection'); void fetchPage(cursor); }} style={styles.more}><ThemedText themeColor="accent">만남 더 보기</ThemedText></Pressable>}
        <MyMeetups onOpen={open} showLoadingIndicator={false} /></View>} />
    {/* 화면에서 가장 중요한 행동. 스크롤 위치와 무관하게 항상 보이도록 하단에 고정한다. */}
    <Pressable analyticsId="app_tabs_meetups.pressable.3" accessibilityRole="button" accessibilityLabel={eventId ? '이 행사 모임 만들기' : '모임 만들기'}
      onPress={() => { play('selection'); action('/meetup-create'); }}
      style={({ pressed }) => [styles.fab, { backgroundColor: theme.accent, shadowColor: '#000', bottom: insets.bottom + TabBarHeight + 16, transform: [{ translateY: pressed ? 2 : 0 }, { scale: pressed && !reducedMotion ? 0.98 : 1 }] }]}>
      <ThemedText style={{ fontSize: 18, color: theme.accentInk }}>＋</ThemedText>
      <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{eventId ? '이 행사 모임 만들기' : '모임 만들기'}</ThemedText>
    </Pressable>
    <Modal visible={cityPicker} animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={() => setCityPicker(false)}><SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}><CityPicker onClose={() => setCityPicker(false)} /></SafeAreaView></Modal>
    {/* 카테고리·일정·자리 남음은 시트에서만 편다(목록이 먼저 보여야 한다). 값은 켜는 즉시 적용된다. */}
    <Modal visible={filtersOpen} transparent animationType="none" onRequestClose={closeFilters}
      onShow={() => { sheetOffset.setValue(screenHeight); if (reducedMotion) sheetOffset.setValue(0); else Animated.timing(sheetOffset, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }}>
      <View style={styles.sheetWrap}>
        <Pressable analyticsId="app_tabs_meetups.pressable.15" accessibilityRole="button" accessibilityLabel="필터 닫기" onPress={() => { play('selection'); closeFilters(); }} style={styles.scrim} />
        <Animated.View style={{ transform: [{ translateY: sheetOffset }] }}><GlassSurface style={styles.sheetGlass}><SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.sheetHead}>
            <ThemedText type="subtitle">필터</ThemedText>
            <Pressable analyticsId="app_tabs_meetups.pressable.15" accessibilityRole="button" accessibilityLabel="필터 닫기" onPress={() => { play('selection'); closeFilters(); }} style={({ pressed }) => [styles.circle, Depth.control, { backgroundColor: theme.backgroundElement, transform: [{ translateY: pressed ? 2 : 0 }] }]}>
              <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={19} tintColor={theme.text} />
            </Pressable>
          </View>
          <ThemedText type="smallBold">분위기</ThemedText>
          <View style={styles.sheetChips}>{[['all','전체'],['party','파티'],['festival','페스티벌'],['sports','스포츠'],['casual','가볍게'],['hobby','취미'],['travel','여행']].map(([value,label]) => <Pressable analyticsId="app_tabs_meetups.pressable.5" key={value} accessibilityRole="radio" aria-checked={category === value} accessibilityState={{ selected: category === value }} onPress={() => { play('selection'); setCategory(value); }} style={({ pressed }) => [styles.chip, Depth.control, { borderColor: category === value ? theme.accent : theme.line, borderBottomColor: category === value ? theme.accentDepth : theme.line, backgroundColor: category === value ? theme.accent : theme.card, borderBottomWidth: 3, transform: [{ translateY: pressed ? 2 : 0 }] }]}><ThemedText type="smallBold" style={{ color: category === value ? theme.accentInk : theme.text }}>{label}</ThemedText></Pressable>)}</View>
          {kind === 'once' && <><ThemedText type="smallBold">일정</ThemedText>
            <View style={styles.sheetChips}>{([['all','일정 전체'],['today','오늘'],['week','7일 이내']] as const).map(([value,label]) => <Pressable analyticsId="app_tabs_meetups.pressable.10" key={value} accessibilityRole="radio" aria-checked={dateWindow === value} accessibilityState={{ selected: dateWindow === value }} onPress={() => { play('selection'); setDateWindow(value); }} style={({ pressed }) => [styles.chip, Depth.control, { borderColor: dateWindow === value ? theme.accentDepth : theme.line, backgroundColor: dateWindow === value ? theme.accent : theme.card, borderBottomWidth: 3, transform: [{ translateY: pressed ? 2 : 0 }] }]}><ThemedText type="smallBold" style={{ color: dateWindow === value ? theme.accentInk : theme.text }}>{label}</ThemedText></Pressable>)}</View></>}
          {/* 켜짐/꺼짐은 칩이 아니라 스위치로 — 모양이 의미를 따라간다. */}
          <View style={styles.switchRow}>
            <View style={styles.flexText}>
              <ThemedText type="smallBold">자리 남음만 보기</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">정원이 찬 모임은 숨겨요.</ThemedText>
            </View>
            <Switch analyticsId="app_tabs_meetups.switch.1" accessibilityLabel="자리 남음만 보기" value={seatsOnly} onValueChange={value => { play('selection'); setSeatsOnly(value); }} />
          </View>
          <View style={styles.sheetActions}>
            <Pressable analyticsId="app_tabs_meetups.pressable.16" accessibilityRole="button" onPress={() => { play('selection'); clearFilters(); }} style={({ pressed }) => [styles.ghostButton, Depth.control, { backgroundColor: theme.card, borderColor: theme.line, transform: [{ translateY: pressed ? 2 : 0 }] }]}><ThemedText type="smallBold">필터 초기화</ThemedText></Pressable>
            <Pressable analyticsId="app_tabs_meetups.pressable.15" accessibilityRole="button" onPress={() => { play('selection'); closeFilters(); }} style={({ pressed }) => [styles.sheetPrimary, Depth.control, { backgroundColor: theme.accent, borderBottomColor: theme.accentDepth, transform: [{ translateY: pressed ? 2 : 0 }] }]}><ThemedText type="smallBold" style={{ color: theme.accentInk }}>목록 보기</ThemedText></Pressable>
          </View>
        </SafeAreaView></GlassSurface></Animated.View>
      </View>
    </Modal>
    <UserSheet user={user} onClose={() => setUser(null)} />
  </SafeAreaView></TabContent>;
}
const styles = StyleSheet.create({
  root: { flex: 1 }, content: { padding: 22, width: '100%', maxWidth: 640, alignSelf: 'center' }, head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 },
  loadingState: { alignItems: 'center', justifyContent: 'center' },
  flexText: { flexShrink: 1, gap: 2 },
  // 목록 밖에 고정되는 헤더: 좌우 여백은 목록과 맞춘다.
  headFixed: { marginBottom: 0, paddingHorizontal: 22, paddingTop: Spacing.one, paddingBottom: 10, width: '100%', maxWidth: 640, alignSelf: 'center' }, headLarge: { flexWrap: 'wrap' }, titleLarge: { width: '100%' },
  city: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.one, borderRadius: 12, paddingHorizontal: Spacing.two, flexShrink: 1 }, cityText: { fontSize: 14, lineHeight: 20, flexShrink: 1 }, cityGlass: { marginLeft: 'auto', flexShrink: 1, borderRadius: 12 }, cityGlassLarge: { minWidth: 176 }, title: { fontSize: 32, lineHeight: 40, fontWeight: '800', letterSpacing: -1 }, circle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, circleGlass: { borderRadius: 22 }, filterGlass: { borderRadius: 12 },
  fab: { position: 'absolute', right: 22, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 20, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', shadowOpacity: 0.38, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  filterButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, paddingHorizontal: 14 },
  chips: { gap: 8 }, chip: { minHeight: 44, paddingHorizontal: 16, borderRadius: 24, borderWidth: 1, justifyContent: 'center' },
  pending: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 2, marginBottom: 16 },
  slots: { minHeight: 44, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 12 },
  searchRow: { width: '100%', maxWidth: 640, alignSelf: 'center', flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 22, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth }, search: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 15 },
  searchButton: { minHeight: 48, paddingHorizontal: 20, borderRadius: 10, borderBottomWidth: 3, alignItems: 'center', justifyContent: 'center' },
  clear: { minHeight: 44, justifyContent: 'center' },
  sectionRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  section: { fontSize: 18, fontWeight: '700' }, sectionNote: { flexShrink: 1 },
  more: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  // 시트 뒤를 살짝 가라앉혀 "지금은 시트 안"이라는 것을 분명히 한다.
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.28)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: Spacing.three, gap: Spacing.two },
  sheetGlass: { borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: Spacing.one },
  sheetChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: Spacing.one },
  switchRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sheetActions: { flexDirection: 'row', gap: 8, marginTop: Spacing.two },
  ghostButton: { flex: 1, minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  sheetPrimary: { flex: 2, minHeight: 52, borderRadius: 14, borderBottomWidth: 3, alignItems: 'center', justifyContent: 'center' },
});
