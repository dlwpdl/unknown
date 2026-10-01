import { Stack } from 'expo-router';
import { WebNightColors } from '@/constants/theme';

export default function PublicWebLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: WebNightColors.background } }} />;
}
