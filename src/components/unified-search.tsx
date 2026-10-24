import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';

import { FlatList, Pressable } from '@/components/analytics-controls';
import { SelectionChip } from '@/components/selection-chip';
import { StateCard } from '@/components/state-card';
import { GlingLoader } from '@/components/gling-loader';
import { ThemedText } from '@/components/themed-text';
import { ControlStyles, IconSize, Typography } from '@/constants/design-system';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES } from '@/lib/mock';
import { supabase } from '@/lib/supabase';
import { loadUnifiedSearch, type UnifiedSearchItem, type UnifiedSearchKind } from '@/lib/unified-search';

type Kind = Exclude<UnifiedSearchKind, 'all'>;
const kinds: UnifiedSearchKind[] = ['all', 'business', 'place', 'person', 'post', 'meetup'];
const kindActions = { all: 'search.kind.all', business: 'search.kind.business', place: 'search.kind.place', person: 'search.kind.person', post: 'search.kind.post', meetup: 'search.kind.meetup' };
const resultActions = { business: 'search.result.business', place: 'search.result.place', person: 'search.result.person', post: 'search.result.post', meetup: 'search.result.meetup' };
const identity = (item: UnifiedSearchItem) => `${item.kind}:${item.cityId}:${item.id}`;
type ContextToken = readonly unknown[];
type Result = { token: ContextToken; items: UnifiedSearchItem[]; hasMore: boolean; nextOffset: number; loadingMore: boolean; moreFailed: boolean };
type Scope = { token: ContextToken; active: boolean; controller: AbortController; morePending: boolean; result: Result | null };

