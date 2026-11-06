import { Typography } from '@/constants/design-system';
import { useTheme } from '@/hooks/use-theme';
import { fromPickerValue, localDateInput, localDay, parseLocalDateInput, parseLocalDay, toPickerValue, type ChillingDateInputProps } from '@/lib/chilling-date';

export function ChillingDateInput({ label, value, onChange, disabled, minimumDate, dateOnly, zone }: ChillingDateInputProps & { minimumDate?: Date }) {
  const theme = useTheme();
  return <label style={{ display: 'grid', gap: 8, margin: '8px 0', color: theme.text, ...Typography.menu }}>{label}
    <input type={dateOnly ? 'date' : 'datetime-local'} aria-label={label} disabled={disabled} value={(dateOnly ? localDay : localDateInput)(toPickerValue(value, zone))}
      min={minimumDate ? (dateOnly ? localDay : localDateInput)(toPickerValue(minimumDate.toISOString(), zone)) : undefined} onChange={event => onChange(fromPickerValue((dateOnly ? parseLocalDay : parseLocalDateInput)(event.target.value), zone))} style={{ minHeight: 48, width: '100%', boxSizing: 'border-box', padding: 12, border: `1px solid ${theme.line}`, borderRadius: 10, background: theme.card, color: theme.text, font: 'inherit' }} />
  </label>;
}
