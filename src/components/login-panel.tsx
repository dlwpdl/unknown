import { Image } from 'expo-image';
import { useFonts } from 'expo-font';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { LOGIN_TERMS_VERSION } from '@/lib/login-terms';

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
  onApple?: (termsVersion: string) => void;
  onKakao?: (termsVersion: string) => void;
  onGoogle?: (termsVersion: string) => void;
  onDevLogin?: (email: string, password: string, termsVersion: string) => void;
  onReviewLogin?: (email: string, password: string, termsVersion: string) => void;
  onAdminLogin?: (email: string, password: string, termsVersion: string) => void;
  loading?: boolean;
  error?: string | null;
  onClose?: () => void;
}) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const [googleFontLoaded] = useFonts({ GoogleSansMedium: require('@/assets/fonts/GoogleSans-Medium.ttf') });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const disabled = loading || !accepted || !privacyAccepted;
  const passwordLogin = onAdminLogin ?? onReviewLogin ?? (__DEV__ ? onDevLogin : undefined);
  const publicSiteUrl = (process.env.EXPO_PUBLIC_APP_URL ?? 'https://gling.ej-entertainment.com').replace(/\/$/, '');

  return (
    <ThemedView style={styles.wrap}>
      <SafeAreaView style={styles.wrap}>
      <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
        <Image
          source={require('@/assets/brand/gling-wordmark.png')}
          style={styles.brandLogo}
          contentFit="contain"
          tintColor={dark ? theme.text : undefined}
          accessibilityLabel={t.appName}
        />
        <ThemedText type="small" themeColor="textSecondary" style={styles.tagline}>
          {reason ?? t.auth.tagline}
        </ThemedText>

        <View style={[styles.consentCard, { backgroundColor: theme.card, borderColor: theme.line }]}>
          <ThemedText type="smallBold">서로 편안하게 만나는 글링</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            유해 콘텐츠와 괴롭힘·혐오·협박 등 악성 행위는 허용하지 않아요. 위반 콘텐츠는 삭제되고 계정 이용이 제한될 수 있어요. 불편한 콘텐츠와 사용자는 언제든 신고·차단할 수 있어요.
          </ThemedText>
          {[
            { id: 'terms', checked: accepted, change: setAccepted, label: '이용약관과 커뮤니티 행동 기준에 동의합니다.', title: '이용약관' },
            { id: 'privacy', checked: privacyAccepted, change: setPrivacyAccepted, label: '개인정보 수집·이용에 동의합니다.', title: '개인정보처리방침' },
          ].map(item => <View key={item.id}>
            <Pressable onPress={() => { if (!loading) item.change(value => !value); }} disabled={loading}
              accessibilityRole="checkbox" aria-checked={item.checked} accessibilityState={{ checked: item.checked, disabled: loading }}
              accessibilityLabel={`${item.label} 필수`} style={styles.consentRow}>
              <View style={[styles.checkbox, { borderColor: item.checked ? theme.accent : theme.line, backgroundColor: item.checked ? theme.accent : theme.background }]}>
                {item.checked && <ThemedText style={{ color: theme.accentInk }}>✓</ThemedText>}
              </View>
              <ThemedText type="small" style={styles.consentText}>[필수] {item.label}</ThemedText>
            </Pressable>
            <Pressable onPress={() => void Linking.openURL(`${publicSiteUrl}/${item.id}`)} accessibilityRole="link"
              accessibilityLabel={`${item.title} 전문 보기`} style={styles.legalLink}>
              <ThemedText type="smallBold" themeColor="accent">{item.title} 전문 보기 ↗</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{publicSiteUrl}/{item.id}</ThemedText>
            </Pressable>
          </View>)}
          <ThemedText type="small" themeColor="textSecondary">계정 식별정보·프로필·서비스 이용기록을 회원 관리와 서비스 제공·안전 운영에 사용합니다. 원칙적으로 탈퇴 시 삭제하며, 보관 예외는 개인정보처리방침에서 확인할 수 있어요. 필수 동의를 거절하면 가입할 수 없지만 공개 글은 둘러볼 수 있어요.</ThemedText>
          {(!accepted || !privacyAccepted) && <ThemedText type="small" themeColor="textSecondary">필수 항목 두 개에 동의하면 아래 버튼으로 가입·로그인할 수 있어요. 이름·생년월일 등 선택 정보는 입력하지 않아도 가입할 수 있어요.</ThemedText>}
        </View>
        <View style={styles.actions}>
            {Platform.OS === 'ios' && onApple && (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={dark
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={24}
                onPress={() => { if (!disabled) onApple(LOGIN_TERMS_VERSION); }}
                accessibilityState={{ disabled, busy: loading }}
                style={[styles.appleButton, { opacity: disabled ? 0.6 : 1 }]}
              />
            )}
            {onKakao && <Pressable
              onPress={() => { if (!disabled) onKakao(LOGIN_TERMS_VERSION); }}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ disabled, busy: loading }}
              style={[styles.btn, { backgroundColor: '#FEE500', opacity: disabled ? 0.6 : 1 }]}>
              <ThemedText type="smallBold" style={{ color: '#191600', fontSize: 16 }}>
                {t.auth.kakao}
              </ThemedText>
            </Pressable>}
            {onGoogle && <Pressable
              onPress={() => { if (!disabled) onGoogle(LOGIN_TERMS_VERSION); }}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={t.auth.google}
              accessibilityState={{ disabled, busy: loading }}
              style={[styles.btn, styles.googleButton, { opacity: disabled ? 0.6 : 1 }]}>
              <Image source={require('@/assets/brand/google-g.png')} style={styles.googleIcon} contentFit="contain" accessible={false} />
              <ThemedText type="small" style={[styles.googleText, googleFontLoaded && { fontFamily: 'GoogleSansMedium' }]}>{t.auth.google}</ThemedText>
            </Pressable>}
            {loading && <ThemedText type="small" themeColor="textSecondary" accessibilityRole="progressbar" style={styles.note}>{t.auth.connecting}</ThemedText>}
            {passwordLogin && (
              <View style={[styles.devBox, { borderColor: theme.line }]}>
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
                  style={[styles.devInput, { color: theme.text, borderColor: theme.line }]}
                />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete="current-password"
                  placeholder={onAdminLogin ? '관리자 비밀번호' : onReviewLogin ? t.auth.reviewPassword : t.auth.devPassword}
                  placeholderTextColor={theme.textSecondary}
                  accessibilityLabel={onAdminLogin ? '관리자 비밀번호' : onReviewLogin ? t.auth.reviewPassword : t.auth.devPassword}
                  style={[styles.devInput, { color: theme.text, borderColor: theme.line }]}
                />
                <Pressable
                  onPress={() => { if (!disabled && email.trim() && password) passwordLogin(email, password, LOGIN_TERMS_VERSION); }}
                  disabled={disabled || !email.trim() || !password}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: disabled || !email.trim() || !password, busy: loading }}
                  style={[styles.devButton, { borderColor: theme.line, opacity: disabled || !email.trim() || !password ? 0.5 : 1 }]}>
                  <ThemedText type="smallBold">{onAdminLogin ? '관리자 로그인' : onReviewLogin ? t.auth.reviewLoginCta : t.auth.devLoginCta}</ThemedText>
                </Pressable>
              </View>
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

        {!onReviewLogin && !onAdminLogin && (
          <Pressable
            onPress={() => { onClose?.(); router.push('/auth/review'); }}
            accessibilityRole="link"
            style={styles.reviewLink}>
            <ThemedText type="small" themeColor="textSecondary">{t.auth.reviewLoginTitle}</ThemedText>
          </Pressable>
        )}

        {onClose && (
          <Pressable onPress={onClose} accessibilityRole="button" style={styles.close}>
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
    justifyContent: 'center',
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.four,
    gap: Spacing.two,
  },
  brandLogo: { width: 180, height: 80 },
  tagline: {
    textAlign: 'center',
    maxWidth: 280,
    marginBottom: Spacing.four,
  },
  actions: {
    alignSelf: 'stretch',
    gap: Spacing.two,
  },
  btn: {
    alignSelf: 'stretch',
    alignItems: 'center',
    borderRadius: 999,
    paddingVertical: 15,
  },
  appleButton: { width: '100%', height: 50 },
  googleButton: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#747775', flexDirection: 'row', justifyContent: 'center', gap: 12, paddingHorizontal: 16, minHeight: 50 },
  googleIcon: { width: 20, height: 20 },
  googleText: { color: '#1F1F1F', fontSize: 16, flexShrink: 1 },
  error: { textAlign: 'center', fontSize: 12 },
  note: {
    textAlign: 'center',
    fontSize: 12,
    marginTop: Spacing.two,
    maxWidth: 280,
  },
  reviewLink: { minHeight: 44, justifyContent: 'center' },
  legalLink: { minHeight: 44, justifyContent: 'center' },
  consentCard: { alignSelf: 'stretch', padding: Spacing.three, gap: Spacing.two, borderWidth: 1, borderRadius: 12, marginBottom: Spacing.three },
  consentRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  consentText: { flex: 1 },
  checkbox: { width: 24, height: 24, borderWidth: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  close: {
    marginTop: Spacing.four,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  devBox: { marginTop: Spacing.two, padding: Spacing.three, gap: Spacing.two, borderWidth: 1, borderRadius: 10 },
  devInput: { minHeight: 44, paddingHorizontal: Spacing.three, borderWidth: 1, borderRadius: 8 },
  devButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 8 },
});
