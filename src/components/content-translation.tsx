import { useState } from 'react';
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
  const label = translation.loading ? english ? 'Translating…' : '번역 중…'
    : translation.translated ? translation.original ? english ? 'See translation' : '번역 보기' : english ? 'Translated · See original' : '번역됨 · 원문 보기'
      : translation.error ? english ? 'Couldn’t translate · Try again' : '번역하지 못했어요 · 다시 시도'
        : english ? 'See translation' : '번역 보기';
  const disabled = translation.loading || !translation.ready;
  return <View>
    <Pressable analyticsId="content_translation.toggle" accessibilityRole="button" accessibilityLabel={label}
      accessibilityHint={english ? 'Switches between the translation and the original.' : '번역문과 원문을 바꿔 볼 수 있어요.'}
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
  const [showTerms, setShowTerms] = useState(false);
  const preference = useTranslationPreference();
  const { language } = useLanguage();
  const { play } = useInteractionFeedback();
  const theme = useTheme();
  const english = language === 'en';
  return <View style={[styles.settings, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <View style={styles.row}>
      <ThemedText type="smallBold" style={{ flex: 1 }}>{english ? 'Translate posts automatically' : '글·댓글 자동 번역'}</ThemedText>
      <Switch analyticsId="content_translation.auto" value={preference.mode === 'auto'}
        disabled={!preference.ready || preference.saving} hitSlop={8}
        accessibilityLabel={english ? 'Translate posts and comments automatically' : '글과 댓글 자동 번역'}
        accessibilityState={{ disabled: !preference.ready || preference.saving, busy: preference.saving }}
        trackColor={{ false: theme.line, true: theme.accent }}
        onValueChange={(enabled) => { play('selection'); void preference.requestMode(enabled ? 'auto' : 'manual'); }} />
    </View>
    <ThemedText type="small" themeColor="textSecondary">{english
      ? 'Korean posts and comments show up in English. You can always tap to see the original.'
      : '영어로 쓴 글과 댓글을 한국어로 보여드려요. 언제든 눌러서 원문을 볼 수 있어요.'}</ThemedText>
    <Pressable analyticsId="content_translation.terms" accessibilityRole="button" accessibilityState={{ expanded: showTerms }}
      onPress={() => { play('selection'); setShowTerms(value => !value); }} style={styles.control}>
      <ThemedText type="small" style={{ color: theme.accent }}>{english ? 'About translation' : '번역 안내'}</ThemedText>
    </Pressable>
    {showTerms && <View style={{ gap: 8 }}>
      <ThemedText type="small" themeColor="textSecondary">{english ? "Translations are made by AI and can be wrong. Check the original for anything important." : 'AI 번역은 틀릴 수 있어요. 중요한 내용은 원문을 꼭 확인해 주세요.'}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{english ? "To translate, the text is sent to Gling's server and OpenAI. It isn't used to train AI models." : '번역할 때 글이 글링 서버와 OpenAI로 전송돼요. AI 학습에는 쓰이지 않아요.'}</ThemedText>
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  control: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingVertical: 8, paddingRight: 12 },
  settings: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 8 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 44 },
});
