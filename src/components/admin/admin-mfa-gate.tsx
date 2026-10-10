import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Image } from 'expo-image';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { ThemeOverrideProvider } from '@/hooks/use-theme';
import { adminTotpQrUri } from '@/lib/admin';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

export function AdminMfaGate({ children }: { children: ReactNode }) {
  const { isAdmin, isAuthed, me, signOut } = useAuth();
  const { play } = useInteractionFeedback();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ id: string; ready: boolean; factorId: string | null } | null>(null);
  const [enrollment, setEnrollment] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [focused, setFocused] = useState(false);
  const busyRef = useRef(false);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'TOKEN_REFRESHED') setResult(null);
      setRevision((v) => v + 1);
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') { setEnrollment(null); setCode(''); setShowKey(false); }
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!isAdmin || !isAuthed) return;
    let active = true;
    void (async () => {
      const level = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (level.error) throw level.error;
      const factors = await supabase.auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      if (active) setResult({ id: me.id, ready: level.data.currentLevel === 'aal2', factorId: factors.data.totp.find((f) => f.status === 'verified')?.id ?? null });
    })().catch(() => { if (active) { setResult(null); setError('인증 상태를 확인하지 못했습니다. 다시 확인하거나 로그아웃 후 로그인해 주세요.'); } });
    return () => { active = false; };
  }, [isAdmin, isAuthed, me.id, revision]);
  async function act(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); play('selection');
    try { await action(); }
    catch { setError('인증을 완료하지 못했습니다. 앱의 최신 6자리 코드와 네트워크 상태를 확인하고 다시 시도해 주세요.'); play('warning'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const current = result?.id === me.id ? result : null;
  if (!isAuthed || !isAdmin) return children;
  if (current?.ready) return children;
  const factorId = enrollment?.id ?? current?.factorId;
  const verifyCode = () => {
    if (!factorId || code.length !== 6 || busy) return;
    void act(async () => {
      const verified = await supabase.auth.mfa.challengeAndVerify({ factorId, code }); if (verified.error) throw verified.error;
      setCode(''); setEnrollment(null); play('selection'); setRevision((v) => v + 1);
    });
  };
  return <ThemeOverrideProvider scheme="dark"><View style={styles.screen}>
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Image source={require('@/assets/brand/gling-night-wordmark.png')} style={styles.logo} contentFit="contain" accessibilityLabel="글링" />
    <View style={styles.header}><ThemedText type="subtitle" accessibilityRole="header">관리자 2차 인증</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{!current ? error ? '인증 상태를 다시 확인해 주세요.' : '로그인 정보를 안전하게 확인하고 있습니다.' : factorId ? '인증 앱의 6자리 코드로 안전하게 로그인하세요.' : '관리자 계정을 보호할 인증 앱을 연결해 주세요.'}</ThemedText></View>
    <View style={styles.form} aria-busy={busy}>
    {!current && !error && <View style={styles.status}><ThemedText type="small" accessibilityLiveRegion="polite" themeColor="textSecondary">인증 상태를 확인하는 중…</ThemedText></View>}
    {!!error && <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}><ThemedText type="small">{error}</ThemedText></View>}
    {current && !factorId && <>
      <ThemedText type="small" themeColor="textSecondary">Google Authenticator, Microsoft Authenticator, 1Password 등을 사용할 수 있습니다.</ThemedText>
      <RaisedActionButton analyticsId="admin_mfa.enroll" disabled={busy} busy={busy} label={busy ? '연결 중…' : '인증 앱 연결'} onPress={() => void act(async () => {
        const factors = await supabase.auth.mfa.listFactors(); if (factors.error) throw factors.error;
        for (const factor of factors.data.all.filter((f) => f.status === 'unverified' && f.friendly_name?.startsWith('gling-admin-'))) {
          const removed = await supabase.auth.mfa.unenroll({ factorId: factor.id }); if (removed.error) throw removed.error;
        }
        const enrolled = await supabase.auth.mfa.enroll({ factorType: 'totp', issuer: 'Gling Admin', friendlyName: `gling-admin-${Date.now()}` });
        if (enrolled.error) throw enrolled.error;
        setEnrollment({ id: enrolled.data.id, qr: adminTotpQrUri(enrolled.data.totp.qr_code), secret: enrolled.data.totp.secret });
      })} />
    </>}
    {enrollment && <>
      <View style={styles.setup}><ThemedText type="small">인증 앱에서 QR을 스캔해 주세요.</ThemedText>
      <View style={styles.qrCard}><Image source={{ uri: enrollment.qr }} style={styles.qr} contentFit="contain" accessibilityLabel="인증 앱 연결용 QR 코드" /></View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showKey }} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} onPress={() => { play('selection'); setShowKey((v) => !v); }}><ThemedText type="small" themeColor="textSecondary">{showKey ? '수동 입력 키 숨기기' : 'QR 대신 수동 입력 키 보기'}</ThemedText></Pressable>
      {showKey && <TextInput readOnly selectTextOnFocus value={enrollment.secret} accessibilityLabel="QR을 사용할 수 없을 때 입력할 인증 키" style={[styles.input, styles.key]} onFocus={() => play('selection')} />}</View>
    </>}
    {factorId && <>
      <View style={styles.field}><ThemedText type="smallBold">인증 앱의 6자리 코드</ThemedText>
      <TextInput value={code} maxLength={6} keyboardType="number-pad" inputMode="numeric" autoComplete="one-time-code" textContentType="oneTimeCode" editable={!busy} autoCorrect={false} spellCheck={false} returnKeyType="go"
        accessibilityLabel="2차 인증 6자리 코드" placeholder="000000" placeholderTextColor={Colors.dark.textSecondary} style={[styles.input, styles.code, focused && styles.focused]}
        onFocus={() => { play('selection'); setFocused(true); }} onBlur={() => setFocused(false)} onSubmitEditing={verifyCode} onChangeText={(value) => setCode(value.replace(/\D/g, ''))} /></View>
      <RaisedActionButton analyticsId="admin_mfa.verify" disabled={busy || code.length !== 6} busy={busy} label={busy ? '인증 중…' : '인증하고 들어가기'} onPress={verifyCode} />
      {enrollment && <Pressable disabled={busy} accessibilityRole="button" style={styles.secondary} onPress={() => void act(async () => {
        const removed = await supabase.auth.mfa.unenroll({ factorId: enrollment.id }); if (removed.error) throw removed.error;
        setEnrollment(null); setCode(''); setRevision((v) => v + 1);
      })}><ThemedText type="small" themeColor="textSecondary">연결 취소</ThemedText></Pressable>}
    </>}
    {!!error && <Pressable disabled={busy} accessibilityRole="button" style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} onPress={() => { play('selection'); setError(''); setRevision((v) => v + 1); }}><ThemedText type="small" themeColor="textSecondary">다시 확인</ThemedText></Pressable>}
    </View><View style={styles.footer}><ThemedText type="small" themeColor="textSecondary" style={styles.note}>2차 인증을 마치면 관리자 대시보드가 열립니다.</ThemedText>
    <Pressable disabled={busy} accessibilityRole="button" style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} onPress={() => { play('selection'); void signOut(); }}><ThemedText type="small" themeColor="textSecondary">로그아웃</ThemedText></Pressable>
    </View></ScrollView></KeyboardAvoidingView>
  </View></ThemeOverrideProvider>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.dark.background }, fill: { flex: 1 },
  content: { flexGrow: 1, width: '100%', maxWidth: 440, alignSelf: 'center', justifyContent: 'center', paddingHorizontal: Spacing.four, paddingVertical: Spacing.five, gap: Spacing.five },
  logo: { width: 180, height: 64, alignSelf: 'flex-start' }, header: { gap: Spacing.two }, form: { gap: Spacing.three }, field: { gap: Spacing.two },
  error: { padding: Spacing.three, borderWidth: 1, borderColor: Colors.dark.accent, borderRadius: 12, backgroundColor: Colors.dark.card },
  status: { paddingVertical: Spacing.three },
  input: { minHeight: 52, minWidth: 0, borderWidth: 1, borderColor: Colors.dark.line, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: 12, color: Colors.dark.text, backgroundColor: Colors.dark.backgroundElement, fontSize: 16, lineHeight: 24 },
  code: { fontSize: 24, lineHeight: 32, letterSpacing: 8, textAlign: 'center', fontVariant: ['tabular-nums'] }, focused: { borderColor: Colors.dark.accent }, key: { fontSize: 13 },
  secondary: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: Spacing.two }, pressed: { opacity: .7 },
  setup: { gap: Spacing.two }, qrCard: { alignSelf: 'center', padding: 12, borderRadius: 16, backgroundColor: '#FFFFFF' }, qr: { width: 216, height: 216 },
  footer: { gap: Spacing.two }, note: { textAlign: 'center' },
});
