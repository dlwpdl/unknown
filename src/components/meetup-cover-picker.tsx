import { Pressable } from '@/components/analytics-controls';
import { useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { getPostImagePlan } from '@/lib/image-upload';
import type { PostDraftImage } from '@/lib/community-data';

export type MeetupCover = PostDraftImage & { uri: string };

export function MeetupCoverPicker({ value, onChange, onPickingChange, disabled }: { value: MeetupCover | null; onChange: (image: MeetupCover | null) => void; onPickingChange: (busy: boolean) => void; disabled: boolean }) {
  const theme = useTheme();
  const [picking, setPicking] = useState(false), [error, setError] = useState('');
  const busy = useRef(false), mounted = useRef(true);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const pick = async () => {
    if (disabled || busy.current) return;
    busy.current = true; setPicking(true); onPickingChange(true); setError('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
      if (result.canceled || !mounted.current) return;
      const asset = result.assets[0];
      if (!asset?.uri) throw new Error('사진을 불러오지 못했어요. 다시 선택해 주세요.');
      const mimeType = asset.mimeType ?? 'image/jpeg';
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) throw new Error('JPG, PNG 또는 WebP 사진을 선택해 주세요.');
      const plan = getPostImagePlan(asset.width, asset.height, mimeType);
      const context = ImageManipulator.manipulate(asset.uri);
      if (plan.resize) context.resize(plan.resize);
      const image = await context.renderAsync();
      const optimized = await image.saveAsync({ base64: true, compress: 0.8,
        format: plan.format === 'png' ? SaveFormat.PNG : plan.format === 'webp' ? SaveFormat.WEBP : SaveFormat.JPEG });
      if (!optimized.base64) throw new Error('사진을 불러오지 못했어요. 다시 선택해 주세요.');
      if (Math.ceil(optimized.base64.length * 0.75) > 5 * 1024 * 1024) throw new Error('사진은 5MB 이하로 선택해 주세요.');
      if (mounted.current) onChange({ uri: optimized.uri, base64: optimized.base64, mimeType: plan.mimeType });
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error && cause.message.includes('주세요') ? cause.message : '사진을 불러오지 못했어요. 다시 선택해 주세요.');
    } finally { if (mounted.current) { busy.current = false; setPicking(false); onPickingChange(false); } }
  };
  return <View style={styles.root}>
    <ThemedText type="smallBold">커버 사진 <ThemedText type="small" themeColor="textSecondary">(선택)</ThemedText></ThemedText>
    <Pressable analyticsId="components_meetup-cover-picker.pressable.1" accessibilityRole="button" accessibilityLabel={value ? '커버 사진 변경' : '커버 사진 선택'} accessibilityState={{ disabled: disabled || picking, busy: picking }} disabled={disabled || picking} onPress={pick} style={[styles.cover, { borderColor: theme.line, backgroundColor: theme.backgroundElement }]}>
      {value ? <Image source={{ uri: value.uri }} contentFit="cover" style={StyleSheet.absoluteFill} accessibilityLabel="선택한 모임 커버" /> : <><ThemedText type="subtitle">＋</ThemedText><ThemedText type="small">만남의 분위기를 보여주세요</ThemedText></>}
    </Pressable>
    <View style={styles.actions}><ThemedText type="small" themeColor="textSecondary">{picking ? '사진을 준비하고 있어요…' : value ? '사진을 눌러 변경할 수 있어요' : '사진 1장 · 무료 · 최대 5MB'}</ThemedText>
      {value && <Pressable analyticsId="components_meetup-cover-picker.pressable.2" accessibilityRole="button" accessibilityLabel="커버 사진 삭제" disabled={disabled || picking} accessibilityState={{ disabled: disabled || picking }} onPress={() => onChange(null)} style={styles.remove}><ThemedText type="small" themeColor="accent">삭제</ThemedText></Pressable>}
    </View>
    {!!error && <ThemedText accessibilityRole="alert" type="small" themeColor="accent">{error}</ThemedText>}
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 8, marginVertical: 8 }, cover: { width: '100%', aspectRatio: 16 / 9, borderWidth: 1, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', gap: 8 },
  actions: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, remove: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
