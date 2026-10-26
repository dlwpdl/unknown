import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { StateCard } from '@/components/state-card';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { adminOptionKeys } from '@/lib/admin';
import { loadTicketmasterRevenue, revenueMonths, type RevenueSnapshot, type RevenueTotals } from '@/lib/admin-ticketmaster';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';
import { AdminButton, AdminCard, AdminFacts, AdminInfo } from './admin-ui';

const METRICS: { key: keyof Omit<RevenueTotals, 'currency'>; label: string; color: string }[] = [
  { key: 'pending', label: '확정 대기', color: Colors.admin.warning },
  { key: 'approved', label: '정산 대기', color: Colors.admin.accent },
  { key: 'settled', label: '정산 완료', color: Colors.admin.success },
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
  const monthLabel = `${Number(month.slice(5))}월`;

  useEffect(() => {
    let active = true;
    if (localPreview) return;
    void loadTicketmasterRevenue(supabase, month)
      .then((data) => { if (active) setResult({ key, data, error: false }); })
      .catch(() => { if (active) setResult({ key, data: null, error: true }); });
    return () => { active = false; };
  }, [key, localPreview, month]);

  const openImpact = async () => {
    setLinkError(false);
    try { await Linking.openURL('https://app.impact.com/'); }
    catch { setLinkError(true); play('warning'); }
  };
  const info = [
    '글링에서 연결된 티켓 구매의 제휴 수수료예요. 선택한 달의 구매로 생긴 수수료를 현재 상태로 보여줘요.',
    '정산 완료는 은행 입금과 달라요. 출금 가능 잔고와 지급 설정은 Impact에서 확인해 주세요.',
    '통화는 합산하지 않아요. 기간은 UTC 기준이에요.',
    ...(connected && data.generatedAt ? [`마지막 갱신 ${new Date(data.generatedAt).toLocaleString('ko-KR', { timeZone: 'UTC' })} UTC · 최대 5분 간격으로 갱신해요.`] : []),
  ];
  return <View style={styles.section}>
    <View style={styles.heading}>
      <ThemedText accessibilityRole="header" style={styles.title}>Ticketmaster 수익</ThemedText>
      <AdminButton label="Impact 열기 ↗" onPress={() => void openImpact()} />
    </View>
    <View style={styles.row}>
      <View accessibilityRole="tablist" accessibilityLabel="수수료 발생 월" style={styles.months}>
        {months.map((value) => <Pressable key={value} accessibilityRole="tab" aria-selected={month === value} accessibilityState={{ selected: month === value }} tabIndex={month === value ? 0 : -1}
          {...(Platform.OS === 'web' ? { onKeyDown: adminOptionKeys } : {})}
          onPress={() => { play('selection'); setMonth(value); }} style={({ pressed }) => [styles.month, month === value && styles.selected, pressed && styles.pressed]}>
          <ThemedText type="smallBold" style={month === value ? styles.accent : styles.muted}>{Number(value.slice(5))}월</ThemedText>
        </Pressable>)}
      </View>
      <AdminInfo label="수익 기준 보기" text={info} />
    </View>
    {loading ? <View style={styles.notice} accessibilityRole="progressbar" accessibilityLabel="Ticketmaster 수익 조회 중"><ThemedText style={styles.muted}>Impact에서 수익을 확인하고 있어요.</ThemedText></View>
      : current?.error ? <StateCard kind="error" title="수익을 불러오지 못했어요" body="지금은 금액을 확인할 수 없어요. 잠시 후 다시 시도하거나 Impact에서 확인해 주세요." actionLabel="다시 시도" onAction={() => { play('selection'); setRetry((value) => value + 1); }} />
      : !connected ? <StateCard kind="empty" title={localPreview ? '수익 화면 미리보기' : 'Impact 연결 준비 중'} body={localPreview ? '운영자 로그인과 Impact 연결 후 실제 수익이 보여요.' : '정산 데이터를 아직 연결하지 않았어요. 연결 전에는 금액을 보여주지 않아요.'} />
      : !data.totals.length ? <StateCard kind="empty" title="이 달에는 발생한 수수료가 없어요" body="Ticketmaster 구매 수수료가 Impact에 등록되면 여기에 보여요." />
      : <>
        <AdminFacts columns={3} items={METRICS.map((metric) => ({ label: metric.label, value: <View style={styles.amounts}>{data.totals.map((row) => <View key={row.currency} style={styles.moneyRow}>
          <ThemedText type="smallBold" style={styles.muted}>{row.currency}</ThemedText>
          <ThemedText style={styles.amount}>{money(row[metric.key])}</ThemedText>
        </View>)}</View> }))} />
        <AdminCard icon="$" tone="warning" title={`${monthLabel} 정산 흐름`}>
          {data.totals.map((row) => {
            const values = METRICS.map((metric) => Math.max(0, Number(row[metric.key]) || 0));
            const total = values.reduce((sum, value) => sum + value, 0);
            return <View key={row.currency} style={styles.flow}>
              {data.totals.length > 1 && <ThemedText type="smallBold" style={styles.muted}>{row.currency}</ThemedText>}
              <View style={styles.bar} accessibilityRole="image" accessibilityLabel={`${row.currency} ${METRICS.map((metric, index) => `${metric.label} ${total ? Math.round(values[index] / total * 100) : 0}%`).join(', ')}`}>
                {total > 0 && METRICS.map((metric, index) => values[index] > 0 && <View key={metric.key} style={{ flex: values[index], backgroundColor: metric.color }} />)}
              </View>
              <View style={styles.legend}>{METRICS.map((metric, index) => <View key={metric.key} style={styles.legendItem}>
                <View style={[styles.swatch, { backgroundColor: metric.color }]} />
                <ThemedText type="small" style={styles.muted}>{metric.label} {total ? Math.round(values[index] / total * 100) : 0}%</ThemedText>
              </View>)}</View>
            </View>;
          })}
        </AdminCard>
      </>}
    {linkError && <ThemedText accessibilityRole="alert" style={styles.accent}>Impact를 열지 못했어요. 브라우저에서 app.impact.com에 접속해 주세요.</ThemedText>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: Spacing.four },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three, flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap', zIndex: 5 },
  title: { fontSize: 28, lineHeight: 36, fontWeight: '700', letterSpacing: -0.6 },
  muted: { color: Colors.admin.textSecondary },
  accent: { color: Colors.admin.accent },
  months: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, padding: 3, borderRadius: 10, backgroundColor: Colors.admin.backgroundElement },
  month: { minHeight: 44, minWidth: 56, borderRadius: 8, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  selected: { backgroundColor: Colors.admin.card },
  pressed: { opacity: 0.7 },
  amounts: { gap: Spacing.two },
  moneyRow: { gap: Spacing.one },
  amount: { fontSize: 28, lineHeight: 36, fontWeight: '700', letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  flow: { gap: Spacing.two },
  bar: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: Colors.admin.backgroundElement },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  notice: { padding: Spacing.four, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 16, alignItems: 'center' },
});
