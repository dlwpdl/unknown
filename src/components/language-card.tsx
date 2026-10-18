import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { FlatPressable } from '@/components/flat-pressable';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import type { LanguagePreference } from '@/i18n/language';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

export function LanguageCard({ compact = false }: { compact?: boolean } = {}) {
  const { language, preference, isSaving, setPreference, t } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  if (!setPreference) return null;
  const options: { value: LanguagePreference; label: string }[] = [
    { value: 'system', label: t.language.system }, { value: 'ko', label: t.language.korean }, { value: 'en', label: t.language.english },
  ];
  const close = () => { play('selection'); setOpen(false); };
  const panel = <View style={styles.section}>
    <ThemedText accessibilityRole="header" type="smallBold" themeColor="textSecondary">{t.language.title}</ThemedText>
    <View accessibilityRole="radiogroup" accessibilityLabel={t.language.title} style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
      {options.map(({ value, label }, index) => <Pressable key={value} analyticsId={`app_language.${value}`} accessibilityRole="radio"
        aria-checked={preference === value} aria-disabled={!!isSaving} aria-busy={!!isSaving}
        accessibilityLabel={label} accessibilityState={{ checked: preference === value, disabled: !!isSaving, busy: !!isSaving }}
        disabled={isSaving} onPress={() => {
          if (isSaving) return;
          play('selection'); setFailed(false);
          void setPreference(value).then((saved) => { if (saved) setOpen(false); else { play('warning'); setFailed(true); } });
        }} style={({ pressed }) => [styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line }, pressed && { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText type="small" style={styles.label}>{label}</ThemedText>
        <ThemedText style={{ color: theme.accent }} accessible={false} accessibilityElementsHidden aria-hidden>{preference === value ? '✓' : '○'}</ThemedText>
      </Pressable>)}
    </View>
    <ThemedText type="small" themeColor="textSecondary">{t.language.note}</ThemedText>
    {isSaving && <ThemedText type="small" accessibilityLiveRegion="polite">{t.language.saving}</ThemedText>}
    {failed && <ThemedText type="small" accessibilityRole="alert">{t.language.saveError}</ThemedText>}
  </View>;
  if (!compact) return panel;
  const label = language === 'ko' ? t.language.korean : t.language.english;
  return <>
    <FlatPressable testID="app_language.open" accessibilityRole="button" accessibilityLabel={`${t.language.title}, ${label}`}
      disabled={isSaving} accessibilityState={{ expanded: open, disabled: !!isSaving, busy: !!isSaving }}
      onPress={() => { if (!isSaving) { play('selection'); setOpen(true); } }}
      style={({ pressed }) => [styles.compact, { borderColor: theme.line, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText><ThemedText type="small" themeColor="textSecondary" accessible={false}>⌄</ThemedText>
    </FlatPressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.modalRoot}>
        <FlatPressable testID="app_language.dismiss" accessibilityRole="button" accessibilityLabel={t.language.close} onPress={close} style={styles.backdrop} />
        <View accessibilityViewIsModal style={[styles.modalCard, { backgroundColor: theme.background, borderColor: theme.line }]}>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
          {panel}
          <FlatPressable testID="app_language.close" accessibilityRole="button" onPress={close} style={styles.close}>
            <ThemedText type="smallBold" themeColor="textSecondary">{t.language.close}</ThemedText>
          </FlatPressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two }, card: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  row: { minHeight: 48, paddingVertical: 12, paddingHorizontal: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  label: { flex: 1, flexShrink: 1 },
  compact: { minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderRadius: 999, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  modalRoot: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.four },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  modalCard: { width: '100%', maxWidth: 360, maxHeight: '90%', borderRadius: 24, borderWidth: 1, overflow: 'hidden' },
  modalScroll: { flexGrow: 0 }, modalContent: { padding: Spacing.four },
  close: { minHeight: 44, marginTop: Spacing.three, justifyContent: 'center', alignItems: 'center' },
});
