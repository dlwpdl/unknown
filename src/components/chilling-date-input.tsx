import { useLanguage } from '@/hooks/use-language';
import { Pressable } from '@/components/analytics-controls';
import { useState } from 'react';
import { View } from 'react-native';
import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { mergePickerDate, type ChillingDateInputProps } from '@/lib/chilling-date';
import { Typography } from '@/constants/design-system';

export function ChillingDateInput({ analyticsId = 'components_chilling-date-input.pressable.1', label, value, onChange, disabled, minimumDate, dateOnly }: ChillingDateInputProps & { minimumDate?: Date }) {
  const { tr, locale: appLocale } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  const [mode, setMode] = useState<'date' | 'time' | null>(null);
  const date = new Date(value);
  return <View style={{ gap: 8, marginVertical: 8 }}>
    <ThemedText type="smallBold" style={Typography.menu}>{label}</ThemedText>
    <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>{(dateOnly ? ['date'] as const : ['date', 'time'] as const).map(part => <Pressable analyticsId={analyticsId} key={part} disabled={disabled} accessibilityRole="button" accessibilityLabel={tr("{0} {1} 선택", (label), (part === 'date' ? tr('날짜') : tr('시간')))} onPress={() => { play('selection'); setMode(part); }} style={({ pressed }) => ({ minHeight: 48, justifyContent: 'center', padding: 12, borderWidth: 1, borderRadius: 10, borderColor: theme.line, opacity: pressed ? 0.65 : 1 })}><ThemedText style={Typography.menu}>{part === 'date' ? date.toLocaleDateString(appLocale) : date.toLocaleTimeString(appLocale, { hour: '2-digit', minute: '2-digit' })}</ThemedText></Pressable>)}</View>
    {mode && !disabled ? <DateTimePicker value={mode === 'date' ? new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) : date} mode={mode} minimumDate={mode === 'date' ? minimumDate : undefined} accentColor={theme.accent} positiveButton={{ label: tr('선택') }} negativeButton={{ label: tr('취소') }} onDismiss={() => setMode(null)} onValueChange={(_, selected) => { onChange(mergePickerDate(value, selected, mode)); setMode(null); }} /> : null}
  </View>;
}
