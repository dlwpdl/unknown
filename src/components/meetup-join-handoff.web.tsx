import { StyleSheet, View } from 'react-native';

import { AppStoreChoices } from '@/components/public-web/app-store-choices';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { Typography } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

/**
 * After a web request (owner 2026-11-13): the host's answer and the meetup chat arrive in the app, so the next step is the
 * store button for this phone (App Store on iPhone, Google Play on Android, a QR choice on a computer) or opening the app.
 */
export function MeetupJoinHandoff({ postId, host }: { postId: string; host: string }) {
  const { tr } = useLanguage(), { play } = useInteractionFeedback();
  return <View style={styles.box}>
    <ThemedText style={Typography.body}>{tr('{0} 님이 수락하면 바로 알려 드려요. 알림이랑 모임 대화는 앱으로 오니까 지금 받아 두면 편해요.', host)}</ThemedText>
    <AppStoreChoices />
    <RaisedActionButton analyticsId="meetup.join.open_app" tone="secondary" onPress={() => { play('selection'); window.location.href = `gling://meetup-join?postId=${encodeURIComponent(postId)}`; }} label={tr('앱에서 열기')} />
    <ThemedText style={Typography.supporting} themeColor="textSecondary">{tr("설치한 뒤 이 페이지에서 '앱에서 열기'를 한 번 더 눌러 주세요.")}</ThemedText>
  </View>;
}

const styles = StyleSheet.create({ box: { gap: Spacing.three, marginTop: Spacing.two } });
