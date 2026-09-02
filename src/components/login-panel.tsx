import { Image } from 'expo-image';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, useColorScheme, View } from 'react-native';

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
  loading = false,
  error,
  onClose,
}: {
  reason?: string;
  onApple?: () => void;
  onKakao?: () => void;
  onDevLogin?: (email: string, password: string) => void;
  loading?: boolean;
  error?: string | null;
  onClose?: () => void;
}) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const [devEmail, setDevEmail] = useState('');
  const [devPassword, setDevPassword] = useState('');
  const publicSiteUrl = (process.env.EXPO_PUBLIC_APP_URL ?? 'https://dlwpdl.github.io/gling').replace(/\/$/, '');

  return (
    <ThemedView style={styles.wrap}>
      <View style={styles.center}>
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
                onPress={onApple}
                style={[styles.appleButton, { opacity: loading ? 0.6 : 1 }]}
              />
            )}
            <Pressable
              onPress={onKakao}
              disabled={loading}
              accessibilityRole="button"
              accessibilityState={{ disabled: loading, busy: loading }}
              style={[styles.btn, { backgroundColor: '#FEE500', opacity: loading ? 0.6 : 1 }]}>
              <ThemedText type="smallBold" style={{ color: '#191600', fontSize: 16 }}>
                {loading ? t.auth.kakaoLoading : t.auth.kakao}
              </ThemedText>
            </Pressable>
            {__DEV__ && onDevLogin && (
              <View style={[styles.devBox, { borderColor: theme.line }]}>
                <ThemedText type="smallBold">{t.auth.devLoginTitle}</ThemedText>
                <TextInput
                  value={devEmail}
                  onChangeText={setDevEmail}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  placeholder={t.auth.devEmail}
                  placeholderTextColor={theme.textSecondary}
                  accessibilityLabel={t.auth.devEmail}
                  style={[styles.devInput, { color: theme.text, borderColor: theme.line }]}
                />
                <TextInput
                  value={devPassword}
                  onChangeText={setDevPassword}
                  secureTextEntry
                  autoComplete="current-password"
                  placeholder={t.auth.devPassword}
                  placeholderTextColor={theme.textSecondary}
                  accessibilityLabel={t.auth.devPassword}
                  style={[styles.devInput, { color: theme.text, borderColor: theme.line }]}
                />
                <Pressable
                  onPress={() => onDevLogin(devEmail, devPassword)}
                  disabled={loading || !devEmail.trim() || !devPassword}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: loading || !devEmail.trim() || !devPassword, busy: loading }}
                  style={[styles.devButton, { borderColor: theme.line, opacity: !devEmail.trim() || !devPassword ? 0.5 : 1 }]}>
                  <ThemedText type="smallBold">{t.auth.devLoginCta}</ThemedText>
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
          {t.auth.loginNote}
        </ThemedText>

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
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  center: {
    flex: 1,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.five,
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
