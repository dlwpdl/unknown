import { useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import { StyleSheet, View } from 'react-native';

import { AppStoreChoices } from '@/components/public-web/app-store-choices';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Typography } from '@/constants/design-system';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { parseCheckInLink } from '@/lib/app-links';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

// https://gling.ej-entertainment.com/checkin?s=…&c=… opened without the app: check-in only happens in the app, so this page points there.
export default function CheckInLandingPage() {
  const link = parseCheckInLink(useLocalSearchParams<{ s?: string; c?: string }>());
  const { tr } = useLanguage();
  const { play } = useInteractionFeedback();
  return <ThemedView style={styles.container}>
    <Head><title>{tr('글링 모임 체크인')}</title><meta name="robots" content="noindex, nofollow" /></Head>
    <View style={styles.content}>
      <ThemedText accessibilityRole="header" style={Typography.screenTitle}>{tr('체크인은 글링 앱에서 해요')}</ThemedText>
      <ThemedText themeColor="textSecondary">{tr('앱이 있으면 아래 버튼을 눌러 주세요. 앱을 새로 설치했다면 모임장 폰에 뜬 QR을 다시 찍어 주세요. QR은 15초마다 바뀌어요.')}</ThemedText>
      {link && <RaisedActionButton analyticsId="checkin.open_app" label={tr('앱에서 열기')} onPress={() => { play('selection'); window.location.href = `gling://checkin?s=${link.sessionId}&c=${link.code}`; }} />}
      <AppStoreChoices />
    </View>
  </ThemedView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  content: { width: '100%', maxWidth: MaxContentWidth, padding: Spacing.four, gap: Spacing.three },
});
