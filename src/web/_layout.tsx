import { Stack } from 'expo-router';
import { PublicWebProviders } from '@/components/public-web/providers';
import { WebNightColors } from '@/constants/theme';

export default function PublicWebLayout() {
  return <PublicWebProviders><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: WebNightColors.background } }} /></PublicWebProviders>;
}
