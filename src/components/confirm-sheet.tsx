import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { DragSheet } from '@/components/drag-sheet';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';

type Props = {
  visible: boolean; onClose: () => void; onDismissed?: () => void;
  title: string; body?: string; children?: ReactNode;
  // The caller's registered id and handler; the caller plays its own feedback for the result.
  confirmId: string; confirmLabel: string; onConfirm: () => void;
  cancelLabel?: string;
  // danger (default) for what cannot be undone; primary for a safe next step inside the same flow.
  tone?: 'danger' | 'primary';
  busy?: boolean; error?: string;
};

/** The one confirm for a risky action: title, what happens, then 취소 and the action side by side, the action on the right in danger colour. */
export function ConfirmSheet({ visible, onClose, onDismissed, title, body, children, confirmId, confirmLabel, onConfirm, cancelLabel, tone = 'danger', busy = false, error }: Props) {
  const { tr } = useLanguage(), theme = useTheme(), { play } = useInteractionFeedback();
  const cancel = () => { play('selection'); onClose(); };
  // A hidden copy of the action label measures its one-line width. Both buttons take that width (plus the pill's padding), so a label
  // that would wrap at half width ('모든 기기에서 로그아웃', or any label at large text) stacks the buttons instead (QA A-set-06).
  // The key remounts the row when the width arrives: Android kept the first-pass line breaks after the basis changed, so the pair stayed side by side.
  const [labelWidth, setLabelWidth] = useState(0);
  const basis = Math.max(140, Math.ceil(labelWidth) + 52);
  return <DragSheet visible={visible} onClose={onClose} onDismissed={onDismissed} dismissible={!busy} title={title}>
    <View style={styles.content}>
      {!!body && <ThemedText type="small" themeColor="textSecondary">{body}</ThemedText>}
      {children}
      {!!error && <ThemedText type="small" accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: theme.danger }}>{error}</ThemedText>}
      <View key={basis} style={styles.actions}>
        <ThemedText type="smallBold" style={styles.measure} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
          onLayout={({ nativeEvent }) => setLabelWidth(nativeEvent.layout.width)}>{confirmLabel}</ThemedText>
        <View style={[styles.action, { flexBasis: basis }]}><RaisedActionButton analyticsId="sheet.close" tone="secondary" label={cancelLabel ?? tr('취소')} disabled={busy} onPress={cancel} /></View>
        <View style={[styles.action, { flexBasis: basis }]}><RaisedActionButton analyticsId={confirmId} tone={tone} label={confirmLabel} busy={busy} onPress={onConfirm} /></View>
      </View>
    </View>
  </DragSheet>;
}

const styles = StyleSheet.create({
  content: { gap: Spacing.three, paddingBottom: Spacing.two },
  // Side by side on a phone; large text or a narrow screen stacks them with the action still last.
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  action: { flexGrow: 1, flexShrink: 1 },
  // Same size as the button label (RaisedActionButton wideLabel); never seen or read.
  measure: { position: 'absolute', opacity: 0, fontSize: 16 },
});
