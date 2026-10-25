import { useEffect, useRef, useState } from 'react';
import { Platform, Share, StyleSheet, View } from 'react-native';

import { Pressable } from '@/components/analytics-controls';
import { MerchantBadge } from '@/components/merchant-ui';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { createMerchantOperatorLink, loadMerchantOperatorLinks, merchantOperatorInviteUrl, revokeMerchantOperatorLink, type MerchantOperatorLinks } from '@/lib/merchant-operators';
import { supabase } from '@/lib/supabase';

const errors: Record<string, string> = {
  MERCHANT_OPERATOR_PLAN_REQUIRED: '공동 관리자 초대는 유료 비즈니스 멤버십(플러스 이상)에서 쓸 수 있어요.',
  MERCHANT_OPERATOR_LIMIT: '지금 등급의 공동 관리자 자리를 모두 썼어요.',
  RATE_LIMITED: '초대 링크를 너무 많이 만들었어요. 내일 다시 시도해 주세요.',
};

// Owner-only card under 계정 관리: seats come from the server, the token is shown once at creation.
export function MerchantOperatorInvites({ merchantId, refreshSignal, onChanged }: { merchantId: string; refreshSignal: number; onChanged?: () => void }) {
  const { tr } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [state, setState] = useState<{ key: string; value: MerchantOperatorLinks } | null>(null);
  const [fresh, setFresh] = useState<{ url: string; copied: boolean } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const working = useRef(false), key = `${merchantId}:${refreshSignal}:${revision}`;
  useEffect(() => {
    let active = true;
    void loadMerchantOperatorLinks(supabase, merchantId).then(value => { if (active) { setState({ key, value }); setError(''); } })
      .catch(failure => { if (active) setError(errors[failure instanceof Error ? failure.message : ''] ?? '초대 정보를 불러오지 못했어요. 잠시 후 다시 열어 주세요.'); });
    return () => { active = false; };
  }, [merchantId, key]);
  async function run(operation: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try { await operation(); }
    catch (failure) { play('warning'); setError(errors[failure instanceof Error ? failure.message : ''] ?? '처리하지 못했어요. 잠시 후 다시 시도해 주세요.'); }
    finally { working.current = false; setBusy(false); }
  }
  async function share(url: string) {
    if (Platform.OS === 'web') { if (!navigator.clipboard?.writeText) throw new Error('CLIPBOARD_UNAVAILABLE'); await navigator.clipboard.writeText(url); }
    else await Share.share({ message: url });
    setFresh({ url, copied: true }); play('success');
  }
  const value = state?.key === key ? state.value : null;
  const used = value ? value.operators + value.links.length : 0;
  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <View style={styles.row}>
      <ThemedText type="subtitle" accessibilityRole="header" style={styles.grow}>{tr('공동 관리자 초대')}</ThemedText>
      {value && value.limit > 0 && <MerchantBadge label={tr('{0} / {1}명', used, value.limit)} tone={used >= value.limit ? 'warn' : 'accent'} />}
    </View>
    {!!error && <ThemedText type="small" accessibilityRole="alert">{tr(error)}</ThemedText>}
    {value && value.limit === 0 && <ThemedText type="small" themeColor="textSecondary">{tr('공동 관리자 초대는 유료 비즈니스 멤버십(플러스 이상)에서 쓸 수 있어요.')}</ThemedText>}
    {value && value.limit > 0 && <>
      <ThemedText type="small" themeColor="textSecondary">{tr('링크를 받은 사람이 글링에 로그인해 열면 공동 관리자가 돼요. 7일 동안 한 번만 쓸 수 있어요.')}</ThemedText>
      {fresh && <View style={[styles.link, { borderColor: theme.line, backgroundColor: theme.background }]}>
        <ThemedText type="small" selectable style={styles.grow} numberOfLines={2}>{fresh.url}</ThemedText>
        <SmallButton label={fresh.copied ? tr('복사했어요') : tr('복사')} disabled={busy} onPress={() => { void run(() => share(fresh.url)); }} />
      </View>}
      {used < value.limit && <View style={styles.row}><RaisedActionButton compact analyticsId="merchant.primary" label={tr('초대 링크 만들기')} disabled={busy}
        onPress={() => { play('selection'); void run(async () => { const link = await createMerchantOperatorLink(supabase, merchantId); const url = merchantOperatorInviteUrl(link.token); setFresh({ url, copied: false }); await share(url).catch(() => {}); setRevision(v => v + 1); onChanged?.(); }); }} /></View>}
      {value.links.map(link => <View key={link.id} style={[styles.row, styles.item, { borderColor: theme.line }]}>
        <View style={styles.grow}><ThemedText type="smallBold">{tr('보낸 초대 링크')}</ThemedText><ThemedText type="small" themeColor="textSecondary">{tr('{0}까지 사용할 수 있어요', new Date(link.expires_at).toLocaleDateString())}</ThemedText></View>
        <SmallButton label={tr('초대 취소')} disabled={busy} onPress={() => { void run(async () => { await revokeMerchantOperatorLink(supabase, link.id); setFresh(null); setRevision(v => v + 1); onChanged?.(); }); }} />
      </View>)}
    </>}
  </View>;
}

function SmallButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  return <Pressable analyticsId="merchant.connection.action" accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
    onPress={() => { play('selection'); onPress(); }} style={({ pressed }) => [styles.button, { borderColor: theme.line, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}><ThemedText type="smallBold">{label}</ThemedText></Pressable>;
}

const styles = StyleSheet.create({
  card: { gap: 12, padding: 18, borderWidth: 1, borderRadius: 20 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  item: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingLeft: 12, paddingRight: 6, paddingVertical: 6 },
  button: { minHeight: 44, minWidth: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
});
