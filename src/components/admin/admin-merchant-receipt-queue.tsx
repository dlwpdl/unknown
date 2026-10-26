import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AdminMerchantReviewContent } from '@/components/admin/admin-merchant-review-content';
import { AdminButton, AdminCard, AdminPill } from '@/components/admin/admin-ui';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { loadAdminMerchantReceiptReviews } from '@/lib/admin-data';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

const A = Colors.admin;
type Props = { refreshSignal: number; onUser: (id: string) => void; localPreview?: boolean; onCount?: (count: number, more: boolean) => void };
export function AdminMerchantReceiptQueue(props: Props) {
  const { me } = useAuth();
  return <ReceiptQueue key={me.id} {...props} />;
}
function ReceiptQueue({ refreshSignal, onUser, localPreview = false, onCount }: Props) {
  const { play } = useInteractionFeedback();
  const [page, setPage] = useState<Awaited<ReturnType<typeof loadAdminMerchantReceiptReviews>> | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const [picked, setPicked] = useState('');
  const request = useRef(0), reading = useRef(false);
  useEffect(() => {
    if (localPreview) return;
    const tracker = request, token = ++tracker.current; reading.current = true;
    void Promise.resolve().then(() => {
      if (token !== tracker.current) return null;
      setBusy(true); setError(''); return loadAdminMerchantReceiptReviews(supabase);
    }).then(next => { if (next && token === tracker.current) { setPage(next); onCount?.(next.reviews.length, next.has_more); } })
      .catch(() => { if (token === request.current) setError('검토 대기 후기를 불러오지 못했어요. 권한과 연결 상태를 확인해 주세요.'); })
      .finally(() => { if (token === request.current) { reading.current = false; setBusy(false); } });
    return () => { tracker.current++; };
    // onCount is a parent setter; re-reading on its identity would repeat the audited list read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localPreview, refreshSignal, revision]);
  async function more() {
    if (!page?.has_more || localPreview || reading.current) return;
    const token = ++request.current; reading.current = true; setBusy(true); setError('');
    try {
      const next = await loadAdminMerchantReceiptReviews(supabase, page.reviews.length);
      if (token === request.current) setPage(current => ({ has_more: next.has_more, reviews: [...(current?.reviews ?? []), ...next.reviews.filter(row => !current?.reviews.some(known => known.id === row.id))] }));
    } catch { if (token === request.current) { setError('다음 후기를 불러오지 못했어요. 지금 목록은 그대로 두었어요.'); play('warning'); } }
    finally { if (token === request.current) { reading.current = false; setBusy(false); } }
  }
  const rows = page?.reviews ?? [];
  const current = rows.find(row => row.id === picked) ?? rows[0];
  const proof = (kind: string) => kind === 'employment' ? '근무 증빙' : '영수증';
  return <View style={styles.queue}>
    {error ? <ThemedText type="small" accessibilityRole="alert" style={{ color: A.danger }}>{error}</ThemedText> : null}
    {notice ? <ThemedText type="small" accessibilityLiveRegion="polite">{notice}</ThemedText> : null}
    {localPreview && <ThemedText type="small">미리보기에서는 운영 후기를 조회하지 않아요.</ThemedText>}
    <View style={styles.split}>
      <AdminCard icon="✓" tone="warning" title="검토 대기" count={page ? `${rows.length}${page.has_more ? '+' : ''}` : undefined} style={styles.list}
        info={['신고가 없어도 제출한 영수증과 근무 증빙을 검토해요.', '미인증 근무 후기는 작성자와 관리자만 볼 수 있고, 미인증 상품·서비스 후기는 작성자·승인된 비즈니스 계정·관리자만 볼 수 있어요.']}
        action={<AdminButton label={busy ? '불러오는 중…' : '새로고침'} accessibilityLabel="검토 대기 후기 새로고침" disabled={busy || localPreview} onPress={() => setRevision(value => value + 1)} />}>
        {page && !rows.length && <ThemedText type="small" style={{ color: A.textSecondary }}>검토할 증빙이 없어요.</ThemedText>}
        {rows.map(row => <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={`${row.merchantName} ${proof(row.reviewKind)} 후기 검토`} accessibilityState={{ selected: row.id === current?.id }}
          onPress={() => { play('selection'); setPicked(row.id); setNotice(''); }} style={({ pressed }) => [styles.row, row.id === current?.id && styles.rowOn, { opacity: pressed ? 0.7 : 1 }]}>
          <ThemedText type="smallBold" numberOfLines={1}>{row.merchantName} · {row.score}/10</ThemedText>
          <ThemedText type="small" numberOfLines={1} style={{ color: A.textSecondary }}>{`${row.reviewKind === 'employment' ? '근무 후기' : '상품·서비스 후기'} · ${row.nickname} · ${new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(row.updatedAt))}`}</ThemedText>
        </Pressable>)}
        {page?.has_more && <AdminButton label="더 보기" accessibilityLabel="검토 대기 후기 더 보기" disabled={busy} onPress={() => more()} />}
      </AdminCard>
      {current && <AdminCard key={current.id} title={`${current.merchantName} · ${proof(current.reviewKind)} 후기`} style={styles.detail} action={<AdminPill label="검토 대기" tone="warning" />}>
        <AdminMerchantReviewContent targetId={current.id} onUser={onUser} localPreview={localPreview} autoLoad
          onChanged={() => { setNotice('검토 결과를 확인했어요. 대기 목록을 새로 불러와요.'); setRevision(value => value + 1); }} />
      </AdminCard>}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  queue: { gap: Spacing.three, paddingVertical: Spacing.three },
  split: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: Spacing.three },
  list: { flexGrow: 1, flexBasis: 280, maxWidth: 420 },
  detail: { flexGrow: 3, flexBasis: 420 },
  row: { minHeight: 52, justifyContent: 'center', gap: 2, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, borderRadius: 10 },
  rowOn: { backgroundColor: A.backgroundSelected },
});
