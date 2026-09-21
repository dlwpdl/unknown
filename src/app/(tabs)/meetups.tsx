import { Pressable, ScrollView, FlatList } from '@/components/analytics-controls';
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { ActivityIndicator, DeviceEventEmitter, Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';
import { ChillingEvent } from '@/components/chilling-event';
import { CityPicker } from '@/components/city-picker';
import { MyMeetups } from '@/components/my-meetups';
import { ThemedText } from '@/components/themed-text';
import { UserSheet, type SheetUser } from '@/components/user-sheet';
import { TabBarHeight } from '@/constants/theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useCommunityCity } from '@/lib/community-city';
import { MEETUPS_CHANGED_EVENT } from '@/lib/community-data';
import { matchesChilling, discoveryCursor } from '@/lib/chilling-discovery';
import { type ChillingKind } from '@/lib/chilling';
import { appendUniquePosts, loadPublicFeed, type FeedCursor } from '@/lib/feed-data';
import { TAGS } from '@/lib/mock';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

export default function MeetupsScreen() {
  const { me, isAuthed } = useAuth();
  const { city } = useCommunityCity();
  return <MeetupDiscovery key={`${isAuthed ? me.id : 'guest'}:${city.id}`} />;
}

function MeetupDiscovery() {
  const theme = useTheme(), router = useRouter(), insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const { city } = useCommunityCity();
  const { me, isAuthed, promptLogin } = useAuth();
  const hidden = useContentVisibility();
  const [kind, setKind] = useState<ChillingKind>('once');
  const [category, setCategory] = useState('all');
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [cursor, setCursor] = useState<FeedCursor | null>(null);
  const [cityPicker, setCityPicker] = useState(false);
  const [user, setUser] = useState<SheetUser | null>(null);
  const version = useRef(0), busy = useRef(false);
  const failedCursor = useRef<FeedCursor | null>(null);
  const scope = isAuthed ? me.id : 'guest';
  const fetchPage = useCallback(async (after: FeedCursor | null = null) => {
    if (after && busy.current) return;
    const request = ++version.current;
    busy.current = true; setLoading(true); setError(false);
    try {
      const page = city.state === 'open' ? await loadPublicFeed(supabase, city.id, TAGS.find(t => t.kind === 'meetup')!.id, null, after, { viewerScope: scope }) : [];
      if (request !== version.current) return;
      setPosts(current => after ? appendUniquePosts(current, page) : page);
      setCursor(discoveryCursor(page));
    } catch { if (request === version.current) { failedCursor.current = after; setError(true); } }
    finally { if (request === version.current) { busy.current = false; setLoading(false); } }
  }, [city.id, city.state, scope]);
  useFocusEffect(useCallback(() => {
    setPosts([]); setCursor(null); void fetchPage();
    const listener = DeviceEventEmitter.addListener(MEETUPS_CHANGED_EVENT, () => void fetchPage());
    return () => { version.current++; busy.current = false; listener.remove(); };
  }, [fetchPage]));
  const open = useCallback(async (id: string) => { router.push({ pathname: '/post/[id]', params: { id } }); }, [router]);
  const visible = posts.filter(p => p.cityId === city.id && matchesChilling(p, kind, category) && !hidden('post', p.id, p.author.id));
  const action = (route: '/meetup-create' | '/meetup-profile') => isAuthed ? router.push(route) : promptLogin('모임 프로필을 만들고 함께 만나요.');
  return <SafeAreaView edges={['top', 'left', 'right']} style={[styles.root, { backgroundColor: theme.background }]}>
    <FlatList analyticsId="app_tabs_meetups.flatlist.1" data={visible} keyExtractor={p => p.id} refreshing={loading && posts.length > 0} onRefresh={() => void fetchPage()}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + TabBarHeight + 24 }]}
      ListHeaderComponent={<>
        <View style={styles.head}><View style={{ flex: 1 }}><Pressable analyticsId="app_tabs_meetups.pressable.1" onPress={() => setCityPicker(true)} accessibilityRole="button" accessibilityLabel="활동 지역 선택" style={styles.city}><ThemedText type="small" themeColor="textSecondary">{city.name}에서⌄</ThemedText></Pressable><ThemedText accessibilityRole="header" style={styles.title}>모임<ThemedText style={styles.title} themeColor="accent">.</ThemedText></ThemedText></View>
          <Pressable analyticsId="app_tabs_meetups.pressable.2" accessibilityRole="button" accessibilityLabel="내 모임 프로필" onPress={() => action('/meetup-profile')} style={[styles.circle, { backgroundColor: theme.backgroundElement }]}><ThemedText type="smallBold">{isAuthed ? me.nickname.slice(0, 1) : '나'}</ThemedText></Pressable>
          <Pressable analyticsId="app_tabs_meetups.pressable.3" accessibilityRole="button" accessibilityLabel="만남 열기" onPress={() => action('/meetup-create')} style={[styles.circle, { borderColor: theme.line, borderWidth: 1 }]}><ThemedText style={{ fontSize: 26 }}>＋</ThemedText></Pressable></View>
        <View style={[styles.segments, { backgroundColor: theme.backgroundElement }]}>{(['once', 'group'] as const).map(value => <Pressable analyticsId="app_tabs_meetups.pressable.4" key={value} accessibilityRole="tab" accessibilityState={{ selected: kind === value }} onPress={() => { setKind(value); setCategory('all'); }} style={[styles.segment, kind === value && { backgroundColor: theme.background }]}><ThemedText type="smallBold">{value === 'once' ? '칠링 (일회성)' : '모임 (정기모임)'}</ThemedText></Pressable>)}</View>
        <ThemedText themeColor="textSecondary" style={styles.lede}>{kind === 'once' ? '이번 한 번, 가볍게 만나봐요.' : '취향이 맞는 사람들과, 오래 봐요.'}</ThemedText>
        <ScrollView analyticsId="app_tabs_meetups.scrollview.1" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{[['all','전체'],['casual','가볍게'],['hobby','취미'],['travel','여행']].map(([value,label]) => <Pressable analyticsId="app_tabs_meetups.pressable.5" key={value} accessibilityRole="button" accessibilityState={{ selected: category === value }} onPress={() => setCategory(value)} style={[styles.chip, { borderColor: theme.line, backgroundColor: category === value ? theme.text : theme.background }]}><ThemedText type="small" style={{ color: category === value ? theme.background : theme.text }}>{label}</ThemedText></Pressable>)}</ScrollView>
        <ThemedText accessibilityRole="header" style={styles.section}>{kind === 'once' ? '다가오는 칠링' : '함께할 모임'}</ThemedText>
      </>}
      renderItem={({ item }) => <ChillingEvent post={item} city={city.name} onOpen={() => void open(item.id)} onAuthor={() => setUser({ ...item.author, mine: item.author.id === me.id })} />}
      ListEmptyComponent={!loading && !error ? <ThemedText themeColor="textSecondary" style={styles.empty}>{city.state !== 'open' ? '아직 준비 중인 지역이에요.' : cursor ? '이 페이지에는 조건에 맞는 만남이 없어요. 다음 만남을 더 살펴보세요.' : '아직 등록된 만남이 없어요. 첫 만남을 열어보세요.'}</ThemedText> : null}
      ListFooterComponent={<View style={{ gap: 16 }}>{loading && <ActivityIndicator color={theme.accent} accessibilityLabel="만남 불러오는 중" />}{error && <ThemedText accessibilityRole="alert">만남을 불러오지 못했어요.</ThemedText>}{!loading && (cursor || error) && <Pressable analyticsId="app_tabs_meetups.pressable.6" accessibilityRole="button" onPress={() => void fetchPage(error ? failedCursor.current : cursor)} style={styles.more}><ThemedText themeColor="accent">{error ? '다시 시도' : '만남 더 보기'}</ThemedText></Pressable>}<MyMeetups onOpen={open} /></View>} />
    <Modal visible={cityPicker} animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={() => setCityPicker(false)}><SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}><CityPicker onClose={() => setCityPicker(false)} /></SafeAreaView></Modal>
    <UserSheet user={user} onClose={() => setUser(null)} />
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1 }, content: { padding: 22, width: '100%', maxWidth: 640, alignSelf: 'center' }, head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 },
  city: { minHeight: 44, justifyContent: 'center' }, title: { fontSize: 32, lineHeight: 40, fontWeight: '800', letterSpacing: -1 }, circle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  segments: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: 12 }, segment: { flex: 1, minHeight: 44, borderRadius: 9, alignItems: 'center', justifyContent: 'center', padding: 4 },
  lede: { marginVertical: 16 }, chips: { gap: 8, paddingBottom: 24 }, chip: { minHeight: 44, paddingHorizontal: 16, borderRadius: 24, borderWidth: 1, justifyContent: 'center' },
  section: { fontSize: 18, fontWeight: '700', marginBottom: 16 }, empty: { paddingVertical: 24 }, more: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
