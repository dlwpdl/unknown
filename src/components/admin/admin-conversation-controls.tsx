import type { ReactNode } from 'react';
import { useState } from 'react';
import { SymbolView } from 'expo-symbols';
import { Modal, Platform, Pressable, ScrollView, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors } from '@/constants/theme';
import { adminOptionKeys } from '@/lib/admin';
import { AdminInfo } from './admin-ui';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { conversationStyles as styles } from './admin-conversation-styles';

export function ConversationButton({ label, onPress, disabled, busy, primary, testID, children, style }: {
  label: string; onPress: () => void; disabled?: boolean; busy?: boolean; primary?: boolean;
  testID?: string; children?: ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const { play } = useInteractionFeedback();
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled: !!disabled, busy: !!busy }} disabled={disabled}
    onPress={() => { play('selection'); onPress(); }}
    style={({ pressed }) => [styles.button, primary && styles.primary, style, pressed && styles.pressed, disabled && styles.disabled]}>
    {children ?? <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>}
  </Pressable>;
}

export function ConversationDialog({ title, visible, onClose, children, review = false, testID, info }: {
  title: string; visible: boolean; onClose: () => void; children: ReactNode; review?: boolean; testID?: string; info?: string[];
}) {
  const { play } = useInteractionFeedback();
  return <Modal visible={visible} transparent animationType="none" onRequestClose={() => { play('selection'); onClose(); }}>
    <View nativeID="gling-admin-detail" style={styles.modalShade}>
      <Pressable accessibilityLabel={`${title} 닫기`} accessibilityRole="button" onPress={() => { play('selection'); onClose(); }} style={styles.modalBackdrop} />
      <View testID={testID} accessibilityViewIsModal accessibilityLabel={title} role="dialog" aria-modal style={[styles.modal, review && styles.reviewModal]}>
        <View style={[styles.modalHeader, { zIndex: 2 }]}><View style={[styles.row, styles.grow]}><Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>{!!info && <AdminInfo text={info} />}</View>
          <ConversationButton testID={review ? 'conversation-inspector-close' : undefined} label={`${title} 닫기`} onPress={onClose} style={styles.iconButton}>
            <SymbolView name={{ ios: 'xmark', web: 'close' }} size={18} tintColor={Colors.admin.textSecondary} />
          </ConversationButton>
        </View>
        {children}
      </View>
    </View>
  </Modal>;
}

export function ConversationPicker({ label, value, options, onChange, testID, disabled, compact }: {
  label: string; value: string; options: { value: string; label: string }[];
  onChange: (value: string) => void; testID?: string; disabled?: boolean; compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { play } = useInteractionFeedback();
  const selected = options.find((option) => option.value === value)?.label ?? value;
  return <>
    <ConversationButton testID={testID} label={`${label}: ${selected}`} disabled={disabled} onPress={() => setOpen(true)} style={compact && styles.compactPicker}>
      <Text numberOfLines={1} style={[styles.buttonText, compact && styles.caption]}>{selected}</Text>
      <SymbolView name={{ ios: 'chevron.down', web: 'expand_more' }} size={16} tintColor={Colors.admin.textSecondary} />
    </ConversationButton>
    <ConversationDialog title={label} visible={open} onClose={() => setOpen(false)}>
      <ScrollView style={styles.pickerScroll} contentContainerStyle={styles.pickerOptions} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((option) => <Pressable key={option.value} testID={testID ? `${testID}-${option.value}` : undefined}
          accessibilityRole="radio" accessibilityLabel={option.label} accessibilityState={{ checked: value === option.value }}
          tabIndex={value === option.value ? 0 : -1}
          {...(Platform.OS === 'web' ? { onKeyDown: adminOptionKeys } : {})}
          onPress={() => { play('selection'); onChange(option.value); setOpen(false); }}
          style={({ pressed }) => [styles.option, value === option.value && styles.optionSelected, pressed && styles.pressed]}>
          <Text style={styles.body}>{option.label}</Text>
          {value === option.value && <SymbolView name={{ ios: 'checkmark', web: 'check' }} size={18} tintColor={Colors.admin.accent} />}
        </Pressable>)}
      </ScrollView>
    </ConversationDialog>
  </>;
}

export function ConversationState({ title, body, action, onAction, testID, loading = false }: {
  title: string; body?: string; action?: string; onAction?: () => void; testID?: string; loading?: boolean;
}) {
  return <View testID={testID} accessibilityLiveRegion="polite" accessibilityState={{ busy: loading }} style={styles.empty}>
    <SymbolView name={loading ? { ios: 'ellipsis.bubble', web: 'more_horiz' } : { ios: 'bubble.left.and.bubble.right', web: 'forum' }} size={28} tintColor={Colors.admin.textSecondary} />
    <Text style={styles.sectionTitle}>{title}</Text>
    {!!body && <Text style={[styles.caption, styles.centered]}>{body}</Text>}
    {!!action && !!onAction && <ConversationButton label={action} onPress={onAction} />}
  </View>;
}
