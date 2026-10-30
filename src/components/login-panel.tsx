import { useLanguage } from '@/hooks/use-language';
import { Pressable, ScrollView } from '@/components/analytics-controls';
import { Image } from 'expo-image';
import { useFonts } from 'expo-font';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GlassSurface } from '@/components/glass-surface';
import { LanguageCard } from '@/components/language-card';
import { RaisedActionButton } from '@/components/raised-action-button';
import { Colors, Spacing } from '@/constants/theme';
import { ThemeOverrideProvider, useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

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
  const { tr, t } = useLanguage();
  const theme = useTheme();
  const dark = theme === Colors.dark;
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const [googleFontLoaded] = useFonts({ GoogleSansMedium: require('@/assets/fonts/GoogleSans-Medium.ttf') });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const adminPasswordInput = useRef<TextInputInstance>(null);
  const [adminFocusedField, setAdminFocusedField] = useState<'email' | 'password' | null>(null);
  const disabled = loading;
  const showWelcome = !onAdminLogin && !onReviewLogin;
  const passwordLogin = onAdminLogin ?? onReviewLogin ?? (__DEV__ ? onDevLogin : undefined);
  const publicSiteUrl = (process.env.EXPO_PUBLIC_APP_URL ?? 'https://gling.ej-entertainment.com').replace(/\/$/, '');

  if (onAdminLogin) {
    const submitDisabled = disabled || !email.trim() || !password;
    const submitAdmin = () => { if (!submitDisabled) { play('selection'); onAdminLogin(email, password); } };
    return <ThemeOverrideProvider scheme="dark">
      <View style={[styles.wrap, styles.adminBackground]}><SafeAreaView style={styles.wrap}>
        <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView analyticsId="components_login-panel.scrollview.1" contentContainerStyle={styles.adminCenter} keyboardShouldPersistTaps="handled">
            <Image source={require('@/assets/brand/gling-night-wordmark.png')} style={styles.adminLogo} contentFit="contain" accessibilityLabel={t.appName} />
            <View style={styles.adminHeader}>
              <ThemedText type="subtitle" accessibilityRole="header">{tr("관리자 로그인")}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{reason ?? tr("관리자 계정으로 로그인해 주세요.")}</ThemedText>
            </View>
            <View style={styles.adminForm} aria-busy={loading}>
              <View style={styles.adminField}>
                <ThemedText type="smallBold">{tr("이메일")}</ThemedText>
                <TextInput value={email} onChangeText={setEmail} editable={!disabled} autoCapitalize="none" autoCorrect={false} spellCheck={false}
                  autoComplete="email" textContentType="username" keyboardType="email-address" returnKeyType="next" onSubmitEditing={() => adminPasswordInput.current?.focus()}
                  accessibilityLabel={tr("관리자 이메일")} placeholder={tr("관리자 이메일")} placeholderTextColor={Colors.dark.textSecondary}
                  onFocus={() => { play('selection'); setAdminFocusedField('email'); }} onBlur={() => setAdminFocusedField(null)}
                  style={[styles.adminInput, { borderColor: adminFocusedField === 'email' ? Colors.dark.accent : Colors.dark.line }]} />
              </View>
              <View style={styles.adminField}>
                <ThemedText type="smallBold">{tr("비밀번호")}</ThemedText>
                <TextInput ref={adminPasswordInput} value={password} onChangeText={setPassword} editable={!disabled} secureTextEntry
                  autoCapitalize="none" autoCorrect={false} spellCheck={false} autoComplete="current-password" textContentType="password"
                  returnKeyType="go" onSubmitEditing={submitAdmin} accessibilityLabel={tr("관리자 비밀번호")} placeholder={tr("관리자 비밀번호")} placeholderTextColor={Colors.dark.textSecondary}
                  onFocus={() => { play('selection'); setAdminFocusedField('password'); }} onBlur={() => setAdminFocusedField(null)}
                  style={[styles.adminInput, { borderColor: adminFocusedField === 'password' ? Colors.dark.accent : Colors.dark.line }]} />
              </View>
              {!!error && <View style={styles.adminError} accessibilityRole="alert" accessibilityLiveRegion="polite"><ThemedText type="small">{tr(error)}</ThemedText></View>}
              <RaisedActionButton analyticsId="components_login-panel.pressable.3" label={loading ? tr("로그인 중…") : tr("관리자 로그인")} onPress={submitAdmin} disabled={submitDisabled} busy={loading} />
              {onGoogle && <Pressable analyticsId="components_login-panel.pressable.2" accessibilityRole="button" accessibilityLabel={t.auth.google}
                disabled={disabled} accessibilityState={{ disabled, busy: loading }} onPress={() => { if (!disabled) { play('selection'); onGoogle(); } }}
                style={({ pressed }) => [styles.adminGoogle, { opacity: disabled ? 0.6 : pressed ? 0.8 : 1 }]}>
                <Image source={require('@/assets/brand/google-g.png')} style={styles.googleIcon} contentFit="contain" accessible={false} />
                <ThemedText type="small" style={[styles.googleText, googleFontLoaded && { fontFamily: 'GoogleSansMedium' }]}>{t.auth.google}</ThemedText>
              </Pressable>}
            </View>
            <View style={styles.adminFooter}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.adminNote}>{tr("사전에 등록된 관리자 계정만 접근할 수 있습니다.")}</ThemedText>
              <View style={[styles.legalLinks, styles.adminLegalLinks]}>{['terms', 'privacy'].map((path) => <Pressable analyticsId="components_login-panel.pressable.4" key={path}
                accessibilityRole="link" onPress={() => { play('selection'); void Linking.openURL(`${publicSiteUrl}/${path}`); }} style={styles.legalLink}>
                <ThemedText type="small" themeColor="textSecondary">{path === 'terms' ? tr("이용약관") : tr("개인정보처리방침")}</ThemedText>
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
      <SafeAreaView style={styles.wrap}>
      <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView analyticsId="components_login-panel.scrollview.1" contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
        <View style={styles.brandRow}>
          <Image source={dark ? require('@/assets/brand/gling-night-wordmark.png') : require('@/assets/brand/gling-night-wordmark-light.png')}
            style={styles.brandLogo} contentFit="contain" accessibilityLabel={t.appName} />
          <LanguageCard compact />
        </View>
        <View style={styles.hero}>
          {showWelcome && <ThemedText accessibilityRole="header" style={styles.heroTitle}>
            {t.auth.welcomeTitle}{'\n'}<ThemedText style={[styles.heroTitle, { color: theme.accent }]}>{t.auth.welcomeAccent}</ThemedText>
          </ThemedText>}
          <ThemedText type="small" themeColor="textSecondary" style={styles.tagline}>{reason == null ? t.auth.tagline : tr(reason)}</ThemedText>
        </View>
        <View style={styles.authArea} aria-busy={loading}>
          {!!error && <View style={[styles.errorBox, { borderLeftColor: theme.accent }]}>
            <ThemedText accessibilityRole="alert" accessibilityLiveRegion="polite" type="small" style={styles.error}>{tr(error)}</ThemedText>
          </View>}
          <View style={styles.actions}>
            {onKakao && <Pressable analyticsId="components_login-panel.pressable.1" accessibilityRole="button" accessibilityLabel={t.auth.kakao}
              onPress={() => { if (!disabled) { play('selection'); onKakao(); } }} disabled={disabled} accessibilityState={{ disabled, busy: loading }}
              style={({ pressed }) => [styles.socialButton, styles.kakaoButton, { opacity: disabled ? 0.6 : pressed ? 0.8 : 1, transform: [{ scale: pressed && !reducedMotion ? 0.98 : 1 }] }]}>
              <Image source={require('@/assets/brand/kakao-login-symbol.svg')} style={styles.googleIcon} contentFit="contain" accessible={false} />
              <ThemedText type="smallBold" style={styles.kakaoText}>{t.auth.kakao}</ThemedText>
            </Pressable>}
            {Platform.OS === 'ios' && onApple && <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN} buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK} cornerRadius={12}
              onPress={() => { if (!disabled) { play('selection'); onApple(); } }} accessibilityState={{ disabled, busy: loading }}
              style={[styles.appleButton, { opacity: disabled ? 0.6 : 1 }]} />}
            {onGoogle && <Pressable analyticsId="components_login-panel.pressable.2" accessibilityRole="button" accessibilityLabel={t.auth.google}
              onPress={() => { if (!disabled) { play('selection'); onGoogle(); } }} disabled={disabled} accessibilityState={{ disabled, busy: loading }}
              style={({ pressed }) => [styles.socialButton, { backgroundColor: dark ? '#131314' : '#FFFFFF', borderColor: dark ? '#8E918F' : '#747775', opacity: disabled ? 0.6 : pressed ? 0.8 : 1, transform: [{ scale: pressed && !reducedMotion ? 0.98 : 1 }] }]}>
              <Image source={require('@/assets/brand/google-g.png')} style={styles.googleIcon} contentFit="contain" accessible={false} />
              <ThemedText type="small" style={[styles.googleText, { color: dark ? '#E3E3E3' : '#1F1F1F' }, googleFontLoaded && { fontFamily: 'GoogleSansMedium' }]}>{t.auth.google}</ThemedText>
            </Pressable>}
            {loading && <ThemedText type="small" themeColor="textSecondary" accessibilityRole="progressbar" accessibilityLiveRegion="polite" style={styles.note}>{t.auth.connecting}</ThemedText>}
            {passwordLogin && (
              <GlassSurface tone="control" style={styles.devGlass}>
              <View style={styles.devBox}>
                <ThemedText type="smallBold">{onAdminLogin ? tr("관리자 계정 로그인") : onReviewLogin ? t.auth.reviewLoginTitle : t.auth.devLoginTitle}</ThemedText>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  placeholder={onAdminLogin ? tr("관리자 이메일") : onReviewLogin ? t.auth.reviewEmail : t.auth.devEmail}
                  placeholderTextColor={theme.textSecondary}
                  accessibilityLabel={onAdminLogin ? tr("관리자 이메일") : onReviewLogin ? t.auth.reviewEmail : t.auth.devEmail}
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
                  placeholder={onAdminLogin ? tr("관리자 비밀번호") : onReviewLogin ? t.auth.reviewPassword : t.auth.devPassword}
                  placeholderTextColor={theme.textSecondary}
                  accessibilityLabel={onAdminLogin ? tr("관리자 비밀번호") : onReviewLogin ? t.auth.reviewPassword : t.auth.devPassword}
                  style={[styles.devInput, { color: theme.text, borderColor: theme.line }]}
                />
                <Pressable analyticsId="components_login-panel.pressable.3"
                  onPress={() => { if (!disabled && email.trim() && password) { play('selection'); passwordLogin(email, password); } }}
                  disabled={disabled || !email.trim() || !password}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: disabled || !email.trim() || !password, busy: loading }}
                  style={({ pressed }) => [styles.devButton, { backgroundColor: theme.accent, opacity: disabled || !email.trim() || !password ? 0.5 : pressed ? 0.8 : 1, transform: [{ scale: pressed && !reducedMotion ? 0.97 : 1 }] }]}>
                  <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{onAdminLogin ? tr("관리자 로그인") : onReviewLogin ? t.auth.reviewLoginCta : t.auth.devLoginCta}</ThemedText>
                </Pressable>
              </View>
              </GlassSurface>
            )}
          </View>
          <ThemedText type="small" themeColor="textSecondary" style={styles.signupNote}>{onReviewLogin ? t.auth.reviewLoginNote : t.auth.loginNote}</ThemedText>
        </View>
        <View style={styles.legalLinks}>
          {['terms', 'privacy'].map((path) => <Pressable analyticsId="components_login-panel.pressable.4" key={path} onPress={() => { play('selection'); void Linking.openURL(`${publicSiteUrl}/${path}`); }}
            accessibilityRole="link" style={styles.legalLink}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.legalCopy}>{path === 'terms' ? tr('이용약관') : tr('개인정보처리방침')}</ThemedText>
          </Pressable>)}
        </View>
        {onClose && <Pressable analyticsId="components_login-panel.pressable.6" onPress={() => { play('selection'); onClose(); }} accessibilityRole="button" style={styles.close}>
          <ThemedText type="smallBold">{t.auth.close}</ThemedText>
        </Pressable>}
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
  wrap: { flex: 1 },
  center: { flexGrow: 1, width: '100%', maxWidth: 440, alignSelf: 'center', paddingHorizontal: Spacing.four, paddingVertical: 12 },
  brandRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  brandLogo: { width: 112, height: 40 },
  hero: { flexGrow: 1, justifyContent: 'center', gap: 18, paddingTop: Spacing.four, paddingBottom: Spacing.five },
  heroTitle: { fontSize: 34, lineHeight: 42, fontWeight: '700', letterSpacing: -1.3 },
  tagline: { fontSize: 15, lineHeight: 24, fontWeight: '400' },
  authArea: { alignSelf: 'stretch' }, actions: { alignSelf: 'stretch', gap: 12 },
  socialButton: { minHeight: 56, borderWidth: 1, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  kakaoButton: { backgroundColor: '#FEE500', borderColor: '#FEE500' }, kakaoText: { fontSize: 16, lineHeight: 24, color: '#191919' },
  appleButton: { width: '100%', height: 56, borderWidth: 1, borderColor: '#777780', borderRadius: 12 },
  googleIcon: { width: 20, height: 20 }, googleText: { fontSize: 16, flexShrink: 1 },
  errorBox: { borderLeftWidth: 2, paddingLeft: 12, marginBottom: Spacing.three }, error: { fontSize: 13, lineHeight: 20 },
  note: { textAlign: 'center', fontSize: 12, lineHeight: 19 },
  signupNote: { textAlign: 'center', fontSize: 12, lineHeight: 19, fontWeight: '400', marginTop: Spacing.three, marginBottom: 6 },
  legalLink: { minHeight: 44, justifyContent: 'center' }, legalCopy: { fontSize: 11.5, lineHeight: 18, fontWeight: '400' },
  legalLinks: { flexDirection: 'row', gap: Spacing.three, justifyContent: 'center', flexWrap: 'wrap' },
  close: { minHeight: 48, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', paddingHorizontal: Spacing.three },
  devGlass: { marginTop: Spacing.two, alignSelf: 'stretch', borderRadius: 18 },
  devBox: { padding: Spacing.three, gap: Spacing.two },
  devInput: { minHeight: 44, paddingHorizontal: Spacing.three, borderWidth: 1, borderRadius: 8, backgroundColor: 'rgba(11,11,18,0.46)' },
  devButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
});
