import { useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';

import { Pressable, ScrollView } from '@/components/analytics-controls';
import { ExternalLink } from '@/components/external-link';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

export function PostPhotoCredits({ credits }: { credits: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const { play } = useInteractionFeedback();
  const [visible, setVisible] = useState(false);
  const close = () => { play('selection'); setVisible(false); };
  if (!credits) return null;

  return <>
    <View style={styles.toolbar}>
      <Pressable analyticsId="post.photo-credits.open" accessibilityRole="button" accessibilityLabel="사진 출처와 이용 조건 보기"
        onPress={() => { play('selection'); setVisible(true); }} style={({ pressed }) => [styles.button, { opacity: pressed ? 0.65 : 1 }]}>
        <ThemedText type="small" themeColor="textSecondary">사진 출처</ThemedText>
      </Pressable>
    </View>
    <Modal visible={visible} transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={close}>
      <View style={styles.overlay}>
        <Pressable analyticsId="post.photo-credits.backdrop" onPress={close} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: theme.card, paddingBottom: Math.max(insets.bottom, Spacing.three) }]}>
          <View style={styles.header}>
            <ThemedText accessibilityRole="header" type="smallBold">사진 출처·이용 조건</ThemedText>
            <Pressable analyticsId="post.photo-credits.close" accessibilityRole="button" accessibilityLabel="사진 출처 닫기" onPress={close} style={styles.button}>
              <ThemedText type="smallBold" themeColor="accent">닫기</ThemedText>
            </Pressable>
          </View>
          <ScrollView analyticsId="post.photo-credits.content" contentContainerStyle={styles.content}>
            {credits.split(/\n+/).map((line, index) => <View key={index} style={styles.line}>
              {line.split(/(https?:\/\/\S+)/).filter(Boolean).map((part, position) => /^https?:\/\//.test(part)
                ? <ExternalLink key={position} href={part as `https://${string}`} style={styles.link} accessibilityLabel={part.includes('creativecommons.org/') || part.includes('unsplash.com/license') ? '사진 라이선스 보기' : '사진 원본 보기'}>
                    <ThemedText type="smallBold" themeColor="accent">{part.includes('creativecommons.org/') || part.includes('unsplash.com/license') ? '라이선스 보기' : '원본 보기'}</ThemedText>
                  </ExternalLink>
                : <ThemedText key={position} type="small" themeColor="textSecondary" selectable>{part}</ThemedText>)}
            </View>)}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  toolbar: { alignItems: 'flex-end', paddingHorizontal: Spacing.three },
  button: { minWidth: 44, minHeight: 44, paddingHorizontal: Spacing.two, justifyContent: 'center', alignItems: 'center' },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0009' },
  sheet: { maxHeight: '80%', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  content: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three, gap: Spacing.one },
  line: { gap: Spacing.one },
  link: { minHeight: 44, paddingVertical: Spacing.two, alignSelf: 'flex-start' },
});
