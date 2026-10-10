import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AdminTrendingPanel } from './admin-trending-panel';
import { AdminMerchantReviewContent } from '@/components/admin/admin-merchant-review-content';
import { AdminMerchantReviewReplyContent } from '@/components/admin/admin-merchant-review-reply-content';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { reportReasonLabel, reportStatusLabel, reportTargetLabel, type AdminSection } from '@/lib/admin';
import { displayName, shortId } from '@/lib/admin-labels';
import { loadAdminClientErrors, resolveAdminClientError, type AdminDashboardData, type AdminReport } from '@/lib/admin-data';
import type { AdminClientError } from '@/lib/admin-trending';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { supabase } from '@/lib/supabase';

type Row = { id: string; title: string; body: string; meta: string; userId?: string; reviewId?: string; replyId?: string; reviewEvidence?: AdminReport['evidence'] };

export function AdminSectionView({ section, data, onUser, onLoadMore, loadingMore, noMore, localPreview = false }: {
  section: AdminSection;
  data: AdminDashboardData;
  resolving: boolean;
  loadingMore: boolean;
  noMore: boolean;
  onUser: (userId: string) => void;
  onResolve: (reportId: string | string[], action: 'dismissed' | 'warned' | 'blocked' | 'hidden', note: string) => Promise<string[]>;
  onLoadMore: () => void;
  localPreview?: boolean;
}) {
  const { play } = useInteractionFeedback();
  const profiles = new Map(data.profiles.map((profile) => [profile.id, profile]));
  if (section === 'errors') return <Errors localPreview={localPreview} />;
  if (section === 'trending') return <AdminTrendingPanel localPreview={localPreview} />;

  let title = '';
  let rows: Row[] = [];
  if (section === 'overview') {
    title = '운영 현황';
    rows = [
      { id: 'reports', title: '미처리 신고', body: `${data.counts.openReports}건`, meta: `전체 ${data.counts.reports}건` },
      { id: 'alerts', title: '감시어 경보', body: `${data.counts.alertsOpen}건`, meta: '미처리' },
      { id: 'safety', title: 'AI 안전 검토', body: `고위험 ${data.counts.safetyHigh}건`, meta: `처리 대기 ${data.counts.safetyPending}건` },
      { id: 'members', title: '전체 사용자', body: `${data.counts.profiles}명`, meta: `글 ${data.counts.posts}건 · 메시지 ${data.counts.messages}건` },
    ];
  } else if (section === 'alerts') {
    title = '감시어 경보';
    rows = data.safetyAlerts.map((alert) => ({ id: String(alert.id), title: `${reportTargetLabel(alert.target_type)} · ${alert.category} · ${alert.severity}`, body: alert.excerpt,
      meta: `${alert.status} · ${date(alert.created_at)} · ${displayName(profiles.get(alert.author_id), alert.author_id)}`, userId: alert.author_id,
      ...(alert.target_type === 'merchant_review' ? { reviewId: alert.target_id } : {}),
      ...(alert.target_type === 'merchant_review_reply' ? { replyId: alert.target_id } : {}) }));
  } else if (section === 'safety') {
    title = 'AI 안전 모니터링';
    rows = data.safetyReviews.map((review) => ({ id: String(review.id), title: `${reportTargetLabel(review.target_type)} · ${review.risk_level ?? '분석 대기'}`,
      body: review.risk_reasons.join(' · ') || review.last_error || '분석 결과 대기 중', meta: `${review.status} · ${date(review.created_at)} · ${shortId(review.target_id)}`,
      ...(review.target_type === 'merchant_review' ? { reviewId: review.target_id } : {}),
      ...(review.target_type === 'merchant_review_reply' ? { replyId: review.target_id } : {}) }));
  } else if (section === 'reports') {
    title = '신고 관리';
    rows = data.reports.map((report) => ({ id: report.id, title: `${reportReasonLabel(report.reason_code)} · ${reportStatusLabel(report.status)}`,
      body: report.details || report.evidence?.body || '상세 설명 없음', meta: `${reportTargetLabel(report.target_type)} · ${date(report.created_at)}`,
      userId: report.reported_user_id, ...(report.target_type === 'merchant_review' ? { reviewId: report.target_id, reviewEvidence: report.evidence } : {}),
      ...(report.target_type === 'merchant_review_reply' ? { replyId: report.target_id } : {}) }));
  } else if (section === 'users') {
    title = '사용자';
    rows = data.profiles.map((profile) => ({ id: profile.id, title: profile.nickname, body: profile.bio || '소개 없음',
      meta: `${profile.account_status} · ${profile.city_id ?? '지역 없음'} · ${date(profile.created_at)}`, userId: profile.id }));
  } else if (section === 'posts') {
    title = '게시글';
    rows = data.posts.map((post) => ({ id: post.id, title: post.title, body: post.body,
      meta: `${post.status} · ${date(post.created_at)} · ${displayName(profiles.get(post.author_id), post.author_id)}`, userId: post.author_id }));
  } else if (section === 'conversations') {
    title = '대화';
    rows = data.messages.map((message) => ({ id: message.id, title: displayName(profiles.get(message.sender_id), message.sender_id),
      body: message.body, meta: `${date(message.created_at)} · 대화 ${shortId(message.conversation_id)}`, userId: message.sender_id }));
  }

  return <View style={styles.section}>
    <ThemedText type="title" accessibilityRole="header">{title}</ThemedText>
    {section === 'reports' && <ThemedText type="small" style={styles.muted}>신고 조치와 메모 입력은 웹 관리자 화면에서 할 수 있습니다.</ThemedText>}
    {rows.length === 0 && <ThemedText style={styles.muted}>표시할 기록이 없습니다.</ThemedText>}
    {rows.map((row) => <View key={row.id} style={styles.card}>
      <ThemedText type="smallBold">{row.title}</ThemedText>
      <ThemedText type="small" selectable>{row.body}</ThemedText>
      <ThemedText type="small" style={styles.muted}>{row.meta}</ThemedText>
      {row.reviewEvidence && <>
        <ThemedText type="smallBold">접수 당시 업체 후기 · {row.reviewEvidence.merchant_name ?? row.reviewEvidence.merchant_id ?? '업체 정보 없음'}{row.reviewEvidence.score == null ? '' : ` · ${row.reviewEvidence.score}/10`}</ThemedText>
        <ThemedText type="small" selectable>{row.reviewEvidence.body || '후기글 없음 · 점수만 남긴 후기'}</ThemedText>
      </>}
      {row.reviewId && <AdminMerchantReviewContent targetId={row.reviewId} localPreview={localPreview} onUser={onUser} />}
      {row.replyId && <AdminMerchantReviewReplyContent targetId={row.replyId} localPreview={localPreview} onUser={onUser} />}
      {!!row.userId && <Pressable accessibilityRole="button" accessibilityLabel={`${row.title} 사용자 상세 보기`}
        onPress={() => { play('selection'); onUser(row.userId!); }} style={styles.action}>
        <ThemedText type="smallBold" style={styles.accent}>사용자 상세 보기</ThemedText>
      </Pressable>}
    </View>)}
    {section !== 'overview' && !noMore && <Pressable accessibilityRole="button" accessibilityState={{ disabled: loadingMore }}
      disabled={loadingMore} onPress={() => { play('selection'); onLoadMore(); }} style={styles.action}>
      <ThemedText type="smallBold" style={styles.accent}>{loadingMore ? '불러오는 중' : '이전 기록 더 보기'}</ThemedText>
    </Pressable>}
  </View>;
}

