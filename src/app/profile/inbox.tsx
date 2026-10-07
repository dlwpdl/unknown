import { SymbolView } from 'expo-symbols';
import { Stack, useRouter } from 'expo-router';
import { Pressable } from 'react-native';

import NotificationsScreen from '@/app/(tabs)/notifications';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

export default function ProfileInbox() {
  const router = useRouter();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  return <>
    <Stack.Screen options={{ headerRight: () => <Pressable accessibilityRole="button" accessibilityLabel="알림 설정" onPress={() => { play('selection'); router.push('/profile/notifications'); }} style={({ pressed }) => ({ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.65 : 1 })}>
      <SymbolView name={{ ios: 'slider.horizontal.3', android: 'tune', web: 'tune' }} size={22} tintColor={theme.text} />
    </Pressable> }} />
    <NotificationsScreen embedded />
  </>;
}
