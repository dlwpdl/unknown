import { useLanguage } from '@/hooks/use-language';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { getOAuthCode } from '@/lib/kakao-auth';
import { sharedPostReturnPath, SHARED_POST_RETURN_KEY } from '@/lib/sharing';
import { supabase } from '@/lib/supabase';

export default function SharedAuthCallback() {
  const { tr } = useLanguage();
  const router = useRouter(), theme = useTheme(), { play } = useInteractionFeedback(), { isAuthed, isAuthLoading } = useAuth();
  const [error, setError] = useState(''), started = useRef(false), returned = useRef(false);
  const returnToPost = useCallback(() => {
    if (returned.current) return;
    returned.current = true;
    let path = '/';
    try { path = sharedPostReturnPath(window.sessionStorage.getItem(SHARED_POST_RETURN_KEY)); window.sessionStorage.removeItem(SHARED_POST_RETURN_KEY); } catch {}
    router.replace(path as Href);
  }, [router]);
  useEffect(() => {
    if (typeof window === 'undefined' || window.opener || started.current || isAuthed) return;
    started.current = true;
    void Promise.resolve().then(() => {
      const code = getOAuthCode(window.location.href, `${window.location.origin}/auth/callback`);
      return supabase.auth.exchangeCodeForSession(code);
    }).then(({ error: failure }) => { if (failure) setError("로그인을 완료하지 못했어요. 원래 링크에서 다시 시도해주세요."); })
      .catch(() => setError("로그인 응답을 확인하지 못했어요. 원래 링크에서 다시 시도해주세요."));
  }, [isAuthed]);
  useEffect(() => { if (isAuthed && !isAuthLoading && typeof window !== 'undefined' && !window.opener) returnToPost(); }, [isAuthed, isAuthLoading, returnToPost]);
  return <View style={[styles.page, { backgroundColor: theme.background }]}>
    <ThemedText type="subtitle">{error || tr("로그인을 완료하는 중이에요.")}</ThemedText>
    <Pressable analyticsId="shared.auth.return" accessibilityRole="button" onPress={() => { play('selection'); returnToPost(); }} style={styles.button}>
      <ThemedText type="smallBold" themeColor="accent">{tr("공유받은 내용으로 돌아가기")}</ThemedText>
    </Pressable>
  </View>;
}
const styles = StyleSheet.create({ page: { flex: 1, minHeight: '100%', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }, button: { minHeight: 44, minWidth: 44, padding: 12, justifyContent: 'center' } });

export { generatePrivateMetadata as generateMetadata } from '@/components/public-web/metadata';
