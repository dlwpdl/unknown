import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { InviteQr, InviteStats, rewardName, useInviteShare } from '@/components/invite-parts';
import { MerchantBadge } from '@/components/merchant-ui';
import { RaisedActionButton } from '@/components/raised-action-button';
import { ThemedText } from '@/components/themed-text';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { createInviteLink, inviteUrl, loadBusinessInvite, rewardWeeks, type InviteSummary } from '@/lib/invites';
import { supabase } from '@/lib/supabase';

// The business's referral link under 계정 관리. One link per business, so the same link doubles as the shop's QR.
export function BusinessInviteCard({ merchantId }: { merchantId: string }) {
  const { tr, locale } = useLanguage();
  const theme = useTheme(), { play } = useInteractionFeedback(), share = useInviteShare();
  const [state, setState] = useState<{ id: string; value: InviteSummary } | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const working = useRef(false);
  useEffect(() => {
    let active = true;
    loadBusinessInvite(supabase, merchantId).then(value => { if (active) { setState({ id: merchantId, value }); setError(''); } },
      () => { if (active) setError('초대 정보를 불러오지 못했어요. 잠시 후 다시 열어 주세요.'); });
    return () => { active = false; };
  }, [merchantId]);
  const summary = state?.id === merchantId ? state.value : null;
  const sendLink = (code: string) => share(tr('글링에 우리 비즈니스도 같이 올려요. 이 링크로 가입하고 첫 글을 올리면 두 비즈니스 모두 비즈니스 2주 이용권을 받아요.'), inviteUrl(code));
  const date = (value: string) => new Date(value).toLocaleDateString(locale, { month: 'long', day: 'numeric' });

  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.line }]}>
    <View style={styles.row}>
      <ThemedText type="subtitle" accessibilityRole="header" style={styles.grow}>{tr('비즈니스 초대')}</ThemedText>
      {summary && <MerchantBadge label={tr('{0} / 8주', rewardWeeks(summary.grantedDays))} tone="accent" />}
    </View>
    <ThemedText type="small">{tr('내가 초대한 비즈니스가 글링에 첫 글을 올리면, 초대한 비즈니스와 초대받은 비즈니스 모두 비즈니스 2주 이용권을 받아요.')}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{tr('링크는 비즈니스마다 하나예요. QR로 계산대에 붙여 두면 이 링크로 몇 명이 가입했는지 볼 수 있어요.')}</ThemedText>
    {!!error && <ThemedText type="small" accessibilityRole="alert">{tr(error)}</ThemedText>}
    {summary && (summary.code ? <>
      <InviteQr url={inviteUrl(summary.code)} />
      <ThemedText selectable type="small" style={styles.center}>{inviteUrl(summary.code)}</ThemedText>
      <View style={styles.row}><RaisedActionButton compact analyticsId="business.invite.share" label={tr('링크 보내기')} onPress={() => { play('selection'); void sendLink(summary.code!); }} /></View>
      <InviteStats items={[[tr('가입한 사람'), summary.joined], [tr('이용권 받은 초대'), summary.rewarded]]} />
      {summary.rewards.map(reward => <ThemedText key={reward.startsAt} type="small" themeColor="textSecondary">{rewardName(reward, true, tr)} · {tr('{0} ~ {1}', date(reward.startsAt), date(reward.endsAt))}</ThemedText>)}
      {summary.activeUntil && <ThemedText type="small" themeColor="accent">{tr('{0}까지 비즈니스 이용권을 쓰고 있어요.', date(summary.activeUntil))}</ThemedText>}
    </> : <View style={styles.row}><RaisedActionButton compact analyticsId="business.invite.create" label={tr('초대 링크 만들기')} busy={busy}
      onPress={() => {
        play('selection');
        if (working.current) return;
        working.current = true; setBusy(true);
        void createInviteLink(supabase, merchantId).then(code => { setState({ id: merchantId, value: { ...summary, code } }); return sendLink(code); },
          () => { play('warning'); setError('초대 링크를 만들지 못했어요. 잠시 후 다시 시도해 주세요.'); })
          .finally(() => { working.current = false; setBusy(false); });
      }} /></View>)}
  </View>;
}

const styles = StyleSheet.create({
  card: { gap: 12, padding: 18, borderWidth: 1, borderRadius: 20 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  center: { textAlign: 'center' },
});
