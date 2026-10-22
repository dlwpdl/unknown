import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import type { PreparedImage } from '@/lib/post-image-picker';

export type EditablePostImage = PreparedImage | { path: string; uri: string };

export function PostPhotoEditor({ images, disabled, onChange }: { images: EditablePostImage[]; disabled: boolean; onChange: (images: EditablePostImage[]) => void }) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  const move = (index: number, direction: number) => {
    const next = [...images], target = index + direction;
    if (disabled || target < 0 || target >= images.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    play('selection'); onChange(next);
  };
  return <View style={styles.list}>{images.map((image, index) => <View key={`${image.uri}:${index}`} style={[styles.row, { borderColor: theme.line }]}>
    <Image source={{ uri: image.uri }} contentFit="contain" style={[styles.photo, { backgroundColor: theme.backgroundElement }]} accessibilityLabel={`수정할 사진 ${index + 1}`} />
    <View style={styles.info}>
      <ThemedText type="smallBold">{index + 1}{index === 0 ? ' · 표지 사진' : ' · 사진'}</ThemedText>
      <View style={styles.actions}>
        {([-1, 1] as const).map(direction => <Pressable key={direction} analyticsId="post.edit.photo-move" accessibilityRole="button"
          accessibilityLabel={`사진 ${index + 1} ${direction < 0 ? '앞으로' : '뒤로'} 이동`} disabled={disabled || index + direction < 0 || index + direction >= images.length}
          accessibilityState={{ disabled: disabled || index + direction < 0 || index + direction >= images.length }}
          onPress={() => move(index, direction)} style={styles.button}>
          <ThemedText type="smallBold" themeColor="textSecondary" style={{ opacity: disabled || index + direction < 0 || index + direction >= images.length ? 0.35 : 1 }}>{direction < 0 ? '↑ 앞' : '↓ 뒤'}</ThemedText>
        </Pressable>)}
        <Pressable analyticsId="post.edit.photo-remove" accessibilityRole="button" accessibilityLabel={`사진 ${index + 1} 제거`} disabled={disabled}
          accessibilityState={{ disabled }} onPress={() => { play('selection'); onChange(images.filter((_, position) => position !== index)); }} style={styles.button}>
          <ThemedText type="smallBold" style={{ color: '#FF8585' }}>제거</ThemedText>
        </Pressable>
      </View>
    </View>
  </View>)}</View>;
}
const styles = StyleSheet.create({
  list: { gap: 8 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 8 },
  photo: { width: 64, height: 80, borderRadius: 8 }, info: { flex: 1 }, actions: { flexDirection: 'row' },
  button: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
});
