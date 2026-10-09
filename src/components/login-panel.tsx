import { Pressable, ScrollView } from '@/components/analytics-controls';
import { Image } from 'expo-image';
import { useFonts } from 'expo-font';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Animated, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GlassSurface } from '@/components/glass-surface';
import { RaisedActionButton } from '@/components/raised-action-button';
import { Colors, Spacing } from '@/constants/theme';
import { ThemeOverrideProvider, useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

const WELCOME_LINES = ['모임을 찾아요', '공연을 만나요', '이야기를 나눠요'];

export function LoginPanel({
  reason,
  onApple,
  onKakao,
  onGoogle,
  onDevLogin,
  onReviewLogin,
  onAdminLogin,
  loading = false,
  error,
  onClose,
}: {
  reason?: string;
  onApple?: () => void;
  onKakao?: () => void;
  onGoogle?: () => void;
  onDevLogin?: (email: string, password: string) => void;
  onReviewLogin?: (email: string, password: string) => void;
  onAdminLogin?: (email: string, password: string) => void;
  loading?: boolean;
  error?: string | null;
  onClose?: () => void;
}) {
  const theme = useTheme();
  const dark = theme === Colors.dark;
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const [googleFontLoaded] = useFonts({ GoogleSansMedium: require('@/assets/fonts/GoogleSans-Medium.ttf') });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const adminPasswordInput = useRef<TextInput>(null);
  const [adminFocusedField, setAdminFocusedField] = useState<'email' | 'password' | null>(null);
  const [welcomeIndex, setWelcomeIndex] = useState(0);
  const [welcomeOpacity] = useState(() => new Animated.Value(1));
  const disabled = loading;
  const showWelcome = !onAdminLogin && !onReviewLogin;
  const passwordLogin = onAdminLogin ?? onReviewLogin ?? (__DEV__ ? onDevLogin : undefined);
  const publicSiteUrl = (process.env.EXPO_PUBLIC_APP_URL ?? 'https://gling.ej-entertainment.com').replace(/\/$/, '');

  useFocusEffect(useCallback(() => {
    if (!showWelcome || reducedMotion || loading) {
      welcomeOpacity.setValue(1);
      return;
    }
    const timer = setInterval(() => {
      Animated.timing(welcomeOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(({ finished }) => {
        if (!finished) return;
        setWelcomeIndex((current) => (current + 1) % WELCOME_LINES.length);
        Animated.timing(welcomeOpacity, { toValue: 1, duration: 320, useNativeDriver: true }).start();
      });
    }, 3200);
    return () => {
      clearInterval(timer);
      welcomeOpacity.stopAnimation();
      welcomeOpacity.setValue(1);
    };
  }, [loading, reducedMotion, showWelcome, welcomeOpacity]));

  if (onAdminLogin) {
    const submitDisabled = disabled || !email.trim() || !password;
    const submitAdmin = () => { if (!submitDisabled) { play('selection'); onAdminLogin(email, password); } };
    return <ThemeOverrideProvider scheme="dark">
      <View style={[styles.wrap, styles.adminBackground]}><SafeAreaView style={styles.wrap}>
        <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView analyticsId="components_login-panel.scrollview.1" contentContainerStyle={styles.adminCenter} keyboardShouldPersistTaps="handled">
            <Image source={require('@/assets/brand/gling-night-wordmark.png')} style={styles.adminLogo} contentFit="contain" accessibilityLabel={t.appName} />
            <View style={styles.adminHeader}>
              <ThemedText type="subtitle" accessibilityRole="header">관리자 로그인</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{reason ?? '관리자 계정으로 로그인해 주세요.'}</ThemedText>
            </View>
            <View style={styles.adminForm} aria-busy={loading}>
              <View style={styles.adminField}>
                <ThemedText type="smallBold">이메일</ThemedText>
                <TextInput value={email} onChangeText={setEmail} editable={!disabled} autoCapitalize="none" autoCorrect={false} spellCheck={false}
                  autoComplete="email" textContentType="username" keyboardType="email-address" returnKeyType="next" onSubmitEditing={() => adminPasswordInput.current?.focus()}
                  accessibilityLabel="관리자 이메일" placeholder="관리자 이메일" placeholderTextColor={Colors.dark.textSecondary}
                  onFocus={() => { play('selection'); setAdminFocusedField('email'); }} onBlur={() => setAdminFocusedField(null)}
                  style={[styles.adminInput, { borderColor: adminFocusedField === 'email' ? Colors.dark.accent : Colors.dark.line }]} />
              </View>
              <View style={styles.adminField}>
                <ThemedText type="smallBold">비밀번호</ThemedText>
                <TextInput ref={adminPasswordInput} value={password} onChangeText={setPassword} editable={!disabled} secureTextEntry
                  autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="current-password" textContentType="password"
                  returnKeyType="go" onSubmitEditing={submitAdmin} accessibilityLabel="관리자 비밀번호" placeholder="관리자 비밀번호" placeholderTextColor={Colors.dark.textSecondary}
                  onFocus={() => { play('selection'); setAdminFocusedField('password'); }} onBlur={() => setAdminFocusedField(null)}
                  style={[styles.adminInput, { borderColor: adminFocusedField === 'password' ? Colors.dark.accent : Colors.dark.line }]} />
              </View>
              {!!error && <View style={styles.adminError} accessibilityRole="alert" accessibilityLiveRegion="polite"><ThemedText type="small">{error}</ThemedText></View>}
              <RaisedActionButton analyticsId="components_login-panel.pressable.3" label={loading ? '로그인 중…' : '관리자 로그인'} onPress={submitAdmin} disabled={submitDisabled} busy={loading} />
              {onGoogle && <Pressable analyticsId="components_login-panel.pressable.2" accessibilityRole="button" accessibilityLabel={t.auth.google}
                disabled={disabled} accessibilityState={{ disabled, busy: loading }} onPress={() => { if (!disabled) { play('selection'); onGoogle(); } }}
                style={({ pressed }) => [styles.adminGoogle, { opacity: disabled ? 0.6 : pressed ? 0.8 : 1 }]}>
                <Image source={require('@/assets/brand/google-g.png')} style={styles.googleIcon} contentFit="contain" accessible={false} />
                <ThemedText type="small" style={[styles.googleText, googleFontLoaded && { fontFamily: 'GoogleSansMedium' }]}>{t.auth.google}</ThemedText>
              </Pressable>}
            </View>
            <View style={styles.adminFooter}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.adminNote}>사전에 등록된 관리자 계정만 접근할 수 있습니다.</ThemedText>
              <View style={[styles.legalLinks, styles.adminLegalLinks]}>{['terms', 'privacy'].map((path) => <Pressable analyticsId="components_login-panel.pressable.4" key={path}
                accessibilityRole="link" onPress={() => { play('selection'); void Linking.openURL(`${publicSiteUrl}/${path}`); }} style={styles.legalLink}>
                <ThemedText type="small" themeColor="textSecondary">{path === 'terms' ? '이용약관' : '개인정보처리방침'}</ThemedText>
              </Pressable>)}</View>
              {onClose && <Pressable analyticsId="components_login-panel.pressable.6" accessibilityRole="button" style={styles.adminClose} onPress={() => { play('selection'); onClose(); }}>
                <ThemedText type="smallBold" themeColor="textSecondary">{t.auth.close}</ThemedText>
              </Pressable>}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView></View>
    </ThemeOverrideProvider>;
  }

  return (
    <ThemedView style={styles.wrap}>
      <Image source={require('@/assets/images/festival-glass-orbs.webp')} style={styles.ambientArt} contentFit="contain" accessible={false} pointerEvents="none" />
      <SafeAreaView style={styles.wrap}>
      <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView analyticsId="components_login-panel.scrollview.1" contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
        <Image
          source={dark ? require('@/assets/brand/gling-night-wordmark.png') : require('@/assets/brand/gling-night-wordmark-light.png')}
          style={styles.brandLogo}
          contentFit="contain"
          accessibilityLabel={t.appName}
        />
        <GlassSurface tone="control" style={styles.welcomeGlass}>
          <View style={styles.welcomeContent}>
            {showWelcome && <View style={styles.welcomeLine}>
              <ThemedText type="subtitle">오늘은 </ThemedText>
              <Animated.View style={{ opacity: welcomeOpacity,
                transform: [{ translateY: welcomeOpacity.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }}>
                <ThemedText type="subtitle" style={{ color: theme.accent }}>{WELCOME_LINES[welcomeIndex]}</ThemedText>
              </Animated.View>
            </View>}
            <ThemedText type="small" themeColor="textSecondary" style={styles.tagline}>
              {reason ?? t.auth.tagline}
            </ThemedText>
          </View>
        </GlassSurface>

        <View style={styles.actions}>
            {Platform.OS === 'ios' && onApple && (<GlassSurface tone="control" interactive style={styles.socialGlass}><View style={styles.appleInset}>
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={24}
                onPress={() => { if (!disabled) { play('selection'); onApple(); } }}
                accessibilityState={{ disabled, busy: loading }}
                style={[styles.appleButton, { opacity: disabled ? 0.6 : 1 }]}
              />
            </View></GlassSurface>)}
            {onKakao && <GlassSurface tone="control" interactive style={styles.socialGlass}><Pressable analyticsId="components_login-panel.pressable.1"
              onPress={() => { if (!disabled) { play('selection'); onKakao(); } }}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ disabled, busy: loading }}
              style={({ pressed }) => [styles.btn, { backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent', opacity: disabled ? 0.6 : 1, transform: [{ scale: pressed && !reducedMotion ? 0.98 : 1 }] }]}>
              <ThemedText type="smallBold" style={{ color: '#FEE500', fontSize: 16 }}>
                {t.auth.kakao}
              </ThemedText>
            </Pressable></GlassSurface>}
            {onGoogle && <GlassSurface tone="control" interactive style={styles.socialGlass}><Pressable analyticsId="components_login-panel.pressable.2"
              onPress={() => { if (!disabled) { play('selection'); onGoogle(); } }}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={t.auth.google}
              accessibilityState={{ disabled, busy: loading }}
              style={({ pressed }) => [styles.btn, styles.googleButton, { backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent', opacity: disabled ? 0.6 : 1, transform: [{ scale: pressed && !reducedMotion ? 0.98 : 1 }] }]}>
              <Image source={require('@/assets/brand/google-g.png')} style={styles.googleIcon} contentFit="contain" accessible={false} />
              <ThemedText type="small" style={[styles.googleText, { color: theme.text }, googleFontLoaded && { fontFamily: 'GoogleSansMedium' }]}>{t.auth.google}</ThemedText>
            </Pressable></GlassSurface>}
            {loading && <ThemedText type="small" themeColor="textSecondary" accessibilityRole="progressbar" style={styles.note}>{t.auth.connecting}</ThemedText>}
            {passwordLogin && (
              <GlassSurface tone="control" style={styles.devGlass}>
              <View style={styles.devBox}>
                <ThemedText type="smallBold">{onAdminLogin ? '관리자 계정 로그인' : onReviewLogin ? t.auth.reviewLoginTitle : t.auth.devLoginTitle}</ThemedText>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  placeholder={onAdminLogin ? '관리자 이메일' : onReviewLogin ? t.auth.reviewEmail : t.auth.devEmail}
                  placeholderTextColor={theme.textSecondary}
                  accessibilityLabel={onAdminLogin ? '관리자 이메일' : onReviewLogin ? t.auth.reviewEmail : t.auth.devEmail}
                  autoCorrect={false}
                  spellCheck={false}
                  style={[styles.devInput, { color: theme.text, borderColor: theme.line }]}
                />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  // iOS는 autocapitalize=on이면 첫 글자를 대문자로 바꾼다. 28자 비밀번호는 그 한 글자로 실패한다.
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  autoComplete="current-password"
                  placeholder={onAdminLogin ? '관리자 비밀번호' : onReviewLogin ? t.auth.reviewPassword : t.auth.devPassword}
                  placeholderTextColor={theme.textSecondary}
                  accessibilityLabel={onAdminLogin ? '관리자 비밀번호' : onReviewLogin ? t.auth.reviewPassword : t.auth.devPassword}
                  style={[styles.devInput, { color: theme.text, borderColor: theme.line }]}
                />
                <Pressable analyticsId="components_login-panel.pressable.3"
                  onPress={() => { if (!disabled && email.trim() && password) { play('selection'); passwordLogin(email, password); } }}
                  disabled={disabled || !email.trim() || !password}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: disabled || !email.trim() || !password, busy: loading }}
                  style={({ pressed }) => [styles.devButton, { backgroundColor: theme.accent, opacity: disabled || !email.trim() || !password ? 0.5 : pressed ? 0.8 : 1, transform: [{ scale: pressed && !reducedMotion ? 0.97 : 1 }] }]}>
                  <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{onAdminLogin ? '관리자 로그인' : onReviewLogin ? t.auth.reviewLoginCta : t.auth.devLoginCta}</ThemedText>
                </Pressable>
              </View>
              </GlassSurface>
            )}
          </View>

        {!!error && (
          <ThemedText accessibilityRole="alert" type="small" style={[styles.error, { color: theme.accent }]}>
            {error}
          </ThemedText>
        )}

        <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
          {onAdminLogin ? '사전에 등록된 관리자 계정만 접근할 수 있습니다.' : onReviewLogin ? t.auth.reviewLoginNote : t.auth.loginNote}
        </ThemedText>

        <View style={styles.legalLinks}>
          {['terms', 'privacy'].map((path) => <Pressable analyticsId="components_login-panel.pressable.4" key={path} onPress={() => { play('selection'); void Linking.openURL(`${publicSiteUrl}/${path}`); }}
            accessibilityRole="link" style={styles.legalLink}>
            <ThemedText type="small" themeColor="textSecondary">{path === 'terms' ? '이용약관' : '개인정보처리방침'}</ThemedText>
          </Pressable>)}
        </View>

        {onClose && (
          <Pressable analyticsId="components_login-panel.pressable.6" onPress={() => { play('selection'); onClose(); }} accessibilityRole="button" style={styles.close}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {t.auth.close}
            </ThemedText>
          </Pressable>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  adminBackground: { backgroundColor: Colors.dark.background },
  adminCenter: { flexGrow: 1, width: '100%', maxWidth: 440, alignSelf: 'center', justifyContent: 'center', paddingHorizontal: Spacing.four, paddingVertical: Spacing.five, gap: Spacing.five },
  adminLogo: { width: 180, height: 64, alignSelf: 'flex-start' },
  adminHeader: { gap: Spacing.two }, adminForm: { gap: Spacing.three }, adminField: { gap: Spacing.two },
  adminInput: { minHeight: 52, minWidth: 0, borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: 12, color: Colors.dark.text, backgroundColor: Colors.dark.backgroundElement, fontSize: 16, lineHeight: 24 },
  adminError: { padding: Spacing.three, borderWidth: 1, borderColor: Colors.dark.accent, borderRadius: 12, backgroundColor: Colors.dark.card },
  adminGoogle: { minHeight: 52, borderWidth: 1, borderColor: Colors.dark.line, borderRadius: 999, paddingHorizontal: Spacing.three, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  adminFooter: { gap: Spacing.two }, adminNote: { textAlign: 'center' },
  adminLegalLinks: { justifyContent: 'center', flexWrap: 'wrap' }, adminClose: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  wrap: {
    flex: 1,
  },
  center: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.four,
    gap: Spacing.two,
  },
  brandLogo: { width: 180, height: 80 },
  ambientArt: { position: 'absolute', top: 84, right: -118, width: 510, height: 340, opacity: 0.16 },
  welcomeGlass: { alignSelf: 'stretch', borderRadius: 24, marginBottom: Spacing.two },
  welcomeContent: { alignItems: 'center', paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, gap: Spacing.one },
  welcomeLine: { minHeight: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  tagline: {
    textAlign: 'center',
    maxWidth: 280,
  },
  actions: {
    alignSelf: 'stretch',
    gap: Spacing.two,
  },
  socialGlass: { alignSelf: 'stretch', borderRadius: 999, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
  btn: {
    alignSelf: 'stretch',
    alignItems: 'center',
    borderRadius: 999,
    paddingVertical: 15,
  },
  appleButton: { width: '100%', height: 50 },
  appleInset: { padding: 3 },
  googleButton: { flexDirection: 'row', justifyContent: 'center', gap: 12, paddingHorizontal: 16, minHeight: 50 },
  googleIcon: { width: 20, height: 20 },
  googleText: { fontSize: 16, flexShrink: 1 },
  error: { textAlign: 'center', fontSize: 12 },
  note: {
    textAlign: 'center',
    fontSize: 12,
    marginTop: Spacing.two,
    maxWidth: 280,
  },
  legalLink: { minHeight: 44, justifyContent: 'center' },
  legalLinks: { flexDirection: 'row', gap: Spacing.three },
  close: {
    marginTop: Spacing.four,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  devGlass: { marginTop: Spacing.two, alignSelf: 'stretch', borderRadius: 18 },
  devBox: { padding: Spacing.three, gap: Spacing.two },
  devInput: { minHeight: 44, paddingHorizontal: Spacing.three, borderWidth: 1, borderRadius: 8, backgroundColor: 'rgba(11,11,18,0.46)' },
  devButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
});
