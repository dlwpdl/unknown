import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';

import { Pressable } from '@/components/analytics-controls';
import { ReportSheet } from '@/components/report-sheet';
import { ThemedText } from '@/components/themed-text';
import { MerchantRatingBar } from '@/components/merchant-rating-bar';
import { useContentVisibility } from '@/hooks/use-content-visibility';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { loadMerchantReviews, uploadMerchantReviewReceipt, writeMerchantReview, type MerchantReview, type MerchantReviewKind, type MerchantReviewPage } from '@/lib/merchant-reviews';
import { isSupportedImage, preparePostImage, type PreparedImage } from '@/lib/post-image-picker';
import { supabase } from '@/lib/supabase';

const SCORES = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];

type Props = { postId: string; reviewKind?: MerchantReviewKind; onOpenProfile?: (merchantId: string) => void; onChanged?: () => void };

export function MerchantReviews({ postId, reviewKind = 'usage', onOpenProfile, onChanged }: Props) {
  const { isAuthed, isAuthLoading, me } = useAuth();
  const [visited, setVisited] = useState<MerchantReviewKind[]>([reviewKind]);
  const kinds = visited.includes(reviewKind) ? visited : [...visited, reviewKind];
  if (!visited.includes(reviewKind)) setVisited(kinds);
  // Keep kind drafts mounted; post/account changes still isolate pending reads and saves.
  return <View>{kinds.map(kind => <View key={`${postId}:${kind}:${isAuthLoading ? 'loading' : isAuthed ? me.id : 'guest'}`}
    style={kind !== reviewKind ? { display: 'none' } : undefined} accessibilityElementsHidden={kind !== reviewKind}
    importantForAccessibility={kind !== reviewKind ? 'no-hide-descendants' : 'auto'}>
    <ScopedMerchantReviews postId={postId} reviewKind={kind} onOpenProfile={onOpenProfile} onChanged={onChanged} />
  </View>)}</View>;
}

