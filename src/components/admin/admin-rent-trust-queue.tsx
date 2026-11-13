import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AdminButton, AdminCard, AdminPill } from '@/components/admin/admin-ui';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { reportReasonLabel } from '@/lib/admin';
import { loadAdminHeldListings, loadAdminListingCheckUrl, loadAdminListingPhotoChecks, resolveAdminHeldListing, reviewAdminListingPhotoCheck, type AdminHeldListing, type AdminListingPhotoCheck } from '@/lib/admin-data';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { formatMoney } from '@/lib/listing-details';
import { supabase } from '@/lib/supabase';

const A = Colors.admin;
const CATEGORY = { housing: '부동산', jobs: '구인구직', used: '중고거래' } as const;
const time = (value: string) => new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
type Props = { onUser: (id: string) => void; localPreview?: boolean };

// 신고 관리 위: 세 사람이 신고해 일단 숨김된 부동산·구인구직·중고거래 글, 그리고 렌트 확인 사진.
export function AdminRentTrustQueue(props: Props) {
  const { me } = useAuth();
  return <Queue key={me.id} {...props} />;
}

function Queue({ onUser, localPreview = false }: Props) {
  const { play } = useInteractionFeedback();
  const [held, setHeld] = useState<{ rows: AdminHeldListing[]; loadedAt: number } | null>(null);
  const [checks, setChecks] = useState<AdminListingPhotoCheck[] | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(''), [revision, setRevision] = useState(0);
  const [photo, setPhoto] = useState<{ path: string; url: string } | null>(null);
  const request = useRef(0);
  useEffect(() => {
    if (localPreview) return;
    const tracker = request, token = ++tracker.current;
    void Promise.all([loadAdminHeldListings(supabase), loadAdminListingPhotoChecks(supabase)])
      .then(([nextHeld, nextChecks]) => { if (token === tracker.current) { setHeld({ rows: nextHeld, loadedAt: Date.now() }); setChecks(nextChecks); } })
      .catch(() => { if (token === tracker.current) setError('숨김된 글과 확인 사진을 불러오지 못했어요. 권한과 연결 상태를 확인해 주세요.'); });
    return () => { tracker.current++; };
  }, [localPreview, revision]);

  async function run(key: string, action: () => Promise<void>, done: string) {
    if (busy) return;
    setBusy(key); setError(''); setNotice('');
    try { await action(); setNotice(done); setPhoto(null); setRevision(value => value + 1); }
    catch { play('warning'); setError('처리하지 못했어요. 새로고침해서 지금 상태를 다시 확인해 주세요.'); }
    finally { setBusy(''); }
  }
  async function openPhoto(path: string) {
    try { setPhoto({ path, url: await loadAdminListingCheckUrl(supabase, path) }); }
    catch { play('warning'); setError('확인 사진을 열지 못했어요.'); }
  }
  const resolve = (row: AdminHeldListing, action: 'restore' | 'remove' | 'fraud') => {
    if (action === 'fraud' && !window.confirm(`${row.title}\n${row.nickname}\n\n사기로 확정할까요? 같은 계정이 세 번 확정되면 부동산 글을 더 쓸 수 없어요.`)) return;
    void run(`${row.id}:${action}`, () => resolveAdminHeldListing(supabase, row.id, action),
      action === 'restore' ? '글을 되살렸어요. 신고는 기각으로 닫혔어요.' : action === 'fraud' ? '사기로 확정했어요. 글은 내려간 채로 있어요.' : '내림을 확정했어요.');
  };

  return <View style={styles.queue}>
    {error ? <ThemedText type="small" accessibilityRole="alert" style={{ color: A.danger }}>{error}</ThemedText> : null}
    {notice ? <ThemedText type="small" accessibilityLiveRegion="polite">{notice}</ThemedText> : null}
    {localPreview && <ThemedText type="small">미리보기에서는 운영 글을 조회하지 않아요.</ThemedText>}
    <View style={styles.split}>
      <AdminCard icon="!" tone="danger" title="일단 숨김된 글" count={held?.rows.length} style={styles.half}
        info={['가입 7일이 넘은 서로 다른 세 사람이 7일 안에 신고한 부동산·구인구직·중고거래 글은 모두에게서 바로 내려가요.', '24시간 안에 되살리거나 내림을 확정해 주세요. 사기로 세 번 확정된 계정은 부동산 글을 쓸 수 없어요.']}
        action={<AdminButton label="새로고침" accessibilityLabel="숨김된 글 새로고침" disabled={!!busy || localPreview} onPress={() => setRevision(value => value + 1)} />}>
        {held && !held.rows.length && <ThemedText type="small" style={{ color: A.textSecondary }}>지금 숨김된 글이 없어요.</ThemedText>}
        {held?.rows.map(row => {
          const late = held.loadedAt - new Date(row.heldAt).getTime() > 24 * 3600_000;
          return <View key={row.id} style={styles.item}>
            <View style={styles.itemHead}>
              <ThemedText type="smallBold" style={styles.flex} numberOfLines={2}>{row.title}</ThemedText>
              {late && <AdminPill label="24시간 지남" tone="danger" />}
            </View>
            <ThemedText type="small" style={{ color: A.textSecondary }}>
              {[CATEGORY[row.category], row.price != null ? formatMoney(Number(row.price)) : null, `숨김 ${time(row.heldAt)}`].filter(Boolean).join(' · ')}
            </ThemedText>
            <Pressable accessibilityRole="button" accessibilityLabel={`${row.nickname} 사용자 보기`} onPress={() => { play('selection'); onUser(row.authorId); }} style={styles.userLink}>
              <ThemedText type="smallBold" style={{ color: A.accent }}>{row.nickname}{row.authorFraudCount > 0 ? ` · 사기 확정 ${row.authorFraudCount}번` : ''} ›</ThemedText>
            </Pressable>
            {!!row.body && <ThemedText type="small" numberOfLines={4}>{row.body}</ThemedText>}
            {row.reports.map((report, index) => <ThemedText key={`${report.createdAt}:${index}`} type="small" style={{ color: A.textSecondary }}>
              {`신고 ${index + 1} · ${reportReasonLabel(report.reason)}${report.details ? ` · ${report.details}` : ''}`}
            </ThemedText>)}
            <View style={styles.actions}>
              <AdminButton label="되살리기" busy={busy === `${row.id}:restore`} disabled={!!busy} onPress={() => resolve(row, 'restore')} />
              <AdminButton label="내림 확정" busy={busy === `${row.id}:remove`} disabled={!!busy} onPress={() => resolve(row, 'remove')} />
              <AdminButton label="사기 확정" kind="danger" busy={busy === `${row.id}:fraud`} disabled={!!busy} onPress={() => resolve(row, 'fraud')} />
            </View>
          </View>;
        })}
      </AdminCard>
      <AdminCard icon="✓" tone="warning" title="렌트 확인 사진" count={checks?.length} style={styles.half}
        info={['작성자가 닉네임과 날짜를 적은 종이를 방 안에서 찍은 사진이에요. 글에는 붙지 않고 작성자와 관리자만 열 수 있어요.', '사진을 열 때마다 기록이 남아요. 확인하면 글에 ‘글쓴이가 방 안에 있었음 · 날짜’가 붙어요.']}>
        {checks && !checks.length && <ThemedText type="small" style={{ color: A.textSecondary }}>확인할 사진이 없어요.</ThemedText>}
        {checks?.map(row => <View key={row.postId} style={styles.item}>
          <ThemedText type="smallBold" numberOfLines={2}>{row.title}</ThemedText>
          <ThemedText type="small" style={{ color: A.textSecondary }}>{[row.nickname, row.price != null ? formatMoney(Number(row.price)) : null, `올림 ${time(row.submittedAt)}`].filter(Boolean).join(' · ')}</ThemedText>
          {photo?.path === row.photoPath
            ? <Image source={{ uri: photo.url }} contentFit="contain" style={styles.photo} accessibilityLabel={`${row.nickname} 확인 사진`} />
            : <AdminButton label="사진 열기" accessibilityLabel={`${row.nickname} 확인 사진 열기`} disabled={!!busy} onPress={() => void openPhoto(row.photoPath)} />}
          <View style={styles.actions}>
            <AdminButton label="사진 확인 달기" kind="primary" busy={busy === `${row.postId}:yes`} disabled={!!busy || photo?.path !== row.photoPath}
              onPress={() => void run(`${row.postId}:yes`, () => reviewAdminListingPhotoCheck(supabase, row.postId, true), '사진 확인을 달았어요.')} />
            <AdminButton label="반려" busy={busy === `${row.postId}:no`} disabled={!!busy}
              onPress={() => void run(`${row.postId}:no`, () => reviewAdminListingPhotoCheck(supabase, row.postId, false), '반려했어요. 글에는 아무것도 붙지 않아요.')} />
          </View>
        </View>)}
      </AdminCard>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  queue: { gap: Spacing.two, paddingTop: Spacing.three },
  split: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: Spacing.three },
  half: { flexGrow: 1, flexBasis: 360 },
  item: { gap: 4, paddingVertical: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: A.line },
  itemHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  flex: { flex: 1, minWidth: 0 },
  userLink: { minHeight: 32, justifyContent: 'center', alignSelf: 'flex-start' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: 4 },
  photo: { width: '100%', height: 320, borderRadius: 10, backgroundColor: A.backgroundElement },
});
