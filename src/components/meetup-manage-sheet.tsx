import { useLanguage } from '@/hooks/use-language';
import { StyleSheet, View } from 'react-native';
import { useRef, useState } from 'react';
import { SymbolView } from '@/components/symbol-view';

import { Pressable } from '@/components/analytics-controls';
import { ListCard } from '@/components/list-card';
import { DragSheet } from '@/components/drag-sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

type Action = { key: string; analyticsId?: string; label: string; hint?: string; icon: Parameters<typeof SymbolView>[0]['name']; danger?: boolean; onPress: () => void };

/** 모임장이 방 안에서 여는 관리 시트. 지금 실제로 되는 동작만 담는다. */
export function MeetupManageSheet({ visible, onClose, actions, title }: { visible: boolean; onClose: () => void; actions: Action[]; title?: string }) {
  const { tr } = useLanguage();
  const theme = useTheme();
  const { play } = useInteractionFeedback();
  // iOS drops an Alert/Modal presented while this sheet is still animating out, so run the action after it has dismissed.
  // The parent may stop rendering this as soon as onClose runs, so it only hears about it once the sheet is really gone.
  const pending = useRef<(() => void) | null>(null);
  const [open, setOpen] = useState(true), [shown, setShown] = useState(visible);
  if (visible !== shown) { setShown(visible); if (visible) setOpen(true); }
  const choose = (action: () => void) => { pending.current = action; setOpen(false); };
  return <DragSheet visible={visible && open} onClose={() => setOpen(false)} title={title ?? tr('모임 관리')} onDismissed={() => { const action = pending.current; pending.current = null; onClose(); action?.(); }}>
    {[false, true].map(danger => { const list = actions.filter(action => !!action.danger === danger); return list.length > 0 && <View key={String(danger)} style={danger && styles.dangerGap}><ListCard>{list.map(action => <Pressable key={action.key} analyticsId={action.analyticsId ?? `chat.manage.${action.key}`} accessibilityRole="button" accessibilityLabel={action.hint ? `${action.label}, ${action.hint}` : action.label}
      onPress={() => { play('selection'); choose(action.onPress); }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>
      <View style={[styles.icon, { backgroundColor: theme.background }]}>
        <SymbolView name={action.icon} size={18} tintColor={action.danger ? theme.danger : theme.accent} />
      </View>
      <View style={styles.labels}>
        <ThemedText type="default" style={[styles.bodyText, action.danger ? { color: theme.danger } : undefined]}>{action.label}</ThemedText>
        {!!action.hint && <ThemedText type="small" themeColor="textSecondary" style={[styles.helper, styles.hint]}>{action.hint}</ThemedText>}
      </View>
    </Pressable>)}</ListCard></View>; })}
  </DragSheet>;
}

const styles = StyleSheet.create({
  helper: { fontSize: 14, lineHeight: 22 }, bodyText: { fontSize: 16, lineHeight: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, minHeight: 64, paddingHorizontal: Spacing.three },
  icon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  labels: { flex: 1 },
  hint: { marginTop: 2 },
  // Destructive actions sit apart from routine ones.
  dangerGap: { marginTop: Spacing.three },
});
