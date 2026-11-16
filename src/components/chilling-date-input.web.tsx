import { Typography } from '@/constants/design-system';
import { useTheme } from '@/hooks/use-theme';
import { fromPickerValue, localDateInput, localDay, parseLocalDateInput, parseLocalDay, toPickerValue, type ChillingDateInputProps } from '@/lib/chilling-date';

export function ChillingDateInput({ label, value, onChange, disabled, minimumDate, dateOnly, timeOnly, zone }: ChillingDateInputProps & { minimumDate?: Date }) {
  const theme = useTheme(), picked = toPickerValue(value, zone);
  // timeOnly keeps the picked day and swaps only the clock.
  const show = (iso: string) => dateOnly ? localDay(iso) : timeOnly ? localDateInput(iso).slice(11) : localDateInput(iso);
  const parse = (text: string) => dateOnly ? parseLocalDay(text) : timeOnly ? parseLocalDateInput(`${localDay(picked)}T${text}`) : parseLocalDateInput(text);
  return <label style={{ display: 'grid', gap: 8, margin: '8px 0', color: theme.text, ...Typography.menu }}>{label}
    <input type={dateOnly ? 'date' : timeOnly ? 'time' : 'datetime-local'} aria-label={label} disabled={disabled} value={show(picked)}
      min={minimumDate && !timeOnly ? show(toPickerValue(minimumDate.toISOString(), zone)) : undefined} onChange={event => onChange(fromPickerValue(parse(event.target.value), zone))} style={{ minHeight: 48, width: '100%', boxSizing: 'border-box', padding: 12, border: `1px solid ${theme.line}`, borderRadius: 10, background: theme.card, color: theme.text, font: 'inherit' }} />
  </label>;
}
