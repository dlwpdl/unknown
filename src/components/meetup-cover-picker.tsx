import { Pressable } from '@/components/analytics-controls';
import { useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { isSupportedImage, preparePostImage } from '@/lib/post-image-picker';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import type { PostDraftImage } from '@/lib/community-data';

export type MeetupCover = PostDraftImage & { uri: string };

export function MeetupCoverPicker({ value, onChange, onPickingChange, disabled }: { value: MeetupCover | null; onChange: (image: MeetupCover | null) => void; onPickingChange: (busy: boolean) => void; disabled: boolean }) {
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const [picking, setPicking] = useState(false), [error, setError] = useState('');
  const busy = useRef(false), mounted = useRef(true);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const pick = async () => {
    if (disabled || busy.current) return;
    play('selection');
    busy.current = true; setPicking(true); onPickingChange(true); setError('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
      if (result.canceled || !mounted.current) return;
      const asset = result.assets[0];
      if (!asset?.uri) throw new Error('사진을 불러오지 못했어요. 다시 선택해 주세요.');
      const mimeType = asset.mimeType ?? 'image/jpeg';
      if (!isSupportedImage(mimeType)) throw new Error('JPG, PNG 또는 WebP 사진을 선택해 주세요.');
      const prepared = await preparePostImage(asset, { withThumb: true });
      if (mounted.current) onChange({ uri: prepared.uri, base64: prepared.base64, thumbBase64: prepared.thumbBase64, mimeType: prepared.mimeType, width: prepared.width, height: prepared.height });
      if (mounted.current) play('success');
    } catch (cause) {
      if (mounted.current) { play('warning'); setError(cause instanceof Error && cause.message.includes('주세요') ? cause.message : '사진을 불러오지 못했어요. 다시 선택해 주세요.'); }
    } finally { if (mounted.current) { busy.current = false; setPicking(false); onPickingChange(false); } }
  };
  return <View style={styles.root}>
    <Pressable analyticsId="components_meetup-cover-picker.pressable.1" accessibilityRole="button" accessibilityLabel={value ? '모임 사진 변경' : '모임 사진 추가'} accessibilityState={{ disabled: disabled || picking, busy: picking }} disabled={disabled || picking} onPress={pick} style={({ pressed }) => [styles.cover, value ? styles.coverFilled : styles.coverEmpty, { borderColor: theme.line, backgroundColor: theme.backgroundElement, opacity: pressed ? 0.65 : 1 }]}>
      {value ? <Image source={{ uri: value.uri }} contentFit="cover" style={StyleSheet.absoluteFill} accessibilityLabel="선택한 모임 사진" /> : <><SymbolView name={{ ios: 'photo', android: 'photo_library', web: 'photo_library' }} size={20} tintColor={theme.textSecondary} /><ThemedText type="smallBold">모임 사진 추가</ThemedText><ThemedText type="small" themeColor="textSecondary" style={styles.choose}>선택 ›</ThemedText></>}
    </Pressable>
    <View style={styles.actions}><ThemedText type="small" themeColor="textSecondary">{picking ? '사진을 준비하고 있어요…' : value ? '사진을 눌러 변경할 수 있어요' : '사진 1장 · 무료 · 최대 5MB'}</ThemedText>
      {value && <Pressable analyticsId="components_meetup-cover-picker.pressable.2" accessibilityRole="button" accessibilityLabel="커버 사진 삭제" disabled={disabled || picking} accessibilityState={{ disabled: disabled || picking }} onPress={() => { play('selection'); onChange(null); }} style={({ pressed }) => [styles.remove, { opacity: pressed ? 0.65 : 1 }]}><ThemedText type="small" themeColor="accent">삭제</ThemedText></Pressable>}
    </View>
    {!!error && <ThemedText accessibilityRole="alert" type="small" themeColor="accent">{error}</ThemedText>}
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 8 }, cover: { width: '100%', borderWidth: 1, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', gap: 8 },
  coverFilled: { aspectRatio: 2.1 }, coverEmpty: { minHeight: 56, flexDirection: 'row', justifyContent: 'flex-start', paddingHorizontal: 16 },
  choose: { marginLeft: 'auto' },
  actions: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, remove: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
