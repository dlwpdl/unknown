import { Pressable } from '@/components/analytics-controls';
import { Stack, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useReducedMotion } from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { t } from '@/i18n/ko';
import { PROMOTIONS_PREVIEW_ENABLED } from '@/lib/promotions';

export default function ProfileLayout() {
  const theme = useTheme();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const { play } = useInteractionFeedback();

  return (
    <Stack
      screenOptions={({ route }) => ({
        contentStyle: { backgroundColor: theme.background },
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        animation: reducedMotion ? 'none' : 'default',
        headerLeft: () => (
          <Pressable analyticsId="app_profile__layout.pressable.1"
            onPress={() => { play('selection'); if (router.canGoBack()) router.back(); else router.replace(route.name === 'index' ? '/' : '/profile'); }}
            accessibilityRole="button"
            accessibilityLabel="뒤로가기"
            style={({ pressed }) => ({ minWidth: 44, minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
            <SymbolView name={{ ios: route.name === 'membership' ? 'xmark' : 'chevron.left', android: route.name === 'membership' ? 'close' : 'arrow_back', web: route.name === 'membership' ? 'close' : 'arrow_back' }} size={22} tintColor={theme.text} />
          </Pressable>
        ),
      })}>
      <Stack.Screen name="index" options={{ title: t.tabs.profile }} />
      <Stack.Screen name="guidelines" options={{ title: t.profile.guidelines }} />
      <Stack.Screen name="membership" options={{ title: '멤버십', presentation: 'modal', animation: reducedMotion ? 'none' : 'slide_from_bottom' }} />
      <Stack.Screen name="merchant" options={{ title: '비지니스' }} />
      <Stack.Screen name="trust" options={{ title: '인증 단계' }} />
      <Stack.Screen name="saved" options={{ title: t.profile.saved }} />
      <Stack.Screen name="promotions" options={{ title: PROMOTIONS_PREVIEW_ENABLED ? '홍보 크레딧' : '', headerShown: PROMOTIONS_PREVIEW_ENABLED }} />
      <Stack.Screen name="settings" options={{ title: t.profile.settings }} />
      <Stack.Screen name="notifications" options={{ title: '알림 설정' }} />
      <Stack.Screen name="inbox" options={{ title: t.notifications.title }} />
    </Stack>
  );
}
