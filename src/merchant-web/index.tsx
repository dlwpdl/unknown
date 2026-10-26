import { useRouter } from 'expo-router';
import Head from 'expo-router/head';
import { Image } from 'expo-image';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';

import { Pressable, ScrollView } from '@/components/analytics-controls';
import { GlingLoader } from '@/components/gling-loader';
import { captureMerchantNaverCallback, MerchantNaverCallback } from '@/components/merchant-naver-cafe';
import { MerchantOperatorAccept } from '@/components/merchant-operator-accept';
import { MerchantWorkspace } from '@/components/merchant-workspace';
import { AppStoreChoices } from '@/components/public-web/app-store-choices';
import { ThemedText } from '@/components/themed-text';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { clearMerchantMcpReturn } from '@/lib/merchant-mcp';
import { loadMerchantWebAccess, type MerchantWebAccess } from '@/lib/merchant-web-access';
import { supabase } from '@/lib/supabase';

export default function MerchantWebIndex() {
  const { tr } = useLanguage();
  const router = useRouter();
  const theme = useTheme(), { play } = useInteractionFeedback();
  const { me, isAuthed, isAuthLoading, authError, promptLogin, signOut } = useAuth();
  const [access, setAccess] = useState<{ user: string; value: MerchantWebAccess | null; failed: boolean } | null>(null);
  const [callback, setCallback] = useState(captureMerchantNaverCallback);
  const [connected, setConnected] = useState<{ user: string; merchantId: string } | null>(null);
  const [revision, setRevision] = useState(0), [signingOut, setSigningOut] = useState(false);
  const [loginError, setLoginError] = useState('');
  const signOutBusy = useRef(false);
  const loginScope = useRef({ active: false, key: '' }), loginKey = `${me.id}:${isAuthed}:${isAuthLoading}`;
  useLayoutEffect(() => {
    const current = { active: true, key: loginKey }; loginScope.current = current;
    return () => { current.active = false; };
  }, [loginKey]);
  const current = isAuthed && access?.user === me.id ? access : null;
  const initialMerchantId = connected?.user === me.id ? connected.merchantId : undefined;
  useEffect(() => {
    if (!isAuthed) return;
    let active = true, request = 0;
    const check = () => {
      const latest = ++request;
      void loadMerchantWebAccess(supabase, me.id).then(value => { if (active && latest === request) setAccess({ user: me.id, value, failed: false }); })
        .catch(() => { if (active && latest === request) setAccess({ user: me.id, value: null, failed: true }); });
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
  function login() {
    if (isAuthed || isAuthLoading || !loginScope.current.active || loginScope.current.key !== loginKey) return;
    play('selection'); setLoginError('');
    try { clearMerchantMcpReturn(window.sessionStorage); }
    catch { setLoginError('로그인을 준비하지 못했어요. 다시 시도해 주세요.'); play('warning'); return; }
    promptLogin(tr('같은 글링 계정으로 로그인해요.'));
  }
  return <View style={[styles.page, { backgroundColor: theme.background }]}>
    <Head><title>{tr('비즈니스 관리 | gling')}</title><meta name="robots" content="noindex,nofollow" /></Head>
    <View style={[styles.header, { borderColor: theme.line }]}>
      <View style={styles.headerContent}>
        <View style={styles.brand}><Image source={require('@/assets/brand/gling-night-wordmark.png')} style={styles.wordmark} contentFit="contain" accessibilityLabel={tr('글링')} /><ThemedText type="smallBold">{tr('비즈니스 관리')}</ThemedText></View>
        {isAuthed && <View style={styles.account}>
          <ThemedText type="small" numberOfLines={1} style={styles.nickname}>{me.nickname}</ThemedText>
          {/* The public reader lives at the site root; this keeps the business web from being a dead end for reading posts. */}
          <Pressable analyticsId="merchant-web.feed" accessibilityRole="link" accessibilityLabel={tr('게시글 보기')} onPress={() => { play('selection'); window.location.assign('/'); }}
            style={({ pressed }) => [styles.action, { borderColor: theme.line, opacity: pressed ? 0.65 : 1 }]}><ThemedText type="smallBold">{tr('게시글 보기')}</ThemedText></Pressable>
          <Pressable analyticsId="merchant-web.ai" accessibilityRole="button" accessibilityLabel={current?.value?.canConnectMcp ? tr('AI 연결') : tr('AI 연결 관리')} onPress={() => { play('selection'); router.push('/ai'); }}
            style={({ pressed }) => [styles.action, { borderColor: theme.line, opacity: pressed ? 0.65 : 1 }]}><ThemedText type="smallBold">{current?.value?.canConnectMcp ? tr('AI 연결') : tr('AI 연결 관리')}</ThemedText></Pressable>
          <Pressable analyticsId="merchant-web.signout" accessibilityRole="button" accessibilityLabel={tr('로그아웃')} accessibilityState={{ disabled: signingOut }} disabled={signingOut} onPress={() => { void exit(); }}
            style={({ pressed }) => [styles.action, { borderColor: theme.line, opacity: signingOut || pressed ? 0.65 : 1 }]}>
            <ThemedText type="smallBold">{signingOut ? tr('로그아웃 중…') : tr('로그아웃')}</ThemedText>
          </Pressable>
        </View>}
      </View>
    </View>
    <ScrollView analyticsId="merchant-web.workspace" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {authError && <ThemedText accessibilityRole="alert">{tr(authError)}</ThemedText>}
      {!isAuthLoading && <MerchantOperatorAccept userId={me.id} isAuthed={isAuthed} onJoined={() => { setAccess(null); setRevision(value => value + 1); }} />}
      {isAuthLoading || isAuthed && !current ? <View style={styles.state}><GlingLoader accessibilityLabel={tr('비즈니스 관리 권한을 확인하는 중')} /><ThemedText themeColor="textSecondary">{tr('계정과 비즈니스를 확인하고 있어요.')}</ThemedText></View>
        : !isAuthed ? <View style={[styles.state, { backgroundColor: theme.card, borderColor: theme.line }]}>
          <ThemedText type="title" accessibilityRole="header">{tr('글링 로그인')}</ThemedText>
          <ThemedText themeColor="textSecondary">{tr('같은 글링 계정으로 로그인해요. 비즈니스 운영자는 웹에서 소식과 사진을 관리할 수 있어요. 모임 참여와 대화는 앱에서 이어가요.')}</ThemedText>
          {loginError && <ThemedText accessibilityRole="alert">{tr(loginError)}</ThemedText>}
          <Pressable analyticsId="merchant-web.login" accessibilityRole="button" accessibilityLabel={tr('로그인·가입하기')} onPress={login}
            style={({ pressed }) => [styles.primary, { backgroundColor: theme.accent, opacity: pressed ? 0.8 : 1 }]}>
            <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{tr('로그인·가입하기')}</ThemedText>
          </Pressable>
        </View>
          : current?.failed ? <View style={[styles.state, { backgroundColor: theme.card, borderColor: theme.line }]}>
            <ThemedText type="subtitle" accessibilityRole="header">{tr('권한을 확인하지 못했어요')}</ThemedText>
            <ThemedText themeColor="textSecondary">{tr('연결 상태를 확인한 뒤 다시 시도해 주세요.')}</ThemedText>
            <Pressable analyticsId="merchant-web.access.retry" accessibilityRole="button" accessibilityLabel={tr('권한 다시 확인')} onPress={retry}
              style={({ pressed }) => [styles.action, { borderColor: theme.line, opacity: pressed ? 0.65 : 1 }]}><ThemedText type="smallBold">{tr('권한 다시 확인')}</ThemedText></Pressable>
          </View>
            : current?.value?.kind === 'member' ? <View style={[styles.state, { backgroundColor: theme.card, borderColor: theme.line }]}>
              <ThemedText type="subtitle" accessibilityRole="header">{tr('모임과 대화는 앱에서 이어가요')}</ThemedText>
              <ThemedText themeColor="textSecondary">{tr('공개 글은 로그인한 뒤 웹에서 읽을 수 있어요. 글쓰기·모임 참여·대화는 글링 앱에서 이용해 주세요.')}</ThemedText>
              <Pressable analyticsId="merchant-web.member.app" accessibilityRole="button" accessibilityLabel={tr('글링 앱에서 이어가기')} onPress={() => { play('selection'); window.location.assign('gling://'); }}
                style={({ pressed }) => [styles.primary, { backgroundColor: theme.accent, opacity: pressed ? 0.65 : 1 }]}><ThemedText type="smallBold" style={{ color: theme.accentInk }}>{tr('글링 앱에서 이어가기')}</ThemedText></Pressable>
              <View style={styles.storeChoices}><AppStoreChoices /></View>
            </View>
            : <>
              {current?.value?.kind === 'unassigned' && <View style={[styles.state, { backgroundColor: theme.card, borderColor: theme.line }]}>
                <ThemedText type="subtitle" accessibilityRole="header">{tr('관리할 비즈니스를 연결해 주세요')}</ThemedText>
                <ThemedText themeColor="textSecondary">{tr('비즈니스 운영 승인은 완료됐어요. 아래에서 받은 초대를 확인하거나 비즈니스를 등록해 주세요. AI 신규 연결은 소유권 확인 후 이용할 수 있어요.')}</ThemedText>
              </View>}
              {callback && <MerchantNaverCallback key={me.id} callback={callback} onConnected={merchantId => { setConnected({ user: me.id, merchantId }); setCallback(null); }} />}
              <MerchantWorkspace layout="sidebar" key={`${me.id}:${initialMerchantId ?? ''}`} refreshSignal={revision} initialMerchantId={initialMerchantId} initialTab={initialMerchantId ? 'channels' : undefined} assignedOnly onBusinessesChanged={() => setRevision(value => value + 1)} />
            </>}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  page: { flex: 1, minHeight: '100%' }, header: { borderBottomWidth: 1 },
  headerContent: { width: '100%', maxWidth: 1228, alignSelf: 'center', paddingHorizontal: 24, paddingVertical: 12, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12 }, wordmark: { width: 76, height: 30 },
  account: { flexDirection: 'row', gap: 12, alignItems: 'center', maxWidth: '100%', flexShrink: 1 }, nickname: { flexShrink: 1 },
  content: { width: '100%', maxWidth: 1228, alignSelf: 'center', padding: 24, gap: 16, paddingBottom: 64 },
  state: { gap: 16, padding: 24, borderWidth: 1, borderRadius: 20, alignItems: 'flex-start', width: '100%', maxWidth: 760, alignSelf: 'center' },
  storeChoices: { alignSelf: 'stretch' },
  action: { minHeight: 44, minWidth: 44, borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  primary: { minHeight: 48, minWidth: 44, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
