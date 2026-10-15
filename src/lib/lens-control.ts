import type { ViewStyle } from 'react-native';

// Keep existing border widths as layout space; replace only their old raised-edge paint.
export function lensControlStyle(style: ViewStyle = {}, pressed = false): ViewStyle {
  const edge = style.borderColor && style.borderColor !== 'transparent' ? style.borderColor
    : style.borderBottomColor && style.borderBottomColor !== 'transparent' ? style.borderBottomColor : 'rgba(128,128,144,0.45)';
  return {
    borderRadius: 999,
    borderColor: 'transparent', borderTopColor: 'transparent', borderBottomColor: 'transparent',
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderStartColor: 'transparent', borderEndColor: 'transparent',
    shadowOpacity: 0, elevation: 0,
    boxShadow: [
      { inset: true, offsetX: 0, offsetY: 0, blurRadius: 0, spreadDistance: 1, color: edge },
      { inset: true, offsetX: 0, offsetY: pressed ? 1 : 2, blurRadius: 0, color: 'rgba(255,255,255,0.48)' },
      { inset: true, offsetX: 0, offsetY: pressed ? 2 : -3, blurRadius: 4, color: 'rgba(0,0,0,0.13)' },
      { offsetX: 0, offsetY: pressed ? 1 : 3, blurRadius: pressed ? 3 : 8, color: 'rgba(0,0,0,0.12)' },
    ],
  };
}
