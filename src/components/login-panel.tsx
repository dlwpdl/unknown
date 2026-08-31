import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, useColorScheme, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';

// 인증 게이트 화면. 인라인(채팅·나 탭)과 모달(상세·글쓰기·참여) 양쪽에서 재사용.
//  mode 'login'  = Supabase 카카오 로그인.
//  mode 'verify' = L2 전화 인증. mock: 버튼이 바로 인증 완료.
export function LoginPanel({
  mode = 'login',
  reason,
  onKakao,
  onDevLogin,
  onVerify,
  loading = false,
  error,
  onClose,
}: {
  mode?: 'login' | 'verify';
  reason?: string;
  onKakao?: () => void;
  onDevLogin?: (email: string, password: string) => void;
  onVerify?: () => void;
  loading?: boolean;
  error?: string | null;
  onClose?: () => void;
}) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const isVerify = mode === 'verify';
  const [devEmail, setDevEmail] = useState('');
  const [devPassword, setDevPassword] = useState('');

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
          {reason ?? (isVerify ? t.auth.verifyTitle : t.auth.tagline)}
        </ThemedText>

        {isVerify ? (
          <Pressable
            onPress={onVerify}
            accessibilityRole="button"
            style={[styles.btn, { backgroundColor: theme.accent }]}>
            <ThemedText type="smallBold" style={{ color: theme.accentInk, fontSize: 16 }}>
              {t.auth.verifyCta}
            </ThemedText>
          </Pressable>
        ) : (
          <View style={styles.actions}>
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
        )}

        {!!error && (
          <ThemedText accessibilityRole="alert" type="small" style={[styles.error, { color: theme.accent }]}>
            {error}
          </ThemedText>
        )}

        <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
          {isVerify ? t.auth.verifyNote : t.auth.loginNote}
        </ThemedText>

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
  error: { textAlign: 'center', fontSize: 12 },
  note: {
    textAlign: 'center',
    fontSize: 12,
    marginTop: Spacing.two,
    maxWidth: 280,
  },
  close: {
    marginTop: Spacing.four,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  devBox: { marginTop: Spacing.two, padding: Spacing.three, gap: Spacing.two, borderWidth: 1, borderRadius: 10 },
  devInput: { minHeight: 44, paddingHorizontal: Spacing.three, borderWidth: 1, borderRadius: 8 },
  devButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 8 },
});
