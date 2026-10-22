import Head from 'expo-router/head';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Pressable, ScrollView } from '@/components/analytics-controls';
import { GlingLoader } from '@/components/gling-loader';
import { MerchantMcpConnections } from '@/components/merchant-mcp-connections';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { rememberMerchantMcpReturn, validMerchantMcpAuthorizationId } from '@/lib/merchant-mcp';

export default function MerchantAiPage() {
  const theme = useTheme(), router = useRouter(), { play } = useInteractionFeedback();
  const { me, isAuthed, isAuthLoading, authError, promptLogin, signOut } = useAuth();
  const params = useLocalSearchParams<{ authorization_id?: string }>();
  const authorizationId = validMerchantMcpAuthorizationId(params.authorization_id) ? params.authorization_id : undefined;
  function login() {
    play('selection');
    if (authorizationId && typeof window !== 'undefined') { try { rememberMerchantMcpReturn(window.sessionStorage, authorizationId); } catch {} }
    promptLogin('내 비즈니스에 연결할 AI 도구와 권한을 확인해요.');
  }
  return <View style={[styles.page, { backgroundColor: theme.background }]}>
    <Head><title>AI 연결 | 글링 비즈니스</title><meta name="robots" content="noindex,nofollow" /><meta name="referrer" content="no-referrer" /></Head>
    <View style={[styles.header, { borderColor: theme.line }]}><View style={styles.headerContent}>
      <Image source={require('@/assets/brand/gling-night-wordmark.png')} style={styles.wordmark} contentFit="contain" accessibilityLabel="글링" />
      <Pressable analyticsId="merchant.ai.back" accessibilityRole="button" accessibilityLabel="비즈니스 관리로 돌아가기" onPress={() => { play('selection'); router.replace('/'); }} style={styles.button}><ThemedText type="smallBold">비즈니스 관리</ThemedText></Pressable>
    </View></View>
    <ScrollView analyticsId="merchant.ai.page" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {authError && <ThemedText accessibilityRole="alert">{authError}</ThemedText>}
      {isAuthLoading ? <GlingLoader accessibilityLabel="사업자 계정을 확인하는 중" /> : !isAuthed ? <View style={[styles.login, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <ThemedText type="title" accessibilityRole="header">AI에 연결할{`\n`}내 비즈니스를 확인해요.</ThemedText>
        <ThemedText themeColor="textSecondary">글링 사업자 계정으로 로그인한 뒤, 이 AI 도구에 허용할 비즈니스와 작업을 고를 수 있어요.</ThemedText>
        <Pressable analyticsId="merchant.ai.login" accessibilityRole="button" accessibilityLabel="비즈니스 로그인" onPress={login} style={[styles.button, { backgroundColor: theme.accent, borderRadius: 14 }]}><ThemedText type="smallBold" style={{ color: theme.accentInk }}>비즈니스 로그인</ThemedText></Pressable>
      </View> : <>
        <View style={styles.account}><ThemedText type="small" themeColor="textSecondary">{me.nickname} 계정으로 연결</ThemedText>
          <Pressable analyticsId="merchant.ai.switch-account" accessibilityRole="button" accessibilityLabel="다른 계정으로 로그인" style={styles.button} onPress={() => { play('selection'); void signOut(); }}><ThemedText type="smallBold" themeColor="accent">다른 계정으로 로그인</ThemedText></Pressable></View>
        {params.authorization_id && !authorizationId ? <ThemedText accessibilityRole="alert">연결 요청을 확인할 수 없어요. AI 도구에서 글링 연결을 다시 시작해 주세요.</ThemedText>
          : <MerchantMcpConnections key={`${me.id}:${authorizationId ?? ''}`} userId={me.id} authorizationId={authorizationId} />}
      </>}
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  page: { flex: 1, minHeight: '100%' }, header: { borderBottomWidth: 1 },
  headerContent: { width: '100%', maxWidth: 808, alignSelf: 'center', paddingHorizontal: 24, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16 },
  wordmark: { width: 76, height: 30 }, content: { width: '100%', maxWidth: 808, alignSelf: 'center', padding: 24, gap: 20, paddingBottom: 64 },
  button: { minHeight: 44, minWidth: 44, paddingHorizontal: 16, paddingVertical: 12, justifyContent: 'center', alignItems: 'center' },
  login: { borderWidth: 1, borderRadius: 20, padding: 24, gap: 20, alignItems: 'flex-start' }, account: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' },
});
