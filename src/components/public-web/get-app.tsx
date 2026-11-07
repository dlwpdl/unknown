import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Typography } from '@/constants/design-system';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { behavior, flushBehavior } from '@/lib/behavior-analytics';
import { useReaderAnalytics } from './analytics';
import { AppStoreChoices, AppStoreRating, appStoreUrl, playUrl, useDevice } from './app-store-choices';

// /get?utm_source=instagram&utm_campaign=bio: a profile link that sends phones straight to their store with the source attached.
// Computers (and phones whose store doesn't open) keep the usual store choices.
export default function GetAppPage() {
  const { language } = useLanguage(), ko = language === 'ko';
  const device = useDevice();
  useReaderAnalytics('app-invitation', 'get');
  useEffect(() => {
    if (device !== 'ios' && device !== 'android') return;
    behavior('press', `web.store.${device}.open`);
    const url = device === 'ios' ? appStoreUrl() : playUrl();
    // The batch is sent with keepalive, so it can finish after the page leaves; never hold the visitor more than a second.
    void Promise.race([flushBehavior(), new Promise(resolve => setTimeout(resolve, 1000))]).then(() => window.location.replace(url));
  }, [device]);
  return <ThemedView style={styles.container}>
    <View style={styles.content}>
      <ThemedText accessibilityRole="header" style={Typography.screenTitle}>{ko ? '글링 앱 받기' : 'Get the Gling app'}</ThemedText>
      <AppStoreChoices />
      <AppStoreRating />
    </View>
  </ThemedView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  content: { width: '100%', maxWidth: MaxContentWidth, padding: Spacing.four, gap: Spacing.three },
});
