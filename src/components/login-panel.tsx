import { Pressable, ScrollView } from '@/components/analytics-controls';
import { Image } from 'expo-image';
import { useFonts } from 'expo-font';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Animated, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GlassSurface } from '@/components/glass-surface';
import { Colors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
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

  return (
    <ThemedView style={styles.wrap}>
      <Image source={require('@/assets/images/festival-glass-orbs.webp')} style={styles.ambientArt} contentFit="contain" accessible={false} pointerEvents="none" />
      <SafeAreaView style={styles.wrap}>
      <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView analyticsId="components_login-panel.scrollview.1" contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
        <Image
          source={dark ? require('@/assets/brand/gling-night-wordmark.png') : require('@/assets/brand/gling-wordmark.png')}
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
