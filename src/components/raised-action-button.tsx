import { StyleSheet, View } from 'react-native';
import Reanimated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  analyticsId: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  compact?: boolean;
};

export function RaisedActionButton({ analyticsId, label, onPress, disabled = false, busy = false, compact = false }: Props) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const depth = useSharedValue(0);
  const faceMotion = useAnimatedStyle(() => ({ transform: [{ translateY: depth.value * 4 }, { scale: 1 - depth.value * 0.012 }] }));
  const press = (down: number) => { depth.value = reducedMotion ? down : withSpring(down, { stiffness: 420, damping: 32, mass: 0.7 }); };

  return <View style={[styles.base, compact ? styles.compact : styles.wide, { backgroundColor: theme.accentDepth, opacity: disabled ? 0.62 : 1 }]}>
    <Reanimated.View style={[styles.face, compact ? styles.compact : styles.wide, { backgroundColor: theme.accent, shadowColor: '#000' }, faceMotion]}>
      <Pressable analyticsId={analyticsId} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, busy }} disabled={disabled}
        onPressIn={() => press(1)} onPressOut={() => press(0)} onPress={onPress}
        style={[styles.touch, compact ? styles.compactTouch : styles.wideTouch]}>
        <ThemedText type="smallBold" style={[styles.label, !compact && styles.wideLabel, { color: theme.accentInk }]}>{label}</ThemedText>
      </Pressable>
    </Reanimated.View>
  </View>;
}

const styles = StyleSheet.create({
  base: { paddingBottom: 2 },
  compact: { borderRadius: 999 },
  wide: { width: '100%', maxWidth: 596, alignSelf: 'center', borderRadius: 999 },
  face: { shadowOpacity: 0.25, shadowRadius: 13, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
  touch: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  compactTouch: { minHeight: 44, paddingHorizontal: 16, borderRadius: 999 },
  wideTouch: { minHeight: 52, paddingHorizontal: 20, borderRadius: 999 },
  label: { textAlign: 'center' },
  wideLabel: { fontSize: 16 },
});
