import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

export default function MerchantAuthCallback() {
  const router = useRouter(), theme = useTheme(), { play } = useInteractionFeedback();
  return <View style={[styles.page, { backgroundColor: theme.background }]}>
    <ThemedText type="subtitle">로그인을 완료하는 중이에요.</ThemedText>
    <Pressable analyticsId="merchant-web.callback.return" accessibilityRole="button" accessibilityLabel="업체 관리로 돌아가기"
      onPress={() => { play('selection'); router.replace('/'); }} style={({ pressed }) => [styles.button, { opacity: pressed ? 0.65 : 1 }]}>
      <ThemedText type="smallBold" themeColor="accent">업체 관리로 돌아가기</ThemedText>
    </Pressable>
  </View>;
}
const styles = StyleSheet.create({ page: { flex: 1, minHeight: '100%', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }, button: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 16 } });
