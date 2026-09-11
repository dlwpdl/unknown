import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PostDetail } from '@/components/post-detail';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { loadPublicPost } from '@/lib/feed-data';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

export default function SharedPostRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const postId = typeof id === 'string' ? id : '';
  const router = useRouter();
  const theme = useTheme();
  const [result, setResult] = useState<{ id: string; post: Post | null; failed: boolean } | null>(null);
  const current = result?.id === postId ? result : null;
  const loading = Boolean(postId) && !current;
  const goBack = () => router.canGoBack() ? router.back() : router.replace('/');

  useEffect(() => {
    if (!postId) return;
    let active = true;
    void loadPublicPost(supabase, postId)
      .then((post) => { if (active) setResult({ id: postId, post, failed: false }); })
      .catch(() => { if (active) setResult({ id: postId, post: null, failed: true }); });
    return () => { active = false; };
  }, [postId]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        {current?.post ? (
          <PostDetail post={current.post} onClose={goBack} />
        ) : (
          <>
            <View style={styles.header}>
              <Pressable
                onPress={goBack}
                accessibilityRole="button"
                accessibilityLabel="뒤로가기"
                style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.6 : 1 }]}>
                <ThemedText type="smallBold" style={{ color: theme.accent }}>돌아가기</ThemedText>
              </Pressable>
            </View>
            <View style={styles.center}>
              {loading ? (
                <ActivityIndicator color={theme.accent} accessibilityLabel="공유 글 불러오는 중" />
              ) : (
                <View style={styles.message}>
                  <ThemedText type="subtitle" style={styles.title}>
                    {current?.failed ? '글을 불러오지 못했어요' : '글을 찾을 수 없어요'}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {current?.failed ? '잠시 후 다시 시도해 주세요.' : '삭제되었거나 공개되지 않은 글이에요.'}
                  </ThemedText>
                </View>
              )}
            </View>
          </>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16 },
  backButton: { alignSelf: 'flex-start', minWidth: 44, minHeight: 44, justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  message: { alignItems: 'center', gap: 8, padding: 24 },
  title: { fontSize: 22, lineHeight: 30 },
});
