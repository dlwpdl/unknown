import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppStoreChoices } from '@/components/public-web/app-store-choices';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Typography } from '@/constants/design-system';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { inviteAppUrl, rememberInviteCode } from '@/lib/invites';

// https://gling.ej-entertainment.com/invite?code=XXXXXXXX — there are no universal links, so the page
// shows the code, opens the app when it is installed and points to the stores when it isn't.
export default function InviteLandingPage() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { tr } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  useEffect(() => { void rememberInviteCode(AsyncStorage, code).then(setSaved, () => setSaved(null)); }, [code]);
  return <ThemedView style={styles.container}>
    <Head><title>{tr('글링 초대')}</title><meta name="robots" content="noindex" /></Head>
    <View style={styles.content}>
      <ThemedText accessibilityRole="header" style={Typography.screenTitle}>{saved === null ? tr('초대 링크가 올바르지 않아요') : tr('친구가 글링에 초대했어요')}</ThemedText>
      {saved && <>
        <ThemedText themeColor="textSecondary">{tr('앱을 설치하고 가입하면 초대가 연결돼요. 앱에서 이 페이지를 다시 열거나 코드를 직접 넣어도 돼요.')}</ThemedText>
        <View style={[styles.codeBox, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="small" themeColor="textSecondary">{tr('초대 코드')}</ThemedText>
          <ThemedText selectable style={styles.code}>{saved}</ThemedText>
        </View>
        <RaisedActionButton analyticsId="invite.open_app" label={tr('앱에서 열기')} onPress={() => { play('selection'); window.location.href = inviteAppUrl(saved); }} />
        <ThemedText type="small" themeColor="textSecondary">{tr('앱에서는 프로필 → 친구 초대에서 코드를 넣을 수 있어요.')}</ThemedText>
        <AppStoreChoices />
      </>}
      {saved === null && <ThemedText themeColor="textSecondary">{tr('링크를 보낸 분께 다시 받아 주세요.')}</ThemedText>}
    </View>
  </ThemedView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  content: { width: '100%', maxWidth: MaxContentWidth, padding: Spacing.four, gap: Spacing.three },
  codeBox: { borderRadius: 12, padding: Spacing.three, gap: 2, alignItems: 'center' },
  code: { fontSize: 28, lineHeight: 36, fontWeight: '700', letterSpacing: 4 },
});
