import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n/ko';
import { useAuth } from '@/lib/auth';
import { blockUser, reportContent, type ReportReason, type ReportTarget } from '@/lib/community-data';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

const REASONS: ReportReason[] = ['spam', 'harassment', 'hate', 'sexual', 'privacy', 'other'];

export function ReportSheet({
  visible,
  targetType,
  targetId,
  reportedUserId,
  reportedNickname,
  onClose,
}: {
  visible: boolean;
  targetType: ReportTarget;
  targetId: string;
  reportedUserId: string;
  reportedNickname: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { me } = useAuth();
  const { play } = useInteractionFeedback();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [blockAfter, setBlockAfter] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    setReason(null);
    setDetails('');
    setBlockAfter(false);
    onClose();
  };

  const submit = async () => {
    if (!reason || submitting) return;
    setSubmitting(true);
    try {
      await reportContent(supabase, targetType, targetId, reason, details);
      if (blockAfter) {
        try {
          await blockUser(supabase, me.id, reportedUserId);
        } catch {
          close();
          play('warning');
          Alert.alert(t.report.doneTitle, t.report.doneButBlockFailed);
          return;
        }
      }
      close();
      play('warning');
      Alert.alert(t.report.doneTitle, blockAfter ? t.report.doneBlocked : t.report.doneBody);
    } catch {
      play('warning');
      Alert.alert(t.report.errorTitle, t.report.errorBody);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable
          style={styles.backdropDismiss}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={t.report.close}
        />
        <View
          accessibilityViewIsModal
          accessibilityLabel={t.report.title(reportedNickname)}
          style={[styles.sheet, { backgroundColor: theme.card, paddingBottom: Math.max(insets.bottom, Spacing.three) }]}>
          <View style={styles.header}>
            <View style={styles.copy}>
              <ThemedText type="subtitle">{t.report.title(reportedNickname)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{t.report.body}</ThemedText>
            </View>
            <Pressable onPress={close} accessibilityRole="button" hitSlop={12}>
              <ThemedText type="smallBold" themeColor="textSecondary">{t.report.close}</ThemedText>
            </Pressable>
          </View>

          <View style={styles.reasons} accessibilityRole="radiogroup">
            {REASONS.map((item) => {
              const selected = reason === item;
              return (
                <Pressable
                  key={item}
                  onPress={() => setReason(item)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[
                    styles.reason,
                    { borderColor: selected ? theme.accent : theme.line, backgroundColor: selected ? theme.backgroundElement : theme.card },
                  ]}>
                  <ThemedText type={selected ? 'smallBold' : 'small'}>{t.report.reasons[item]}</ThemedText>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            value={details}
            onChangeText={setDetails}
            maxLength={1000}
            multiline
            placeholder={t.report.details}
            placeholderTextColor={theme.textSecondary}
            accessibilityLabel={t.report.details}
            style={[styles.details, { color: theme.text, borderColor: theme.line, backgroundColor: theme.background }]}
          />

          {reportedUserId !== me.id && (
            <Pressable
              onPress={() => setBlockAfter((value) => !value)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: blockAfter }}
              style={styles.blockRow}>
              <View style={[styles.checkbox, { borderColor: blockAfter ? theme.accent : theme.line, backgroundColor: blockAfter ? theme.accent : theme.card }]}>
                {blockAfter && <ThemedText type="smallBold" style={{ color: theme.accentInk }}>✓</ThemedText>}
              </View>
              <View style={styles.copy}>
                <ThemedText type="smallBold">{t.report.block(reportedNickname)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{t.report.blockBody}</ThemedText>
              </View>
            </Pressable>
          )}

          <Pressable
            onPress={() => void submit()}
            disabled={!reason || submitting}
            accessibilityRole="button"
            accessibilityState={{ disabled: !reason || submitting, busy: submitting }}
            style={[styles.submit, { backgroundColor: theme.accent, opacity: !reason || submitting ? 0.55 : 1 }]}>
            <ThemedText type="smallBold" style={{ color: theme.accentInk }}>
              {submitting ? t.report.submitting : t.report.submit}
            </ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  backdropDismiss: { position: 'absolute', inset: 0 },
  sheet: { paddingHorizontal: Spacing.four, paddingTop: Spacing.four, gap: Spacing.three, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.three },
  copy: { flex: 1, gap: Spacing.one },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  reason: { minHeight: 42, justifyContent: 'center', paddingHorizontal: Spacing.three, borderWidth: 1, borderRadius: 8 },
  details: { minHeight: 88, padding: Spacing.three, textAlignVertical: 'top', borderWidth: 1, borderRadius: 8 },
  blockRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  checkbox: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 6 },
  submit: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
});
