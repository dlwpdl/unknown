import { Image } from 'expo-image';
import { useCallback, useState } from 'react';
import { type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, StyleSheet, View } from 'react-native';

import { ScrollView } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import type { Post } from '@/lib/types';

// 사진이 여러 장인 글의 상세 화면 갤러리. 화면에 보이는 장만 원본을 내려받는다.
export function PostPhotoGallery({ post }: { post: Post }) {
  const theme = useTheme();
  const photos = post.imageUris ?? [];
  const [width, setWidth] = useState(0);
  const galleryKey = JSON.stringify([post.id, photos]);
  const [page, setPage] = useState<{ key: string; index: number } | null>(null);
  const [aspectRatios, setAspectRatios] = useState<Record<string, number>>({});
  const index = page?.key === galleryKey ? page.index : 0;
  const aspectRatio = aspectRatios[`${post.id}:${photos[index]}`] ?? 4 / 3;
  const onLayout = useCallback((event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width), []);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    setPage({ key: galleryKey, index: Math.max(0, Math.min(photos.length - 1, next)) });
  }, [galleryKey, photos.length, width]);
  if (photos.length < 2) return null;

  return <View style={styles.root} onLayout={onLayout}>
    {width > 0 && (
      <ScrollView key={galleryKey} analyticsId="components_post-photo-gallery.scrollview.1" horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        onScroll={onScroll} scrollEventThrottle={200}>
        {photos.map((uri, position) => (
          <Image
            key={`${post.id}-${position}:${uri}`}
            source={{ uri }}
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
        ))}
      </ScrollView>
    )}
    <View style={[styles.counter, { backgroundColor: theme.card, borderColor: theme.line }]}>
      <ThemedText type="smallBold" style={{ fontVariant: ['tabular-nums'] }}>{index + 1}/{photos.length}</ThemedText>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { width: '100%' },
  counter: { position: 'absolute', right: 12, bottom: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
});
