import { Pressable } from '@/components/analytics-controls';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { mergePickerDate, type ChillingDateInputProps } from '@/lib/chilling-date';

export function ChillingDateInput({ label, value, onChange, disabled }: ChillingDateInputProps) {
  const theme = useTheme();
  const [mode, setMode] = useState<'date' | 'time' | null>(null);
  const date = new Date(value);
  return <View style={{ gap: 8, marginVertical: 8 }}>
    <ThemedText type="smallBold">{label}</ThemedText>
    {Platform.OS === 'ios' ? <DateTimePicker value={date} mode="datetime" display="compact" disabled={disabled} accentColor={theme.accent} locale="ko-KR" style={{ minHeight: 48, width: '100%' }} onValueChange={(_, next) => onChange(next.toISOString())} /> : <>
      <View style={{ flexDirection: 'row', gap: 12 }}>{(['date', 'time'] as const).map(part => <Pressable analyticsId="components_chilling-date-input.pressable.1" key={part} disabled={disabled} accessibilityRole="button" accessibilityLabel={`${label} ${part === 'date' ? '날짜' : '시간'} 선택`} onPress={() => setMode(part)} style={{ minHeight: 48, justifyContent: 'center', padding: 12, borderWidth: 1, borderRadius: 10, borderColor: theme.line }}><ThemedText>{part === 'date' ? date.toLocaleDateString('ko-KR') : date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</ThemedText></Pressable>)}</View>
      {mode && !disabled ? <DateTimePicker value={mode === 'date' ? new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) : date} mode={mode} accentColor={theme.accent} positiveButton={{ label: '선택' }} negativeButton={{ label: '취소' }} onDismiss={() => setMode(null)} onValueChange={(_, selected) => { onChange(mergePickerDate(value, selected, mode)); setMode(null); }} /> : null}
    </>}
  </View>;
}
