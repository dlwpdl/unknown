export function localDateInput(iso: string) {
  if (!iso) return '';
  const date = new Date(iso), pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseLocalDateInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return '';
  const date = new Date(value);
  // Reject impossible calendar dates and local times skipped by daylight saving.
  return Number.isFinite(date.getTime()) && localDateInput(date.toISOString()) === value ? date.toISOString() : '';
}

export function mergePickerDate(iso: string, selected: Date, mode: 'date' | 'time') {
  const current = new Date(iso);
  // Material's date picker returns a UTC calendar day; its time picker returns local time.
  return mode === 'date'
    ? new Date(selected.getUTCFullYear(), selected.getUTCMonth(), selected.getUTCDate(), current.getHours(), current.getMinutes()).toISOString()
    : new Date(current.getFullYear(), current.getMonth(), current.getDate(), selected.getHours(), selected.getMinutes()).toISOString();
}

// Calendar days (YYYY-MM-DD, local) for date-only pickers. Noon keeps the day stable across DST changes.
export const localDay = (iso: string) => localDateInput(iso).slice(0, 10);
export const parseLocalDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseLocalDateInput(`${value}T12:00`) : '';

// dateOnly hides the time; callers read the day with localDay.
export type ChillingDateInputProps = { label: string; value: string; onChange: (iso: string) => void; disabled?: boolean; dateOnly?: boolean };
