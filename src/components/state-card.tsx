import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { Depth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

type StateKind = 'empty' | 'error' | 'blocked' | 'update' | 'pending' | 'success';

// 빈 화면·오류·권한 없음이 화면마다 다른 모양이면 사용자는 "고장"과 "비어 있음"을 구분하지 못한다.
const glyphs = {
  empty: { ios: 'tray', android: 'inbox', web: 'inbox' },
  error: { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' },
  blocked: { ios: 'lock', android: 'lock', web: 'lock' },
  update: { ios: 'arrow.triangle.2.circlepath', android: 'update', web: 'update' },
  pending: { ios: 'clock', android: 'schedule', web: 'schedule' },
  success: { ios: 'checkmark.circle', android: 'check_circle', web: 'check_circle' },
} as const;

export function StateCard({ kind = 'empty', title, body, actionLabel, onAction }: {
  kind?: StateKind; title: string; body: string; actionLabel?: string; onAction?: () => void;
}) {
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  return <View style={[styles.card, Depth.card, { borderColor: theme.line, backgroundColor: theme.card }]}>
    <View style={[styles.glyph, { backgroundColor: theme.backgroundElement }]}>
      <SymbolView name={glyphs[kind]} size={22} tintColor={kind === 'error' ? theme.accent : theme.textSecondary} />
    </View>
    <ThemedText type="smallBold" style={styles.title}>{title}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary" style={styles.body}>{body}</ThemedText>
    {actionLabel && onAction && <Pressable analyticsId="components_state-card.pressable.1" accessibilityRole="button" accessibilityLabel={actionLabel}
      onPress={() => { play(kind === 'error' ? 'warning' : 'selection'); onAction(); }}
      style={({ pressed }) => [styles.action, { backgroundColor: theme.accent, opacity: pressed ? 0.8 : 1 }]}>
      <ThemedText type="smallBold" style={{ color: theme.accentInk }}>{actionLabel}</ThemedText>
    </Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: Spacing.four, gap: Spacing.two, alignItems: 'center' },
  glyph: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.one },
  title: { textAlign: 'center' },
  body: { textAlign: 'center' },
  action: { minHeight: 44, borderRadius: 999, paddingHorizontal: Spacing.four, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.two },
});
