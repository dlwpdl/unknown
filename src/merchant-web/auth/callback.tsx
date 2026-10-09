import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/lib/auth';
import { merchantMcpReturnPath } from '@/lib/merchant-mcp';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

export default function MerchantAuthCallback() {
  const router = useRouter(), theme = useTheme(), { play } = useInteractionFeedback();
  const { isAuthed, isAuthLoading } = useAuth();
  function returnToWorkspace() {
    let path: ReturnType<typeof merchantMcpReturnPath> = '/';
    try { path = merchantMcpReturnPath(window.sessionStorage); } catch {}
    router.replace(path);
  }
  useEffect(() => {
    if (!isAuthed || isAuthLoading || typeof window === 'undefined' || window.opener) return;
    let path: ReturnType<typeof merchantMcpReturnPath> = '/';
    try { path = merchantMcpReturnPath(window.sessionStorage); } catch {}
    router.replace(path);
  }, [isAuthed, isAuthLoading, router]);
  return <View style={[styles.page, { backgroundColor: theme.background }]}>
    <ThemedText type="subtitle">로그인을 완료하는 중이에요.</ThemedText>
    <Pressable analyticsId="merchant-web.callback.return" accessibilityRole="button" accessibilityLabel="비즈니스 관리로 돌아가기"
      onPress={() => { play('selection'); returnToWorkspace(); }} style={({ pressed }) => [styles.button, { opacity: pressed ? 0.65 : 1 }]}>
      <ThemedText type="smallBold" themeColor="accent">비즈니스 관리로 돌아가기</ThemedText>
    </Pressable>
  </View>;
}
const styles = StyleSheet.create({ page: { flex: 1, minHeight: '100%', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }, button: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 16 } });