export function UnifiedSearch({ initialCityId, initialQuery = '', initialKind = 'all' }: { initialCityId: string; initialQuery?: string; initialKind?: UnifiedSearchKind }) {
  const router = useRouter(), focused = useIsFocused(), hidden = useContentVisibility();
  const { isAuthed, isAuthLoading, me } = useAuth(), { play } = useInteractionFeedback();
  const [query, setQuery] = useState(initialQuery), [kind, setKind] = useState<UnifiedSearchKind>(initialKind);
  const [cityId, setCityId] = useState<string | null>(initialCityId), [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Result | null>(null), [failure, setFailure] = useState<ContextToken | null>(null);
  const needle = query.trim().replace(/^#/, '').trim(), viewer = me.id;
  const token = useMemo(() => [query, cityId, kind, viewer, isAuthed, isAuthLoading, focused, attempt, hidden] as const, [query, cityId, kind, viewer, isAuthed, isAuthLoading, focused, attempt, hidden]);
  const live = useRef<Scope | null>(null);
  const current = loaded?.token === token ? loaded : null;
  useLayoutEffect(() => {
    const scope: Scope = { token, active: focused, controller: new AbortController(), morePending: false, result: null };
    live.current = scope;
    return () => { scope.active = false; scope.controller.abort(); };
  }, [focused, token]);
  useLayoutEffect(() => { if (live.current?.token === token) live.current.result = current; }, [current, token]);
  const isCurrent = () => live.current?.token === token && live.current.active;
  const visible = (item: UnifiedSearchItem) => item.kind === 'post' || item.kind === 'meetup' ? !hidden('post', item.id)
    : item.kind === 'person' ? !hidden('user', item.id) : item.kind === 'business' ? !hidden('user', item.merchantId ?? item.id) : !item.merchantId || !hidden('user', item.merchantId);
  useEffect(() => {
    const scope = live.current;
    if (!needle || isAuthLoading || !scope?.active || scope.token !== token) return;
    const timer = setTimeout(() => {
      if (!scope.active || live.current !== scope) return;
      void loadUnifiedSearch(supabase, { query: needle, cityId, kind, offset: 0, signal: scope.controller.signal }).then(page => {
        if (scope.active && live.current === scope) setLoaded({ token, ...page, loadingMore: false, moreFailed: false });
      }).catch(() => { if (scope.active && live.current === scope && !scope.controller.signal.aborted) setFailure(token); });
    }, 250);
    return () => clearTimeout(timer);
  }, [cityId, isAuthLoading, kind, needle, token]);
  function open(item: UnifiedSearchItem) {
    const scope = live.current;
    if (!isCurrent() || isAuthLoading || !scope?.result || scope.result.token !== token) return;
    const target = scope.result.items.find(value => identity(value) === identity(item));
    if (!target || !visible(target)) return;
    play('selection'); Keyboard.dismiss();
    if (target.kind === 'business' || (target.kind === 'place' && target.merchantId)) router.push({ pathname: '/company/[id]', params: { id: target.merchantId ?? target.id } });
    else if (target.kind === 'person') router.push({ pathname: '/user/[id]', params: { id: target.id } });
    else if (target.kind === 'place') router.push({ pathname: '/map', params: { cityId: target.cityId, placeId: target.placeId ?? target.id } });
    else router.push({ pathname: '/post/[id]', params: { id: target.id } });
  }
  function more() {
    const scope = live.current;
    if (!isCurrent() || isAuthLoading || kind === 'all' || !current?.hasMore || scope?.result !== current || scope.morePending) return;
    scope.morePending = true; play('selection');
    setLoaded(previous => previous?.token === token ? { ...previous, loadingMore: true, moreFailed: false } : previous);
    void loadUnifiedSearch(supabase, { query: needle, cityId, kind, offset: current.nextOffset, signal: scope.controller.signal }).then(page => {
      if (!scope.active || live.current !== scope) return;
      setLoaded(previous => {
        if (previous?.token !== token) return previous;
        const unique = new Map(previous.items.map(value => [identity(value), value]));
        page.items.forEach(value => unique.set(identity(value), value));
        return { token, items: [...unique.values()], hasMore: page.hasMore, nextOffset: page.nextOffset, loadingMore: false, moreFailed: false };
      });
    }).catch(() => {
      if (scope.active && live.current === scope && !scope.controller.signal.aborted) {
        setLoaded(previous => previous?.token === token ? { ...previous, loadingMore: false, moreFailed: true } : previous); play('warning');
      }
    }).finally(() => { scope.morePending = false; });
  }
  return <UnifiedSearchView query={query} kind={kind} cityId={cityId} currentCityId={initialCityId} items={current?.items.filter(visible) ?? []}
    loading={!!needle && (isAuthLoading || (!current && failure !== token))} failed={failure === token} hasMore={!!current?.hasMore && kind !== 'all'}
    moreLoading={!!current?.loadingMore} moreFailed={!!current?.moreFailed}
    onBack={() => { if (!isCurrent()) return; play('selection'); Keyboard.dismiss(); if (router.canGoBack()) router.back(); else router.replace('/'); }}
    onQuery={value => { if (!isCurrent()) return; setQuery(value.slice(0, 100)); if (value.trim().startsWith('#')) setKind('post'); }}
    onClear={() => { if (!isCurrent()) return; play('selection'); setQuery(''); }}
    onKind={value => { if (!isCurrent() || !kinds.includes(value)) return; play('selection'); setKind(value); }}
    onScope={value => { if (!isCurrent() || (value !== null && value !== initialCityId)) return; play('selection'); setCityId(value); }}
    onRetry={() => { if (isCurrent()) setAttempt(value => value + 1); }} onMore={more} onOpen={open} />;
}

type ViewProps = {
  query: string; kind: UnifiedSearchKind; cityId: string | null; currentCityId: string; items: UnifiedSearchItem[];
  loading: boolean; failed: boolean; hasMore: boolean; moreLoading: boolean; moreFailed: boolean;
  onBack: () => void; onQuery: (query: string) => void; onClear: () => void; onKind: (kind: UnifiedSearchKind) => void;
  onScope: (city: string | null) => void; onRetry: () => void; onMore: () => void; onOpen: (item: UnifiedSearchItem) => void;
};
type Row = { type: 'heading'; kind: Kind } | { type: 'item'; item: UnifiedSearchItem };
export function UnifiedSearchView(props: ViewProps) {
  const theme = useTheme(), { language, tr } = useLanguage(), { play } = useInteractionFeedback(), ko = language === 'ko';
  const labels = ko ? { all: '전체', business: '비즈니스', place: '장소', person: '사람', post: '게시글', meetup: '모임' }
    : { all: 'All', business: 'Businesses', place: 'Places', person: 'People', post: 'Posts', meetup: 'Meetups' };
  const cityName = (id: string) => tr(CITIES.find(value => value.id === id)?.name ?? id);
  const rows: Row[] = props.kind === 'all' ? (kinds.filter(value => value !== 'all') as Kind[]).flatMap(kind => {
    const values = props.items.filter(item => item.kind === kind).slice(0, 3);
    return values.length ? [{ type: 'heading' as const, kind }, ...values.map(item => ({ type: 'item' as const, item }))] : [];
  }) : props.items.map(item => ({ type: 'item', item }));
  const empty = props.loading ? <View style={styles.state}><GlingLoader /><ThemedText accessibilityLiveRegion="polite" themeColor="textSecondary">{ko ? '검색하고 있어요…' : 'Searching…'}</ThemedText></View>
    : props.failed ? <View style={styles.state}><StateCard kind="error" title={ko ? '검색 결과를 불러오지 못했어요' : 'Could not load search results'} body={ko ? '연결을 확인하고 다시 시도해 주세요.' : 'Check your connection and try again.'} actionLabel={ko ? '다시 시도' : 'Try again'} onAction={props.onRetry} /></View>
      : <View style={styles.state}><StateCard kind="empty" title={props.query.trim() ? ko ? '검색 결과가 없어요' : 'No results found' : ko ? '무엇을 찾고 계세요?' : 'What are you looking for?'}
        body={props.query.trim() ? ko ? props.cityId === null ? '검색어나 종류를 바꿔서 다시 찾아보세요.' : '검색어나 종류를 바꾸거나 캐나다 전체에서 찾아보세요.' : props.cityId === null ? 'Try another search term or result type.' : 'Try another search term, result type or the Canada-wide scope.' : ko ? '비즈니스, 장소, 이웃과 게시글·모임을 한 번에 찾아보세요.' : 'Find businesses, places, people, posts and meetups in one search.'} /></View>;
  return <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={[styles.safe, { backgroundColor: theme.background }]}>
    <View style={styles.content}>
      <View style={styles.header}><Pressable analyticsId="search.back" accessibilityRole="button" accessibilityLabel={ko ? '이전 화면으로' : 'Go back'} onPress={props.onBack} style={ControlStyles.icon}>
        <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={IconSize.toolbar} tintColor={theme.text} /></Pressable><ThemedText type="sheetTitle" accessibilityRole="header" style={styles.heading}>{ko ? '통합검색' : 'Search'}</ThemedText></View>
      <View style={[styles.field, ControlStyles.field, { borderColor: theme.line, backgroundColor: theme.backgroundElement }]}><SymbolView name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }} size={IconSize.toolbar} tintColor={theme.textSecondary} />
        <TextInput value={props.query} onChangeText={props.onQuery} onFocus={() => play('selection')} onSubmitEditing={() => { play('selection'); Keyboard.dismiss(); }}
          placeholder={ko ? '이름, 장소, 이야기 검색' : 'Search names, places and stories'} accessibilityLabel={ko ? '통합검색어' : 'Search query'} placeholderTextColor={theme.textSecondary} maxLength={100} autoFocus returnKeyType="search" autoCorrect={false} style={[styles.input, { color: theme.text }]} />
        {!!props.query && <Pressable analyticsId="search.input.clear" accessibilityRole="button" accessibilityLabel={ko ? '검색어 지우기' : 'Clear search'} onPress={props.onClear} style={ControlStyles.icon}><SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={16} tintColor={theme.textSecondary} /></Pressable>}
      </View>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={ko ? '검색 지역' : 'Search area'}>
        <SelectionChip analyticsId="search.scope.city" selected={props.cityId !== null} accessibilityRole="radio" accessibilityState={{ checked: props.cityId !== null }} onPress={() => props.onScope(props.currentCityId)} style={ControlStyles.pill} baseColor={theme.backgroundElement}><ThemedText type="label" style={{ color: props.cityId !== null ? theme.accentInk : theme.text }}>{cityName(props.currentCityId)}</ThemedText></SelectionChip>
        <SelectionChip analyticsId="search.scope.canada" selected={props.cityId === null} accessibilityRole="radio" accessibilityState={{ checked: props.cityId === null }} onPress={() => props.onScope(null)} style={ControlStyles.pill} baseColor={theme.backgroundElement}><ThemedText type="label" style={{ color: props.cityId === null ? theme.accentInk : theme.text }}>{ko ? '캐나다 전체' : 'All Canada'}</ThemedText></SelectionChip>
      </View>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={ko ? '검색 종류' : 'Result type'}>{kinds.map(kind => <SelectionChip key={kind} analyticsId={kindActions[kind]} selected={props.kind === kind} accessibilityRole="radio" accessibilityState={{ checked: props.kind === kind }} onPress={() => props.onKind(kind)} style={ControlStyles.pill} baseColor={theme.backgroundElement}><ThemedText type="label" style={{ color: props.kind === kind ? theme.accentInk : theme.text }}>{labels[kind]}</ThemedText></SelectionChip>)}</View>
      <FlatList analyticsId="search.results" data={rows} keyExtractor={row => row.type === 'heading' ? `heading:${row.kind}` : identity(row.item)} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.results}
        ListEmptyComponent={empty ?? undefined} renderItem={({ item: row }) => row.type === 'heading' ? <View style={styles.group}><ThemedText type="section" accessibilityRole="header" style={styles.groupTitle}>{labels[row.kind]}</ThemedText><Pressable analyticsId="search.group.more" accessibilityRole="button" accessibilityLabel={ko ? `${labels[row.kind]} 더 보기` : `More ${labels[row.kind].toLowerCase()}`} onPress={() => props.onKind(row.kind)} style={styles.groupMore}><ThemedText type="label" themeColor="accent">{ko ? '더 보기' : 'See more'}</ThemedText></Pressable></View>
          : <Pressable analyticsId={resultActions[row.item.kind]} testID={`search.item.${identity(row.item)}`} accessibilityRole="button" accessibilityLabel={[labels[row.item.kind], row.item.title, row.item.subtitle, props.cityId === null ? cityName(row.item.cityId) : ''].filter(Boolean).join(', ')} onPress={() => props.onOpen(row.item)} style={({ pressed }) => [styles.result, { borderColor: theme.line, backgroundColor: theme.card, opacity: pressed ? 0.82 : 1 }]}>
            {row.item.imageUri ? <Image source={{ uri: row.item.imageUri }} style={styles.image} contentFit="cover" accessible={false} /> : <View style={[styles.image, { backgroundColor: theme.backgroundElement }]}><SymbolView name={{ ios: row.item.kind === 'person' ? 'person.crop.circle' : row.item.kind === 'business' ? 'storefront' : row.item.kind === 'place' ? 'mappin.and.ellipse' : 'text.bubble', android: row.item.kind === 'person' ? 'person' : 'search', web: 'search' }} size={22} tintColor={theme.textSecondary} /></View>}
            <View style={styles.resultText}><ThemedText type="menu" numberOfLines={2}>{row.item.title}</ThemedText>{!!row.item.subtitle && <ThemedText type="supporting" themeColor="textSecondary" numberOfLines={2}>{row.item.subtitle}</ThemedText>}{props.cityId === null && <ThemedText type="caption" themeColor="accent">{cityName(row.item.cityId)}</ThemedText>}</View><SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={14} tintColor={theme.textSecondary} />
          </Pressable>}
        ListFooterComponent={props.hasMore ? <View style={styles.footer}>{props.moreFailed && <ThemedText accessibilityLiveRegion="polite" themeColor="textSecondary">{ko ? '다음 결과를 불러오지 못했어요. 다시 시도해 주세요.' : 'Could not load more results. Please try again.'}</ThemedText>}<Pressable analyticsId="search.more" accessibilityRole="button" disabled={props.moreLoading} onPress={props.onMore} style={[ControlStyles.action, { borderWidth: 1, borderColor: theme.line, opacity: props.moreLoading ? 0.6 : 1 }]}><ThemedText type="menu" themeColor="accent">{props.moreLoading ? ko ? '불러오는 중…' : 'Loading…' : props.moreFailed ? ko ? '다시 불러오기' : 'Try again' : ko ? '더 보기' : 'Load more'}</ThemedText></Pressable></View> : undefined} />
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, content: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.four, paddingTop: Spacing.two }, heading: { flex: 1, minWidth: 0 },
  field: { flexDirection: 'row', alignItems: 'center', marginHorizontal: Spacing.four, marginTop: Spacing.three, gap: Spacing.two },
  input: { flex: 1, minWidth: 0, minHeight: 48, paddingVertical: Spacing.three, ...Typography.body },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingHorizontal: Spacing.four, marginTop: Spacing.three },
  results: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, paddingTop: Spacing.two }, state: { paddingTop: Spacing.five, gap: Spacing.three },
  group: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.three }, groupTitle: { flex: 1, minWidth: 0 }, groupMore: { minHeight: 44, minWidth: 44, paddingHorizontal: Spacing.two, justifyContent: 'center' },
  result: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three, borderWidth: 1, borderRadius: 16, marginTop: Spacing.two, minHeight: 72 },
  image: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, resultText: { flex: 1, minWidth: 0, gap: Spacing.one }, footer: { paddingVertical: Spacing.four, gap: Spacing.three },
});
