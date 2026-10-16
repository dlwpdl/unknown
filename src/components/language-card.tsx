import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import type { LanguagePreference } from '@/i18n/language';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

export function LanguageCard() {
  const { preference, isSaving, setPreference, t } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const [failed, setFailed] = useState(false);
  if (!setPreference) return null;
  const options: { value: LanguagePreference; label: string }[] = [
    { value: 'system', label: t.language.system }, { value: 'ko', label: t.language.korean }, { value: 'en', label: t.language.english },
  ];
  return <View style={styles.section}>
    <ThemedText accessibilityRole="header" type="smallBold" themeColor="textSecondary">{t.language.title}</ThemedText>
    <View accessibilityRole="radiogroup" accessibilityLabel={t.language.title} style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
      {options.map(({ value, label }, index) => <Pressable key={value} analyticsId={`app_language.${value}`} accessibilityRole="radio"
        aria-checked={preference === value} aria-disabled={!!isSaving} aria-busy={!!isSaving}
        accessibilityLabel={label} accessibilityState={{ checked: preference === value, disabled: !!isSaving, busy: !!isSaving }}
        disabled={isSaving} onPress={() => {
          play('selection'); setFailed(false);
          void setPreference(value).then((saved) => { if (!saved) { play('warning'); setFailed(true); } });
        }} style={({ pressed }) => [styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line }, pressed && { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText type="small" style={styles.label}>{label}</ThemedText>
        <ThemedText style={{ color: theme.accent }} accessible={false} accessibilityElementsHidden aria-hidden>{preference === value ? '✓' : '○'}</ThemedText>
      </Pressable>)}
    </View>
    <ThemedText type="small" themeColor="textSecondary">{t.language.note}</ThemedText>
    {isSaving && <ThemedText type="small" accessibilityLiveRegion="polite">{t.language.saving}</ThemedText>}
    {failed && <ThemedText type="small" accessibilityRole="alert">{t.language.saveError}</ThemedText>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two }, card: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  row: { minHeight: 48, paddingVertical: 12, paddingHorizontal: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  label: { flex: 1, flexShrink: 1 },
});
