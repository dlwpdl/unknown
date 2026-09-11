import { Image } from 'expo-image';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, useColorScheme, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';

export function LoginPanel({
  reason,
  onApple,
  onKakao,
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
  onDevLogin?: (email: string, password: string) => void;
  onReviewLogin?: (email: string, password: string) => void;
  onAdminLogin?: (email: string, password: string) => void;
  loading?: boolean;
  error?: string | null;
  onClose?: () => void;
}) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const passwordLogin = onAdminLogin ?? onReviewLogin ?? (__DEV__ ? onDevLogin : undefined);
  const publicSiteUrl = (process.env.EXPO_PUBLIC_APP_URL ?? 'https://gling.ej-entertainment.com').replace(/\/$/, '');

  return (
    <ThemedView style={styles.wrap}>
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

        <View style={styles.actions}>
            {Platform.OS === 'ios' && onApple && (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={dark
                  ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                  : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={24}
                onPress={() => { if (!loading) onApple(); }}
                accessibilityState={{ disabled: loading, busy: loading }}
                style={[styles.appleButton, { opacity: loading ? 0.6 : 1 }]}
              />
            )}
            {onKakao && <Pressable
              onPress={onKakao}
              disabled={loading}
              accessibilityRole="button"
              accessibilityState={{ disabled: loading, busy: loading }}
              style={[styles.btn, { backgroundColor: '#FEE500', opacity: loading ? 0.6 : 1 }]}>
              <ThemedText type="smallBold" style={{ color: '#191600', fontSize: 16 }}>
                {loading ? t.auth.kakaoLoading : t.auth.kakao}
              </ThemedText>
            </Pressable>}
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
                  onPress={() => passwordLogin(email, password)}
                  disabled={loading || !email.trim() || !password}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: loading || !email.trim() || !password, busy: loading }}
                  style={[styles.devButton, { borderColor: theme.line, opacity: !email.trim() || !password ? 0.5 : 1 }]}>
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

        <View style={styles.legalLinks}>
          <Pressable onPress={() => void Linking.openURL(`${publicSiteUrl}/terms`)} accessibilityRole="link">
            <ThemedText type="small" themeColor="textSecondary">이용약관</ThemedText>
          </Pressable>
          <ThemedText type="small" themeColor="textSecondary">·</ThemedText>
          <Pressable onPress={() => void Linking.openURL(`${publicSiteUrl}/privacy`)} accessibilityRole="link">
            <ThemedText type="small" themeColor="textSecondary">개인정보처리방침</ThemedText>
          </Pressable>
        </View>

        {onClose && (
          <Pressable onPress={onClose} accessibilityRole="button" style={styles.close}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              {t.auth.close}
            </ThemedText>
          </Pressable>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
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
  error: { textAlign: 'center', fontSize: 12 },
  note: {
    textAlign: 'center',
    fontSize: 12,
    marginTop: Spacing.two,
    maxWidth: 280,
  },
  reviewLink: { minHeight: 44, justifyContent: 'center' },
  legalLinks: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  close: {
    marginTop: Spacing.four,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  devBox: { marginTop: Spacing.two, padding: Spacing.three, gap: Spacing.two, borderWidth: 1, borderRadius: 10 },
  devInput: { minHeight: 44, paddingHorizontal: Spacing.three, borderWidth: 1, borderRadius: 8 },
  devButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 8 },
});
