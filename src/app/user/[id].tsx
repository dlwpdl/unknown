import { GlingLoader } from '@/components/gling-loader';
import { Pressable } from '@/components/analytics-controls';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PostCard } from '@/components/post-card';
import { PostDetail } from '@/components/post-detail';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { count, t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadAuthorPosts } from '@/lib/feed-data';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

// 글·댓글 작성자를 눌렀을 때 여는 프로필 화면. 이 사람이 지금까지 쓴 글만 모아 보여준다.
export default function AuthorPostsRoute() {
  const { id, nickname } = useLocalSearchParams<{ id: string; nickname?: string }>();
  const authorId = typeof id === 'string' ? id : '';
  const { isAuthed, me } = useAuth();
  const viewerScope = isAuthed ? me.id : 'guest';
  const router = useRouter();
  const theme = useTheme();
  const [state, setState] = useState<{ key: string; posts: Post[] } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [detail, setDetail] = useState<Post | null>(null);

  const requestKey = `${authorId}:${viewerScope}`;
  const current = state?.key === requestKey ? state : null;
  const loading = Boolean(authorId) && !current && failed !== requestKey;
  const { play } = useInteractionFeedback();
  const goBack = () => { play('selection'); if (router.canGoBack()) router.back(); else router.replace('/'); };

  useEffect(() => {
    if (!authorId) return;
    let active = true;
    void loadAuthorPosts(supabase, authorId, null, { viewerScope })
      .then((posts) => { if (active) setState({ key: requestKey, posts }); })
      .catch(() => { if (active) setFailed(requestKey); });
    return () => { active = false; };
  }, [authorId, requestKey, viewerScope]);

  const updateViewCount = useCallback((postId: string, views: number) => {
    setState((prev) => prev ? { ...prev, posts: prev.posts.map((post) => post.id === postId ? { ...post, views } : post) } : prev);
  }, []);

  const posts = current?.posts ?? [];
  const shownName = typeof nickname === 'string' && nickname ? nickname : posts[0]?.author.nickname;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <Pressable analyticsId="app_user_[id].pressable.1"
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel={t.authorPosts.back}
            style={({ pressed }) => [styles.backButton, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
            <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={22} tintColor={theme.text} />
          </Pressable>
          <View style={styles.heading}>
            <ThemedText type="subtitle" numberOfLines={1}>
              {shownName ? t.authorPosts.title(shownName) : t.authorPosts.fallbackTitle}
            </ThemedText>
            {current && (
              <ThemedText type="small" themeColor="textSecondary">
                {t.authorPosts.count(count(posts.length))}
              </ThemedText>
            )}
          </View>
        </View>

        {loading ? (
          <View style={styles.center}>
            <GlingLoader color={theme.accent} accessibilityLabel={t.authorPosts.loading} />
          </View>
        ) : (
          <FlatList
            data={posts}
            keyExtractor={(post) => post.id}
            contentContainerStyle={posts.length === 0 ? styles.center : styles.list}
            renderItem={({ item }) => (
              <PostCard post={item} onPress={() => setDetail(item)} />
            )}
            ListEmptyComponent={(
              <View style={styles.message}>
                <ThemedText type="subtitle">{failed === requestKey ? t.authorPosts.errorTitle : t.authorPosts.emptyTitle}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {failed === requestKey ? t.authorPosts.errorBody : t.authorPosts.emptyBody}
                </ThemedText>
              </View>
            )}
          />
        )}
      </SafeAreaView>

      {detail && (
        <PostDetail
          post={detail}
          onViewCountChange={updateViewCount}
          onClose={() => setDetail(null)}
          onPostRemoved={(postId) => setState((prev) => prev ? { ...prev, posts: prev.posts.filter((post) => post.id !== postId) } : prev)}
          onPostChanged={(saved) => {
            setState(prev => prev ? { ...prev, posts: prev.posts.map(post => post.id === saved.id ? saved : post) } : prev);
            setDetail(saved);
          }}
          onCommentCountChange={(comments) => setState((prev) => prev
            ? { ...prev, posts: prev.posts.map((post) => post.id === detail.id ? { ...post, comments } : post) }
            : prev)}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 8, gap: 4 },
  backButton: { alignSelf: 'flex-start', minWidth: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  heading: { gap: 2, paddingBottom: 4 },
  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  message: { gap: 6, alignItems: 'center' },
});
