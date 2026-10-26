import { useState } from 'react';
import { Alert, Image, Linking, StyleSheet, View } from 'react-native';

import { Pressable, Switch } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/theme';
import { useContentTranslation, useTranslationPreference } from '@/hooks/use-content-translation';
import { useLanguage } from '@/hooks/use-language';
import { isDeviceTranslationSupported } from '@/lib/content-translation';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

export function TranslationControl({ translation }: { translation: ReturnType<typeof useContentTranslation> }) {
  const { language } = useLanguage();
  const { play } = useInteractionFeedback();
  const theme = useTheme();
  // A button that cannot translate in this build is noise under every post.
  if (!translation.eligible || !translation.supported) return null;
  const english = language === 'en';
  const label = translation.loading ? english ? 'Preparing translation…' : '번역 준비 중…'
    : translation.translated ? translation.original ? english ? 'See translation' : '번역 보기' : english ? 'Translated · See original' : '번역됨 · 원문 보기'
      : translation.error ? english ? 'Retry translation' : '번역 다시 시도'
        : english ? 'Translate with Google' : 'Google로 번역';
  const disabled = translation.loading || !translation.ready;
  return <View>
    {translation.error && <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
      {english ? 'Could not prepare translation. For the first download, connect to Wi-Fi and retry. Showing the original.' : '번역을 준비하지 못했어요. 처음이라면 Wi-Fi에 연결한 뒤 다시 눌러 주세요. 원문을 보여드려요.'}
    </ThemedText>}
    <Pressable analyticsId="content_translation.toggle" accessibilityRole="button" accessibilityLabel={label}
      accessibilityHint={english ? 'Switch between the translation and original text.' : '번역문과 원문을 바꿔 볼 수 있어요.'}
      accessibilityState={{ disabled, busy: translation.loading }} disabled={disabled}
      onPress={() => { play('selection'); void translation.action(); }}
      style={({ pressed }) => [styles.control, { opacity: disabled ? 0.65 : pressed ? 0.65 : 1 }]}>
      <ThemedText type="small" style={{ color: theme.accent }} accessibilityLiveRegion="polite">{label}</ThemedText>
    </Pressable>
    {translation.translated && !translation.original && <Image
      source={theme.text === Colors.dark.text ? require('../../assets/images/google-translate-white.png') : require('../../assets/images/google-translate.png')}
      style={styles.attribution} resizeMode="contain" accessibilityLabel="powered by Google Translate" />}
  </View>;
}

export function TranslatedCommentBody({ id, body, visible }: { id: string; body: string; visible: boolean }) {
  const translation = useContentTranslation('comment', id, { title: null, body }, visible);
  return <View>
    <ThemedText type="small" themeColor="textSecondary">{translation.display.body}</ThemedText>
    <TranslationControl translation={translation} />
  </View>;
}

export function ContentTranslationSettings() {
  const [showTerms, setShowTerms] = useState(false);
  const preference = useTranslationPreference();
  const supported = isDeviceTranslationSupported();
  const { language } = useLanguage();
  const { play } = useInteractionFeedback();
  const theme = useTheme();
  const english = language === 'en';
  return <View style={[styles.settings, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <View style={styles.row}>
      <ThemedText type="smallBold" style={{ flex: 1 }}>{english ? 'Translate posts and comments automatically' : '글·댓글 자동 번역'}</ThemedText>
      <Switch analyticsId="content_translation.auto" value={preference.mode === 'auto'}
        disabled={!supported || !preference.ready || preference.saving} hitSlop={8}
        accessibilityLabel={english ? 'Automatic content translation' : '글과 댓글 자동 번역'}
        accessibilityState={{ disabled: !supported || !preference.ready || preference.saving, busy: preference.saving }}
        trackColor={{ false: theme.line, true: theme.accent }}
        onValueChange={(enabled) => { play('selection'); void preference.requestMode(enabled ? 'auto' : 'manual'); }} />
    </View>
    <ThemedText type="small" themeColor="textSecondary">{english
      ? 'Google Translate works on your phone. First use downloads Korean/English language packs over Wi-Fi (about 30 MB per model). Originals stay unchanged.'
      : 'Google Translate가 휴대폰에서 번역해요. 처음에는 Wi-Fi로 한·영 언어팩을 내려받아요(모델당 약 30MB). 원문은 그대로 보존돼요.'}</ThemedText>
    {!supported && <ThemedText type="small" themeColor="textSecondary">{english ? 'Available in the updated iOS and Android app.' : '업데이트된 iOS·Android 앱에서 사용할 수 있어요.'}</ThemedText>}
    <Pressable analyticsId="content_translation.terms" accessibilityRole="button" accessibilityState={{ expanded: showTerms }}
      onPress={() => { play('selection'); setShowTerms(value => !value); }} style={styles.control}>
      <ThemedText type="small" style={{ color: theme.accent }}>{english ? 'About Google Translate' : 'Google 번역 안내'}</ThemedText>
    </Pressable>
    {showTerms && <View style={{ gap: 8 }}>
      <ThemedText type="small" themeColor="textSecondary">{english ? 'Machine translations can be inaccurate. Check the original before acting on important information.' : '자동 번역은 정확하지 않을 수 있어요. 중요한 정보는 원문을 함께 확인해 주세요.'}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">THIS SERVICE MAY CONTAIN TRANSLATIONS POWERED BY GOOGLE. GOOGLE DISCLAIMS ALL WARRANTIES RELATED TO THE TRANSLATIONS, EXPRESS OR IMPLIED, INCLUDING ANY WARRANTIES OF ACCURACY, RELIABILITY, AND ANY IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.</ThemedText>
      <Pressable analyticsId="content_translation.google_info" accessibilityRole="link" style={styles.control}
        onPress={() => { play('selection'); void Linking.openURL('https://cloud.google.com/translate').catch(() => {
          play('warning'); Alert.alert(english ? 'Could not open the link' : '링크를 열지 못했어요');
        }); }}>
        <ThemedText type="small" style={{ color: theme.accent }}>Google Translate ↗</ThemedText>
      </Pressable>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  control: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingVertical: 8, paddingRight: 12 },
  attribution: { width: 176, height: 16, marginBottom: 8 },
  settings: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 8 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 44 },
});
