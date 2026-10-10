import { useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { loadAdminMerchantReceiptUrl, loadAdminMerchantReviewContent, setAdminMerchantReviewReceipt, type AdminMerchantReviewContent as Review } from '@/lib/admin-data';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

type Props = { targetId: string; localPreview?: boolean; onUser: (id: string) => void; onChanged?: () => void };
export function AdminMerchantReviewContent(props: Props) {
  const { me } = useAuth();
  return <ReviewContent key={`${me.id}:${props.targetId}`} {...props} />;
}
function ReviewContent({ targetId, localPreview = false, onUser, onChanged }: Props) {
  const { play } = useInteractionFeedback(), theme = useTheme();
  const [content, setContent] = useState<Review | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [note, setNote] = useState(''), [notice, setNotice] = useState('');
  const [receipt, setReceipt] = useState<{ key: string; uri: string } | null>(null), [seenReceipt, setSeenReceipt] = useState(''), [preview, setPreview] = useState(false);
  const reading = useRef(false), mounted = useRef(true);
  const employment = content?.reviewKind === 'employment', proofLabel = employment ? '근무 증빙' : '영수증';
  const receiptKey = content ? JSON.stringify([targetId, content.receiptPath, content.updatedAt]) : '';
  const noteLength = Array.from(note.trim()).length;
  const canConfirm = content?.status === 'published' && !!content.receiptPath && seenReceipt === receiptKey && noteLength >= 5 && noteLength <= 1000 && !busy && !localPreview;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function load() {
    if (localPreview || reading.current) return;
    reading.current = true; setBusy(true); setError(''); setNotice(''); setContent(null); setReceipt(null); setSeenReceipt(''); play('selection');
    try {
      const next = await loadAdminMerchantReviewContent(supabase, targetId);
      if (!mounted.current) return;
      setContent(next);
      if (!next) { setError('후기를 찾을 수 없습니다.'); play('warning'); }
    } catch {
      if (mounted.current) { setError('후기 원문을 불러오지 못했습니다. 관리자 권한과 연결 상태를 확인해주세요.'); play('warning'); }
    } finally {
      reading.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function openReceipt() {
    if (!content?.receiptPath || localPreview || reading.current) return;
    reading.current = true; setBusy(true); setError(''); setSeenReceipt(''); play('selection');
    try {
      const uri = await loadAdminMerchantReceiptUrl(supabase, content.receiptPath);
      if (mounted.current) { setReceipt({ key: receiptKey, uri }); setPreview(true); }
    } catch {
      if (mounted.current) { setError(`${proofLabel}을 불러오지 못했습니다. 관리자 권한과 연결 상태를 확인해주세요.`); play('warning'); }
    } finally { reading.current = false; if (mounted.current) setBusy(false); }
  }
  async function confirmReceipt(verified: boolean) {
    if (!content || !canConfirm || reading.current) return;
    reading.current = true; setBusy(true); setError(''); setNotice(''); play('selection');
    try {
      await setAdminMerchantReviewReceipt(supabase, targetId, content, verified, note);
      const next = await loadAdminMerchantReviewContent(supabase, targetId);
      if (!mounted.current) return;
      if (!next || next.reviewKind !== content.reviewKind || next.receiptPath !== content.receiptPath || next.receiptStatus !== (verified ? 'verified' : 'rejected')) throw new Error('MERCHANT_REVIEW_RECEIPT_NOT_VERIFIED');
      setContent(next); setNote(''); setReceipt(null); setSeenReceipt(''); setNotice(verified ? `${proofLabel} 인증을 확인했습니다.` : `${proofLabel} 인증 거절을 확인했습니다.`); play('success'); onChanged?.();
    } catch {
      if (mounted.current) { setError('검토 결과를 확인하지 못했습니다. 메모는 유지했습니다. 최신 후기를 다시 불러와 확인해주세요.'); play('warning'); }
    } finally { reading.current = false; if (mounted.current) setBusy(false); }
  }
  const actionStyle = [styles.action, { borderColor: theme.line, backgroundColor: theme.card }];
  return <View style={styles.content}>
    <Pressable accessibilityRole="button" accessibilityLabel="후기 원문 보기" accessibilityState={{ disabled: localPreview || busy, busy }}
      disabled={localPreview || busy} onPress={() => load()} style={[styles.action, { borderColor: theme.line, backgroundColor: theme.card }, (localPreview || busy) && styles.disabled]}>
      <ThemedText type="smallBold">{busy ? '후기 불러오는 중…' : '후기 원문 보기'}</ThemedText>
    </Pressable>
    {error ? <ThemedText type="small" accessibilityRole="alert">{error}</ThemedText> : null}
    {notice ? <ThemedText type="small" accessibilityLiveRegion="polite">{notice}</ThemedText> : null}
    {content && <>
      <ThemedText type="small" selectable>{content.text}</ThemedText>
      <ThemedText type="smallBold">{employment ? '근무 후기' : '상품·서비스 후기'}</ThemedText>
      <ThemedText type="small" style={{ color: theme.textSecondary }}>현재 후기 · {content.status === 'removed' ? '숨김' : content.receiptStatus === 'verified' ? '공개' : employment ? '비공개' : '작성자·업체만 보기'}</ThemedText>
      <ThemedText type="smallBold">{proofLabel} · {({ none: '없음', pending: '검토 대기', verified: '인증됨', rejected: '인증 거절' })[content.receiptStatus ?? 'none']}</ThemedText>
      {content.receiptReviewNote && <ThemedText type="small" selectable>최근 검토 메모 · {content.receiptReviewNote}</ThemedText>}
      {!!content.receiptPath && <>
        <Pressable accessibilityRole="button" accessibilityLabel={`${proofLabel} 보기`} disabled={busy || localPreview} accessibilityState={{ disabled: busy || localPreview }} onPress={() => openReceipt()} style={[actionStyle, (busy || localPreview) && styles.disabled]}>
          <ThemedText type="smallBold">{proofLabel} 보기</ThemedText>
        </Pressable>
        <ThemedText type="small" style={{ color: theme.textSecondary }}>{employment
          ? '근무 증빙은 작성자와 관리자만 볼 수 있습니다. 회사·근무자·근무 이력을 확인하고, 작성자와 근무자가 일치하는지 확인해주세요. 신분증·은행계좌번호·불필요한 급여 정보는 필요하지 않습니다.'
          : '영수증은 작성자와 관리자만 볼 수 있습니다. 업체명·이용일·금액을 확인한 뒤 검토 메모를 남겨주세요.'}</ThemedText>
        <TextInput accessibilityLabel={`${proofLabel} 검토 메모`} value={note} editable={!busy} onFocus={() => play('selection')} onChangeText={setNote} maxLength={1000} multiline
          placeholder="인증 또는 거절의 판단 근거 · 5자 이상" placeholderTextColor={theme.textSecondary} style={[styles.note, { color: theme.text, backgroundColor: theme.card, borderColor: theme.line }]} />
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${proofLabel} 인증`} disabled={!canConfirm} accessibilityState={{ disabled: !canConfirm }} onPress={() => confirmReceipt(true)} style={[actionStyle, !canConfirm && styles.disabled]}><ThemedText type="smallBold">{proofLabel} 인증</ThemedText></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`${proofLabel} 인증 거절`} disabled={!canConfirm} accessibilityState={{ disabled: !canConfirm }} onPress={() => confirmReceipt(false)} style={[actionStyle, !canConfirm && styles.disabled]}><ThemedText type="smallBold">인증 거절</ThemedText></Pressable>
        </View>
      </>}
      <Pressable accessibilityRole="button" accessibilityLabel="후기 작성자 이력 보기" onPress={() => { play('selection'); onUser(content.authorId); }} style={[styles.action, { borderColor: theme.line, backgroundColor: theme.card }]}>
        <ThemedText type="smallBold">작성자 이력 보기</ThemedText>
      </Pressable>
    </>}
    <Modal visible={preview} onRequestClose={() => { play('selection'); setPreview(false); }} animationType="fade">
      <SafeAreaView style={[styles.preview, { backgroundColor: theme.background }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${proofLabel} 닫기`} onPress={() => { play('selection'); setPreview(false); }} style={[actionStyle, styles.close]}><ThemedText type="smallBold">{proofLabel} 닫기</ThemedText></Pressable>
        {receipt?.key === receiptKey && <Image source={{ uri: receipt.uri }} accessibilityLabel={`검토용 비공개 ${proofLabel}`} contentFit="contain" style={styles.image}
          onLoad={() => setSeenReceipt(receiptKey)} onError={() => { setSeenReceipt(''); setError(`${proofLabel} 사진을 확인하지 못했습니다. 다시 불러와주세요.`); play('warning'); }} />}
      </SafeAreaView>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  content: { gap: Spacing.two },
  action: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: Spacing.three,
    borderWidth: 1, borderRadius: 8 },
  disabled: { opacity: 0.5 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  note: { minHeight: 80, padding: Spacing.two, borderWidth: 1, borderRadius: 8, textAlignVertical: 'top' },
  preview: { flex: 1, padding: Spacing.three, gap: Spacing.two }, close: { alignSelf: 'flex-end' }, image: { flex: 1, width: '100%' },
});
