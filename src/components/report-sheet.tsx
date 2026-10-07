import { Pressable } from '@/components/analytics-controls';
import { useState } from 'react';
import { Alert, Animated, Easing, Modal, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Depth, Spacing } from '@/constants/theme';
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
  const reducedMotion = useReducedMotion();
  const { height: screenHeight } = useWindowDimensions();
  const [sheetOffset] = useState(() => new Animated.Value(screenHeight));
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [blockAfter, setBlockAfter] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    const finish = () => {
      setReason(null);
      setDetails('');
      setBlockAfter(false);
      onClose();
    };
    if (reducedMotion) { finish(); return; }
    Animated.timing(sheetOffset, { toValue: screenHeight, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true })
      .start(({ finished }) => { if (finished) finish(); });
  };

  const submit = async () => {
    if (!reason || submitting) return;
    setSubmitting(true);
    try {
      await reportContent(supabase, targetType, targetId, reason, details, me.id);
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
      Alert.alert(t.report.doneTitle, blockAfter ? t.report.doneBlocked
        : targetType === 'user' ? '운영팀에 신고를 전달했어요. 활동 내역을 검토하겠습니다.' : t.report.doneBody);
    } catch {
      play('warning');
      Alert.alert(t.report.errorTitle, t.report.errorBody);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close}
      onShow={() => { sheetOffset.setValue(screenHeight); if (reducedMotion) sheetOffset.setValue(0); else Animated.timing(sheetOffset, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }}>
      <View style={styles.backdrop}>
        <View style={styles.scrim} />
        <Pressable analyticsId="components_report-sheet.pressable.1"
          style={styles.backdropDismiss}
          onPress={() => { play('selection'); close(); }}
          accessibilityRole="button"
          accessibilityLabel={t.report.close}
        />
        <Animated.View
          accessibilityViewIsModal
          accessibilityLabel={t.report.title(reportedNickname)}
          style={[styles.sheet, { backgroundColor: theme.card, paddingBottom: Math.max(insets.bottom, Spacing.three), transform: [{ translateY: sheetOffset }] }]}>
          <View style={styles.header}>
            <View style={styles.copy}>
              <ThemedText type="subtitle">{t.report.title(reportedNickname)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{t.report.body}</ThemedText>
            </View>
            <Pressable analyticsId="components_report-sheet.pressable.2" onPress={() => { play('selection'); close(); }} accessibilityRole="button" hitSlop={12} style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}>
              <ThemedText type="smallBold" themeColor="textSecondary">{t.report.close}</ThemedText>
            </Pressable>
          </View>

          <View style={styles.reasons} accessibilityRole="radiogroup">
            {REASONS.map((item) => {
              const selected = reason === item;
              return (
                <Pressable analyticsId="components_report-sheet.pressable.3"
                  key={item}
                  onPress={() => { play('selection'); setReason(item); }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.reason,
                    Depth.control,
                    { borderColor: selected ? theme.accent : theme.line, backgroundColor: selected ? theme.backgroundElement : theme.card, transform: [{ translateY: pressed ? 2 : 0 }] },
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
            <Pressable analyticsId="components_report-sheet.pressable.4"
                  onPress={() => { play('selection'); setBlockAfter((value) => !value); }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: blockAfter }}
                  style={({ pressed }) => [styles.blockRow, { opacity: pressed ? 0.65 : 1 }]}>
              <View style={[styles.checkbox, { borderColor: blockAfter ? theme.accent : theme.line, backgroundColor: blockAfter ? theme.accent : theme.card }]}>
                {blockAfter && <ThemedText type="smallBold" style={{ color: theme.accentInk }}>✓</ThemedText>}
              </View>
              <View style={styles.copy}>
                <ThemedText type="smallBold">{t.report.block(reportedNickname)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{t.report.blockBody}</ThemedText>
              </View>
            </Pressable>
          )}

          <Pressable analyticsId="components_report-sheet.pressable.5"
            onPress={() => { play('selection'); void submit(); }}
            disabled={!reason || submitting}
            accessibilityRole="button"
            accessibilityState={{ disabled: !reason || submitting, busy: submitting }}
            style={({ pressed }) => [styles.submit, Depth.control, { backgroundColor: theme.accent, borderBottomColor: theme.accentDepth, borderBottomWidth: 3, opacity: !reason || submitting ? 0.55 : 1, transform: [{ translateY: pressed ? 2 : 0 }] }]}>
            <ThemedText type="smallBold" style={{ color: theme.accentInk }}>
              {submitting ? t.report.submitting : t.report.submit}
            </ThemedText>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
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
