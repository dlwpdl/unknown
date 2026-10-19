import { StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { Depth, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { MEETUP_DRAFT_FIELDS, type MeetupDraftField, type MeetupDraftFields } from '@/lib/ai-draft';

export function MeetupAiDraftPreview({ fields, selected, protectedFields, disabled, onToggle, onApply, onDismiss }: {
  fields: MeetupDraftFields;
  selected: Record<MeetupDraftField, boolean>;
  protectedFields: Record<MeetupDraftField, boolean>;
  disabled: boolean;
  onToggle: (field: MeetupDraftField) => void;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const theme = useTheme(), { language } = useLanguage(), { play } = useInteractionFeedback();
  const copy = (ko: string, en: string) => language === 'en' ? en : ko;
  const labels = { title: copy('모임 제목', 'Meetup title'), body: copy('모임 소개', 'Meetup introduction'), question: copy('신청 질문', 'Application question') };
  const canApply = !disabled && MEETUP_DRAFT_FIELDS.some(field => selected[field] && !protectedFields[field]);
  return <View style={[styles.preview, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <ThemedText accessibilityRole="header" type="smallBold">{copy('AI 초안 미리보기', 'AI draft preview')}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{copy('적용할 항목을 선택해 주세요. 생성 중이거나 미리보기 뒤에 수정한 항목은 그대로 남겨요.', 'Choose what to apply. Fields you edited during generation or after this preview stay as you wrote them.')}</ThemedText>
    {MEETUP_DRAFT_FIELDS.map(field => {
      const checked = selected[field] && !protectedFields[field];
      const locked = disabled || protectedFields[field];
      return <View key={field} style={[styles.section, { borderColor: theme.line }]}>
        <Pressable analyticsId={`meetup.ai-preview.select.${field}`} accessibilityRole="checkbox" accessibilityLabel={labels[field]} accessibilityState={{ checked, disabled: locked }} disabled={locked} onPress={() => { play('selection'); onToggle(field); }} style={({ pressed }) => [styles.select, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
          <SymbolView name={{ ios: checked ? 'checkmark.square.fill' : 'square', android: checked ? 'check_box' : 'check_box_outline_blank', web: checked ? 'check_box' : 'check_box_outline_blank' }} size={22} tintColor={checked ? theme.accent : theme.textSecondary} />
          <ThemedText type="smallBold" style={styles.label}>{labels[field]}</ThemedText>
          {protectedFields[field] && <ThemedText type="small" themeColor="textSecondary">{copy('수정한 내용 유지', 'Your edit is kept')}</ThemedText>}
        </Pressable>
        <ThemedText>{fields[field]}</ThemedText>
      </View>;
    })}
    <ThemedText type="small" themeColor="textSecondary">{copy('날짜·장소·정원·비용은 직접 확인해 주세요.', 'Confirm the date, venue, capacity and costs yourself.')}</ThemedText>
    <View style={styles.actions}>
      <Pressable analyticsId="meetup.ai-preview.apply" accessibilityRole="button" accessibilityState={{ disabled: !canApply }} disabled={!canApply} onPress={() => { play('selection'); onApply(); }} style={({ pressed }) => [styles.button, Depth.control, { backgroundColor: theme.accent, opacity: !canApply ? 0.5 : pressed ? 0.8 : 1 }]}><ThemedText type="smallBold" style={{ color: theme.accentInk }}>{copy('선택한 항목 적용', 'Apply selected fields')}</ThemedText></Pressable>
      <Pressable analyticsId="meetup.ai-preview.dismiss" accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={() => { play('selection'); onDismiss(); }} style={({ pressed }) => [styles.button, { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement }]}><ThemedText type="smallBold">{copy('미리보기 닫기', 'Dismiss preview')}</ThemedText></Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  preview: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.three },
  section: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two, gap: Spacing.two },
  select: { minHeight: 44, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two, borderRadius: 8 },
  label: { flexShrink: 1 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: 12 },
});
