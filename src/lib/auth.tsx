import { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } from '@react-native-google-signin/google-signin';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, DeviceEventEmitter, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LoginPanel } from '@/components/login-panel';
import { ProfileOnboarding, type CompletedProfile } from '@/components/profile-onboarding';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { isAdminRole } from '@/lib/admin';
import { canUseDevPasswordLogin, getKakaoAuthSessionUrl, getOAuthCallbackPath, getOAuthCode } from '@/lib/kakao-auth';
import { CONTACT_EMAIL } from '@/lib/legal-documents';
import { CommunityLocationProvider } from '@/lib/location-provider';
import { CITIES } from '@/lib/mock';
import { AUTH_EXPIRED_EVENT, signInAdminAccount, signInReviewAccount, supabase } from '@/lib/supabase';
import { unregisterPushDevice } from '@/lib/push-notifications';
import type { TrustLevel } from '@/lib/trust';

type Level = 0 | 1;
type OAuthProvider = 'kakao' | 'google';

type Me = { id: string; nickname: string; photoUri: string | null; cityId?: string };

type ProfileRecord = Pick<CompletedProfile, 'id' | 'nickname' | 'city_id' | 'avatar_path'> & {
  verification_level?: TrustLevel;
  account_status?: 'active' | 'suspended' | 'deleted' | 'reactivation_pending';
  account_status_note?: string | null;
  ai_safety_consent_at?: string | null;
};

type AuthValue = {
  level: Level;
  me: Me; // 내 부캐 (mock — 온보딩 구현 시 설정값으로 교체)
  isAuthed: boolean; // L0+ (로그인됨)
  isVerified: boolean;
  trustLevel: TrustLevel;
  isAdmin: boolean;
  isAuthLoading: boolean;
  authError: string | null;
  signInApple: () => Promise<void>;
  prepareAppleAccountDeletion: () => Promise<string | null>;
  signInKakao: () => Promise<void>;
  signInGoogle: () => Promise<void>;
  signInDev: (email: string, password: string) => Promise<void>;
  signInReview: (email: string, password: string) => Promise<void>;
  signInAdmin: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setProfilePhoto: (uri: string | null, base64?: string) => Promise<void>;
  setProfileCity: (cityId: string) => Promise<void>;
  promptLogin: (reason?: string) => void; // L0 게이트
};

