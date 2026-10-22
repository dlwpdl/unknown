import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Pressable } from '@/components/analytics-controls';
import { MerchantReviewCard } from '@/components/merchant-reviews';
import { ReportSheet } from '@/components/report-sheet';
import { ThemedText } from '@/components/themed-text';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadMyMerchantReviews, replyToMerchantReview, type MerchantReview } from '@/lib/merchant-reviews';
import { supabase } from '@/lib/supabase';

export function MerchantReviewInbox({ merchantId, onDirty }: { merchantId: string; onDirty?: (dirty: boolean) => void }) {
  const { me, isAuthed } = useAuth();
  return <ScopedInbox key={`${merchantId}:${isAuthed ? me.id : 'guest'}`} merchantId={merchantId} onDirty={onDirty} />;
}

function ScopedInbox({ merchantId, onDirty }: { merchantId: string; onDirty?: (dirty: boolean) => void }) {
  const theme = useTheme(), { play } = useInteractionFeedback(), { me } = useAuth();
  const hidden = useContentVisibility();
  const [rows, setRows] = useState<MerchantReview[]>([]), [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0), [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [report, setReport] = useState<MerchantReview | null>(null);
  const pending = useRef(true);
  const mounted = useRef(true), replying = useRef(false);
  const [draft, setDraft] = useState<{ id: string; body: string; original: string; updatedAt: string | null } | null>(null);
  const [replyBusy, setReplyBusy] = useState(false), [replyError, setReplyError] = useState('');
  const dirty = !!draft && draft.body !== draft.original;
  useEffect(() => { onDirty?.(dirty || replyBusy); }, [dirty, replyBusy, onDirty]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; onDirty?.(false); }; }, [onDirty]);
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
  const saveReply = async () => {
    if (!draft?.body.trim() || draft.body.trim().length > 300 || replying.current) return;
    replying.current = true; setReplyBusy(true); setReplyError('');
    try {
      const session = await supabase.auth.getSession();
      if (!mounted.current || session.data.session?.user.id !== me.id) throw new Error('ACCOUNT_CHANGED');
      const saved = await replyToMerchantReview(supabase, merchantId, draft.id, draft.body, draft.updatedAt);
      if (!mounted.current) return;
      setRows(previous => previous.map(row => row.id === draft.id ? { ...row, reply: saved } : row));
      setDraft(null); play('success');
    } catch (failure) {
      if (mounted.current) {
        const message = failure instanceof Error ? failure.message : '';
        setReplyError(message.includes('CHANGED') && !message.includes('ACCOUNT') ? '다른 담당자가 답변을 바꿨어요. 작성한 내용은 남아 있어요. 취소 후 최근 답변을 확인해 주세요.'
          : message.includes('ACCOUNT_CHANGED') ? '계정이 바뀌었어요. 작성한 답변을 복사한 뒤 현재 계정으로 다시 열어주세요.' : '답변 저장을 확인하지 못했어요. 작성한 내용은 남아 있으니 다시 시도해 주세요.');
        play('warning');
      }
    } finally { replying.current = false; if (mounted.current) setReplyBusy(false); }
  };
  return <View style={[styles.section, { borderColor: theme.line, backgroundColor: theme.card }]}>
    <View style={styles.header}>
      <ThemedText type="subtitle">받은 후기</ThemedText>
      <Pressable analyticsId="merchant.reviews.refresh" accessibilityRole="button" disabled={loading || dirty || replyBusy} accessibilityState={{ disabled: loading || dirty || replyBusy }}
        style={styles.button} onPress={() => { play('selection'); refresh(); }}><ThemedText type="smallBold" themeColor="accent">새로 확인</ThemedText></Pressable>
    </View>
    <ThemedText type="small" themeColor="textSecondary">이용 리뷰는 미인증 의견도 확인할 수 있어요. 근무 리뷰는 근무 증빙 인증 후에만 보이며, 증빙 원본은 업체에 공개되지 않아요. 공개 평균은 종류별 인증 후기만 따로 계산해요.</ThemedText>
    {rows.filter((row) => !hidden('merchant_review', row.id, row.author_id)).map((row) => <View key={row.id} style={styles.review}>
      <MerchantReviewCard review={row} onReport={row.author_id === me.id || draft || replyBusy ? undefined : () => setReport(row)} />
      {row.review_kind !== 'employment' && (draft?.id === row.id ? <View style={[styles.reply, { borderColor: theme.line }]}>
        <ThemedText type="smallBold">업체 답변</ThemedText>
        <TextInput accessibilityLabel="이용 후기 업체 답변, 최대 300자" value={draft.body} editable={!replyBusy} multiline maxLength={300}
          placeholder="이용 후기에 답변해 주세요." placeholderTextColor={theme.textSecondary} onFocus={() => play('selection')}
          onChangeText={body => { setDraft({ ...draft, body }); setReplyError(''); }} style={[styles.input, { color: theme.text, borderColor: theme.line }]} />
        <ThemedText type="small" themeColor="textSecondary">{draft.body.length}/300 · 후기 공개 범위에 따라 답변도 표시돼요.</ThemedText>
        {!!replyError && <ThemedText type="small" accessibilityRole="alert">{replyError}</ThemedText>}
        <View style={styles.actions}>
          <Pressable analyticsId="merchant.reply.save" accessibilityRole="button" disabled={replyBusy || !draft.body.trim()} accessibilityState={{ disabled: replyBusy || !draft.body.trim(), busy: replyBusy }}
            style={styles.button} onPress={() => { play('selection'); void saveReply(); }}><ThemedText type="smallBold" themeColor="accent">{replyBusy ? '저장 중…' : '답변 저장'}</ThemedText></Pressable>
          <Pressable analyticsId="merchant.reply.cancel" accessibilityRole="button" disabled={replyBusy} accessibilityState={{ disabled: replyBusy }} style={styles.button}
            onPress={() => { play('selection'); setDraft(null); setReplyError(''); refresh(); }}><ThemedText type="small" themeColor="textSecondary">취소</ThemedText></Pressable>
        </View>
      </View> : <Pressable analyticsId={`merchant.reply.edit.${row.id}`} accessibilityRole="button" disabled={!!draft || replyBusy} accessibilityState={{ disabled: !!draft || replyBusy }}
        style={styles.button} onPress={() => { play('selection'); setReplyError(''); setDraft({ id: row.id, body: row.reply?.body ?? '', original: row.reply?.body ?? '', updatedAt: row.reply?.updated_at ?? null }); }}>
        <ThemedText type="smallBold" themeColor="accent">{row.reply ? '답변 수정' : '답변하기'}</ThemedText>
      </Pressable>)}
    </View>)}
    {loading && <ThemedText type="small" accessibilityLiveRegion="polite">후기를 불러오는 중…</ThemedText>}
    {!loading && !rows.length && !error && <ThemedText type="small" themeColor="textSecondary">아직 받은 후기가 없어요.</ThemedText>}
    {!!error && <ThemedText type="small" accessibilityRole="alert">{error}</ThemedText>}
    {hasMore && !error && <Pressable analyticsId="merchant.reviews.more" accessibilityRole="button" disabled={loading || dirty || replyBusy} accessibilityState={{ disabled: loading || dirty || replyBusy }}
      style={styles.button} onPress={() => { play('selection'); if (pending.current || dirty || replying.current) return; pending.current = true; setLoading(true); setOffset((value) => value + 20); }}>
      <ThemedText type="smallBold" themeColor="accent">후기 더 보기</ThemedText>
    </Pressable>}
    {report && <ReportSheet visible targetType="merchant_review" targetId={report.id} reportedUserId={report.author_id} reportedNickname={report.nickname}
      onClose={() => { setReport(null); if (!dirty && !replying.current) refresh(); }} />}
  </View>;
}
const styles = StyleSheet.create({
  section: { padding: 16, gap: 12, borderWidth: 1, borderRadius: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  button: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 },
  review: { gap: 8 }, reply: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 8 },
  input: { borderWidth: 1, borderRadius: 8, minHeight: 88, padding: 12, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
