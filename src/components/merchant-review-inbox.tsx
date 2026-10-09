import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Pressable } from '@/components/analytics-controls';
import { MerchantReviewCard } from '@/components/merchant-reviews';
import { ReportSheet } from '@/components/report-sheet';
import { ThemedText } from '@/components/themed-text';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadMyMerchantReviews, type MerchantReview } from '@/lib/merchant-reviews';
import { supabase } from '@/lib/supabase';

export function MerchantReviewInbox({ merchantId }: { merchantId: string }) {
  const { me, isAuthed } = useAuth();
  return <ScopedInbox key={`${merchantId}:${isAuthed ? me.id : 'guest'}`} merchantId={merchantId} />;
}

function ScopedInbox({ merchantId }: { merchantId: string }) {
  const theme = useTheme(), { play } = useInteractionFeedback(), { me } = useAuth();
  const hidden = useContentVisibility();
  const [rows, setRows] = useState<MerchantReview[]>([]), [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0), [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [report, setReport] = useState<MerchantReview | null>(null);
  const pending = useRef(true);
  useEffect(() => {
    let active = true;
    void loadMyMerchantReviews(supabase, merchantId, offset).then((page) => {
      if (!active) return;
      setRows((previous) => offset > 0 ? [...previous, ...page.reviews.filter((row) => !previous.some(({ id }) => id === row.id))] : page.reviews);
      setHasMore(page.has_more);
    }).catch(() => {
      if (active) { setRows([]); setHasMore(false); setError('후기를 불러오지 못했어요. 업체 소유 확인과 계정 권한을 다시 확인해 주세요.'); }
    }).finally(() => { if (active) { pending.current = false; setLoading(false); } });
    return () => { active = false; };
  }, [merchantId, offset, revision]);
  const refresh = () => { pending.current = true; setLoading(true); setError(''); setOffset(0); setRevision((value) => value + 1); };
  return <View style={[styles.section, { borderColor: theme.line, backgroundColor: theme.card }]}>
    <View style={styles.header}>
      <ThemedText type="subtitle">받은 후기</ThemedText>
      <Pressable analyticsId="merchant.reviews.refresh" accessibilityRole="button" disabled={loading} accessibilityState={{ disabled: loading }}
        style={styles.button} onPress={() => { play('selection'); refresh(); }}><ThemedText type="smallBold" themeColor="accent">새로 확인</ThemedText></Pressable>
    </View>
    <ThemedText type="small" themeColor="textSecondary">이용 리뷰는 미인증 의견도 확인할 수 있어요. 근무 리뷰는 근무 증빙 인증 후에만 보이며, 증빙 원본은 업체에 공개되지 않아요. 공개 평균은 종류별 인증 후기만 따로 계산해요.</ThemedText>
    {rows.filter((row) => !hidden('merchant_review', row.id, row.author_id)).map((row) => <MerchantReviewCard key={row.id} review={row}
      onReport={row.author_id === me.id ? undefined : () => setReport(row)} />)}
    {loading && <ThemedText type="small" accessibilityLiveRegion="polite">후기를 불러오는 중…</ThemedText>}
    {!loading && !rows.length && !error && <ThemedText type="small" themeColor="textSecondary">아직 받은 후기가 없어요.</ThemedText>}
    {!!error && <ThemedText type="small" accessibilityRole="alert">{error}</ThemedText>}
    {hasMore && !error && <Pressable analyticsId="merchant.reviews.more" accessibilityRole="button" disabled={loading} accessibilityState={{ disabled: loading }}
      style={styles.button} onPress={() => { play('selection'); if (pending.current) return; pending.current = true; setLoading(true); setOffset((value) => value + 20); }}>
      <ThemedText type="smallBold" themeColor="accent">후기 더 보기</ThemedText>
    </Pressable>}
    {report && <ReportSheet visible targetType="merchant_review" targetId={report.id} reportedUserId={report.author_id} reportedNickname={report.nickname}
      onClose={() => { setReport(null); refresh(); }} />}
  </View>;
}
const styles = StyleSheet.create({
  section: { padding: 16, gap: 12, borderWidth: 1, borderRadius: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  button: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 },
});
