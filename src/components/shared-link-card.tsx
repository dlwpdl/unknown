import { useEffect, useState, useSyncExternalStore } from 'react';
import { Image } from 'expo-image';
import { Platform, StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { chillingSchedule } from '@/lib/chilling';
import { loadSharedLinkPreview, type SharedLinkPreview } from '@/lib/shared-link-preview';
import { sharedLinkTarget } from '@/lib/sharing';
import { supabase } from '@/lib/supabase';
import { subscribeVisibility, visibilityRevision } from '@/lib/content-visibility';

export function SharedPreviewContent({ preview }: { preview: SharedLinkPreview }) {
  const theme = useTheme();
  const image = preview.imageUrl ? { uri: preview.imageUrl } : preview.kind === 'meetup' ? require('@/assets/brand/chat-3d/disco-ball.png')
    : preview.kind === 'festival' ? require('@/assets/brand/chat-3d/ticket.png') : require('@/assets/brand/gling-night-app-icon.png');
  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <Image source={image} style={styles.cover} contentFit={preview.imageUrl ? 'cover' : 'contain'} accessible={false} />
    <View style={styles.copy}>
      <ThemedText type="smallBold" themeColor="accent">{preview.kind === 'meetup' ? '모임 초대' : preview.kind === 'festival' ? '페스티벌 같이 가요' : preview.label}</ThemedText>
      <ThemedText type="subtitle" numberOfLines={3}>{preview.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{preview.city}{preview.schedule ? ` · ${chillingSchedule(preview.schedule)}` : ''}{preview.closed ? ' · 모집 마감' : ''}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">글링에서 {preview.kind === 'meetup' ? '모임 확인하기' : '전체 내용 보기'} ›</ThemedText>
    </View>
  </View>;
}
export function SharedLinkCard({ url }: { url: string }) {
  const target = sharedLinkTarget(url), router = useRouter(), hidden = useContentVisibility();
  const postId = target?.id;
  const revision = useSyncExternalStore(subscribeVisibility, visibilityRevision, visibilityRevision);
  const { isAuthed, me } = useAuth(), { play } = useInteractionFeedback();
  const key = `${target?.id}:${isAuthed ? me.id : 'guest'}:${revision}`;
  const [result, setResult] = useState<{ key: string; preview: SharedLinkPreview } | null>(null);
  useEffect(() => {
    let active = true;
    if (postId && !hidden('post', postId)) void loadSharedLinkPreview(supabase, postId).then(preview => {
      if (active) setResult(preview ? { key, preview } : null);
    }).catch(() => { if (active) setResult(null); });
    return () => { active = false; };
  }, [postId, key, hidden]);
  if (!target || result?.key !== key || hidden('post', target.id)) return null;
  return <Pressable analyticsId="chat.shared-link.open" accessibilityRole="link" accessibilityLabel={`${result.preview.title} · 글링에서 보기`}
    onPress={() => { play('selection'); router.push(Platform.OS === 'web' ? `/post?id=${target.id}${result.preview.kind === 'meetup' ? '&invite=1' : ''}` as Href : { pathname: '/post/[id]', params: { id: target.id, invite: result.preview.kind === 'meetup' ? '1' : undefined } }); }}
    style={({ pressed }) => [styles.link, { opacity: pressed ? 0.8 : 1 }]}><SharedPreviewContent preview={result.preview} /></Pressable>;
}
const styles = StyleSheet.create({ link: { minHeight: 44, width: '100%', maxWidth: 460, alignSelf: 'flex-start', marginTop: 8 },
  card: { borderRadius: 16, borderWidth: 1, overflow: 'hidden', width: '100%' }, cover: { width: '100%', aspectRatio: 16 / 9 }, copy: { padding: 16, gap: 8 } });
