import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppStoreChoices, AppStoreRating } from '@/components/public-web/app-store-choices';
import { ShopInviteLanding } from '@/components/public-web/shop-invite-landing';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Typography } from '@/constants/design-system';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { inviteAppUrl, rememberInviteCode } from '@/lib/invites';
import { loadBusinessInviteLanding, type BusinessInviteLanding } from '@/lib/meetup-invite';
import { publicWebClient } from '@/lib/public-web-client';

// https://gling.ej-entertainment.com/invite?code=XXXXXXXX — there are no universal links, so the page
// shows the code, opens the app when it is installed and points to the stores when it isn't.
export default function InviteLandingPage() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { tr } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  useEffect(() => { void rememberInviteCode(AsyncStorage, code).then(setSaved, () => setSaved(null)); }, [code]);
  // A shop QR code is a business invite: it opens that shop's landing (owner 2026-11-13). A friend's code keeps this page;
  // until the check answers, neither heading shows, so a shop scan never flashes "친구가 초대했어요".
  const [checked, setChecked] = useState<{ code: string; shop: BusinessInviteLanding | null } | null>(null);
  useEffect(() => {
    if (!saved) return;
    let live = true;
    void loadBusinessInviteLanding(publicWebClient, saved).catch(() => null).then(shop => { if (live) setChecked({ code: saved, shop }); });
    return () => { live = false; };
  }, [saved]);
  const answer = saved && checked?.code === saved ? checked : null;
  if (saved && answer?.shop) return <ShopInviteLanding code={saved} landing={answer.shop} />;
  const pending = saved === undefined || (!!saved && !answer);
  return <ThemedView style={styles.container}>
    <Head><title>{tr('친구가 글링에 초대했어요')}</title><meta name="robots" content="noindex, follow" /></Head>
    <View style={styles.content}>
      {!pending && <ThemedText accessibilityRole="header" style={Typography.screenTitle}>{saved === null ? tr('초대 링크가 올바르지 않아요') : tr('친구가 글링에 초대했어요')}</ThemedText>}
      {saved && !pending && <>
        <ThemedText themeColor="textSecondary">{tr("앱을 설치하고 아래 '앱에서 열기'를 눌러 주세요. 그다음 가입하면 초대가 바로 연결돼요.")}</ThemedText>
        <View style={[styles.codeBox, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="small" themeColor="textSecondary">{tr('초대 코드')}</ThemedText>
          <ThemedText selectable style={styles.code}>{saved}</ThemedText>
        </View>
      </>}
      {saved === null && <ThemedText themeColor="textSecondary">{tr('링크를 보낸 분께 다시 받아 주세요.')}</ThemedText>}
      {/* Also in the static HTML (before the code is read) and for a bad code: installing never depends on the invite. */}
      <AppStoreChoices />
      {/* Same place and weight as on the shop QR and web request pages: install first, then '앱에서 열기' (owner 2026-11-13). */}
      {saved && !pending && <>
        <RaisedActionButton analyticsId="invite.open_app" tone="secondary" label={tr('앱에서 열기')} onPress={() => { play('selection'); window.location.href = inviteAppUrl(saved); }} />
        <ThemedText type="small" themeColor="textSecondary">{tr('앱에서는 프로필 → 친구 초대에서 코드를 넣을 수 있어요.')}</ThemedText>
      </>}
      <AppStoreRating />
    </View>
  </ThemedView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  content: { width: '100%', maxWidth: MaxContentWidth, padding: Spacing.four, gap: Spacing.three },
  codeBox: { borderRadius: 12, padding: Spacing.three, gap: 2, alignItems: 'center' },
  code: { fontSize: 28, lineHeight: 36, fontWeight: '700', letterSpacing: 4 },
});
