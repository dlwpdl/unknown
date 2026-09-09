import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';

import FeedScreen from '@/components/feed-screen';

export default function ComposeScreen() {
  const router = useRouter();
  useFocusEffect(useCallback(() => {
    router.setParams({ compose: '1' });
  }, [router]));
  return <FeedScreen />;
}
