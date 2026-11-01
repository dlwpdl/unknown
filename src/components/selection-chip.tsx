import { Pressable } from '@/components/analytics-controls';
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { ControlStyles } from '@/constants/design-system';
import { useTheme } from '@/hooks/use-theme';

// Shared selected-fill animation for chip groups. The fill fades instead of hard-switching,
// matching the sliding selection used by the bottom tabs and meetup kind switch.
export function SelectionChip({ selected, disabled, onPress, style, baseColor, analyticsId, children, label, ...rest }: Omit<PressableProps, 'style'> & {
  selected: boolean; analyticsId: string; children?: React.ReactNode; style?: StyleProp<ViewStyle>; baseColor?: string; label?: string;
}) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const [fill] = useState(() => new Animated.Value(selected ? 1 : 0));
  useEffect(() => {
    if (reducedMotion) fill.setValue(selected ? 1 : 0);
    else Animated.timing(fill, { toValue: selected ? 1 : 0, duration: 160, useNativeDriver: true }).start();
  }, [fill, reducedMotion, selected]);
  return <Pressable {...rest} analyticsId={analyticsId} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [label ? ControlStyles.pill : null, style, styles.chip, { backgroundColor: baseColor ?? (label ? theme.backgroundElement : 'transparent'), opacity: pressed ? 0.82 : disabled ? 0.45 : 1 }]}>
    <Animated.View pointerEvents="none" style={[styles.fillLayer, { backgroundColor: theme.accent, opacity: fill }]} />
    {label ? <ThemedText type="smallBold" style={{ color: selected ? theme.accentInk : theme.text }}>{label}</ThemedText> : children}
  </Pressable>;
}

const styles = StyleSheet.create({
  chip: { overflow: 'hidden', backgroundColor: 'transparent' },
  fillLayer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 22 },
});
