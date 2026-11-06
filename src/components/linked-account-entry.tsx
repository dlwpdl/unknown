import { useLanguage } from '@/hooks/use-language';
import { useClayBox } from '@/components/clay';
import { useFocusEffect } from 'expo-router';
import { SymbolView } from '@/components/symbol-view';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import Reanimated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { AdminMfaGate } from '@/components/admin/admin-mfa-gate';
import { Pressable } from '@/components/analytics-controls';
import { GlingLoader } from '@/components/gling-loader';
import { ThemedText } from '@/components/themed-text';
import { ControlMotion } from '@/constants/design-system';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadLinkedAccounts, switchToAccount, type LinkedAccount } from '@/lib/linked-accounts';

/** Other personal accounts of the owner, and the account this device came from. Nothing for ordinary members. */
export function LinkedAccountEntry() {
  const { tr } = useLanguage();
  const { me } = useAuth(), theme = useTheme(), clayBox = useClayBox(), { play } = useInteractionFeedback(), reducedMotion = useReducedMotion();
  const [loaded, setLoaded] = useState<{ userId: string; accounts: LinkedAccount[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null), [failed, setFailed] = useState<string | null>(null);
  const [mfaFor, setMfaFor] = useState<LinkedAccount | null>(null);
  const switching = useRef(false);
  useFocusEffect(useCallback(() => {
    let active = true;
    void loadLinkedAccounts().then(accounts => { if (active) setLoaded({ userId: me.id, accounts }); }).catch(() => {});
    return () => { active = false; };
  }, [me.id]));
  const accounts = loaded?.userId === me.id ? loaded.accounts : [];
  if (!accounts.length) return null;
  async function open(account: LinkedAccount, afterMfa = false) {
    if (switching.current) return;
    switching.current = true; setBusy(account.id); setFailed(null); play('selection');
    try { await switchToAccount(account.id, me.nickname); }
    // One second-factor prompt per tap: a refusal right after passing it is shown as a failure, never a loop.
    catch (error) { if (!afterMfa && error instanceof Error && error.message === 'MFA_REQUIRED') setMfaFor(account); else { setFailed(account.id); play('warning'); } }
    finally { switching.current = false; setBusy(null); }
  }
  return <>
    <Modal visible={!!mfaFor} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setMfaFor(null)}>
      <AdminMfaGate><MfaPassed onPassed={() => { const account = mfaFor; setMfaFor(null); if (account) void open(account, true); }} /></AdminMfaGate>
    </Modal>
    {accounts.map(account => <Reanimated.View key={account.id} entering={reducedMotion ? FadeIn.duration(150) : FadeInDown.duration(250)}>
    <Pressable analyticsId="profile.linked-account" accessibilityRole="button" accessibilityLabel={tr('{0} 계정으로 전환', account.nickname)}
      disabled={busy !== null} accessibilityState={{ disabled: busy !== null, busy: busy === account.id }} onPress={() => { void open(account); }}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.backgroundSelected : clayBox ? 'transparent' : theme.card }, busy !== null && { opacity: ControlMotion.disabledOpacity }]}>
      <View style={[styles.icon, { backgroundColor: theme.backgroundElement }]}><SymbolView name={{ ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' }} size={22} tintColor={theme.navy} /></View>
      <View style={styles.text}><ThemedText type="smallBold">{account.nickname}</ThemedText><ThemedText type="small" themeColor="textSecondary">{account.forward ? tr('다른 개인 계정 · 눌러서 전환') : tr('원래 계정으로 돌아가기')}</ThemedText></View>
      {busy === account.id ? <GlingLoader size={14} /> : <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={16} tintColor={theme.textSecondary} />}
    </Pressable>
    {failed === account.id && <ThemedText type="small" themeColor="danger" accessibilityRole="alert" style={styles.error}>{tr('전환하지 못했어요. 잠시 뒤 다시 해 주세요.')}</ThemedText>}
  </Reanimated.View>)}</>;
}

/** Rendered by the gate once this session has passed the second factor; continues the tap that asked for it. */
function MfaPassed({ onPassed }: { onPassed: () => void }) {
  const done = useRef(false);
  useEffect(() => { if (!done.current) { done.current = true; onPassed(); } }, [onPassed]);
  return null;
}

// Same measures as the profile screen's accountRow / accountIcon / accountText.
const styles = StyleSheet.create({
  row: { minHeight: 72, paddingHorizontal: Spacing.three, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: Spacing.one },
  // Starts under the row text, past the icon and its gap.
  error: { paddingLeft: Spacing.three + 32 + 12, paddingRight: Spacing.three, paddingBottom: 12 },
});