function Errors({ localPreview }: { localPreview: boolean }) {
  const { play } = useInteractionFeedback();
  const [rows, setRows] = useState<AdminClientError[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState<number | null>(null);
  useEffect(() => {
    if (localPreview) return;
    let active = true;
    void loadAdminClientErrors(supabase).then((next) => { if (active) { setRows(next); setFailed(false); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [localPreview, retry]);
  const resolve = async (id: number) => {
    setBusy(id);
    try {
      await resolveAdminClientError(supabase, id, true);
      setRows((current) => current?.filter((row) => row.id !== id) ?? null);
      play('success');
    } catch {
      setFailed(true);
      play('warning');
    } finally { setBusy(null); }
  };
  return <View style={styles.section}>
    <ThemedText type="title" accessibilityRole="header">앱 오류</ThemedText>
    <ThemedText type="small" style={styles.muted}>사용자 폰에서 보고된 자바스크립트 오류입니다. 버전별 발생 횟수를 확인하세요.</ThemedText>
    {localPreview ? <ThemedText>로컬 미리보기에는 운영 오류가 표시되지 않습니다.</ThemedText> : null}
    {!localPreview && !rows && !failed && <ActivityIndicator color={Colors.admin.accent} accessibilityLabel="오류 불러오는 중" />}
    {failed && <Pressable accessibilityRole="button" onPress={() => { play('selection'); setFailed(false); setRetry((value) => value + 1); }} style={styles.action}>
      <ThemedText style={styles.accent}>오류를 불러오거나 처리하지 못했습니다. 다시 시도</ThemedText>
    </Pressable>}
    {rows?.length === 0 && <ThemedText style={styles.muted}>미처리 앱 오류가 없습니다.</ThemedText>}
    {rows?.map((row) => <View key={row.id} style={styles.card}>
      <ThemedText type="smallBold" selectable>{row.message}</ThemedText>
      <ThemedText type="small" style={styles.muted}>{row.platform} {row.appVersion} · {row.occurrences}회 · 마지막 {date(row.lastSeen)}</ThemedText>
      {!!row.screen && <ThemedText type="small" style={styles.muted}>화면: {row.screen}</ThemedText>}
      <View style={styles.actions}>
        {!!row.stack && <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded === row.id }}
          onPress={() => { play('selection'); setExpanded(expanded === row.id ? null : row.id); }} style={styles.action}>
          <ThemedText type="smallBold" style={styles.accent}>{expanded === row.id ? '스택 접기' : '스택 보기'}</ThemedText>
        </Pressable>}
        <Pressable accessibilityRole="button" disabled={busy != null} accessibilityState={{ disabled: busy != null }}
          onPress={() => { play('selection'); void resolve(row.id); }} style={styles.action}>
          <ThemedText type="smallBold" style={styles.accent}>{busy === row.id ? '처리 중' : '확인 완료'}</ThemedText>
        </Pressable>
      </View>
      {expanded === row.id && !!row.stack && <ThemedText type="small" selectable>{row.stack}</ThemedText>}
    </View>)}
  </View>;
}

function date(value: string) { return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }

const styles = StyleSheet.create({
  section: { gap: Spacing.three, paddingBottom: Spacing.six },
  card: { gap: Spacing.one, padding: Spacing.three, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 8, backgroundColor: Colors.admin.card },
  muted: { color: Colors.admin.textSecondary },
  accent: { color: Colors.admin.accent },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  action: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: Spacing.three,
    borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 8, backgroundColor: Colors.admin.card },
});
