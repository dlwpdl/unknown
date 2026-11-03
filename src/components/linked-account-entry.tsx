import { useLanguage } from '@/hooks/use-language';
import { useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
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
  const { me } = useAuth(), theme = useTheme(), { play } = useInteractionFeedback(), reducedMotion = useReducedMotion();
  const [loaded, setLoaded] = useState<{ userId: string; accounts: LinkedAccount[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null), [failed, setFailed] = useState<string | null>(null);
  const switching = useRef(false);
  useFocusEffect(useCallback(() => {
    let active = true;
    void loadLinkedAccounts().then(accounts => { if (active) setLoaded({ userId: me.id, accounts }); }).catch(() => {});
    return () => { active = false; };
  }, [me.id]));
  const accounts = loaded?.userId === me.id ? loaded.accounts : [];
  if (!accounts.length) return null;
  async function open(account: LinkedAccount) {
    if (switching.current) return;
    switching.current = true; setBusy(account.id); setFailed(null); play('selection');
    try { await switchToAccount(account.id, me.nickname); }
    catch { setFailed(account.id); play('warning'); }
    finally { switching.current = false; setBusy(null); }
  }
  return <>{accounts.map(account => <Reanimated.View key={account.id} entering={reducedMotion ? FadeIn.duration(150) : FadeInDown.duration(250)}>
    <Pressable analyticsId="profile.linked-account" accessibilityRole="button" accessibilityLabel={tr('{0} 계정으로 전환', account.nickname)}
      disabled={busy !== null} accessibilityState={{ disabled: busy !== null, busy: busy === account.id }} onPress={() => { void open(account); }}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.backgroundSelected : theme.card }, busy !== null && { opacity: ControlMotion.disabledOpacity }]}>
      <View style={[styles.icon, { backgroundColor: theme.backgroundElement }]}><SymbolView name={{ ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' }} size={22} tintColor={theme.navy} /></View>
      <View style={styles.text}><ThemedText type="smallBold">{account.nickname}</ThemedText><ThemedText type="small" themeColor="textSecondary">{account.forward ? tr('다른 개인 계정 · 눌러서 전환') : tr('원래 계정으로 돌아가기')}</ThemedText></View>
      {busy === account.id ? <GlingLoader size={14} /> : <SymbolView name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} size={16} tintColor={theme.textSecondary} />}
    </Pressable>
    {failed === account.id && <ThemedText type="small" themeColor="danger" accessibilityRole="alert" style={styles.error}>{tr('전환하지 못했어요. 잠시 뒤 다시 해 주세요.')}</ThemedText>}
  </Reanimated.View>)}</>;
}

// Same measures as the profile screen's accountRow / accountIcon / accountText.
const styles = StyleSheet.create({
  row: { minHeight: 72, paddingHorizontal: Spacing.three, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: Spacing.one },
  // Starts under the row text, past the icon and its gap.
  error: { paddingLeft: Spacing.three + 32 + 12, paddingRight: Spacing.three, paddingBottom: 12 },
});
