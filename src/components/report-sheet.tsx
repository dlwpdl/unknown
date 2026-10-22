import { useLanguage } from '@/hooks/use-language';
import { Pressable } from '@/components/analytics-controls';
import { useLayoutEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Depth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useChatIdentity } from '@/hooks/use-chat-identity';
import { chatBusinessIdentity } from '@/lib/chat-identity';
import { useAuth } from '@/lib/auth';
import { blockBusiness, blockUser, reportContent, type ConversationPreview, type ReportReason, type ReportTarget } from '@/lib/community-data';
import { blockBusinessConversation, reportBusinessChatMessage } from '@/lib/business-chat';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

const REASONS: ReportReason[] = ['spam', 'harassment', 'hate', 'sexual', 'privacy', 'other'];

export function ReportSheet({
  visible,
  targetType,
  targetId,
  reportedUserId,
  reportedBusinessId,
  reportedNickname = '비즈니스 답변',
  businessConversation,
  onClose,
}: {
  visible: boolean;
  targetType: ReportTarget;
  targetId: string;
  reportedUserId?: string;
  reportedBusinessId?: string;
  reportedNickname?: string;
  businessConversation?: ConversationPreview;
  onClose: () => void;
}) {
  const { tr, t } = useLanguage();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { me } = useAuth();
  const asBusinessId = useChatIdentity()?.id ?? null;
  const { play } = useInteractionFeedback();
  const reducedMotion = useReducedMotion();
  const { height: screenHeight } = useWindowDimensions();
  const [sheetOffset] = useState(() => new Animated.Value(screenHeight));
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [blockAfter, setBlockAfter] = useState(false);
  const scopeKey = `${me.id}:${asBusinessId ?? 'personal'}:${targetType}:${targetId}:${businessConversation?.id ?? ''}:${visible}`;
  const [submission, setSubmission] = useState({ scope: scopeKey, busy: false });
  if (submission.scope !== scopeKey) setSubmission({ scope: scopeKey, busy: false });
  const submitting = submission.scope === scopeKey && submission.busy;
  const request = useRef<{ active: boolean; busy: boolean } | null>(null);
  useLayoutEffect(() => {
    const operation = { active: visible, busy: false };
    request.current = operation;
    return () => { operation.active = false; if (request.current === operation) request.current = null; };
  }, [visible, scopeKey]);

  const close = () => {
    const operation = request.current;
    if (!operation?.active) return;
    operation.active = false;
    const finish = () => {
      if (request.current !== operation) return;
      setReason(null);
      setDetails('');
      setBlockAfter(false);
      setSubmission({ scope: scopeKey, busy: false });
      onClose();
    };
    if (reducedMotion) { finish(); return; }
    Animated.timing(sheetOffset, { toValue: screenHeight, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true })
      .start(({ finished }) => { if (finished) finish(); });
  };

  const submit = async () => {
    const operation = request.current;
    const valid = () => !!operation?.active && request.current === operation && (chatBusinessIdentity(me.id)?.id ?? null) === asBusinessId;
    if (!reason || !operation || operation.busy || !valid()) return;
    if (businessConversation && (chatBusinessIdentity(me.id)?.id ?? null) !== (businessConversation.selfIdentity?.kind === 'business' ? businessConversation.selfIdentity.id : null)) return;
    operation.busy = true;
    setSubmission({ scope: scopeKey, busy: true });
    try {
      if (businessConversation) await reportBusinessChatMessage(supabase, businessConversation, targetId, reason, details);
      else await reportContent(supabase, targetType, targetId, reason, details, me.id);
      if (!valid()) return;
      if (blockAfter && (reportedUserId || reportedBusinessId)) {
        try {
          if (businessConversation) await blockBusinessConversation(supabase, businessConversation);
          else if (reportedBusinessId) await blockBusiness(supabase, me.id, reportedBusinessId);
          else await blockUser(supabase, me.id, reportedUserId!);
        } catch {
          if (!valid()) return;
          close();
          play('warning');
          Alert.alert(t.report.doneTitle, t.report.doneButBlockFailed);
          return;
        }
      }
      if (!valid()) return;
      close();
      play('warning');
      Alert.alert(t.report.doneTitle, blockAfter ? t.report.doneBlocked
        : targetType === 'user' ? tr("운영팀에 신고를 전달했어요. 활동 내역을 검토하겠습니다.") : t.report.doneBody);
    } catch {
      if (!valid()) return;
      play('warning');
      Alert.alert(t.report.errorTitle, t.report.errorBody);
    } finally {
      operation.busy = false;
      if (valid()) setSubmission({ scope: scopeKey, busy: false });
    }
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close}
      onShow={() => { sheetOffset.setValue(screenHeight); if (reducedMotion) sheetOffset.setValue(0); else Animated.timing(sheetOffset, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.backdrop, { paddingTop: insets.top }]}>
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

          <ScrollView style={styles.formScroll} contentContainerStyle={styles.formContent}
            keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
          <View style={styles.reasons} accessibilityRole="radiogroup">
            {REASONS.map((item) => {
              const selected = reason === item;
              return (
                <Pressable lens analyticsId="components_report-sheet.pressable.3"
                  key={item}
                  onPress={() => { play('selection'); setReason(item); }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [
                    styles.reason,
                    Depth.control,
                    { borderColor: selected ? theme.accent : theme.line, backgroundColor: selected ? theme.backgroundElement : theme.card, },
                  ]}>
                  <ThemedText type={selected ? 'smallBold' : 'small'}>{t.report.reasons[item]}</ThemedText>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            value={details}
            onChangeText={setDetails}
            onFocus={() => play('selection')}
            maxLength={1000}
            multiline
            placeholder={t.report.details}
            placeholderTextColor={theme.textSecondary}
            accessibilityLabel={t.report.details}
            style={[styles.details, { color: theme.text, borderColor: theme.line, backgroundColor: theme.background }]}
          />

          {!!(reportedBusinessId || reportedUserId) && reportedUserId !== me.id && (
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
          </ScrollView>

          <Pressable lens analyticsId="components_report-sheet.pressable.5"
            onPress={() => { play('selection'); void submit(); }}
            disabled={!reason || submitting}
            accessibilityRole="button"
            accessibilityState={{ disabled: !reason || submitting, busy: submitting }}
            style={({ pressed }) => [styles.submit, Depth.control, { backgroundColor: theme.accent, borderBottomColor: theme.accentDepth, borderBottomWidth: 3, opacity: !reason || submitting ? 0.55 : 1, }]}>
            <ThemedText type="smallBold" style={{ color: theme.accentInk }}>
              {submitting ? t.report.submitting : t.report.submit}
            </ThemedText>
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
  backdropDismiss: { position: 'absolute', inset: 0 },
  sheet: { maxHeight: '100%', paddingHorizontal: Spacing.four, paddingTop: Spacing.four, gap: Spacing.three, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  formScroll: { flexGrow: 0, flexShrink: 1 },
  formContent: { gap: Spacing.three },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.three },
  copy: { flex: 1, gap: Spacing.one },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  reason: { minHeight: 42, justifyContent: 'center', paddingHorizontal: Spacing.three, borderWidth: 1, borderRadius: 8 },
  details: { minHeight: 88, maxHeight: 160, padding: Spacing.three, textAlignVertical: 'top', borderWidth: 1, borderRadius: 8 },
  blockRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  checkbox: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 6 },
  submit: { minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
});
