import { Image } from 'expo-image';
import { useCallback, useState } from 'react';
import { type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, Modal, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';

import { Pressable, ScrollView } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import type { Post } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { getPostImageSource } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

export function PostPhotoGallery({ post }: { post: Post }) {
  const theme = useTheme();
  const { isAuthed, me } = useAuth();
  const { play } = useInteractionFeedback();
  const insets = useSafeAreaInsets(), screen = useWindowDimensions(), reducedMotion = useReducedMotion();
  const sources = (post.imageUris ?? []).map((_, position) => getPostImageSource(post, isAuthed ? me.id : 'guest', 'full', position)).filter(source => !!source);
  const photos = sources.map(source => source.uri);
  const [width, setWidth] = useState(0);
  const galleryKey = JSON.stringify([post.id, photos]);
  const [page, setPage] = useState<{ key: string; index: number } | null>(null);
  const [aspectRatios, setAspectRatios] = useState<Record<string, number>>({});
  const [viewer, setViewer] = useState<{ key: string; index: number } | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const fullIndex = viewer?.key === galleryKey ? viewer.index : null;
  const close = () => { play('selection'); setViewer(null); setZoomed(false); };
  const index = page?.key === galleryKey ? page.index : 0;
  const aspectRatio = aspectRatios[`${post.id}:${photos[index]}`] ?? 4 / 3;
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    setPage({ key: galleryKey, index: Math.max(0, Math.min(photos.length - 1, next)) });
  }, [galleryKey, photos.length, width]);
  if (!photos.length) return null;
  const fullRatio = aspectRatios[`${post.id}:${photos[fullIndex ?? index]}`] ?? 4 / 3;
  const fullHeight = Math.min(screen.height - insets.top - insets.bottom - 100, screen.width / fullRatio);

  return <View style={styles.root} onLayout={onLayout}>
    {width > 0 && (
      <ScrollView key={galleryKey} analyticsId="components_post-photo-gallery.scrollview.1" horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        onScroll={onScroll} scrollEventThrottle={200}>
        {photos.map((uri, position) => (
          <Pressable key={`${post.id}-${position}:${uri}`} analyticsId="post.photo.open" accessibilityRole="button"
            accessibilityLabel={`${post.title} 사진 ${position + 1} 크게 보기`}
            onPress={() => { play('selection'); setZoomed(false); setViewer({ key: galleryKey, index: position }); }}>
          <Image
            key={`${post.id}-${position}:${uri}`}
            source={sources[position]}
            style={{ width, aspectRatio, backgroundColor: theme.backgroundElement }}
            contentFit="contain"
            onLoad={({ source: { width: photoWidth, height: photoHeight } }) => {
              if (Number.isFinite(photoWidth) && Number.isFinite(photoHeight) && photoWidth > 0 && photoHeight > 0) {
                setAspectRatios((previous) => ({ ...previous, [`${post.id}:${uri}`]: photoWidth / photoHeight }));
              }
            }}
            cachePolicy="memory-disk"
            recyclingKey={`${post.id}-${position}:${uri}`}
            transition={0}
            accessibilityLabel={`${post.title} 사진 ${position + 1}`}
          />
          </Pressable>
        ))}
      </ScrollView>
    )}
    {photos.length > 1 && <View pointerEvents="none" style={[styles.counter, { backgroundColor: theme.card, borderColor: theme.line }]}>
      <ThemedText type="smallBold" style={{ fontVariant: ['tabular-nums'] }}>{index + 1}/{photos.length}</ThemedText>
    </View>}
    {fullIndex !== null && <Modal visible transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={close}>
      <View accessibilityViewIsModal style={[styles.viewer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.toolbar}>
          <ThemedText style={styles.viewerText}>{fullIndex + 1}/{photos.length}</ThemedText>
          <Pressable analyticsId="post.photo.zoom" accessibilityRole="button" accessibilityLabel={zoomed ? '사진 축소' : '사진 확대'}
            onPress={() => { play('selection'); setZoomed(value => !value); }} style={styles.control}>
            <ThemedText style={styles.viewerText}>{zoomed ? '축소' : '확대'}</ThemedText>
          </Pressable>
          <Pressable analyticsId="post.photo.close" accessibilityRole="button" accessibilityLabel="사진 닫기" onPress={close} style={styles.control}>
            <ThemedText style={styles.viewerText}>닫기 ✕</ThemedText>
          </Pressable>
        </View>
        <ScrollView key={`${galleryKey}:${fullIndex}:${zoomed}`} analyticsId="post.photo.pan-horizontal" horizontal contentContainerStyle={{ minWidth: screen.width }}>
          <ScrollView analyticsId="post.photo.pan-vertical" minimumZoomScale={1} maximumZoomScale={4} centerContent
            contentContainerStyle={[styles.fullContent, { minWidth: screen.width }]}>
            <Image source={sources[fullIndex]} style={{ width: screen.width * (zoomed ? 2 : 1), height: fullHeight * (zoomed ? 2 : 1) }}
              contentFit="contain" accessibilityLabel={`${post.title} 사진 ${fullIndex + 1} 원본`} />
          </ScrollView>
        </ScrollView>
        {photos.length > 1 && <View style={styles.toolbar}>
          {([-1, 1] as const).map(direction => <Pressable key={direction} analyticsId="post.photo.page" accessibilityRole="button"
            accessibilityLabel={direction < 0 ? '이전 사진' : '다음 사진'} disabled={fullIndex + direction < 0 || fullIndex + direction >= photos.length}
            style={styles.control} onPress={() => { play('selection'); setZoomed(false); setViewer({ key: galleryKey, index: fullIndex + direction }); }}>
            <ThemedText style={[styles.viewerText, { opacity: fullIndex + direction < 0 || fullIndex + direction >= photos.length ? 0.35 : 1 }]}>{direction < 0 ? '← 이전' : '다음 →'}</ThemedText>
          </Pressable>)}
        </View>}
      </View>
    </Modal>}
  </View>;
}

const styles = StyleSheet.create({
  root: { width: '100%' },
  counter: { position: 'absolute', right: 12, bottom: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  viewer: { flex: 1, backgroundColor: '#000' },
  toolbar: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  control: { minWidth: 64, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  viewerText: { color: '#fff' },
  fullContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
});
