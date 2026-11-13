import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppStoreChoices } from '@/components/public-web/app-store-choices';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

const METHODS: Record<string, { ko: string; en: string }> = { kakao: { ko: '카카오', en: 'Kakao' }, google: { ko: 'Google', en: 'Google' }, apple: { ko: 'Apple', en: 'Apple' } };

/**
 * After a web request (owner 2026-11-13), right under the status: the host's answer and the meetup chat arrive in the app.
 * There is no deferred link, so a fresh install opens the app's home; the request is then under 모임 → 내 모임 for the same
 * account. A different sign-in method can make another account (Kakao shares no email), so the page names the one used here.
 * '앱에서 열기' opens this request screen when the app is already installed.
 */
export function MeetupJoinHandoff({ postId, host, approved }: { postId: string; host: string; approved: boolean }) {
  const { tr, language } = useLanguage(), { play } = useInteractionFeedback();
  const [provider, setProvider] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void supabase.auth.getSession().then(({ data }) => { if (live) setProvider(data.session?.user.app_metadata?.provider ?? null); }, () => {});
    return () => { live = false; };
  }, []);
  const method = provider ? METHODS[provider]?.[language] : undefined;
  return <View style={styles.box}>
    <ThemedText accessibilityRole="header" style={Typography.section}>{approved ? tr('모임 대화는 앱에서 열려요') : tr('호스트 답은 앱으로 와요')}</ThemedText>
    {!approved && <ThemedText style={Typography.body}>{tr('{0}님이 승인하면 알림이 오고, 모임 대화에도 들어갈 수 있어요.', host)}</ThemedText>}
    <ThemedText style={Typography.body}>{method ? tr('앱에서도 {0}로 로그인해 주세요. 다른 방법으로 들어가면 이 신청이 안 보일 수 있어요.', method)
      : tr('앱에서도 지금과 같은 방법으로 로그인해 주세요. 다른 방법으로 들어가면 이 신청이 안 보일 수 있어요.')}</ThemedText>
    <AppStoreChoices />
    <RaisedActionButton analyticsId="meetup.join.open_app" tone="secondary" onPress={() => { play('selection'); window.location.href = `gling://meetup-join?postId=${encodeURIComponent(postId)}`; }} label={tr('앱에서 열기')} />
    <ThemedText style={Typography.supporting} themeColor="textSecondary">{tr("앱을 설치하고 로그인하면 모임 탭의 '내 모임'에서 이 신청을 볼 수 있어요. 앱이 이미 있으면 '앱에서 열기'로 바로 열려요.")}</ThemedText>
  </View>;
}

const styles = StyleSheet.create({ box: { gap: Spacing.three, marginTop: Spacing.two } });
