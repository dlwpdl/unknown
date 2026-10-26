import { useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { Modal, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdminButton, AdminDock, AdminInfo } from '@/components/admin/admin-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { loadAdminMerchantReceiptUrl, loadAdminMerchantReviewContent, setAdminMerchantReviewReceipt, type AdminMerchantReviewContent as Review } from '@/lib/admin-data';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

// autoLoad: the receipt queue opens the review the admin picked; report and alert screens keep the explicit read button.
type Props = { targetId: string; localPreview?: boolean; autoLoad?: boolean; onUser: (id: string) => void; onChanged?: () => void };
export function AdminMerchantReviewContent(props: Props) {
  const { me } = useAuth();
  return <ReviewContent key={`${me.id}:${props.targetId}`} {...props} />;
}
function ReviewContent({ targetId, localPreview = false, autoLoad = false, onUser, onChanged }: Props) {
  const { play } = useInteractionFeedback(), theme = useTheme();
  const [content, setContent] = useState<Review | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [note, setNote] = useState(''), [notice, setNotice] = useState('');
  const [receipt, setReceipt] = useState<{ key: string; uri: string } | null>(null), [seenReceipt, setSeenReceipt] = useState(''), [preview, setPreview] = useState(false);
  const reading = useRef(false), mounted = useRef(true);
  const employment = content?.reviewKind === 'employment', proofLabel = employment ? '근무 증빙' : '영수증';
  const receiptKey = content ? JSON.stringify([targetId, content.receiptPath, content.updatedAt]) : '';
  const noteLength = Array.from(note.trim()).length;
  const canConfirm = content?.status === 'published' && !!content.receiptPath && seenReceipt === receiptKey && noteLength >= 5 && noteLength <= 1000 && !busy && !localPreview;
  const shownReceipt = receipt?.key === receiptKey ? receipt.uri : '';
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- read once when the queue mounts this review; load() guards duplicates itself.
  useEffect(() => { if (autoLoad) void load(); }, [autoLoad]);
  async function load() {
    if (localPreview || reading.current) return;
    reading.current = true; setBusy(true); setError(''); setNotice(''); setContent(null); setReceipt(null); setSeenReceipt('');
    try {
      const next = await loadAdminMerchantReviewContent(supabase, targetId);
      if (!mounted.current) return;
      setContent(next);
      if (!next) { setError('후기를 찾을 수 없어요.'); play('warning'); }
    } catch {
      if (mounted.current) { setError('후기 원문을 불러오지 못했어요. 관리자 권한과 연결 상태를 확인해 주세요.'); play('warning'); }
    } finally {
      reading.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function openReceipt() {
    if (!content?.receiptPath || localPreview || reading.current) return;
    reading.current = true; setBusy(true); setError(''); setSeenReceipt('');
    try {
      const uri = await loadAdminMerchantReceiptUrl(supabase, content.receiptPath);
      if (mounted.current) setReceipt({ key: receiptKey, uri });
    } catch {
      if (mounted.current) { setError(`${proofLabel}을 불러오지 못했어요. 관리자 권한과 연결 상태를 확인해 주세요.`); play('warning'); }
    } finally { reading.current = false; if (mounted.current) setBusy(false); }
  }
  async function confirmReceipt(verified: boolean) {
    if (!content || !canConfirm || reading.current) return;
    reading.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await setAdminMerchantReviewReceipt(supabase, targetId, content, verified, note);
      const next = await loadAdminMerchantReviewContent(supabase, targetId);
      if (!mounted.current) return;
      if (!next || next.reviewKind !== content.reviewKind || next.receiptPath !== content.receiptPath || next.receiptStatus !== (verified ? 'verified' : 'rejected')) throw new Error('MERCHANT_REVIEW_RECEIPT_NOT_VERIFIED');
      setContent(next); setNote(''); setReceipt(null); setSeenReceipt(''); setNotice(verified ? `${proofLabel} 인증을 확인했어요.` : `${proofLabel} 인증 거절을 확인했어요.`); play('success'); onChanged?.();
    } catch {
      if (mounted.current) { setError('검토 결과를 확인하지 못했어요. 메모는 그대로 두었어요. 최신 후기를 다시 불러와 확인해 주세요.'); play('warning'); }
    } finally { reading.current = false; if (mounted.current) setBusy(false); }
  }
  const proofImage = (style: object) => <Image source={{ uri: shownReceipt }} accessibilityLabel={`검토용 비공개 ${proofLabel}`} contentFit="contain" style={style}
    onLoad={() => setSeenReceipt(receiptKey)} onError={() => { setSeenReceipt(''); setReceipt(null); setPreview(false); setError(`${proofLabel} 사진을 확인하지 못했어요. 다시 불러와 주세요.`); play('warning'); }} />;
  return <View style={styles.content}>
    {!content && <AdminButton label={busy ? '후기 불러오는 중…' : '후기 원문 보기'} accessibilityLabel="후기 원문 보기" disabled={localPreview || busy} onPress={() => load()} />}
    {error ? <ThemedText type="small" accessibilityRole="alert" style={{ color: theme.danger }}>{error}</ThemedText> : null}
    {notice ? <ThemedText type="small" accessibilityLiveRegion="polite">{notice}</ThemedText> : null}
    {content && <>
      <View style={styles.columns}>
        <View style={styles.column}>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>후기</ThemedText>
          <ThemedText type="small" selectable style={[styles.quote, { backgroundColor: theme.backgroundElement, borderColor: theme.line }]}>{content.text}</ThemedText>
          <ThemedText type="small" style={{ color: theme.textSecondary }}>{employment ? '근무 후기' : '상품·서비스 후기'} · 지금 {content.status === 'removed' ? '숨김' : content.receiptStatus === 'verified' ? '공개' : employment ? '비공개' : '작성자·비즈니스만 보기'}</ThemedText>
          <AdminButton kind="text" label="작성자 이력 보기 →" accessibilityLabel="후기 작성자 이력 보기" onPress={() => onUser(content.authorId)} />
        </View>
        <View style={styles.column}>
          <View style={styles.proofHead}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>{proofLabel} · {({ none: '없음', pending: '검토 대기', verified: '인증됨', rejected: '인증 거절' })[content.receiptStatus ?? 'none']}</ThemedText>
            {!!content.receiptPath && <AdminInfo label={`${proofLabel} 검토 기준`} text={employment
              ? '근무 증빙은 작성자와 관리자만 볼 수 있어요. 회사·근무자·근무 이력을 확인하고, 작성자와 근무자가 일치하는지 확인해 주세요. 신분증·은행계좌번호·불필요한 급여 정보는 필요하지 않아요.'
              : '영수증은 작성자와 관리자만 볼 수 있어요. 비즈니스명·이용일·금액을 확인한 뒤 검토 메모를 남겨 주세요.'} />}
          </View>
          {!!content.receiptPath && (shownReceipt
            ? <>{proofImage(styles.image)}<AdminButton kind="text" label="크게 보기" accessibilityLabel={`${proofLabel} 크게 보기`} onPress={() => setPreview(true)} /></>
            : <AdminButton label={`${proofLabel} 보기`} disabled={busy || localPreview} onPress={() => openReceipt()} />)}
          {content.receiptReviewNote && <ThemedText type="small" selectable>최근 검토 메모 · {content.receiptReviewNote}</ThemedText>}
        </View>
      </View>
      {!!content.receiptPath && <AdminDock>
        <TextInput accessibilityLabel={`${proofLabel} 검토 메모`} value={note} editable={!busy} onFocus={() => play('selection')} onChangeText={setNote} maxLength={1000} multiline
          placeholder="판단 근거를 5자 이상 남겨 주세요" placeholderTextColor={theme.textSecondary} style={[styles.note, { color: theme.text, backgroundColor: theme.card, borderColor: theme.line }]} />
        <View style={styles.actions}>
          <AdminButton kind="danger" label="인증 거절" accessibilityLabel={`${proofLabel} 인증 거절`} disabled={!canConfirm} onPress={() => confirmReceipt(false)} />
          <AdminButton kind="primary" label={`${proofLabel} 인증`} disabled={!canConfirm} onPress={() => confirmReceipt(true)} />
        </View>
      </AdminDock>}
    </>}
    <Modal visible={preview && !!shownReceipt} onRequestClose={() => { play('selection'); setPreview(false); }} animationType="fade">
      <SafeAreaView style={[styles.preview, { backgroundColor: theme.background }]}>
        <View style={styles.close}><AdminButton label={`${proofLabel} 닫기`} onPress={() => setPreview(false)} /></View>
        {!!shownReceipt && proofImage(styles.full)}
      </SafeAreaView>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  content: { gap: Spacing.two, alignItems: 'stretch' },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  column: { flexGrow: 1, flexBasis: 260, minWidth: 0, gap: Spacing.two, alignItems: 'flex-start' },
  proofHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  quote: { alignSelf: 'stretch', padding: Spacing.three, borderWidth: 1, borderRadius: 10 },
  image: { alignSelf: 'stretch', height: 260, borderRadius: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginLeft: 'auto' },
  note: { flexGrow: 1, flexBasis: 240, minHeight: 44, padding: Spacing.two, borderWidth: 1, borderRadius: 8, textAlignVertical: 'top' },
  preview: { flex: 1, padding: Spacing.three, gap: Spacing.two }, close: { alignSelf: 'flex-end' }, full: { flex: 1, width: '100%' },
});
