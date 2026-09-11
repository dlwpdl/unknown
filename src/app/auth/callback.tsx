import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';

export default function AuthCallbackRoute() {
  const router = useRouter();
  return (
    <View style={styles.page}>
      <ThemedText type="subtitle">로그인을 완료하는 중입니다.</ThemedText>
      <Pressable onPress={() => router.replace('/')} accessibilityRole="button"
        style={({ pressed }) => ({ minHeight: 44, minWidth: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
        <ThemedText type="smallBold">돌아가기</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    minHeight: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
    backgroundColor: Colors.light.background,
  },
});
