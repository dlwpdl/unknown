import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { PropsWithChildren } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

const available = (() => {
  if (Platform.OS !== 'ios') return false;
  try { return isGlassEffectAPIAvailable() && isLiquidGlassAvailable(); }
  catch { return false; }
})();

export function GlassSurface({ children, style, interactive = false, tone = 'overlay' }: PropsWithChildren<{ style?: StyleProp<ViewStyle>; interactive?: boolean; tone?: 'overlay' | 'control' }>) {
  if (available) return <GlassView glassEffectStyle={tone === 'control' ? 'clear' : 'regular'} colorScheme="dark" tintColor={tone === 'control' ? undefined : '#0B0B12'} isInteractive={interactive} style={[styles.surface, tone === 'control' && styles.controlEdge, style]}>{children}</GlassView>;
  return <View style={[styles.surface, tone === 'control' ? styles.controlFallback : styles.fallback, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  surface: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.4)' },
  fallback: { backgroundColor: 'rgba(11,11,18,0.84)' },
  controlEdge: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)' },
  controlFallback: { borderColor: 'rgba(255,255,255,0.24)', backgroundColor: 'rgba(33,33,40,0.76)' },
});
