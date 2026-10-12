import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView as NativeScrollView, Modal, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';

import { Pressable, ScrollView } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import type { Post } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { getPostImageSource } from '@/lib/feed-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

const directions = [
  { name: 'left', label: '사진 왼쪽 부분 보기', arrow: '←', x: 1, y: 0 },
  { name: 'right', label: '사진 오른쪽 부분 보기', arrow: '→', x: -1, y: 0 },
  { name: 'up', label: '사진 위쪽 부분 보기', arrow: '↑', x: 0, y: 1 },
  { name: 'down', label: '사진 아래쪽 부분 보기', arrow: '↓', x: 0, y: -1 },
];

export function PostPhotoGallery({ post }: { post: Post }) {
  const theme = useTheme();
  const { isAuthed, me } = useAuth();
  const { play } = useInteractionFeedback();
  const insets = useSafeAreaInsets(), screen = useWindowDimensions(), reducedMotion = useReducedMotion();
  const viewerScope = isAuthed ? me.id : 'guest';
  const pictures = (post.imageUris ?? []).flatMap((_, position) => {
    const source = getPostImageSource(post, viewerScope, 'full', position);
    return source ? [{ source, thumbnail: getPostImageSource(post, viewerScope, 'feed', position) ?? source }] : [];
  });
  const sources = pictures.map(picture => picture.source);
  const photos = sources.map(source => source.uri);
  const [width, setWidth] = useState(0);
  const galleryKey = JSON.stringify([post.id, viewerScope, photos]);
  const [page, setPage] = useState<{ key: string; index: number } | null>(null);
  const [aspectRatios, setAspectRatios] = useState<Record<string, number>>({});
  const [viewer, setViewer] = useState<{ key: string; index: number } | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [thumbnailPage, setThumbnailPage] = useState<{ key: string; index: number } | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const carousel = useRef<NativeScrollView>(null), thumbnails = useRef<NativeScrollView>(null);
  const alignedLayout = useRef('');
  const x = useSharedValue(0), y = useSharedValue(0), scale = useSharedValue(1), pinchStart = useSharedValue(1);
  const pinchAnchor = useSharedValue<{ x: number; y: number } | null>(null);
  const viewportRef = useRef<View>(null), viewportOrigin = useSharedValue({ x: 0, y: 0 });
  const fullIndex = viewer?.key === galleryKey ? viewer.index : null;
  const resetZoom = () => { setZoomed(false); scale.set(1); x.set(0); y.set(0); };
  const close = () => { play('selection'); setViewer(null); resetZoom(); };
  const index = page?.key === galleryKey ? page.index : 0;
  const thumbnailIndex = thumbnailPage?.key === galleryKey ? thumbnailPage.index : 0;
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return;
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    setPage({ key: galleryKey, index: Math.max(0, Math.min(photos.length - 1, next)) });
  };
  useEffect(() => {
    const layoutKey = `${galleryKey}:${width}`;
    if (alignedLayout.current !== layoutKey && width > 0) {
      alignedLayout.current = layoutKey;
      carousel.current?.scrollTo({ x: index * width, animated: false });
    }
    thumbnails.current?.scrollTo({ x: Math.max(0, index * 72 - (width - 64) / 2), animated: !reducedMotion });
  }, [galleryKey, index, width, reducedMotion]);
  const selectPhoto = (position: number) => {
    play('selection');
    setPage({ key: galleryKey, index: position });
    carousel.current?.scrollTo({ x: position * width, animated: false });
  };
  const fullRatio = aspectRatios[`${post.id}:${photos[fullIndex ?? index]}`] ?? 4 / 3;
  const fullWidth = Math.min(viewport.width, viewport.height * fullRatio);
  const fullHeight = fullWidth / fullRatio;
  const move = (dx: number, dy: number) => {
    'worklet';
    const maxX = Math.max(0, (fullWidth * scale.get() - viewport.width) / 2), maxY = Math.max(0, (fullHeight * scale.get() - viewport.height) / 2);
    x.set(Math.max(-maxX, Math.min(maxX, x.get() + dx)));
    y.set(Math.max(-maxY, Math.min(maxY, y.get() + dy)));
  };
  const gestures = Gesture.Simultaneous(
    Gesture.Pan().minDistance(0).averageTouches(true).onChange(({ changeX, changeY, numberOfPointers }) => { if (numberOfPointers === 1) move(changeX, changeY); }),
    Gesture.Pinch().onStart(({ focalX, focalY }) => {
      pinchStart.set(scale.get());
      const origin = Platform.OS === 'web' ? viewportOrigin.get() : { x: 0, y: 0 };
      pinchAnchor.set({ x: (focalX - origin.x - viewport.width / 2 - x.get()) / scale.get(), y: (focalY - origin.y - viewport.height / 2 - y.get()) / scale.get() });
    }).onUpdate(({ scale: amount, focalX, focalY }) => {
      const next = Math.max(1, Math.min(4, pinchStart.get() * amount)), anchor = pinchAnchor.get();
      const origin = Platform.OS === 'web' ? viewportOrigin.get() : { x: 0, y: 0 };
      if (!anchor) return;
      const dx = focalX - origin.x - viewport.width / 2 - anchor.x * next - x.get(), dy = focalY - origin.y - viewport.height / 2 - anchor.y * next - y.get();
      scale.set(next);
      move(dx, dy);
    }).onFinalize(() => { runOnJS(setZoomed)(scale.get() > 1); }),
  );
  const imageStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: scale.get() }] }));
  useEffect(() => {
    x.set(0); y.set(0);
  }, [galleryKey, fullIndex, fullRatio, viewport.width, viewport.height, x, y]);
  const moveDirection = (name: string) => {
    const direction = directions.find(item => item.name === name);
    if (!direction) return;
    play('selection'); move(direction.x * viewport.width / 2, direction.y * viewport.height / 2);
  };
  if (!photos.length) return null;

  return <View style={styles.root} onLayout={onLayout}>
    <View style={styles.stage}>
    {width > 0 && (
      <ScrollView ref={carousel} key={galleryKey} analyticsId="components_post-photo-gallery.scrollview.1" horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        onScroll={onScroll} scrollEventThrottle={200}>
        {photos.map((uri, position) => (
          <Pressable key={`${post.id}-${position}:${uri}`} analyticsId="post.photo.open" accessibilityRole="button"
            accessibilityLabel={`${post.title} 사진 ${position + 1} 크게 보기`}
            onPress={() => { play('selection'); resetZoom(); setViewer({ key: galleryKey, index: position }); }}>
          <Image
            key={`${post.id}-${position}:${uri}`}
            source={Math.abs(position - index) <= 1 ? sources[position] : null}
            style={{ width, aspectRatio: 4 / 3, maxHeight: Math.min(520, screen.height * 0.55), backgroundColor: theme.backgroundElement }}
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
    </View>
    {photos.length > 1 && <ScrollView ref={thumbnails} key={`thumbnails:${galleryKey}`} analyticsId="post.photo.thumbnails" horizontal
      style={{ height: 72, flexGrow: 0, flexShrink: 0 }}
      onScroll={event => setThumbnailPage({ key: galleryKey, index: Math.max(0, Math.floor(event.nativeEvent.contentOffset.x / 72)) })} scrollEventThrottle={100}
      showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbnails}>
      {pictures.map((picture, position) => {
        const visible = position >= thumbnailIndex - 1 && position <= thumbnailIndex + Math.ceil(width / 72) + 1;
        return <Pressable key={`${post.id}-${position}:${picture.source.uri}`} analyticsId="post.photo.select"
        accessibilityRole="button" accessibilityLabel={`${post.title} 사진 ${position + 1} 선택${position === index ? ', 선택됨' : ''}`} accessibilityState={{ selected: position === index }}
        onPress={() => selectPhoto(position)} style={[styles.thumbnail, { backgroundColor: theme.backgroundElement, borderColor: position === index ? theme.accent : 'transparent' }]}>
        <Image source={picture.thumbnail.uri !== picture.source.uri || visible ? picture.thumbnail : null} style={styles.thumbnailImage} contentFit="cover" accessible={false}
          cachePolicy="memory-disk" recyclingKey={`${galleryKey}:thumb:${position}`} transition={0} />
      </Pressable>; })}
    </ScrollView>}
    {fullIndex !== null && <Modal visible transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={close}>
      <View accessibilityViewIsModal style={[styles.viewer, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.toolbar}>
          <ThemedText style={styles.viewerText}>{fullIndex + 1}/{photos.length}</ThemedText>
          <Pressable analyticsId="post.photo.zoom" accessibilityRole="button" accessibilityLabel={zoomed ? '사진 축소' : '사진 확대'} accessibilityState={{ expanded: zoomed }}
            onPress={() => { play('selection'); const enlarged = !zoomed; scale.set(enlarged ? 2 : 1); x.set(0); y.set(0); setZoomed(enlarged); }} style={styles.control}>
            <ThemedText style={styles.viewerText}>{zoomed ? '축소' : '확대'}</ThemedText>
          </Pressable>
          <Pressable analyticsId="post.photo.close" accessibilityRole="button" accessibilityLabel="사진 닫기" onPress={close} style={styles.control}>
            <ThemedText style={styles.viewerText}>닫기 ✕</ThemedText>
          </Pressable>
        </View>
        <GestureHandlerRootView style={{ flex: 1 }}><GestureDetector gesture={gestures}><View ref={viewportRef} testID="post-photo-viewport" style={styles.fullContent} collapsable={false}
          onLayout={({ nativeEvent: { layout: { width, height } } }) => {
            setViewport(previous => previous.width === width && previous.height === height ? previous : { width, height });
            if (Platform.OS === 'web') viewportRef.current?.measureInWindow((x, y) => viewportOrigin.set({ x, y }));
          }}
          accessible accessibilityRole="image" accessibilityLabel={`${post.title} 사진 ${fullIndex + 1} 원본`}
          accessibilityHint={zoomed ? '사진을 끌어서 원하는 부분을 볼 수 있어요.' : '확대 버튼으로 사진을 자세히 볼 수 있어요.'}
          accessibilityActions={zoomed ? directions : []} onAccessibilityAction={({ nativeEvent: { actionName } }) => moveDirection(actionName)}>
          <Animated.View pointerEvents="none" style={imageStyle}>
            <Image key={`${galleryKey}:${fullIndex}`} source={sources[fullIndex]} style={{ width: fullWidth, height: fullHeight }}
              contentFit="contain" allowDownscaling={false} accessible={false} cachePolicy="memory-disk" transition={0} />
          </Animated.View>
        </View></GestureDetector></GestureHandlerRootView>
        {Platform.OS === 'web' && <View style={styles.panControls}>{zoomed && directions.map(direction => <Pressable key={direction.name}
          analyticsId="post.photo.pan" accessibilityRole="button" accessibilityLabel={direction.label} style={styles.control} onPress={() => moveDirection(direction.name)}>
          <ThemedText style={styles.viewerText}>{direction.arrow}</ThemedText>
        </Pressable>)}</View>}
        {photos.length > 1 && <View style={styles.toolbar}>
          {([-1, 1] as const).map(direction => <Pressable key={direction} analyticsId="post.photo.page" accessibilityRole="button"
            accessibilityLabel={direction < 0 ? '이전 사진' : '다음 사진'} disabled={fullIndex + direction < 0 || fullIndex + direction >= photos.length}
            style={styles.control} onPress={() => { selectPhoto(fullIndex + direction); resetZoom(); setViewer({ key: galleryKey, index: fullIndex + direction }); }}>
            <ThemedText style={[styles.viewerText, { opacity: fullIndex + direction < 0 || fullIndex + direction >= photos.length ? 0.35 : 1 }]}>{direction < 0 ? '← 이전' : '다음 →'}</ThemedText>
          </Pressable>)}
        </View>}
      </View>
    </Modal>}
  </View>;
}

const styles = StyleSheet.create({
  root: { width: '100%' },
  stage: { borderRadius: 16, overflow: 'hidden' },
  thumbnails: { gap: 8, paddingTop: 8, paddingBottom: 4 },
  thumbnail: { width: 64, height: 60, borderWidth: 2, borderRadius: 8, padding: 2, overflow: 'hidden' },
  thumbnailImage: { width: '100%', height: '100%', borderRadius: 4 },
  counter: { position: 'absolute', right: 12, bottom: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  viewer: { flex: 1, backgroundColor: '#000' },
  toolbar: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  control: { minWidth: 64, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  viewerText: { color: '#fff' },
  fullContent: { flex: 1, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  panControls: { minHeight: 44, flexDirection: 'row', justifyContent: 'center' },
});
