import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { LoginPanel } from '@/components/login-panel';
import { ProfileOnboarding, type CompletedProfile } from '@/components/profile-onboarding';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { isAdminRole } from '@/lib/admin';
import { canUseDevPasswordLogin, getOAuthCode } from '@/lib/kakao-auth';
import { supabase } from '@/lib/supabase';
import type { TrustLevel } from '@/lib/trust';

// 2단 인증 게이트 (원페이저 정체성 모델)
//  L0 = 소셜 로그인 → 표현: 글쓰기·댓글·상세·내 프로필
//  L2 = 전화 인증 → 만남: 대화(DM)·모임 참여·거래 카테고리
// 전화 인증만 mock이며 OAuth 세션은 Supabase가 관리한다.
type Level = 0 | 1 | 2; // 0 게스트 · 1 소셜 · 2 전화인증
type OAuthProvider = 'google' | 'kakao';

type Me = { id: string; nickname: string; photoUri: string | null };

type ProfileRecord = Pick<CompletedProfile, 'id' | 'nickname' | 'city_id' | 'avatar_path'> & {
  verification_level?: TrustLevel;
  account_status?: 'active' | 'suspended' | 'deleted' | 'reactivation_pending';
  account_status_note?: string | null;
};

type AuthValue = {
  level: Level;
  me: Me; // 내 부캐 (mock — 온보딩 구현 시 설정값으로 교체)
  isAuthed: boolean; // L0+ (로그인됨)
  isVerified: boolean; // L2 (전화 인증됨)
  trustLevel: TrustLevel;
  isAdmin: boolean;
  isAuthLoading: boolean;
  authError: string | null;
  signInGoogle: () => Promise<void>;
  signInKakao: () => Promise<void>;
  signInDev: (email: string, password: string) => Promise<void>;
  verifyPhone: () => void;
  signOut: () => Promise<void>;
  setProfilePhoto: (uri: string | null, base64?: string) => Promise<void>;
  promptLogin: (reason?: string) => void; // L0 게이트
  promptVerify: (reason?: string) => void; // L2 게이트
};

