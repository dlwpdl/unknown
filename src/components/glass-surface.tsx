import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { PropsWithChildren } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Colors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const available = (() => {
  if (Platform.OS !== 'ios') return false;
  try { return isGlassEffectAPIAvailable() && isLiquidGlassAvailable(); }
  catch { return false; }
})();

export function GlassSurface({ children, style, interactive = false, tone = 'overlay', colorScheme }: PropsWithChildren<{ style?: StyleProp<ViewStyle>; interactive?: boolean; tone?: 'overlay' | 'control'; colorScheme?: 'light' | 'dark' }>) {
  const theme = useTheme();
  const scheme = colorScheme ?? (theme === Colors.dark ? 'dark' : 'light');
  const colors = colorScheme ? Colors[colorScheme] : theme;
  const lightBorder = scheme === 'light' && { borderColor: colors.line };
  if (tone === 'control') return <View style={[styles.surface, available && styles.controlEdge, { backgroundColor: colors.backgroundElement, borderColor: colors.line }, style, { shadowOpacity: 0, elevation: 0, boxShadow: undefined }]}>{children}</View>;
  if (available) return <GlassView glassEffectStyle="regular" colorScheme={scheme} tintColor={colors.background} isInteractive={interactive} style={[styles.surface, lightBorder, style]}>{children}</GlassView>;
  return <View style={[styles.surface, styles.fallback, lightBorder, scheme === 'light' && { backgroundColor: `${colors.background}D6` }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  surface: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.4)' },
  fallback: { backgroundColor: 'rgba(11,11,18,0.84)' },
  controlEdge: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)' },
});
