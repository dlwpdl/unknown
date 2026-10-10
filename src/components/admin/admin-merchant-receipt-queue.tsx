import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AdminMerchantReviewContent } from '@/components/admin/admin-merchant-review-content';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { loadAdminMerchantReceiptReviews } from '@/lib/admin-data';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

type Props = { refreshSignal: number; onUser: (id: string) => void; localPreview?: boolean };
export function AdminMerchantReceiptQueue(props: Props) {
  const { me } = useAuth();
  return <ReceiptQueue key={me.id} {...props} />;
}
function ReceiptQueue({ refreshSignal, onUser, localPreview = false }: Props) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [page, setPage] = useState<Awaited<ReturnType<typeof loadAdminMerchantReceiptReviews>> | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const request = useRef(0), reading = useRef(false);
  useEffect(() => {
    if (localPreview) return;
    const tracker = request, token = ++tracker.current; reading.current = true;
    void Promise.resolve().then(() => {
      if (token !== tracker.current) return null;
      setBusy(true); setError(''); return loadAdminMerchantReceiptReviews(supabase);
    }).then(next => { if (next && token === tracker.current) setPage(next); })
      .catch(() => { if (token === request.current) setError('검토 대기 후기를 불러오지 못했습니다. 권한과 연결 상태를 확인해주세요.'); })
      .finally(() => { if (token === request.current) { reading.current = false; setBusy(false); } });
    return () => { tracker.current++; };
  }, [localPreview, refreshSignal, revision]);
  async function more() {
    if (!page?.has_more || localPreview || reading.current) return;
    const token = ++request.current; reading.current = true; setBusy(true); setError(''); play('selection');
    try {
      const next = await loadAdminMerchantReceiptReviews(supabase, page.reviews.length);
      if (token === request.current) setPage(current => ({ has_more: next.has_more, reviews: [...(current?.reviews ?? []), ...next.reviews.filter(row => !current?.reviews.some(known => known.id === row.id))] }));
    } catch { if (token === request.current) { setError('다음 후기를 불러오지 못했습니다. 현재 목록은 유지했습니다.'); play('warning'); } }
    finally { if (token === request.current) { reading.current = false; setBusy(false); } }
  }
  const actionStyle = [styles.action, { borderColor: theme.line, backgroundColor: theme.card }, busy && { opacity: 0.5 }];
  return <View style={styles.queue}>
    <ThemedText type="subtitle" accessibilityRole="header">후기 증빙 검토</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">신고가 없어도 제출한 영수증과 근무 증빙을 검토합니다. 미인증 근무 후기는 작성자와 관리자만 볼 수 있고, 미인증 상품·서비스 후기는 작성자·승인된 업체 계정·관리자만 볼 수 있습니다.</ThemedText>
    <Pressable accessibilityRole="button" accessibilityLabel="검토 대기 후기 새로고침" disabled={busy || localPreview} accessibilityState={{ disabled: busy || localPreview }}
      onPress={() => { play('selection'); setRevision(value => value + 1); }} style={actionStyle}><ThemedText type="smallBold">{busy ? '불러오는 중…' : '대기 목록 새로고침'}</ThemedText></Pressable>
    {error ? <ThemedText type="small" accessibilityRole="alert">{error}</ThemedText> : null}
    {notice ? <ThemedText type="small" accessibilityLiveRegion="polite">{notice}</ThemedText> : null}
    {localPreview && <ThemedText type="small">미리보기에서는 운영 후기를 조회하지 않습니다.</ThemedText>}
    {page?.reviews.length === 0 && <ThemedText type="small">검토 대기 증빙이 없습니다.</ThemedText>}
    {page?.reviews.map(row => <View key={row.id} style={[styles.review, { borderColor: theme.line }]}>
      <ThemedText type="smallBold">{row.merchantName} · {row.score}/10</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{row.reviewKind === 'employment' ? '근무 후기' : '상품·서비스 후기'}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{row.nickname} · {new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(row.updatedAt))}</ThemedText>
      <ThemedText type="small" selectable>{row.body || '점수만 남긴 후기'}</ThemedText>
      <AdminMerchantReviewContent targetId={row.id} onUser={onUser} localPreview={localPreview || busy}
        onChanged={() => { setNotice('검토 결과를 확인했습니다. 대기 목록을 갱신합니다.'); setRevision(value => value + 1); }} />
    </View>)}
    {page?.has_more && <Pressable accessibilityRole="button" accessibilityLabel="검토 대기 후기 더 보기" disabled={busy} accessibilityState={{ disabled: busy }} onPress={() => more()} style={actionStyle}><ThemedText type="smallBold">검토 대기 후기 더 보기</ThemedText></Pressable>}
  </View>;
}
const styles = StyleSheet.create({
  queue: { gap: Spacing.three, paddingVertical: Spacing.three }, review: { gap: Spacing.two, paddingVertical: Spacing.three, borderTopWidth: 1 },
  action: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: Spacing.three, borderWidth: 1, borderRadius: 8 },
});
