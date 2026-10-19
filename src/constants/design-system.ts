// Gling control/type contract. Keep colour values in the existing theme palette.
export const ControlMetrics = {
  touch: 44,
  field: 48,
  action: 48,
  actionWide: 52,
  radius: { icon: 22, pill: 999, action: 14, field: 16 },
} as const;

export const IconSize = { toolbar: 21, inline: 16, chevron: 14, avatar: 28 } as const;

export const ControlMotion = { pressedOpacity: 0.82, disabledOpacity: 0.45, settleMs: 180 } as const;

export const ControlStyles = {
  icon: { width: ControlMetrics.touch, minHeight: ControlMetrics.touch, borderRadius: ControlMetrics.radius.icon, alignItems: 'center', justifyContent: 'center' },
  pill: { minHeight: ControlMetrics.touch, borderRadius: ControlMetrics.radius.pill, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  action: { minHeight: ControlMetrics.action, borderRadius: ControlMetrics.radius.action, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  field: { minHeight: ControlMetrics.field, borderRadius: ControlMetrics.radius.field, paddingHorizontal: 12, borderWidth: 1 },
} as const;

export const Typography = {
  display: { fontSize: 32, lineHeight: 40, fontWeight: '600', letterSpacing: 0 },
  screenTitle: { fontSize: 28, lineHeight: 36, fontWeight: '700', letterSpacing: -0.8 },
  sheetTitle: { fontSize: 24, lineHeight: 32, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { fontSize: 24, lineHeight: 32, fontWeight: '600', letterSpacing: 0 },
  section: { fontSize: 18, lineHeight: 26, fontWeight: '700', letterSpacing: -0.4 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '500', letterSpacing: 0 },
  menu: { fontSize: 16, lineHeight: 24, fontWeight: '600', letterSpacing: -0.2 },
  supporting: { fontSize: 13, lineHeight: 19, fontWeight: '500', letterSpacing: 0 },
  label: { fontSize: 13, lineHeight: 19, fontWeight: '700', letterSpacing: 0 },
  caption: { fontSize: 11, lineHeight: 16, fontWeight: '500', letterSpacing: 0 },
  micro: { fontSize: 10, lineHeight: 14, fontWeight: '600', letterSpacing: 0.4 },
} as const;

export type ControlPalette = { accent: string; accentInk: string; text: string; card: string; line: string; backgroundSelected: string };
export type ControlState = { tone?: 'primary' | 'secondary' | 'ghost'; selected?: boolean; pressed?: boolean; disabled?: boolean; busy?: boolean; reducedMotion?: boolean };

export function controlPresentation(theme: ControlPalette, { tone = 'secondary', selected = false, pressed = false, disabled = false, busy = false }: ControlState = {}) {
  const filled = tone === 'primary' || (tone === 'secondary' && selected);
  const active = pressed && !disabled && !busy;
  return {
    container: {
      backgroundColor: filled ? theme.accent : tone === 'ghost' ? selected ? theme.backgroundSelected : 'transparent' : theme.card,
      borderColor: filled ? theme.accent : tone === 'ghost' ? 'transparent' : theme.line,
      opacity: disabled || busy ? ControlMotion.disabledOpacity : active ? ControlMotion.pressedOpacity : 1,
    },
    text: { color: filled ? theme.accentInk : selected ? theme.accent : theme.text },
  };
}
