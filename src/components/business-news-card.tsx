import { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';

import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { PostAdLabel } from '@/components/post-ad-label';
import { TranslationControl } from '@/components/content-translation';
import { ControlMotion, Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLanguage } from '@/hooks/use-language';
import { useContentTranslation } from '@/hooks/use-content-translation';
import { useAuth } from '@/lib/auth';
import { getPostImageSource, relativeTime } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { visibleTranslationSource } from '@/lib/translation-source';
import type { Post } from '@/lib/types';

export function BusinessNewsCard({ post, onPress, onAuthor, translationVisible = true }: {
  post: Post; onPress: () => void; onAuthor: () => void; translationVisible?: boolean;
}) {
  const theme = useTheme(), { tr, locale } = useLanguage(), { play } = useInteractionFeedback();
  const { isAuthed, me } = useAuth(), { fontScale } = useWindowDimensions();
  const photo = getPostImageSource(post, isAuthed ? me.id : 'guest');
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const source = visibleTranslationSource('post', post.title, post.body, !!post.room);
  const translation = useContentTranslation('post', post.id, source, translationVisible);
  const name = post.business?.name ?? post.author.nickname;
  return <View style={[styles.row, { borderBottomColor: theme.line }]}>
    <View style={styles.byline}>
      <Pressable analyticsId="business.news.author" accessibilityRole="button" accessibilityLabel={tr('{0} 프로필 보기', name)}
        onPress={() => { play('selection'); onAuthor(); }} style={({ pressed }) => [styles.author, { opacity: pressed ? ControlMotion.pressedOpacity : 1 }]}>
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.name}>{name}</ThemedText>
      </Pressable>
      <View style={styles.adLabel}><PostAdLabel hashtags={post.hashtags} /></View>
      <ThemedText type="small" themeColor="textSecondary">{post.createdAt ? relativeTime(post.createdAt, undefined, locale) : post.createdAtLabel}</ThemedText>
    </View>
    <Pressable analyticsId="business.news.post" accessibilityRole="button" accessibilityLabel={tr('{0} 글 보기', translation.display.title)}
      onPress={() => { play('selection'); onPress(); }} style={({ pressed }) => [styles.post, { opacity: pressed ? ControlMotion.pressedOpacity : 1 }]}>
      <View style={styles.copy}>
        <ThemedText numberOfLines={fontScale > 1.2 ? undefined : 2} style={styles.title}>{translation.display.title}</ThemedText>
        <View style={styles.meta}>
          <ThemedText type="small" themeColor="textSecondary">{tr('댓글 {0}', post.comments)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{tr('조회 {0}', post.views)}</ThemedText>
        </View>
      </View>
      {photo && failedPhoto !== photo.uri ? <Image source={photo} contentFit="cover" style={styles.photo} accessible={false}
        onError={() => setFailedPhoto(photo.uri)} /> : <View style={[styles.photo, styles.fallback, { backgroundColor: theme.backgroundElement }]} accessible={false}>
        <SymbolView name={{ ios: 'text.bubble', android: 'article', web: 'article' }} size={22} tintColor={theme.textSecondary} />
      </View>}
    </Pressable>
    <TranslationControl translation={translation} />
  </View>;
}

const styles = StyleSheet.create({
  row: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: Spacing.three },
  byline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.two },
  adLabel: { justifyContent: 'center' },
  author: { minHeight: 44, minWidth: 44, justifyContent: 'center', flexGrow: 1, flexShrink: 1 },
  name: { flexShrink: 1 },
  post: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: 72 },
  copy: { flex: 1, gap: Spacing.two },
  title: { ...Typography.body, fontWeight: '700' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  photo: { width: 72, height: 72, borderRadius: 12 },
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
