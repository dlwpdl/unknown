import { useLanguage } from '@/hooks/use-language';
import { View } from 'react-native';
import { DatePicker, Host } from '@expo/ui/swift-ui';
import { accessibilityLabel, datePickerStyle, disabled as disabledModifier, environment, tint } from '@expo/ui/swift-ui/modifiers';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { type ChillingDateInputProps } from '@/lib/chilling-date';
import { Typography } from '@/constants/design-system';

export function ChillingDateInput({ label, value, onChange, disabled, minimumDate, dateOnly }: ChillingDateInputProps & { minimumDate?: Date }) {
  const { locale: appLocale } = useLanguage();
  const theme = useTheme();
  const date = new Date(value);
  return <View style={{ gap: 8, marginVertical: 8 }}>
    <ThemedText type="smallBold" style={Typography.menu}>{label}</ThemedText>
    <Host matchContents ignoreSafeArea="all" style={{ minHeight: 48, width: '100%' }}>
      {/* SwiftUI directly: the community picker drops accessibilityLabel, so VoiceOver could not tell start from end. */}
      <DatePicker selection={date} displayedComponents={dateOnly ? ['date'] : ['date', 'hourAndMinute']} range={minimumDate ? { start: minimumDate } : undefined} onDateChange={next => onChange(next.toISOString())} modifiers={[datePickerStyle('compact'), tint(theme.accent), disabledModifier(!!disabled), environment('locale', appLocale), accessibilityLabel(label)]} />
    </Host>
  </View>;
}
