import { Stack } from 'expo-router';

import { ThemeOverrideProvider } from '@/hooks/use-theme';
import { AuthProvider } from '@/lib/auth';

export default function AdminLayout() {
  return (
    <ThemeOverrideProvider scheme="light">
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </AuthProvider>
    </ThemeOverrideProvider>
  );
}
