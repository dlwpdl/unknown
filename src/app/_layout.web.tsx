import { Stack, usePathname } from 'expo-router';
import PublicReader from '@/components/public-web/reader';
import { PublicWebProviders } from '@/components/public-web/providers';
import SharedAuthCallback from '@/web/auth/callback';

export default function WebLayout() {
  const path = usePathname().replace(/\/$/, '');
  const screen = path === '/auth/callback' ? <SharedAuthCallback />
    : ['/terms', '/privacy', '/account-deletion', '/child-safety', '/chat', '/meetup-join', '/meetup-profile', '/meetup-application', '/profile/membership'].includes(path)
      ? <Stack screenOptions={{ headerShown: false }} /> : <PublicReader />;
  return <PublicWebProviders>{screen}</PublicWebProviders>;
}
