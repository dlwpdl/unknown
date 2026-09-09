import AppTabs from '@/components/app-tabs';
import { CommunityCityProvider } from '@/lib/community-city';

export default function TabsLayout() {
  return <CommunityCityProvider><AppTabs /></CommunityCityProvider>;
}
