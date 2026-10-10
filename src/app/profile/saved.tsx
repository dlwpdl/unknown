import { GlingLoader } from '@/components/gling-loader';
import { useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoginPanel } from '@/components/login-panel';
import { Pressable } from '@/components/analytics-controls';
import { StateCard } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Depth, MaxContentWidth, Spacing } from '@/constants/theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { loadSavedPosts } from '@/lib/community-data';
import { appendUniquePosts, type FeedCursor } from '@/lib/feed-data';
import { loadSavedMerchants, type SavedMerchantPage } from '@/lib/merchant-conveniences';
import type { MerchantProfile } from '@/lib/merchant-profile';
import { visibleMeetupBody } from '@/lib/meetup-ai';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

type SavedPage = SavedMerchantPage & { posts: Post[]; cursor: FeedCursor | null };

export default function SavedPostsScreen() {
  const auth = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const hidden = useContentVisibility();
  const { play } = useInteractionFeedback();
  const [tab, setTab] = useState<'posts' | 'merchants'>('posts'), [revision, setRevision] = useState(0);
  const key = `${auth.isAuthLoading ? 'loading' : auth.isAuthed ? auth.me.id : 'guest'}:${tab}`;
  const [result, setResult] = useState<{ key: string; visibility: typeof hidden; page: SavedPage | null; failed: boolean; appendFailed: boolean } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const request = useRef({ active: false, reading: false });
  const current = result?.key === key && result.visibility === hidden ? result : null;
  const page = current?.page, loading = busyKey === key || !current;
  const rows: (Post | MerchantProfile)[] = tab === 'posts' ? (page?.posts ?? []).filter(post => !hidden('post', post.id, post.author.id)) : page?.merchants ?? [];
  const readPage = useCallback(async (offset = 0, cursor: FeedCursor | null = null): Promise<SavedPage> => {
    if (tab === 'merchants') return { ...await loadSavedMerchants(supabase, offset), posts: [], cursor: null };
    const posts = await loadSavedPosts(supabase, cursor), last = posts.at(-1);
    return { posts, merchants: [], nextOffset: 0, has_more: posts.length === 30 && !!last?.createdAt,
      cursor: last?.createdAt ? { createdAt: last.createdAt, id: last.id } : null };
  }, [tab]);
  const reload = () => { play('selection'); setRevision(value => value + 1); };
  useFocusEffect(useCallback(() => {
    if (!auth.isAuthed || auth.isAuthLoading) return;
    const operation = { active: true, reading: true };
    request.current = operation; setBusyKey(key);
    void readPage().then(page => {
      if (operation.active) setResult({ key, visibility: hidden, page, failed: false, appendFailed: false });
    }).catch(() => {
      if (operation.active) setResult(previous => ({ key, visibility: hidden, page: previous?.key === key && previous.visibility === hidden ? previous.page : null, failed: true, appendFailed: false }));
    }).finally(() => { operation.reading = false; if (operation.active) setBusyKey(null); });
    return () => { operation.active = false; };
  // Pull-to-refresh retries this same account and selection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.isAuthed, auth.isAuthLoading, key, hidden, readPage, revision]));

  async function more() {
    const operation = request.current;
    if (!page?.has_more || loading || operation.reading || !operation.active) return;
    operation.reading = true; setBusyKey(key); play('selection');
    try {
      const next = await readPage(page.nextOffset, page.cursor);
      if (!operation.active) return;
      setResult(previous => previous?.key === key && previous.visibility === hidden && previous.page ? { key, visibility: hidden,
        page: { ...next, posts: appendUniquePosts(previous.page.posts, next.posts), merchants: [...new Map([...previous.page.merchants, ...next.merchants].map(row => [row.id, row])).values()] }, failed: false, appendFailed: false } : previous);
      play('success');
    } catch {
      if (operation.active) { setResult(previous => previous?.key === key ? { ...previous, failed: true, appendFailed: true } : previous); play('warning'); }
    } finally { operation.reading = false; if (operation.active) setBusyKey(null); }
  }
  const retry = () => { if (current?.appendFailed) void more(); else reload(); };

  if (!auth.isAuthed) return <LoginPanel reason="저장한 글과 비즈니스를 보려면 로그인해 주세요." onApple={auth.signInApple} onKakao={auth.signInKakao} onGoogle={auth.signInGoogle} onDevLogin={auth.signInDev} loading={auth.isAuthLoading} error={auth.authError} />;

  return <ThemedView style={styles.root}><SafeAreaView edges={['bottom']} style={styles.safeArea}>
    <FlatList<Post | MerchantProfile>
      data={rows}
      keyExtractor={(post) => post.id}
      contentContainerStyle={styles.list}
      refreshing={loading}
      onRefresh={reload}
      ListHeaderComponent={<View>
        <View style={[styles.tabs, { borderBottomColor: theme.line }]} accessibilityRole="tablist">
          {(['posts', 'merchants'] as const).map(kind => <Pressable key={kind} analyticsId={`saved.tab.${kind}`} accessibilityRole="tab" accessibilityLabel={kind === 'posts' ? '저장한 글·모임' : '저장한 비즈니스'}
            accessibilityState={{ selected: kind === tab }} style={[styles.tab, { borderBottomColor: kind === tab ? theme.accent : 'transparent' }]}
            onPress={() => { play('selection'); setTab(kind); }}><ThemedText type="smallBold" themeColor={kind === tab ? 'accent' : 'textSecondary'}>{kind === 'posts' ? '글·모임' : '비즈니스'}</ThemedText></Pressable>)}
        </View>
        <View style={styles.intro}><ThemedText type="small" themeColor="textSecondary" style={styles.introText}>{tab === 'posts' ? '저장해 둔 글과 모임을 다시 찾아보세요.' : '관심 있는 비즈니스를 다시 찾아보세요.'}</ThemedText>{rows.length > 0 && <ThemedText type="smallBold" themeColor="accent">{rows.length}개 표시 중</ThemedText>}</View>
      </View>}
      ListEmptyComponent={loading
        ? <GlingLoader color={theme.accent} accessibilityLabel={tab === 'posts' ? t.profile.savedLoading : '저장한 비즈니스를 불러오는 중'} style={styles.state} />
        : <View style={styles.state}><StateCard kind={current?.failed ? 'error' : 'empty'} title={current?.failed ? t.profile.savedError : tab === 'posts' ? t.profile.savedEmpty : '저장한 비즈니스가 없어요'} body={current?.failed ? '연결을 확인하고 다시 시도해 주세요.' : tab === 'posts' ? '관심 가는 글이나 모임에서 저장을 누르면 여기에 모여요.' : '비즈니스 프로필에서 저장을 누르면 여기에 모여요.'} actionLabel={current?.failed ? '다시 시도' : '오늘 글 둘러보기'} onAction={current?.failed ? retry : () => router.push('/')} /></View>}
      ListFooterComponent={<View style={styles.footer}>
        {loading && rows.length > 0 && <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">불러오는 중…</ThemedText>}
        {current?.failed && rows.length > 0 && <><ThemedText type="small" accessibilityRole="alert">목록을 불러오지 못했어요. 앞서 불러온 항목은 유지돼요.</ThemedText>
          <Pressable analyticsId="saved.retry" accessibilityRole="button" accessibilityLabel="저장 목록 다시 불러오기" disabled={loading} accessibilityState={{ disabled: loading }} style={styles.action} onPress={retry}><ThemedText themeColor="accent">다시 시도</ThemedText></Pressable></>}
        {page?.has_more && !current?.failed && <Pressable analyticsId="saved.more" accessibilityRole="button" accessibilityLabel={tab === 'posts' ? '저장한 글 더 보기' : '저장한 비즈니스 더 보기'} disabled={loading} accessibilityState={{ disabled: loading, busy: loading }} style={styles.action} onPress={() => void more()}><ThemedText themeColor="accent">더 보기</ThemedText></Pressable>}
      </View>}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      renderItem={({ item }) => 'author' in item ? <Pressable analyticsId={`saved.post.${item.id}`} accessibilityRole="button" accessibilityLabel={`${item.title} 글 열기`} onPress={() => { play('selection'); router.push(`/post/${item.id}`); }} style={({ pressed }) => [styles.post, Depth.card, { backgroundColor: pressed ? theme.backgroundSelected : theme.card, borderColor: theme.line, transform: [{ translateY: pressed ? 2 : 0 }] }]}>
        <View style={styles.postMeta}><ThemedText type="small" themeColor="textSecondary">{item.tag.label} · {item.author.nickname} · {item.createdAtLabel}</ThemedText><SymbolView name={{ ios: 'bookmark.fill', android: 'bookmark', web: 'bookmark' }} size={17} tintColor={theme.accent} /></View>
        <ThemedText type="smallBold" style={styles.postTitle} numberOfLines={2}>{item.title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.postBody} numberOfLines={2}>{item.room ? visibleMeetupBody(item.body) : item.body}</ThemedText>
      </Pressable> : <Pressable analyticsId={`saved.merchant.${item.id}`} accessibilityRole="button" accessibilityLabel={`${item.name} 비즈니스 프로필 열기`} onPress={() => { play('selection'); router.push({ pathname: '/company/[id]', params: { id: item.id } }); }} style={({ pressed }) => [styles.post, Depth.card, { backgroundColor: pressed ? theme.backgroundSelected : theme.card, borderColor: theme.line, transform: [{ translateY: pressed ? 2 : 0 }] }]}>
        <View style={styles.postMeta}><ThemedText type="small" themeColor="textSecondary">{[item.industry, item.city_name].filter(Boolean).join(' · ')}</ThemedText><SymbolView name={{ ios: 'bookmark.fill', android: 'bookmark', web: 'bookmark' }} size={17} tintColor={theme.accent} /></View>
        <ThemedText type="smallBold" style={styles.postTitle} numberOfLines={2}>{item.name}</ThemedText>
        {!!item.address && <ThemedText type="small" themeColor="textSecondary" style={styles.postBody} numberOfLines={2}>{item.address}</ThemedText>}
      </Pressable>}
    />
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', borderBottomWidth: 1 }, tab: { flex: 1, minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 2 },
  footer: { gap: Spacing.two, paddingVertical: Spacing.three }, action: { minHeight: 44, minWidth: 44, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  root: { flex: 1, alignItems: 'center' }, safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth }, list: { flexGrow: 1, paddingHorizontal: Spacing.three, paddingBottom: Spacing.five }, intro: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two }, introText: { flex: 1 }, separator: { height: Spacing.two }, state: { marginTop: Spacing.four }, post: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.two }, postMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two }, postTitle: { fontSize: 16, lineHeight: 22 }, postBody: { lineHeight: 20 },
});
