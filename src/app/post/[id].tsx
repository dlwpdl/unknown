import { GlingLoader } from '@/components/gling-loader';
import { Pressable } from '@/components/analytics-controls';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Head from 'expo-router/head';
import { useEffect, useRef, useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PostDetail } from '@/components/post-detail';
import { SharedPreviewContent } from '@/components/shared-link-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadPublicPost } from '@/lib/feed-data';
import { supabase } from '@/lib/supabase';
import { loadSharedLinkPreview, type SharedLinkPreview } from '@/lib/shared-link-preview';
import { SHARED_POST_RETURN_KEY, buildSharedPostUrl } from '@/lib/sharing';
import type { Post } from '@/lib/types';

export default function SharedPostRoute() {
  const { id, commentId } = useLocalSearchParams<{ id: string; commentId?: string }>();
  const postId = typeof id === 'string' ? id : Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.pathname.match(/^\/(?:post|share)\/([0-9a-f-]+)\/?$/i)?.[1] ?? '' : '';
  const targetCommentId = typeof commentId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(commentId) ? commentId.toLowerCase() : undefined;
  const { isAuthed, me, isAuthLoading, promptLogin } = useAuth();
  const owner = isAuthed ? me.id : 'guest';
  const requestKey = `${postId}:${owner}`;
  const router = useRouter();
  const { play } = useInteractionFeedback();
  const theme = useTheme();
  const [result, setResult] = useState<{ id: string; post: Post | null; failed: boolean } | null>(null);
  const [preview, setPreview] = useState<{ key: string; value: SharedLinkPreview | null; failed: boolean } | null>(null);
  const loginRequested = useRef('');
  const current = result?.id === requestKey ? result : null;
  const loading = isAuthed && Boolean(postId) && !current;
  const goBack = () => { play('selection'); if (router.canGoBack()) router.back(); else router.replace('/'); };

  useEffect(() => {
    if (!postId || !isAuthed) return;
    let active = true;
    void loadPublicPost(supabase, postId)
      .then((post) => { if (active) setResult({ id: requestKey, post, failed: false }); })
      .catch(() => { if (active) setResult({ id: requestKey, post: null, failed: true }); });
    return () => { active = false; };
  }, [postId, requestKey, isAuthed]);

  useEffect(() => {
    if (isAuthed || !postId) return;
    let active = true;
    void loadSharedLinkPreview(supabase, postId).then(value => { if (active) setPreview({ key: requestKey, value, failed: false }); })
      .catch(() => { if (active) setPreview({ key: requestKey, value: null, failed: true }); });
    return () => { active = false; };
  }, [postId, requestKey, isAuthed]);
  useEffect(() => {
    if (!isAuthed && !isAuthLoading && preview?.key === requestKey && preview.value && loginRequested.current !== requestKey) {
      loginRequested.current = requestKey;
      if (Platform.OS === 'web') try { window.sessionStorage.setItem(SHARED_POST_RETURN_KEY, `/post?id=${postId}${preview.value.kind === 'meetup' ? '&invite=1' : ''}`); } catch {}
      promptLogin('로그인하면 공유받은 내용과 모임을 바로 확인할 수 있어요.');
    }
  }, [isAuthed, isAuthLoading, preview, requestKey, postId, promptLogin]);

  return (
    <ThemedView style={styles.container}>
      {Platform.OS === 'web' && <Head><title>{`${preview?.key === requestKey ? preview.value?.title ?? '글링 공유' : current?.post?.title ?? '글링 공유'} | 글링`}</title>
        <meta name="robots" content="noindex, follow" />
        <meta property="og:site_name" content="글링" /><meta property="og:title" content={preview?.key === requestKey ? preview.value?.title ?? '글링 공유' : current?.post?.title ?? '글링 공유'} />
        <meta property="og:description" content="Google·소셜 로그인 후 전체 내용과 모임을 확인해요." />
        {postId && <meta property="og:url" content={buildSharedPostUrl(postId)} />}
        {preview?.key === requestKey && preview.value?.imageUrl && <meta property="og:image" content={preview.value.imageUrl} />}
      </Head>}
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        {isAuthed && current?.post ? (
          <PostDetail post={current.post} commentId={targetCommentId} onClose={goBack} />
        ) : (
          <>
            <View style={styles.header}>
              <Pressable lens analyticsId="app_post_[id].pressable.1"
                onPress={goBack}
                accessibilityRole="button"
                accessibilityLabel="뒤로가기"
                style={({ pressed }) => [styles.backButton, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
                <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={22} tintColor={theme.text} />
              </Pressable>
            </View>
            <View style={styles.center}>
              {!isAuthed && preview?.key === requestKey && preview.value ? <View style={styles.gate}>
                <SharedPreviewContent preview={preview.value} />
                <ThemedText type="small" themeColor="textSecondary">로그인 후 전체 내용을 확인해요. 모임 초대는 기존 참여 신청과 모임장 승인을 거쳐요.</ThemedText>
                <Pressable lens analyticsId="shared.post.login" accessibilityRole="button" accessibilityLabel="로그인하고 공유 내용 보기"
                  onPress={() => { play('selection'); promptLogin('공유받은 내용을 확인해요.'); }} style={[styles.login, { backgroundColor: theme.accent }]}>
                  <ThemedText type="smallBold" style={{ color: theme.accentInk }}>로그인하고 내용 보기</ThemedText>
                </Pressable>
              </View> : loading || isAuthLoading || (!isAuthed && postId && preview?.key !== requestKey) ? (
                <GlingLoader color={theme.accent} accessibilityLabel="공유 글 불러오는 중" />
              ) : (
                <View style={styles.message}>
                  <ThemedText type="subtitle" style={styles.title}>
                    {current?.failed || preview?.failed ? '글을 불러오지 못했어요' : '글을 찾을 수 없어요'}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {current?.failed || preview?.failed ? '잠시 후 다시 시도해 주세요.' : '삭제되었거나 공개되지 않은 글이에요.'}
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
  backButton: { alignSelf: 'flex-start', minWidth: 44, minHeight: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  message: { alignItems: 'center', gap: 8, padding: 24 },
  gate: { width: '100%', maxWidth: 540, padding: 16, gap: 16 },
  login: { minHeight: 44, borderRadius: 12, padding: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, lineHeight: 30 },
});
