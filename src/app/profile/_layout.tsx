import { Stack, useRouter } from 'expo-router';
import { Pressable } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useReducedMotion } from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { PROMOTIONS_PREVIEW_ENABLED } from '@/lib/promotions';

export default function ProfileLayout() {
  const theme = useTheme();
  const router = useRouter();
  const reducedMotion = useReducedMotion();

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: theme.background },
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
      }}>
      <Stack.Screen name="index" options={{
        title: t.tabs.profile,
        headerLeft: () => (
          <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/')} accessibilityRole="button" accessibilityLabel={t.notifications.close} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
            <SymbolView name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }} size={22} tintColor={theme.text} />
          </Pressable>
        ),
      }} />
      <Stack.Screen name="guidelines" options={{ title: t.profile.guidelines }} />
      <Stack.Screen name="membership" options={{ title: '멤버십', animation: reducedMotion ? 'none' : 'default' }} />
      <Stack.Screen name="promotions" options={{ title: PROMOTIONS_PREVIEW_ENABLED ? '홍보 크레딧' : '', headerShown: PROMOTIONS_PREVIEW_ENABLED, animation: reducedMotion ? 'none' : 'default' }} />
      <Stack.Screen name="settings" options={{ title: t.profile.settings }} />
    </Stack>
  );
}
