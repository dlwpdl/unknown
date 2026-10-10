import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { StateCard } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { adminOptionKeys } from '@/lib/admin';
import { loadTicketmasterRevenue, revenueMonths, type RevenueSnapshot, type RevenueTotals } from '@/lib/admin-ticketmaster';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

const METRICS: { key: keyof Omit<RevenueTotals, 'currency'>; label: string; detail: string }[] = [
  { key: 'pending', label: '확정 대기', detail: '변경·취소될 수 있는 수수료' },
  { key: 'approved', label: '승인 후 정산 대기', detail: '승인됐으며 아직 잔고에 반영되지 않은 금액' },
  { key: 'settled', label: '정산 완료', detail: 'Impact 잔고에 반영된 수수료' },
];

function money(value: string) {
  const [whole, fraction = ''] = value.split('.');
  return `${whole.startsWith('-') ? '-' : ''}${BigInt(whole.replace('-', '')).toLocaleString('ko-KR')}.${fraction.padEnd(2, '0')}`;
}

export function AdminTicketmasterView({ localPreview, refreshSignal = 0 }: { localPreview: boolean; refreshSignal?: number }) {
  const { play } = useInteractionFeedback();
  const months = revenueMonths();
  const [month, setMonth] = useState(months[0]);
  const [retry, setRetry] = useState(0);
  const [linkError, setLinkError] = useState(false);
  const [result, setResult] = useState<{ key: string; data: RevenueSnapshot | null; error: boolean } | null>(null);
  const key = `${month}:${retry}:${refreshSignal}`;
  const current = !localPreview && result?.key === key ? result : null;
  const data = current?.data;
  const loading = !localPreview && !current;
  const connected = !!data?.connected;

  useEffect(() => {
    let active = true;
    if (localPreview) return;
    void loadTicketmasterRevenue(supabase, month)
      .then((data) => { if (active) setResult({ key, data, error: false }); })
      .catch(() => { if (active) setResult({ key, data: null, error: true }); });
    return () => { active = false; };
  }, [key, localPreview, month]);

  const openImpact = async () => {
    play('selection'); setLinkError(false);
    try { await Linking.openURL('https://app.impact.com/'); }
    catch { setLinkError(true); play('warning'); }
  };
  return <View style={styles.section}>
    <View style={styles.heading}>
      <View style={styles.titleGroup}>
        <ThemedText accessibilityRole="header" style={styles.title}>Ticketmaster 수익</ThemedText>
        <ThemedText type="small" style={styles.muted}>글링에서 연결된 티켓 구매의 제휴 수수료입니다.</ThemedText>
      </View>
      <Pressable accessibilityRole="button" onPress={() => void openImpact()} style={({ pressed }) => [styles.button, styles.primary, pressed && styles.pressed]}>
        <ThemedText type="smallBold" style={styles.primaryText}>Impact 열기 ↗</ThemedText>
      </Pressable>
    </View>
    <View style={styles.heading}>
      <View accessibilityRole="tablist" accessibilityLabel="수수료 발생 월" style={styles.months}>
        {months.map((value) => <Pressable key={value} accessibilityRole="tab" aria-selected={month === value} accessibilityState={{ selected: month === value }} tabIndex={month === value ? 0 : -1}
          {...(Platform.OS === 'web' ? { onKeyDown: adminOptionKeys } : {})}
          onPress={() => { play('selection'); setMonth(value); }} style={({ pressed }) => [styles.button, month === value && styles.selected, pressed && styles.pressed]}>
          <ThemedText type="smallBold" style={month === value ? styles.accent : styles.muted}>{Number(value.slice(5))}월</ThemedText>
        </Pressable>)}
      </View>
      <Pressable accessibilityRole="button" disabled={loading || localPreview} accessibilityState={{ disabled: loading || localPreview, busy: loading }}
        onPress={() => { play('selection'); setRetry((value) => value + 1); }} style={({ pressed }) => [styles.button, (loading || localPreview) && styles.disabled, pressed && styles.pressed]}>
        <ThemedText type="smallBold">{loading ? '조회 중…' : '새로고침'}</ThemedText>
      </Pressable>
    </View>
    <ThemedText type="small" style={styles.muted}>{month.replace('-', '년 ')}월 발생 수수료 · 현재 상태 · UTC 기준</ThemedText>
    <View style={styles.metrics}>
      {METRICS.map((metric) => <View key={metric.key} style={styles.metric}>
        <ThemedText type="smallBold" style={styles.muted}>{metric.label}</ThemedText>
        {!connected ? <ThemedText style={styles.amount}>—</ThemedText> : data.totals.length ? data.totals.map((row) => <View key={row.currency} style={styles.moneyRow}>
          <ThemedText type="smallBold" style={styles.muted}>{row.currency}</ThemedText>
          <ThemedText style={styles.amount}>{money(row[metric.key])}</ThemedText>
        </View>) : <ThemedText style={styles.amount}>0</ThemedText>}
        <ThemedText type="small" style={styles.muted}>{metric.detail}</ThemedText>
      </View>)}
    </View>
    {loading ? <View style={styles.notice} accessibilityRole="progressbar" accessibilityLabel="Ticketmaster 수익 조회 중"><ThemedText style={styles.muted}>Impact에서 수익을 확인하고 있어요.</ThemedText></View>
      : current?.error ? <StateCard kind="error" title="수익을 불러오지 못했어요" body="현재 금액을 확인할 수 없습니다. 잠시 후 다시 시도하거나 Impact에서 확인해 주세요." actionLabel="다시 시도" onAction={() => setRetry((value) => value + 1)} />
      : !connected ? <StateCard kind="empty" title={localPreview ? '수익 화면 미리보기' : 'Impact 연결 준비 중'} body={localPreview ? '운영자 로그인과 Impact 연결 후 실제 수익이 표시됩니다.' : '정산 데이터를 아직 연결하지 않았습니다. 연결 전 금액은 표시하지 않습니다.'} />
      : !data.totals.length ? <StateCard kind="empty" title="이 달에는 발생한 수수료가 없어요" body="Ticketmaster 구매 수수료가 Impact에 등록되면 여기에 표시됩니다." /> : null}
    {connected && data.generatedAt && <ThemedText type="small" style={styles.muted}>마지막 갱신 {new Date(data.generatedAt).toLocaleString('ko-KR', { timeZone: 'UTC' })} UTC · 최대 5분 간격 갱신</ThemedText>}
    <View style={styles.note}>
      <ThemedText type="smallBold">정산·출금은 Impact에서</ThemedText>
      <ThemedText type="small" style={styles.muted}>선택한 달의 구매로 발생한 수수료를 보여줍니다. 정산 완료는 은행 입금과 다르며, 출금 가능 잔고와 지급 설정은 Impact에서 확인하세요. 통화는 합산하지 않습니다.</ThemedText>
    </View>
    {linkError && <ThemedText accessibilityRole="alert" style={styles.accent}>Impact를 열지 못했어요. 브라우저에서 app.impact.com에 접속해 주세요.</ThemedText>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: Spacing.four },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three, flexWrap: 'wrap' },
  titleGroup: { gap: Spacing.two, flexShrink: 1 },
  title: { fontSize: 28, lineHeight: 36, fontWeight: '700', letterSpacing: -0.6 },
  muted: { color: Colors.admin.textSecondary },
  accent: { color: Colors.admin.accent },
  months: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  button: { minHeight: 44, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 8, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.admin.card },
  primary: { backgroundColor: Colors.admin.accent, borderColor: Colors.admin.accent },
  primaryText: { color: Colors.admin.accentInk },
  selected: { borderColor: Colors.admin.accent, backgroundColor: Colors.admin.backgroundElement },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  metric: { flexGrow: 1, flexBasis: 240, minWidth: 0, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 16, padding: Spacing.four, gap: Spacing.three, backgroundColor: Colors.admin.card },
  moneyRow: { gap: Spacing.one },
  amount: { fontSize: 32, lineHeight: 40, fontWeight: '700', letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
  note: { gap: Spacing.two, paddingTop: Spacing.three, borderTopWidth: 1, borderTopColor: Colors.admin.line },
  notice: { padding: Spacing.four, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 16, alignItems: 'center' },
});
