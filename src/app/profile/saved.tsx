import { GlingLoader } from '@/components/gling-loader';
import { useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoginPanel } from '@/components/login-panel';
import { StateCard } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Depth, MaxContentWidth, Spacing } from '@/constants/theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { loadSavedPosts } from '@/lib/community-data';
import { visibleMeetupBody } from '@/lib/meetup-ai';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

export default function SavedPostsScreen() {
  const auth = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const hidden = useContentVisibility();
  const { play } = useInteractionFeedback();
  const [result, setResult] = useState<{ userId: string; posts: Post[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const rows = result?.userId === auth.me.id ? result.posts.filter((post) => !hidden('post', post.id, post.author.id)) : [];

  const reload = useCallback(async () => {
    setLoading(true);
    setError(false);
    try { setResult({ userId: auth.me.id, posts: await loadSavedPosts(supabase) }); }
    catch { setResult(null); setError(true); }
    finally { setLoading(false); }
  }, [auth.me.id]);

  useFocusEffect(useCallback(() => { if (auth.isAuthed) void reload(); }, [auth.isAuthed, reload]));

  if (!auth.isAuthed) return <LoginPanel reason="저장한 글을 보려면 로그인해 주세요." onApple={auth.signInApple} onKakao={auth.signInKakao} onGoogle={auth.signInGoogle} onDevLogin={auth.signInDev} loading={auth.isAuthLoading} error={auth.authError} />;

  return <ThemedView style={styles.root}><SafeAreaView edges={['bottom']} style={styles.safeArea}>
    <FlatList
      data={rows}
      keyExtractor={(post) => post.id}
      contentContainerStyle={styles.list}
      refreshing={loading}
      onRefresh={() => void reload()}
      ListHeaderComponent={<View style={styles.intro}><ThemedText type="small" themeColor="textSecondary" style={styles.introText}>저장해 둔 글과 모임을 다시 찾아보세요.</ThemedText>{rows.length > 0 && <ThemedText type="smallBold" themeColor="accent">{rows.length}개 표시 중</ThemedText>}</View>}
      ListEmptyComponent={loading
        ? <GlingLoader color={theme.accent} accessibilityLabel={t.profile.savedLoading} style={styles.state} />
        : <View style={styles.state}><StateCard kind={error ? 'error' : 'empty'} title={error ? t.profile.savedError : t.profile.savedEmpty} body={error ? '연결을 확인하고 다시 시도해 주세요.' : '관심 가는 글이나 모임에서 저장을 누르면 여기에 모여요.'} actionLabel={error ? '다시 시도' : '오늘 글 둘러보기'} onAction={error ? () => void reload() : () => router.push('/')} /></View>}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`${item.title} 글 열기`} onPress={() => { play('selection'); router.push(`/post/${item.id}`); }} style={({ pressed }) => [styles.post, Depth.card, { backgroundColor: pressed ? theme.backgroundSelected : theme.card, borderColor: theme.line, transform: [{ translateY: pressed ? 2 : 0 }] }]}>
        <View style={styles.postMeta}><ThemedText type="small" themeColor="textSecondary">{item.tag.label} · {item.author.nickname} · {item.createdAtLabel}</ThemedText><SymbolView name={{ ios: 'bookmark.fill', android: 'bookmark', web: 'bookmark' }} size={17} tintColor={theme.accent} /></View>
        <ThemedText type="smallBold" style={styles.postTitle} numberOfLines={2}>{item.title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.postBody} numberOfLines={2}>{item.room ? visibleMeetupBody(item.body) : item.body}</ThemedText>
      </Pressable>}
    />
  </SafeAreaView></ThemedView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' }, safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth }, list: { flexGrow: 1, paddingHorizontal: Spacing.three, paddingBottom: Spacing.five }, intro: { minHeight: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two }, introText: { flex: 1 }, separator: { height: Spacing.two }, state: { marginTop: Spacing.four }, post: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.two }, postMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two }, postTitle: { fontSize: 16, lineHeight: 22 }, postBody: { lineHeight: 20 },
});
