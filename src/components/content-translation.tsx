import { StyleSheet, View } from 'react-native';

import { Pressable, Switch } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useContentTranslation, useTranslationPreference } from '@/hooks/use-content-translation';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

export function TranslationControl({ translation }: { translation: ReturnType<typeof useContentTranslation> }) {
  const { language } = useLanguage();
  const { play } = useInteractionFeedback();
  const theme = useTheme();
  if (!translation.eligible) return null;
  const english = language === 'en';
  const stale = translation.error === 'SOURCE_CHANGED' || translation.error === 'CONTENT_UNAVAILABLE';
  const limited = translation.error === 'TRANSLATION_LIMIT_REACHED';
  const label = translation.loading ? english ? 'Translating…' : '번역 중…'
    : translation.translated ? translation.original ? english ? 'See translation' : '번역 보기' : english ? 'Translated · See original' : '번역됨 · 원문 보기'
      : translation.error ? english ? 'Retry translation' : '번역 다시 시도'
        : english ? 'Translate to English' : '한국어로 번역';
  const disabled = translation.loading || !translation.ready || stale || limited;
  return <View>
    {translation.error && <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
      {stale ? english ? 'The original changed or is unavailable. Refresh to continue.' : '원문이 바뀌었거나 볼 수 없어요. 새로고침해 주세요.'
        : limited ? english ? 'Today’s translation limit was reached. Showing the original.' : '오늘 번역 한도에 도달해 원문을 보여드려요.'
          : translation.error === 'TRANSLATION_PENDING' ? english ? 'Translation is being prepared. Try again shortly.' : '번역을 준비하고 있어요. 잠시 후 다시 눌러 주세요.'
            : english ? 'Could not translate. Showing the original.' : '번역하지 못해 원문을 보여드려요.'}
    </ThemedText>}
    <Pressable analyticsId="content_translation.toggle" accessibilityRole="button" accessibilityLabel={label}
      accessibilityHint={english ? 'Switch between the translation and original text.' : '번역문과 원문을 바꿔 볼 수 있어요.'}
      accessibilityState={{ disabled, busy: translation.loading }} disabled={disabled}
      onPress={() => { play('selection'); void translation.action(); }}
      style={({ pressed }) => [styles.control, { opacity: disabled ? 0.65 : pressed ? 0.65 : 1 }]}>
      <ThemedText type="small" style={{ color: theme.accent }} accessibilityLiveRegion="polite">{label}</ThemedText>
    </Pressable>
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
  const preference = useTranslationPreference();
  const { language } = useLanguage();
  const { play } = useInteractionFeedback();
  const theme = useTheme();
  const english = language === 'en';
  return <View style={[styles.settings, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <View style={styles.row}>
      <ThemedText type="smallBold" style={{ flex: 1 }}>{english ? 'Translate posts and comments automatically' : '글·댓글 자동 번역'}</ThemedText>
      <Switch analyticsId="content_translation.auto" value={preference.mode === 'auto'}
        disabled={!preference.ready || preference.saving} hitSlop={8}
        accessibilityLabel={english ? 'Automatic content translation' : '글과 댓글 자동 번역'}
        accessibilityState={{ disabled: !preference.ready || preference.saving, busy: preference.saving }}
        trackColor={{ false: theme.line, true: theme.accent }} thumbColor={theme.accentInk}
        onValueChange={(enabled) => { play('selection'); void preference.requestMode(enabled ? 'auto' : 'manual'); }} />
    </View>
    <ThemedText type="small" themeColor="textSecondary">{english
      ? 'Visible posts and comments are translated into your app language through OpenAI. Originals stay unchanged. You can also translate individually.'
      : '보는 글과 댓글을 OpenAI로 앱 언어에 맞춰 번역해요. 원문은 보존되며, 글마다 따로 번역할 수도 있어요.'}</ThemedText>
  </View>;
}

const styles = StyleSheet.create({
  control: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingVertical: 8, paddingRight: 12 },
  settings: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 8 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 44 },
});
