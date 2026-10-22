import { useLanguage } from '@/hooks/use-language';
import { Modal, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Pressable } from '@/components/analytics-controls';
import { ThemedText } from '@/components/themed-text';
import { IconSize } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

type Action = { key: string; label: string; hint?: string; icon: Parameters<typeof SymbolView>[0]['name']; danger?: boolean; onPress: () => void };

/** 모임장이 방 안에서 여는 관리 시트. 지금 실제로 되는 동작만 담는다. */
export function MeetupManageSheet({ visible, onClose, actions }: { visible: boolean; onClose: () => void; actions: Action[] }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { play } = useInteractionFeedback();
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.backdrop}>
      <Pressable analyticsId="chat.manage-dismiss" accessibilityRole="button" accessibilityLabel={tr('모임 관리 닫기')} style={StyleSheet.absoluteFill} onPress={() => { play('selection'); onClose(); }} />
      <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: theme.card, borderTopColor: theme.line, paddingBottom: Math.max(insets.bottom, Spacing.three) }]}>
        <View style={[styles.grab, { backgroundColor: theme.line }]} />
        <ThemedText type="subtitle" style={styles.title}>{tr('모임 관리')}</ThemedText>
        {actions.map(action => <Pressable key={action.key} analyticsId={`chat.manage.${action.key}`} accessibilityRole="button" accessibilityLabel={action.label}
          onPress={() => { play('selection'); onClose(); action.onPress(); }}
          style={({ pressed }) => [styles.row, { opacity: pressed ? 0.82 : 1 }]}>
          <View style={[styles.icon, { backgroundColor: theme.backgroundElement }]}>
            <SymbolView name={action.icon} size={18} tintColor={action.danger ? theme.danger : theme.accent} />
          </View>
          <View style={styles.labels}>
            <ThemedText type="default" style={action.danger ? { color: theme.danger } : undefined}>{action.label}</ThemedText>
            {!!action.hint && <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>{action.hint}</ThemedText>}
          </View>
        </Pressable>)}
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, borderTopWidth: 1, borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: 2 },
  grab: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: Spacing.three },
  title: { marginBottom: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: 52, paddingHorizontal: Spacing.two, borderRadius: 14 },
  icon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  labels: { flex: 1 },
  hint: { marginTop: 2 },
});
