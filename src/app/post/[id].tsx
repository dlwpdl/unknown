import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { PostDetail } from '@/components/post-detail';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { loadPublicPost } from '@/lib/feed-data';
import { supabase } from '@/lib/supabase';
import type { Post } from '@/lib/types';

export default function SharedPostRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void loadPublicPost(supabase, id)
      .then((next) => active && setPost(next))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [id]);

  if (post) return <PostDetail post={post} onClose={() => router.replace('/')} />;

  return (
    <ThemedView style={styles.center}>
      {loading ? (
        <ActivityIndicator color={theme.accent} accessibilityLabel="공유 글 불러오는 중" />
      ) : (
        <View style={styles.message}>
          <ThemedText type="subtitle" style={styles.title}>글을 찾을 수 없어요</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">삭제되었거나 공개되지 않은 글이에요.</ThemedText>
        </View>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  message: { alignItems: 'center', gap: 8, padding: 24 },
  title: { fontSize: 22, lineHeight: 30 },
});
