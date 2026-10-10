import { Stack } from 'expo-router';

import { ThemeOverrideProvider } from '@/hooks/use-theme';
import { AuthProvider } from '@/lib/auth';
import { InteractionFeedbackProvider } from '@/lib/interaction-feedback';

export default function AdminLayout() {
  return (
    <ThemeOverrideProvider scheme="dark">
      <InteractionFeedbackProvider>
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </AuthProvider>
      </InteractionFeedbackProvider>
    </ThemeOverrideProvider>
  );
}