WebBrowser.maybeCompleteAuthSession();
const LAST_ACTIVE_KEY = 'gling.lastActiveAt';
const SESSION_INACTIVITY_MS = 30 * 24 * 60 * 60 * 1000;
// iOS signs in with the native Google SDK: Safari never has to reach supabase.co, which failed
// with "네트워크 연결이 유실" on retry. The ID token is issued for the web client Supabase trusts.
const GOOGLE_WEB_CLIENT_ID = '326642098269-tf80dl3hqk0sosr42gphrtc7bu7gucb8.apps.googleusercontent.com';
const GOOGLE_IOS_CLIENT_ID = '326642098269-oa2a97trifhohih9d9tk8lotse14qnn4.apps.googleusercontent.com';
const usesNativeGoogleSignIn = Platform.OS === 'ios';
if (usesNativeGoogleSignIn) GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID, iosClientId: GOOGLE_IOS_CLIENT_ID });

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children, publicPage = false }: { children: ReactNode; publicPage?: boolean }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [loginKey, setLoginKey] = useState<string | null>(null);
  const observedLogin = useRef<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const signInInFlight = useRef(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [reason, setReason] = useState<string | undefined>();
  const [visible, setVisible] = useState(false);
  const [profilePhotoUri, setProfilePhotoUri] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [missingProfileUserId, setMissingProfileUserId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!session) return;
    void supabase.from('profiles')
      .select('id,nickname,city_id,avatar_path,verification_level,account_status,account_status_note,ai_safety_consent_at')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(async ({ data, error }) => {
        if (!active || error) return;
        setProfile(data);
        setMissingProfileUserId(
          data == null
            || data.account_status === 'reactivation_pending'
            || (data.account_status === 'active' && !data.ai_safety_consent_at)
            ? session.user.id
            : null,
        );
        if (data?.avatar_path) {
          const signed = await supabase.storage.from('avatars').createSignedUrl(data.avatar_path, 3600);
          if (active && signed.data?.signedUrl) setProfilePhotoUri(signed.data.signedUrl);
        }
      });
    return () => { active = false; };
  }, [session]);

  useEffect(() => {
    let active = true;
    // Mobile session policy (server-side inactivity timeout needs the Pro plan): stay signed in as
    // long as the app is opened within 30 days; after that, drop the local session so the login
    // sheet appears instead of a stale "logged in" state. Foreground/background toggles token refresh.
    void AsyncStorage.getItem(LAST_ACTIVE_KEY).then(async (raw) => {
      const lastActive = raw ? Number(raw) : null;
      const expired = lastActive != null && Date.now() - lastActive > SESSION_INACTIVITY_MS;
      if (expired) await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      await AsyncStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session);
      setSessionReady(true);
      if (expired && lastActive != null) { setReason(t.auth.sessionExpired); setVisible(true); }
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        supabase.auth.startAutoRefresh();
        void AsyncStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
      } else {
        supabase.auth.stopAutoRefresh();
      }
    });
    supabase.auth.startAutoRefresh();
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      const nextLogin = nextSession?.user.last_sign_in_at ?? null;
      if (event === 'SIGNED_IN' && nextLogin && nextLogin !== observedLogin.current) setLoginKey(nextLogin);
      if (!nextSession) setLoginKey(null);
      observedLogin.current = nextLogin;
      setSession(nextSession);
      setSessionReady(true);
    });
    return () => {
      active = false;
      appState.remove();
      supabase.auth.stopAutoRefresh();
      data.subscription.unsubscribe();
    };
  }, []);

  // A request that came back unauthenticated means the stored session is dead: clear it locally
  // and open the login sheet immediately instead of showing a generic failure.
  useEffect(() => {
    const listener = DeviceEventEmitter.addListener(AUTH_EXPIRED_EVENT, () => {
      void supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      setAuthError(null);
      setReason(t.auth.sessionExpired);
      setVisible(true);
    });
    return () => listener.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const subscription = AppleAuthentication.addRevokeListener(() => void supabase.auth.signOut());
    return () => subscription.remove();
  }, []);

  const signInOAuth = useCallback(async (provider: OAuthProvider) => {
    if (signInInFlight.current) return;
    signInInFlight.current = true;
    setAuthError(null);
    setSigningIn(true);
    try {
      const redirectTo = Linking.createURL(getOAuthCallbackPath(Platform.OS, process.env.EXPO_BASE_URL));
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          // Override Supabase's default account_email scope; Kakao has not approved it for this app.
          queryParams: provider === 'kakao' ? { scope: 'profile_nickname profile_image' } : undefined,
        },
      });
      if (error || !data.url) throw new Error('OAUTH_START_FAILED');

      const result = await WebBrowser.openAuthSessionAsync(getKakaoAuthSessionUrl(data.url, Platform.OS), redirectTo);
      if (result.type !== 'success') return;

      const code = getOAuthCode(result.url, redirectTo);
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) throw new Error('OAUTH_EXCHANGE_FAILED');
      setVisible(false);
    } catch {
      setAuthError(t.auth.loginError);
    } finally {
      signInInFlight.current = false;
      setSigningIn(false);
    }
  }, []);
  const signInKakao = useCallback(() => signInOAuth('kakao'), [signInOAuth]);
  const signInGoogleNative = useCallback(async () => {
    if (signInInFlight.current) return;
    signInInFlight.current = true;
    setAuthError(null);
    setSigningIn(true);
    try {
      const response = await GoogleSignin.signIn();
      if (!isSuccessResponse(response)) return;
      if (!response.data.idToken) throw new Error('GOOGLE_ID_TOKEN_MISSING');
      // GoogleSignIn 9 mints a nonce we cannot read the pre-image of; the Supabase Google
      // provider must have "Skip nonce checks" enabled for this token to be accepted.
      const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: response.data.idToken });
      if (error) throw error;
      setVisible(false);
    } catch (error) {
      if (!(isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED)) setAuthError(t.auth.loginError);
    } finally {
      signInInFlight.current = false;
      setSigningIn(false);
    }
  }, []);
  const signInGoogle = useCallback(
    () => (usesNativeGoogleSignIn ? signInGoogleNative() : signInOAuth('google')),
    [signInGoogleNative, signInOAuth],
  );
  const signInApple = useCallback(async () => {
    if (signInInFlight.current) return;
    signInInFlight.current = true;
    setAuthError(null);
    setSigningIn(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken || !credential.authorizationCode) throw new Error('APPLE_CREDENTIAL_MISSING');
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
        access_token: credential.authorizationCode,
      });
      if (error) throw error;
      const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
        .filter(Boolean)
        .join(' ');
      const metadata = { apple_user_id: credential.user, ...(fullName ? { full_name: fullName } : {}) };
      const updated = await supabase.auth.updateUser({ data: metadata });
      if (updated.error) throw updated.error;
      setVisible(false);
    } catch (error) {
      if ((error as { code?: string }).code !== 'ERR_REQUEST_CANCELED') setAuthError(t.auth.loginError);
    } finally {
      signInInFlight.current = false;
      setSigningIn(false);
    }
  }, []);
  const prepareAppleAccountDeletion = useCallback(async () => {
    const usesApple = session?.user.identities?.some((identity) => identity.provider === 'apple')
      || session?.user.app_metadata?.provider === 'apple';
    if (!usesApple) return null;
    const appleUserId = session?.user.user_metadata?.apple_user_id;
    if (typeof appleUserId !== 'string' || !appleUserId) throw new Error('APPLE_USER_ID_MISSING');
    const credential = await AppleAuthentication.refreshAsync({ user: appleUserId });
    if (!credential.authorizationCode) throw new Error('APPLE_AUTHORIZATION_CODE_MISSING');
    return credential.authorizationCode;
  }, [session]);
  const signInDev = useCallback(async (email: string, password: string) => {
    if (!canUseDevPasswordLogin(__DEV__) || signInInFlight.current) return;
    signInInFlight.current = true;
    setSigningIn(true);
    setAuthError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      setVisible(false);
    } catch {
      setAuthError(t.auth.devLoginError);
    } finally {
      signInInFlight.current = false;
      setSigningIn(false);
    }
  }, []);
  const signInReview = useCallback(async (email: string, password: string) => {
    if (signInInFlight.current) return;
    signInInFlight.current = true;
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInReviewAccount(email, password);
      setVisible(false);
    } catch {
      setAuthError(t.auth.reviewLoginError);
    } finally {
      signInInFlight.current = false;
      setSigningIn(false);
    }
  }, []);
  const signOut = useCallback(async () => {
    setAuthError(null);
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    // Supabase may clear the local session even when remote logout fails.
    // Revoke push first so an offline logout cannot leave an active device binding.
    try {
      if (currentSession) await unregisterPushDevice(supabase, currentSession.user.id);
    } catch {
      setAuthError(t.auth.signOutError);
      return;
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
      setAuthError(t.auth.signOutError);
      return;
    }
    setProfilePhotoUri(null);
    setProfile(null);
    setMissingProfileUserId(null);
  }, []);
  const signInAdmin = useCallback(async (email: string, password: string) => {
    if (signInInFlight.current) return;
    signInInFlight.current = true;
    setSigningIn(true);
    setAuthError(null);
    try { await signInAdminAccount(email, password); }
    catch { setAuthError('관리자 계정 정보와 접근 권한을 확인해주세요.'); }
    finally { signInInFlight.current = false; setSigningIn(false); }
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
    setReason(r);
    setVisible(true);
  }, []);

  const setProfileCity = useCallback(async (cityId: string) => {
    if (!session || !CITIES.some((city) => city.id === cityId)) throw new Error('INVALID_PROFILE_CITY');
    const { data, error } = await supabase.from('profiles')
      .update({ city_id: cityId, neighborhood: null })
      .eq('id', session.user.id).select('id,city_id').single();
    if (error || data?.id !== session.user.id || data.city_id !== cityId) throw error ?? new Error('CITY_UPDATE_FAILED');
    setProfile((current) => current?.id === session.user.id ? { ...current, city_id: cityId } : current);
  }, [session]);

  const level: Level = session ? 1 : 0;
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
  const trustLevel: TrustLevel = activeProfile?.verification_level ?? 1;

  const value = useMemo<AuthValue>(
    () => ({
      level,
      me: { id: session?.user.id ?? 'me', nickname: activeProfile?.nickname ?? socialNickname ?? '밴쿠버뉴비', photoUri: activeProfile ? profilePhotoUri ?? socialPhoto : socialPhoto, cityId: activeProfile?.city_id },
      isAuthed: level >= 1,
      isVerified: trustLevel >= 2,
      trustLevel,
      isAdmin,
      isAuthLoading: !sessionReady || signingIn,
      authError,
      signInApple,
      prepareAppleAccountDeletion,
      signInKakao,
      signInGoogle,
      signInDev,
      signInReview,
      signInAdmin,
      signOut,
      setProfilePhoto,
      setProfileCity,
      promptLogin,
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
      signInApple,
      prepareAppleAccountDeletion,
      signInKakao,
      signInGoogle,
      signInDev,
      signInReview,
      signInAdmin,
      signOut,
      setProfilePhoto,
      setProfileCity,
      promptLogin,
    ],
  );

  return (
    <AuthContext.Provider value={value}>
      <CommunityLocationProvider userId={!publicPage && !lockedStatus ? session?.user.id ?? null : null} loginKey={loginKey}>
      {children}
      <Modal visible={!publicPage && visible} animationType="slide" onRequestClose={() => setVisible(false)}>
        <SafeAreaProvider>
        <LoginPanel
          reason={reason}
          onApple={signInApple}
          onKakao={signInKakao}
          onGoogle={signInGoogle}
          onDevLogin={signInDev}
          loading={signingIn}
          error={authError}
          onClose={() => setVisible(false)}
        />
        </SafeAreaProvider>
      </Modal>
      <Modal visible={!publicPage && lockedStatus != null} animationType="fade" onRequestClose={() => {}}>
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
          key={`${session.user.id}:${activeProfile?.account_status ?? 'new'}:${activeProfile?.ai_safety_consent_at ?? 'missing'}`}
          visible={!publicPage && missingProfileUserId === session.user.id}
          userId={session.user.id}
          socialNickname={socialNickname}
          socialPhoto={socialPhoto}
          existingProfile={activeProfile?.account_status === 'active' ? {
            nickname: activeProfile.nickname,
            city_id: activeProfile.city_id,
            avatar_path: activeProfile.avatar_path,
            photoUri: profilePhotoUri,
          } : null}
          onComplete={completeProfile}
        />
      )}
      </CommunityLocationProvider>
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
  const supportEmail = process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? CONTACT_EMAIL;
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
