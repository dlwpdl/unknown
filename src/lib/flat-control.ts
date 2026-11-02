import type { ViewStyle } from 'react-native';

export function flatControlStyle(style: ViewStyle = {}): ViewStyle {
  return {
    boxShadow: undefined, shadowOpacity: 0, elevation: 0,
    // Keep the old border's layout space without painting a raised bottom edge.
    ...(style.backgroundColor && style.backgroundColor !== 'transparent' && (style.borderBottomWidth ?? 0) >= 3 && (style.borderBottomWidth ?? 0) > (style.borderWidth ?? 0)
      ? { borderBottomColor: style.backgroundColor } : {}),
  };
}

// About the same few points of shrink on any size, so a small pill and a full-width card both read as pressed.
export function pressedScale(width: number) {
  return Math.max(0.97, 1 - 6 / Math.max(width, 1));
}

// A dismiss layer stretched over its parent must not shrink and reveal what is behind its edges.
export function fillsParent(style: ViewStyle = {}) {
  return style.position === 'absolute' && style.top === 0 && style.bottom === 0;
}
