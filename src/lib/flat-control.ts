import type { ViewStyle } from 'react-native';

export function flatControlStyle(style: ViewStyle = {}): ViewStyle {
  return {
    boxShadow: undefined, shadowOpacity: 0, elevation: 0,
    // Keep the old border's layout space without painting a raised bottom edge.
    ...(style.backgroundColor && style.backgroundColor !== 'transparent' && (style.borderBottomWidth ?? 0) > (style.borderWidth ?? 0)
      ? { borderBottomColor: style.backgroundColor } : {}),
  };
}
