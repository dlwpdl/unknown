import { Stack, usePathname } from 'expo-router';
import PublicReader from '@/components/public-web/reader';

// Even a development web run using the native route root must stay read-only.
export default function WebLayout() {
  const path = usePathname().replace(/\/$/, '');
  return ['/terms', '/privacy', '/account-deletion'].includes(path)
    ? <Stack screenOptions={{ headerShown: false }} /> : <PublicReader />;
}