WebBrowser.maybeCompleteAuthSession();

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [mode, setMode] = useState<'login' | 'verify'>('login');
  const [reason, setReason] = useState<string | undefined>();
  const [visible, setVisible] = useState(false);
  const [profilePhotoUri, setProfilePhotoUri] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [missingProfileUserId, setMissingProfileUserId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!session) return;
    void supabase.from('profiles')
      .select('id,nickname,city_id,avatar_path,verification_level,account_status,account_status_note')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(async ({ data, error }) => {
        if (!active || error) return;
        setProfile(data);
        setMissingProfileUserId(data == null || data.account_status === 'reactivation_pending' ? session.user.id : null);
        if (data?.avatar_path) {
          const signed = await supabase.storage.from('avatars').createSignedUrl(data.avatar_path, 3600);
          if (active && signed.data?.signedUrl) setProfilePhotoUri(signed.data.signedUrl);
        }
      });
    return () => { active = false; };
  }, [session]);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setSessionReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setSessionReady(true);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signInOAuth = useCallback(async (provider: OAuthProvider) => {
    setAuthError(null);
    setSigningIn(true);
    try {
      const redirectTo = Linking.createURL('auth/callback');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: true,
        },
      });
      if (error || !data.url) throw new Error('OAUTH_START_FAILED');

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== 'success') return;

      const code = getOAuthCode(result.url, redirectTo);
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) throw new Error('OAUTH_EXCHANGE_FAILED');
      setVisible(false);
    } catch {
      setAuthError(t.auth.loginError);
    } finally {
      setSigningIn(false);
    }
  }, []);
  const signInGoogle = useCallback(() => signInOAuth('google'), [signInOAuth]);
  const signInKakao = useCallback(() => signInOAuth('kakao'), [signInOAuth]);
  const signInDev = useCallback(async (email: string, password: string) => {
    if (!canUseDevPasswordLogin(__DEV__)) return;
    setSigningIn(true);
    setAuthError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      setVisible(false);
    } catch {
      setAuthError(t.auth.devLoginError);
    } finally {
      setSigningIn(false);
    }
  }, []);
  const verifyPhone = useCallback(() => {
    setPhoneVerified(true);
    setVisible(false);
  }, []);
  const signOut = useCallback(async () => {
    setAuthError(null);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setAuthError(t.auth.signOutError);
      return;
    }
    setPhoneVerified(false);
    setProfilePhotoUri(null);
    setProfile(null);
    setMissingProfileUserId(null);
  }, []);
  const setProfilePhoto = useCallback(async (uri: string | null, base64?: string) => {
    if (!session) return;
    let avatarPath: string | null = null;
    if (uri && base64) {
      avatarPath = `${session.user.id}/avatar.jpg`;
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)).buffer;
      const upload = await supabase.storage.from('avatars').upload(
        avatarPath,
        bytes,
        { contentType: 'image/jpeg', upsert: true },
      );
      if (upload.error) throw upload.error;
    }
    const updated = await supabase.from('profiles').update({ avatar_path: avatarPath }).eq('id', session.user.id);
    if (updated.error) throw updated.error;
    if (!uri && profile?.avatar_path) void supabase.storage.from('avatars').remove([profile.avatar_path]);
    setProfile((current) => current?.id === session.user.id ? { ...current, avatar_path: avatarPath } : current);
    setProfilePhotoUri(uri);
  }, [profile, session]);
  const promptLogin = useCallback((r?: string) => {
    setAuthError(null);
    setMode('login');
    setReason(r);
    setVisible(true);
  }, []);
  const promptVerify = useCallback((r?: string) => {
    setAuthError(null);
    setMode('verify');
    setReason(r);
    setVisible(true);
  }, []);

  const level: Level = session ? (phoneVerified ? 2 : 1) : 0;
  const metadata = session?.user.user_metadata;
  const isAdmin = isAdminRole(session?.user.app_metadata);
  const socialNickname = [metadata?.user_name, metadata?.nickname, metadata?.name, metadata?.full_name].find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
  const socialPhoto = [metadata?.avatar_url, metadata?.picture, metadata?.profile_image_url].find(
    (value): value is string => typeof value === 'string' && value.startsWith('http'),
  ) ?? null;

  const completeProfile = useCallback((created: CompletedProfile) => {
    setProfile({ ...created, account_status: 'active' });
    setProfilePhotoUri(created.photoUri);
    setMissingProfileUserId(null);
  }, []);

  const activeProfile = profile?.id === session?.user.id ? profile : null;
  const lockedStatus = activeProfile?.account_status === 'deleted' || activeProfile?.account_status === 'suspended'
    ? activeProfile.account_status
    : null;
  const trustLevel: TrustLevel = activeProfile?.verification_level ?? (level >= 2 ? 2 : 1);

  const value = useMemo<AuthValue>(
    () => ({
      level,
      me: { id: session?.user.id ?? 'me', nickname: activeProfile?.nickname ?? socialNickname ?? '밴쿠버뉴비', photoUri: activeProfile ? profilePhotoUri ?? socialPhoto : socialPhoto },
      isAuthed: level >= 1,
      isVerified: trustLevel >= 2,
      trustLevel,
      isAdmin,
      isAuthLoading: !sessionReady || signingIn,
      authError,
      signInGoogle,
      signInKakao,
      signInDev,
      verifyPhone,
      signOut,
      setProfilePhoto,
      promptLogin,
      promptVerify,
    }),
    [
      level,
      trustLevel,
      session?.user,
      activeProfile,
      socialNickname,
      socialPhoto,
      profilePhotoUri,
      sessionReady,
      signingIn,
      authError,
      isAdmin,
      signInGoogle,
      signInKakao,
      signInDev,
      verifyPhone,
      signOut,
      setProfilePhoto,
      promptLogin,
      promptVerify,
    ],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      <Modal visible={visible} animationType="slide" onRequestClose={() => setVisible(false)}>
        <LoginPanel
          mode={mode}
          reason={reason}
          onGoogle={signInGoogle}
          onKakao={signInKakao}
          onDevLogin={signInDev}
          onVerify={verifyPhone}
          loading={signingIn}
          error={authError}
          onClose={() => setVisible(false)}
        />
      </Modal>
      <Modal visible={lockedStatus != null} animationType="fade" onRequestClose={() => {}}>
        {lockedStatus && (
          <AccountLockedPanel
            status={lockedStatus}
            note={activeProfile?.account_status_note}
            onSignOut={signOut}
          />
        )}
      </Modal>
      {session && (
        <ProfileOnboarding
          visible={missingProfileUserId === session.user.id}
          userId={session.user.id}
          socialNickname={socialNickname}
          socialPhoto={socialPhoto}
          reactivating={activeProfile?.account_status === 'reactivation_pending'}
          onComplete={completeProfile}
        />
      )}
    </AuthContext.Provider>
  );
}

function AccountLockedPanel({
  status,
  note,
  onSignOut,
}: {
  status: 'deleted' | 'suspended';
  note?: string | null;
  onSignOut: () => Promise<void>;
}) {
  const theme = useTheme();
  const supportEmail = process.env.EXPO_PUBLIC_SUPPORT_EMAIL;
  return (
    <ThemedView style={styles.lockedScreen}>
      <View style={[styles.lockedCard, { backgroundColor: theme.card, borderColor: theme.line }]}>
        <ThemedText type="title">{status === 'deleted' ? t.auth.deletedTitle : t.auth.suspendedTitle}</ThemedText>
        <ThemedText themeColor="textSecondary">
          {status === 'deleted' ? t.auth.deletedBody : t.auth.suspendedBody}
        </ThemedText>
        {!!note && <ThemedText type="small" themeColor="textSecondary">{note}</ThemedText>}
        {supportEmail && (
          <Pressable onPress={() => void Linking.openURL(`mailto:${supportEmail}`)} accessibilityRole="link" style={[styles.lockedButton, { borderColor: theme.line }]}>
            <ThemedText type="smallBold">{t.profile.support}</ThemedText>
          </Pressable>
        )}
        <Pressable onPress={() => void onSignOut()} accessibilityRole="button" style={[styles.lockedButton, { borderColor: theme.line }]}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>{t.profile.signOut}</ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  lockedScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  lockedCard: { width: 440, maxWidth: '100%', padding: Spacing.five, gap: Spacing.three, borderWidth: 1, borderRadius: 16 },
  lockedButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 10 },
});
