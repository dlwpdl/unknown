import Head from 'expo-router/head';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';

import { Pressable, ScrollView } from '@/components/analytics-controls';
import { GlingLoader } from '@/components/gling-loader';
import { captureMerchantNaverCallback, MerchantNaverCallback } from '@/components/merchant-naver-cafe';
import { MerchantWorkspace } from '@/components/merchant-workspace';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { getMyMerchantAccess } from '@/lib/merchant-workspace';
import { supabase } from '@/lib/supabase';

export default function MerchantWebIndex() {
  const theme = useTheme(), { play } = useInteractionFeedback();
  const { me, isAuthed, isAuthLoading, authError, promptLogin, signOut } = useAuth();
  const [access, setAccess] = useState<{ user: string; enabled: boolean; failed: boolean } | null>(null);
  const [callback, setCallback] = useState(captureMerchantNaverCallback);
  const [connected, setConnected] = useState<{ user: string; merchantId: string } | null>(null);
  const [revision, setRevision] = useState(0), [signingOut, setSigningOut] = useState(false);
  const signOutBusy = useRef(false);
  const current = isAuthed && access?.user === me.id ? access : null;
  const initialMerchantId = connected?.user === me.id ? connected.merchantId : undefined;
  useEffect(() => {
    if (!isAuthed) return;
    let active = true, request = 0;
    const check = () => {
      const latest = ++request;
      void getMyMerchantAccess(supabase).then(enabled => { if (active && latest === request) setAccess({ user: me.id, enabled, failed: false }); })
        .catch(() => { if (active && latest === request) setAccess({ user: me.id, enabled: false, failed: true }); });
    };
    check();
    const app = AppState.addEventListener('change', state => { if (state === 'active') check(); });
    const visible = () => { if (document.visibilityState === 'visible') check(); };
    if (Platform.OS === 'web') { window.addEventListener('focus', check); document.addEventListener('visibilitychange', visible); }
    return () => {
      active = false; app.remove();
      if (Platform.OS === 'web') { window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', visible); }
    };
  }, [isAuthed, me.id, revision]);
  async function exit() {
    if (signOutBusy.current) return;
    signOutBusy.current = true; setSigningOut(true); play('selection');
    try { await signOut(); } finally { signOutBusy.current = false; setSigningOut(false); }
  }
  const retry = () => { play('selection'); setAccess(null); setRevision(value => value + 1); };
  return <View style={[styles.page, { backgroundColor: theme.background }]}>
    <Head><title>업체 관리 | gling</title><meta name="robots" content="noindex,nofollow" /></Head>
    <View style={[styles.header, { borderColor: theme.line }]}>
      <View style={styles.headerContent}>
        <View style={styles.brand}><Image source={require('@/assets/brand/gling-night-wordmark.png')} style={styles.wordmark} contentFit="contain" accessibilityLabel="글링" /><ThemedText type="smallBold">업체 관리</ThemedText></View>
        {isAuthed && <View style={styles.account}>
          <ThemedText type="small" numberOfLines={1} style={styles.nickname}>{me.nickname}</ThemedText>
          <Pressable analyticsId="merchant-web.signout" accessibilityRole="button" accessibilityLabel="로그아웃" accessibilityState={{ disabled: signingOut }} disabled={signingOut} onPress={() => { void exit(); }}
            style={({ pressed }) => [styles.action, { borderColor: theme.line, opacity: signingOut || pressed ? 0.65 : 1 }]}>
            <ThemedText type="smallBold">{signingOut ? '로그아웃 중…' : '로그아웃'}</ThemedText>
          </Pressable>
        </View>}
      </View>
    </View>
    <ScrollView analyticsId="merchant-web.workspace" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {authError && <ThemedText accessibilityRole="alert">{authError}</ThemedText>}
      {isAuthLoading || isAuthed && !current ? <View style={styles.state}><GlingLoader accessibilityLabel="업체 관리 권한을 확인하는 중" /><ThemedText themeColor="textSecondary">계정과 업체를 확인하고 있어요.</ThemedText></View>
        : !isAuthed ? <View style={[styles.state, { backgroundColor: theme.card, borderColor: theme.line }]}>
          <ThemedText type="title" accessibilityRole="header">가게 소식을 편하게 관리해요.</ThemedText>
          <ThemedText themeColor="textSecondary">평소 쓰던 글링 계정으로 로그인하면 웹에서도 내 업체의 글과 사진을 관리할 수 있어요.</ThemedText>
          <Pressable analyticsId="merchant-web.login" accessibilityRole="button" accessibilityLabel="글링 계정으로 로그인" onPress={() => { play('selection'); promptLogin('내 업체의 글과 사진을 관리해요.'); }}
            style={({ pressed }) => [styles.primary, { backgroundColor: theme.accent, opacity: pressed ? 0.8 : 1 }]}>
            <ThemedText type="smallBold" style={{ color: theme.accentInk }}>글링 계정으로 로그인</ThemedText>
          </Pressable>
        </View>
          : !current?.enabled ? <View style={[styles.state, { backgroundColor: theme.card, borderColor: theme.line }]}>
            <ThemedText type="subtitle" accessibilityRole="header">{current?.failed ? '권한을 확인하지 못했어요' : '업체 관리 권한이 필요해요'}</ThemedText>
            <ThemedText themeColor="textSecondary">{current?.failed ? '연결 상태를 확인한 뒤 다시 시도해 주세요.' : '담당자가 이 계정의 업체 관리 권한을 승인하면, 연결된 내 업체를 관리할 수 있어요.'}</ThemedText>
            <Pressable analyticsId="merchant-web.access.retry" accessibilityRole="button" accessibilityLabel="권한 다시 확인" onPress={retry}
              style={({ pressed }) => [styles.action, { borderColor: theme.line, opacity: pressed ? 0.65 : 1 }]}><ThemedText type="smallBold">권한 다시 확인</ThemedText></Pressable>
          </View>
            : <>
              {callback && <MerchantNaverCallback key={me.id} callback={callback} onConnected={merchantId => { setConnected({ user: me.id, merchantId }); setCallback(null); }} />}
              <MerchantWorkspace key={`${me.id}:${initialMerchantId ?? ''}`} refreshSignal={revision} initialMerchantId={initialMerchantId} initialTab={initialMerchantId ? 'channels' : undefined} />
            </>}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  page: { flex: 1, minHeight: '100%' }, header: { borderBottomWidth: 1 },
  headerContent: { width: '100%', maxWidth: 808, alignSelf: 'center', paddingHorizontal: 24, paddingVertical: 12, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12 }, wordmark: { width: 76, height: 30 },
  account: { flexDirection: 'row', gap: 12, alignItems: 'center', maxWidth: '100%', flexShrink: 1 }, nickname: { flexShrink: 1 },
  content: { width: '100%', maxWidth: 808, alignSelf: 'center', padding: 24, gap: 16, paddingBottom: 64 },
  state: { gap: 16, padding: 24, borderWidth: 1, borderRadius: 20, alignItems: 'flex-start' },
  action: { minHeight: 44, minWidth: 44, borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  primary: { minHeight: 48, minWidth: 44, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
