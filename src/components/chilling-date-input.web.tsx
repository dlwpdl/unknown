import { Typography } from '@/constants/design-system';
import { useTheme } from '@/hooks/use-theme';
import { localDateInput, parseLocalDateInput, type ChillingDateInputProps } from '@/lib/chilling-date';

export function ChillingDateInput({ label, value, onChange, disabled, minimumDate }: ChillingDateInputProps & { minimumDate?: Date }) {
  const theme = useTheme();
  return <label style={{ display: 'grid', gap: 8, margin: '8px 0', color: theme.text, ...Typography.menu }}>{label}
    <input type="datetime-local" aria-label={label} disabled={disabled} value={localDateInput(value)} min={minimumDate ? localDateInput(minimumDate.toISOString()) : undefined} onChange={event => onChange(parseLocalDateInput(event.target.value))} style={{ minHeight: 48, width: '100%', boxSizing: 'border-box', padding: 12, border: `1px solid ${theme.line}`, borderRadius: 10, background: theme.card, color: theme.text, font: 'inherit' }} />
  </label>;
}