function ScopedMerchantReviews({ postId, reviewKind = 'usage', onOpenProfile, onChanged }: Props) {
  const employment = reviewKind === 'employment', proofLabel = employment ? '근무 증빙' : '영수증';
  const theme = useTheme();
  const { isAuthed, isAuthLoading, me, promptLogin } = useAuth();
  const { play } = useInteractionFeedback();
  const hidden = useContentVisibility();
  const [page, setPage] = useState<MerchantReviewPage | null>(null);
  const [offset, setOffset] = useState(0), [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true), [readError, setReadError] = useState('');
  const [editing, setEditing] = useState(false), [score, setScore] = useState<number | null>(null);
  const [body, setBody] = useState(''), [writeError, setWriteError] = useState(''), [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false), [report, setReport] = useState<MerchantReview | null>(null);
  const [replyReport, setReplyReport] = useState<MerchantReview | null>(null);
  const [receipt, setReceipt] = useState<{ path: string; uri?: string; image?: PreparedImage } | null>(null), [pickingReceipt, setPickingReceipt] = useState(false);
  const mounted = useRef(true), pendingRead = useRef(true), pendingSave = useRef(false);
  const pendingReceipt = useRef(false), uploads = useRef(new Set<string>());

  useEffect(() => {
    mounted.current = true;
    const tracked = uploads.current;
    return () => {
      mounted.current = false;
      // Storage refuses deletion of bound receipts, including uncertain saved uploads.
      if (tracked.size) void supabase.storage.from('merchant-review-receipts').remove([...tracked]).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (isAuthLoading) return;
    let active = true;
    pendingRead.current = true;
    void loadMerchantReviews(supabase, postId, offset, reviewKind).then((next) => {
      if (!active) return;
      setPage((previous) => next && previous && offset > 0
        ? { ...next, reviews: [...previous.reviews, ...next.reviews.filter((row) => !previous.reviews.some(({ id }) => id === row.id))] }
        : next);
    }).catch(() => {
      if (active) setReadError('업체 후기를 불러오지 못했어요. 다시 시도해 주세요.');
    }).finally(() => {
      if (active) { pendingRead.current = false; setLoading(false); }
    });
    return () => { active = false; };
  }, [postId, isAuthLoading, offset, revision, reviewKind]);

  const refresh = () => {
    pendingRead.current = true; setLoading(true); setReadError(''); setOffset(0); setRevision((value) => value + 1); onChanged?.();
  };
  const openEditor = () => {
    play('selection');
    if (!isAuthed) { promptLogin('업체 후기를 남기려면 로그인해 주세요.'); return; }
    if (!page?.can_review || loading) return;
    setScore(page.my_review?.score ?? null); setBody(page.my_review?.body ?? '');
    setReceipt(page.my_review?.receipt_path ? { path: page.my_review.receipt_path } : null);
    setWriteError(''); setNotice(''); setEditing(true);
  };
  const save = async () => {
    if (score == null || !page?.can_review || pendingSave.current || pendingReceipt.current) return;
    pendingSave.current = true; setSaving(true); setWriteError('');
    try {
      let proof = receipt;
      const session = await supabase.auth.getSession();
      if (!mounted.current || session.data.session?.user.id !== me.id) throw new Error('ACCOUNT_CHANGED');
      if (proof?.image) {
        const path = await uploadMerchantReviewReceipt(supabase, me.id, proof.image);
        uploads.current.add(path);
        if (!mounted.current) { void supabase.storage.from('merchant-review-receipts').remove([path]).catch(() => {}); return; }
        proof = { path, uri: proof.uri }; setReceipt(proof);
        const current = await supabase.auth.getSession();
        if (!mounted.current || current.data.session?.user.id !== me.id) throw new Error('ACCOUNT_CHANGED');
      }
      await writeMerchantReview(supabase, postId, score, body, proof?.path ?? '', reviewKind);
      if (!mounted.current) return;
      play('success'); setEditing(false);
      setNotice(proof?.path && proof.path === page.my_review?.receipt_path && page.my_review.receipt_status === 'verified'
        ? '인증 후기를 수정했어요.' : proof ? employment ? '후기를 저장했어요. 근무 증빙 확인 전에는 나에게만 보여요.' : '후기를 저장했어요. 영수증 확인 전에는 업체에만 전달돼요.'
          : employment ? '후기를 나에게만 저장했어요. 근무 증빙 인증 후에 공개돼요.' : '후기를 업체에 전달했어요. 다른 사용자에게는 공개되지 않아요.');
      const old = [page.my_review?.receipt_path, ...uploads.current].filter((path): path is string => !!path);
      if (old.length) void supabase.storage.from('merchant-review-receipts').remove([...new Set(old)]).catch(() => {});
      refresh();
    } catch (error) {
      if (!mounted.current) return;
      const message = error instanceof Error ? error.message : '';
      setWriteError(message.includes('RATE_LIMITED') ? '잠시 후 다시 저장해 주세요. 입력은 남아 있어요.'
        : message.includes('MERCHANT_REVIEW_REMOVED') ? '관리자가 숨긴 후기는 수정할 수 없어요.'
        : message.includes('INVALID_MERCHANT_SCORE') || message.includes('INVALID_REVIEW_SCORE') ? '1~10점에서 0.5점 단위로 선택해 주세요.'
        : message.includes('MERCHANT_REVIEW_TOO_LONG') || message.includes('INVALID_REVIEW_BODY') ? '후기글은 300자 이내로 적어 주세요.'
        : message.includes('INVALID_REVIEW_RECEIPT') ? `${proofLabel} 사진을 다시 선택해 주세요. 입력은 남아 있어요.`
        : message.includes('MERCHANT_OWNER_REVIEW_FORBIDDEN') ? '내가 운영하는 업체에는 후기를 남길 수 없어요.'
        : message.includes('ACCOUNT_CHANGED') ? '계정이 바뀌었어요. 현재 계정으로 다시 열어주세요.'
        : '후기를 저장하지 못했어요. 입력은 남아 있어요. 다시 시도해 주세요.');
      play('warning');
    } finally {
      pendingSave.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  const pickReceipt = async () => {
    if (pendingSave.current || pendingReceipt.current) return;
    pendingReceipt.current = true; setPickingReceipt(true); setWriteError('');
    try {
      const selected = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsMultipleSelection: false,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
      if (selected.canceled || !mounted.current) return;
      const asset = selected.assets?.[0];
      if (!asset?.uri || !isSupportedImage(asset.mimeType ?? 'image/jpeg')) throw new Error('IMAGE_UNSUPPORTED');
      const image = await preparePostImage(asset);
      if (!mounted.current) return;
      setReceipt({ path: '', uri: image.uri, image }); play('selection');
    } catch {
      if (mounted.current) { setWriteError(`${proofLabel} 사진을 준비하지 못했어요. 다시 선택해 주세요.`); play('warning'); }
    } finally {
      pendingReceipt.current = false;
      if (mounted.current) setPickingReceipt(false);
    }
  };

  if (!page && !readError) return null;
  const mine = isAuthed && page?.my_review?.author_id === me.id ? page.my_review : null;
  const publicRows = page?.reviews.filter((row) => row.receipt_status === 'verified' && (row.review_kind ?? 'usage') === reviewKind) ?? [];
  const rows = page ? (mine?.status === 'published' ? [mine, ...publicRows.filter(({ id }) => id !== mine.id)] : publicRows)
    .filter((row) => !hidden('merchant_review', row.id, row.author_id)) : [];

  return <View style={[styles.section, { borderTopColor: theme.line }]}>
    <View style={styles.header}>
      <ThemedText type="smallBold" style={styles.heading}>{employment ? '근무 리뷰' : '상품·서비스 이용 리뷰'}</ThemedText>
      {page && !editing && (!isAuthed || page.can_review) && <Pressable analyticsId="merchant.review.edit" accessibilityRole="button"
        disabled={loading || isAuthLoading} accessibilityState={{ disabled: loading || isAuthLoading }}
        style={[styles.outlineButton, { borderColor: theme.line, opacity: loading ? 0.5 : 1 }]} onPress={openEditor}>
        <ThemedText type="smallBold" themeColor="accent">{mine ? '내 후기 수정' : '후기 남기기'}</ThemedText>
      </Pressable>}
    </View>
    {page?.merchant_id && onOpenProfile && <Pressable analyticsId="merchant.review.profile" accessibilityRole="button" accessibilityLabel={`${page.merchant_name} 업체 프로필 보기`}
      style={[styles.outlineButton, { borderColor: theme.line, alignSelf: 'flex-start' }]} onPress={() => { play('selection'); onOpenProfile(page.merchant_id); }}>
      <ThemedText type="smallBold" themeColor="accent">{page.merchant_name} 프로필 보기 →</ThemedText>
    </Pressable>}
    {page && <View style={styles.summary}>
      <ThemedText type="title" accessibilityLabel={page.rating_average == null ? '아직 점수가 없어요' : `평균 ${page.rating_average.toFixed(1)}점, 10점 만점`}>
        {page.rating_average == null ? '—' : (Math.round(page.rating_average * 10) / 10).toFixed(1)}
      </ThemedText>
      <View style={styles.summaryCopy}>
        <ThemedText type="smallBold">10점 만점</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">인증 후기 {page.review_count}개</ThemedText>
      </View>
    </View>}
    {page && <MerchantRatingBar score={page.rating_average} reviewKind={reviewKind} />}
    {mine?.status === 'removed' && <ThemedText type="small" themeColor="textSecondary">내 후기는 관리자 검토로 숨겨졌어요.</ThemedText>}
    {page && isAuthed && !page.can_review && mine?.status !== 'removed' && <ThemedText type="small" themeColor="textSecondary">이 계정에서는 후기를 남길 수 없어요.</ThemedText>}
    {!!notice && <ThemedText type="small" themeColor="accent" accessibilityLiveRegion="polite">{notice}</ThemedText>}
    {editing && <View style={[styles.editor, { backgroundColor: theme.card, borderColor: theme.line }]}>
      <View style={styles.header}>
        <ThemedText type="smallBold">{score == null ? '점수를 선택해 주세요' : `${score.toFixed(1)}점 / 10점`}</ThemedText>
        <Pressable analyticsId="merchant.review.cancel" accessibilityRole="button" disabled={saving || pickingReceipt} accessibilityState={{ disabled: saving || pickingReceipt }}
          style={styles.textButton} onPress={() => {
            play('selection'); setEditing(false); setWriteError(''); setReceipt(null);
            if (uploads.current.size) void supabase.storage.from('merchant-review-receipts').remove([...uploads.current]).catch(() => {});
            refresh();
          }}>
          <ThemedText type="small" themeColor="textSecondary">취소</ThemedText>
        </Pressable>
      </View>
      <ThemedText type="small" themeColor="textSecondary">최저 1점 · 최고 10점 · 0.5점 단위</ThemedText>
      <View style={styles.scores} accessibilityRole="radiogroup" accessibilityLabel="업체 후기 점수">
        {SCORES.map((value) => <Pressable key={value} analyticsId={`merchant.review.score.${value}`} accessibilityRole="radio"
          accessibilityLabel={`${value}점`} aria-checked={value === score} accessibilityState={{ checked: value === score, disabled: saving }} disabled={saving}
          onPress={() => { play('selection'); setScore(value); setWriteError(''); }}
          style={[styles.score, { borderColor: value === score ? theme.accent : theme.line, backgroundColor: value === score ? theme.accent : theme.background, opacity: saving ? 0.5 : 1 }]}>
          <ThemedText type="smallBold" style={{ color: value === score ? theme.accentInk : theme.text }}>{value}</ThemedText>
        </Pressable>)}
      </View>
      <ThemedText type="smallBold">후기글 <ThemedText type="small" themeColor="textSecondary">(선택)</ThemedText></ThemedText>
      <TextInput value={body} onChangeText={setBody} onFocus={() => play('selection')} editable={!saving} multiline maxLength={300}
        placeholder={employment ? '이 회사에서 직접 근무한 경험을 남겨 주세요.' : '직접 이용한 경험을 남겨 주세요.'} placeholderTextColor={theme.textSecondary} accessibilityLabel={`${employment ? '근무' : '업체'} 후기글, 선택 입력, 최대 300자`}
        style={[styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.line }]} />
      <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>{body.length}/300</ThemedText>
      <ThemedText type="smallBold">{`${proofLabel} 인증`} <ThemedText type="small" themeColor="textSecondary">{employment ? '(공개하려면 필수)' : '(선택)'}</ThemedText></ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{employment ? '관리자가 실제 근무 증빙을 확인한 후기만 공개돼요. 확인 전에는 나에게만 보이고 공개 평균에도 포함되지 않아요. 증빙 원본은 작성자와 권한 있는 관리자만 확인해요.'
        : '인증한 후기만 다른 사용자에게 공개돼요. 영수증 사진은 검토 관리자만 확인하며 공개되지 않아요.'}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{employment ? '재직증명서·근로계약서·급여명세서 중 회사명, 본인 이름, 근무 기간을 확인할 수 있는 사진 1장을 제출해 주세요. 주민등록번호·계좌번호·주소·급여액 등 불필요한 정보는 가려 주세요.'
        : '업체명·이용 날짜가 보이게 제출하고, 이름·전화번호·카드번호는 가려 주세요.'}</ThemedText>
      {receipt?.uri && <Image source={{ uri: receipt.uri }} contentFit="contain" style={styles.receiptImage} accessibilityLabel={`내가 첨부한 비공개 ${proofLabel}`} />}
      {receipt && <ThemedText type="small">{receipt.path === mine?.receipt_path ? merchantReceiptLabel(mine.receipt_status, reviewKind) : `${proofLabel} 사진 첨부됨 · 저장 후 검토`}</ThemedText>}
      <View style={styles.receiptActions}>
        <Pressable analyticsId="merchant.review.receipt.pick" accessibilityRole="button" disabled={saving || pickingReceipt}
          accessibilityState={{ disabled: saving || pickingReceipt, busy: pickingReceipt }} style={[styles.outlineButton, { borderColor: theme.line }]}
          onPress={() => { play('selection'); void pickReceipt(); }}><ThemedText type="smallBold" themeColor="accent">{pickingReceipt ? `${proofLabel} 준비 중…` : receipt ? `${proofLabel} 교체` : `${proofLabel} 첨부`}</ThemedText></Pressable>
        {receipt && <Pressable analyticsId="merchant.review.receipt.remove" accessibilityRole="button" disabled={saving || pickingReceipt}
          accessibilityState={{ disabled: saving || pickingReceipt }} style={styles.textButton}
          onPress={() => { play('selection'); setReceipt(null); }}><ThemedText type="small" themeColor="textSecondary">첨부 제거</ThemedText></Pressable>}
      </View>
      <ThemedText type="small" themeColor="textSecondary">업체마다 계정당 이용 리뷰와 근무 리뷰를 각각 1개씩 남길 수 있어요. 저장한 후기도 수정할 수 있어요.</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">후기글은 안전 점검을 위해 AI와 권한 있는 관리자가 검토할 수 있어요.</ThemedText>
      {!!writeError && <ThemedText type="small" accessibilityRole="alert">{writeError}</ThemedText>}
      <Pressable analyticsId="merchant.review.save" accessibilityRole="button" accessibilityLabel={mine ? '내 후기 수정 저장' : '후기 저장'}
        disabled={saving || pickingReceipt || score == null} accessibilityState={{ disabled: saving || pickingReceipt || score == null, busy: saving }}
        style={[styles.save, { backgroundColor: theme.accent, opacity: saving || pickingReceipt || score == null ? 0.5 : 1 }]}
        onPress={() => { play('selection'); void save(); }}><ThemedText type="smallBold" style={{ color: theme.accentInk }}>{saving ? '저장 중…' : '후기 저장'}</ThemedText></Pressable>
    </View>}
    {page && page.review_count === 0 && !editing && <ThemedText type="small" themeColor="textSecondary">아직 공개된 인증 후기가 없어요.</ThemedText>}
    {rows.map((row) => <MerchantReviewCard key={row.id} review={hidden('merchant_review_reply', row.id) ? { ...row, reply: null } : row} own={isAuthed && row.author_id === me.id}
      onReportReply={() => { if (!isAuthed) promptLogin('업체 답변을 신고하려면 로그인해 주세요.'); else setReplyReport(row); }}
      onReport={isAuthed && row.author_id === me.id ? undefined : () => { if (!isAuthed) promptLogin('후기를 신고하려면 로그인해 주세요.'); else setReport(row); }} />)}
    {!!readError && <View style={styles.error}>
      <ThemedText type="small" accessibilityRole="alert">{readError}</ThemedText>
      <Pressable analyticsId="merchant.review.retry" accessibilityRole="button" disabled={loading} accessibilityState={{ disabled: loading }}
        style={styles.textButton} onPress={() => { play('selection'); refresh(); }}><ThemedText type="smallBold" themeColor="accent">다시 불러오기</ThemedText></Pressable>
    </View>}
    {loading && page && <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">후기를 불러오는 중…</ThemedText>}
    {page?.has_more && !readError && <Pressable analyticsId="merchant.review.more" accessibilityRole="button" disabled={loading}
      accessibilityState={{ disabled: loading }} style={styles.textButton} onPress={() => {
        play('selection'); if (pendingRead.current) return; pendingRead.current = true; setLoading(true); setOffset((value) => value + 20);
      }}><ThemedText type="smallBold" themeColor="accent">후기 더 보기</ThemedText></Pressable>}
    {report && <ReportSheet visible targetType="merchant_review" targetId={report.id} reportedUserId={report.author_id} reportedNickname={report.nickname}
      onClose={() => { setReport(null); refresh(); }} />}
    {replyReport && <ReportSheet visible targetType="merchant_review_reply" targetId={replyReport.id} onClose={() => { setReplyReport(null); refresh(); }} />}
  </View>;
}

export function merchantReceiptLabel(status: MerchantReview['receipt_status'], reviewKind: MerchantReviewKind = 'usage') {
  if (reviewKind === 'employment') return status === 'verified' ? '근무 증빙 인증' : status === 'pending' ? '나에게만 표시 · 근무 증빙 확인 중'
    : status === 'rejected' ? '나에게만 표시 · 근무 증빙 재확인 필요' : '나에게만 표시 · 근무 미인증';
  return status === 'verified' ? '영수증 인증' : status === 'pending' ? '업체에만 전달 · 영수증 확인 중'
    : status === 'rejected' ? '업체에만 전달 · 영수증 재확인 필요' : '업체에만 전달';
}

export function MerchantReviewCard({ review, own = false, onReport, onReportReply }: { review: MerchantReview & { receipt_review_note?: string | null }; own?: boolean; onReport?: () => void; onReportReply?: () => void }) {
  const theme = useTheme(), { play } = useInteractionFeedback();
  const [expanded, setExpanded] = useState(false);
  return <View style={[styles.review, { borderTopColor: theme.line }]}>
    <Pressable analyticsId="merchant.review.detail" accessibilityRole="button" accessibilityLabel={`${review.nickname}님의 후기 ${expanded ? '접기' : '전체 보기'}`}
      accessibilityState={{ expanded }} style={styles.reviewLink} onPress={() => { play('selection'); setExpanded((value) => !value); }}>
      <View style={styles.header}>
        <View style={styles.reviewCopy}>
          <ThemedText type="smallBold">{review.nickname}{own ? ' · 내 후기' : ''}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{new Date(review.created_at).toLocaleDateString('ko-KR')}</ThemedText>
        </View>
        <ThemedText type="smallBold" themeColor="accent" accessibilityLabel={`${review.score}점, 10점 만점`}>{review.score.toFixed(1)} / 10</ThemedText>
      </View>
      <ThemedText type="small" themeColor={review.receipt_status === 'verified' ? 'accent' : 'textSecondary'}>{merchantReceiptLabel(review.receipt_status, review.review_kind)}</ThemedText>
      <ThemedText numberOfLines={expanded ? undefined : 2}>{review.body || '점수만 남긴 후기예요.'}</ThemedText>
      {review.review_kind !== 'employment' && review.reply && <ThemedText type="small" themeColor="accent">업체 답변 1개</ThemedText>}
      <ThemedText type="small" themeColor="textSecondary">{expanded ? '접기' : '후기 전체 보기'}</ThemedText>
    </Pressable>
    {own && review.receipt_status === 'rejected' && !!review.receipt_review_note && <ThemedText type="small" themeColor="textSecondary">재확인 사유: {review.receipt_review_note}</ThemedText>}
    {expanded && review.review_kind !== 'employment' && review.reply && <View style={[styles.reply, { borderLeftColor: theme.accent }]}>
      <ThemedText type="smallBold">업체 답변</ThemedText><ThemedText type="small">{review.reply.body}</ThemedText>
      {onReportReply && <Pressable analyticsId="merchant.reply.report" accessibilityRole="button" accessibilityLabel="업체 답변 신고" style={[styles.textButton, styles.report]}
        onPress={() => { play('selection'); onReportReply(); }}><ThemedText type="small" themeColor="textSecondary">답변 신고</ThemedText></Pressable>}
    </View>}
    {onReport && <Pressable analyticsId="merchant.review.report" accessibilityRole="button" accessibilityLabel={`${review.nickname}님의 업체 후기 신고`}
      style={[styles.textButton, styles.report]} onPress={() => { play('selection'); onReport(); }}><ThemedText type="small" themeColor="textSecondary">신고</ThemedText></Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  section: { marginTop: 24, paddingTop: 20, borderTopWidth: 1, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  heading: { fontSize: 17, lineHeight: 24, flexShrink: 1 },
  outlineButton: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 1, borderRadius: 10 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  summaryCopy: { gap: 2 },
  editor: { padding: 12, gap: 8, borderWidth: 1, borderRadius: 12 },
  scores: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  score: { minWidth: 48, minHeight: 44, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderRadius: 8 },
  input: { minHeight: 96, padding: 12, borderWidth: 1, borderRadius: 8, textAlignVertical: 'top' },
  counter: { textAlign: 'right' },
  save: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  review: { paddingTop: 12, borderTopWidth: 1, gap: 8 },
  reviewCopy: { gap: 2, flex: 1 },
  reply: { borderLeftWidth: 2, paddingLeft: 12, gap: 8 },
  reviewLink: { gap: 8, alignItems: 'stretch', minHeight: 44 },
  receiptImage: { width: '100%', height: 180 },
  receiptActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  textButton: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
  report: { alignSelf: 'flex-end' },
  error: { gap: 8 },
});
