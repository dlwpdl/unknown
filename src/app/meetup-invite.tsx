import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlingLoader } from '@/components/gling-loader';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Typography } from '@/constants/design-system';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { getChillingError, getChillingErrorCode, openMeetupInvite } from '@/lib/chilling-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { MEETUP_INVITE_TOKEN, SHARED_POST_RETURN_KEY } from '@/lib/sharing';
import { supabase } from '@/lib/supabase';

// https://gling.ej-entertainment.com/meetup-invite?token=… — an invite meetup's link (20261108120000).
// Opening it while signed in lets this member see the meetup and apply; the host still approves.
export default function MeetupInviteRoute() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const { tr } = useLanguage();
  const theme = useTheme(), router = useRouter(), { play } = useInteractionFeedback();
  const { isAuthed, isAuthLoading, promptLogin, me } = useAuth();
  const valid = typeof token === 'string' && MEETUP_INVITE_TOKEN.test(token);
  const [failure, setFailure] = useState<{ title: string; body: string } | null>(null), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!valid || !isAuthed) return;
    let active = true;
    void openMeetupInvite(supabase, token).then(postId => {
      if (!active) return;
      play('success');
      // The web reader is guest-only, so web members land on the join screen, which reads with their session.
      if (Platform.OS === 'web') router.replace({ pathname: '/meetup-join', params: { postId } });
      else router.replace(`/post/${postId}`);
    }, error => {
      if (!active) return;
      play('warning');
      setFailure(getChillingErrorCode(error) === 'MEETUP_INVITE_INVALID'
        ? { title: tr('이 초대 링크로는 들어갈 수 없어요'), body: tr('링크를 보낸 분께 다시 받아 주세요.') }
        : { title: tr('모임을 열지 못했어요'), body: getChillingError(error) });
    });
    return () => { active = false; };
  // play, router and tr are stable for this screen; retry re-runs an explicit retry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, isAuthed, me.id, token, retry]);
  const login = () => {
    play('selection');
    // Web sign-in can finish on /auth/callback; come back here to open the link.
    if (Platform.OS === 'web') { try { window.sessionStorage.setItem(SHARED_POST_RETURN_KEY, `/meetup-invite?token=${token}`); } catch {} }
    promptLogin('로그인하면 초대받은 모임을 보고 신청할 수 있어요.');
  };
  const [title, body] = !valid ? [tr('이 초대 링크로는 들어갈 수 없어요'), tr('링크를 보낸 분께 다시 받아 주세요.')]
    : failure ? [failure.title, failure.body]
      : !isAuthed && !isAuthLoading ? [tr('모임에 초대받았어요'), tr('로그인하면 초대받은 모임을 보고 신청할 수 있어요.')] : [null, null];

  return <ThemedView style={styles.container}>
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        {!title ? <GlingLoader color={theme.accent} accessibilityLabel={tr('모임 여는 중')} /> : <>
          <ThemedText accessibilityRole="header" style={Typography.section}>{title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{body}</ThemedText>
          {valid && !failure && <RaisedActionButton analyticsId="meetup-invite.login" label={tr('로그인하고 모임 보기')} disabled={isAuthLoading} onPress={login} />}
          {valid && !!failure && <RaisedActionButton analyticsId="meetup-invite.retry" tone="secondary" label={tr('다시 불러오기')} onPress={() => { play('selection'); setFailure(null); setRetry(value => value + 1); }} />}
          {(!valid || !!failure) && <RaisedActionButton analyticsId="meetup-invite.home" tone={valid ? 'secondary' : 'primary'} label={tr('홈으로')} onPress={() => { play('selection'); router.replace('/'); }} />}
        </>}
      </View>
    </SafeAreaView>
  </ThemedView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  content: { flex: 1, justifyContent: 'center', padding: Spacing.four, gap: Spacing.three },
});
