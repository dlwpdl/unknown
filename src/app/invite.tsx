import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Typography } from '@/constants/design-system';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { claimRememberedInvite, rememberInviteCode } from '@/lib/invites';
import { supabase } from '@/lib/supabase';

// gling://invite?code=XXXXXXXX — the code is kept until sign-up, then linked once (see auth.tsx).
export default function InviteLinkRoute() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { tr } = useLanguage();
  const router = useRouter(), { isAuthed, isAuthLoading, promptLogin } = useAuth(), { play } = useInteractionFeedback();
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  useEffect(() => { void rememberInviteCode(AsyncStorage, code).then(setSaved, () => setSaved(null)); }, [code]);
  useEffect(() => {
    if (!saved || !isAuthed) return;
    // Signed-in members go straight to their invite page; a too-late or own code simply isn't linked.
    void claimRememberedInvite(supabase, AsyncStorage).catch(() => {}).finally(() => router.replace('/profile/invite'));
  }, [saved, isAuthed, router]);

  return <ThemedView style={styles.container}>
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <ThemedText accessibilityRole="header" style={Typography.section}>{saved === null ? tr('초대 링크가 올바르지 않아요') : tr('초대 링크를 받았어요')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{saved === null ? tr('링크를 보낸 분께 다시 받아 주세요.') : tr('가입하면 이 초대가 바로 연결돼요.')}</ThemedText>
        {saved && !isAuthed && <RaisedActionButton analyticsId="invite.open_app" label={tr('가입하고 연결하기')} disabled={isAuthLoading}
          onPress={() => { play('selection'); promptLogin('가입하면 이 초대가 바로 연결돼요.'); }} />}
        {saved === null && <RaisedActionButton analyticsId="invite.open_app" label={tr('홈으로')} onPress={() => { play('selection'); router.replace('/'); }} />}
      </View>
    </SafeAreaView>
  </ThemedView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  safeArea: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  content: { flex: 1, justifyContent: 'center', padding: Spacing.four, gap: Spacing.three },
});
