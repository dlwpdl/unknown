import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { adminTotpQrUri } from '@/lib/admin';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

export function AdminMfaGate({ children }: { children: ReactNode }) {
  const { isAdmin, isAuthed, isAuthLoading, me, signOut } = useAuth();
  const { play } = useInteractionFeedback();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ id: string; ready: boolean; factorId: string | null } | null>(null);
  const [enrollment, setEnrollment] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
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
  if (!isAuthLoading && (!isAuthed || !isAdmin)) return children;
  if (current?.ready) return children;
  const factorId = enrollment?.id ?? current?.factorId;
  return <View style={styles.screen}><View style={styles.content}>
    <ThemedText type="title" accessibilityRole="header">관리자 2차 인증</ThemedText>
    <ThemedText style={styles.muted}>관리자 정보와 작업 API는 2차 인증을 완료한 세션에서만 열립니다.</ThemedText>
    {!current && <ThemedText accessibilityLiveRegion="polite">인증 상태를 확인하는 중…</ThemedText>}
    {!!error && <ThemedText accessibilityRole="alert" style={styles.error}>{error}</ThemedText>}
    {current && !factorId && <>
      <ThemedText>Google Authenticator, Microsoft Authenticator 또는 1Password 같은 인증 앱을 연결해 주세요.</ThemedText>
      <Pressable disabled={busy} accessibilityRole="button" style={styles.primary} onPress={() => void act(async () => {
        const factors = await supabase.auth.mfa.listFactors(); if (factors.error) throw factors.error;
        for (const factor of factors.data.all.filter((f) => f.status === 'unverified' && f.friendly_name?.startsWith('gling-admin-'))) {
          const removed = await supabase.auth.mfa.unenroll({ factorId: factor.id }); if (removed.error) throw removed.error;
        }
        const enrolled = await supabase.auth.mfa.enroll({ factorType: 'totp', issuer: 'Gling Admin', friendlyName: `gling-admin-${Date.now()}` });
        if (enrolled.error) throw enrolled.error;
        setEnrollment({ id: enrolled.data.id, qr: adminTotpQrUri(enrolled.data.totp.qr_code), secret: enrolled.data.totp.secret });
      })}><ThemedText style={styles.primaryText}>{busy ? '연결 중…' : '인증 앱 연결'}</ThemedText></Pressable>
    </>}
    {enrollment && <>
      <ThemedText>인증 앱에서 QR을 스캔한 다음 6자리 코드를 입력해 연결을 완료하세요.</ThemedText>
      <Image source={{ uri: enrollment.qr }} style={styles.qr} contentFit="contain" accessibilityLabel="인증 앱 연결용 QR 코드" />
      <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => { play('selection'); setShowKey((v) => !v); }}><ThemedText>{showKey ? '수동 입력 키 숨기기' : 'QR을 사용할 수 없나요? 수동 입력 키 보기'}</ThemedText></Pressable>
      {showKey && <TextInput readOnly selectTextOnFocus value={enrollment.secret} accessibilityLabel="QR을 사용할 수 없을 때 입력할 인증 키" style={styles.input} />}
    </>}
    {factorId && <>
      <ThemedText>인증 앱의 6자리 코드</ThemedText>
      <TextInput value={code} maxLength={6} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" editable={!busy} accessibilityLabel="2차 인증 6자리 코드" placeholder="000000" placeholderTextColor="#5B6270" style={styles.input}
        onChangeText={(value) => setCode(value.replace(/\D/g, ''))} />
      <Pressable disabled={busy || code.length !== 6} accessibilityRole="button" style={[styles.primary, (busy || code.length !== 6) && styles.disabled]} onPress={() => void act(async () => {
        const verified = await supabase.auth.mfa.challengeAndVerify({ factorId, code }); if (verified.error) throw verified.error;
        setCode(''); setEnrollment(null); play('selection'); setRevision((v) => v + 1);
      })}><ThemedText style={styles.primaryText}>{busy ? '인증 중…' : '인증하고 들어가기'}</ThemedText></Pressable>
      {enrollment && <Pressable disabled={busy} accessibilityRole="button" style={styles.secondary} onPress={() => void act(async () => {
        const removed = await supabase.auth.mfa.unenroll({ factorId: enrollment.id }); if (removed.error) throw removed.error;
        setEnrollment(null); setCode(''); setRevision((v) => v + 1);
      })}><ThemedText>연결 취소</ThemedText></Pressable>}
    </>}
    {error && <Pressable disabled={busy} accessibilityRole="button" style={styles.secondary} onPress={() => { play('selection'); setError(''); setRevision((v) => v + 1); }}><ThemedText>다시 확인</ThemedText></Pressable>}
    <Pressable disabled={busy} accessibilityRole="button" style={styles.secondary} onPress={() => { play('selection'); void signOut(); }}><ThemedText>로그아웃</ThemedText></Pressable>
  </View></View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FAF9F5', alignItems: 'center', justifyContent: 'center', padding: 24 },
  content: { width: '100%', maxWidth: 440, gap: 16 },
  muted: { color: '#5B6270' }, error: { color: '#BE3B2A' },
  input: { minHeight: 48, fontSize: 20, color: '#21252C', padding: 12, borderWidth: 1, borderColor: '#E5E3DB', borderRadius: 8 },
  primary: { minHeight: 48, borderRadius: 8, padding: 12, backgroundColor: '#BE3B2A', alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#FFFFFF', fontWeight: '600' },
  secondary: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  disabled: { opacity: .5 }, qr: { width: 240, height: 240, alignSelf: 'center', backgroundColor: '#FFFFFF' },
});
