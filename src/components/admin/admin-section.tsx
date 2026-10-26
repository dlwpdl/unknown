import { AdminTrustReviewContent, isTrustTarget } from '@/components/admin/admin-trust-review-content';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { matches, selected } from './admin-section-filter';
import './admin-section.css';
import { AdminFilterBar, AdminMultiFilter, AdminSelect, AdminSearch, AdminFilterReset, AdminTableSummary } from '@/components/admin/admin-table-controls';
import { AdminButton, AdminCard, AdminDock, AdminFacts, AdminInfo, AdminMoreMenu, AdminTrace, type AdminTone } from '@/components/admin/admin-ui';
import { AdminReportQueue } from '@/components/admin/admin-report-queue';
import { AdminMerchantReviewContent } from '@/components/admin/admin-merchant-review-content';
import { AdminMerchantReviewReplyContent } from '@/components/admin/admin-merchant-review-reply-content';
import { AdminTrendingPanel } from '@/components/admin/admin-trending-panel';
import { AdminUserDirectoryPanel } from '@/components/admin/admin-user-directory';
import { AdminConversationWorkspace } from '@/components/admin/admin-conversations';
import { decodeUserAgent, displayName } from '@/lib/admin-labels';
import { isCompactAdminWidth } from '@/lib/admin-layout';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { reportReasonLabel, reportTargetLabel, type AdminSection } from '@/lib/admin';
import { exportAdminSafetyEvidence, loadAdminChillingContent, loadAdminClientErrors, resolveAdminClientError, resolveAdminSafetyAlert, setAdminPostFields, type AdminDashboardData, type AdminPost, type AdminProfile, type AdminSafetyAlert, type AdminSafetyReview, type AdminSafetyTargetType } from '@/lib/admin-data';
import type { AdminClientError, AdminPostFields, AdminPostPatch } from '@/lib/admin-trending';
import { count } from '@/i18n/ko';
import { CITIES } from '@/lib/mock';
import { supabase } from '@/lib/supabase';

// This file is the web build (native uses admin-section.native.tsx); react-native-web's Alert is a no-op, so use the browser dialogs.
function notify(title: string, body: string) { globalThis.alert?.(`${title}\n\n${body}`); }
function ask(title: string, body: string) { return globalThis.confirm?.(`${title}\n\n${body}`) ?? false; }

// create_report accepts these targets and lets an admin report any of them; the report then follows the normal moderation queue.
const FORWARDABLE: AdminSafetyTargetType[] = ['post', 'comment', 'message'];

export function AdminSectionView({
  section,
  data,
  resolving,
  loadingMore,
  noMore,
  onUser,
  onResolve,
  onLoadMore,
  onSection,
  localPreview = false,
}: {
  section: AdminSection;
  data: AdminDashboardData;
  resolving: boolean;
  loadingMore: boolean;
  noMore: boolean;
  onUser: (userId: string) => void;
  onResolve: (reportId: string | string[], action: 'dismissed' | 'warned' | 'blocked' | 'hidden', note: string) => Promise<string[]>;
  onLoadMore: () => void;
  onSection?: (section: AdminSection) => void;
  localPreview?: boolean;
}) {
  const { play } = useInteractionFeedback();
  const [query, setQuery] = useState('');
  const [postTab, setPostTab] = useState('');
  const [postCity, setPostCity] = useState<string[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [risks, setRisks] = useState<string[]>([]);
  const [safetyTab, setSafetyTab] = useState('');
  const [forwarded, setForwarded] = useState<Record<number, 'busy' | 'done'>>({});
  const [queueSort, setQueueSort] = useState('oldest');
  const [postSort, setPostSort] = useState('new');
  const windowWidth = useWindowDimensions().width;
  const compactUsers = windowWidth < 560;
  const compact = isCompactAdminWidth(windowWidth);
  const profiles = useMemo(() => new Map(data.profiles.map((profile) => [profile.id, profile])), [data.profiles]);
  const needle = query.trim().toLocaleLowerCase('ko-KR');
  const allPosts = [...(data.posts ?? []), ...(data.contextPosts ?? [])];
  // Author and text are only known for content already loaded on the page; other targets carry their own audited preview.
  const safetySource = (review: Pick<AdminSafetyReview, 'target_type' | 'target_id'>) => {
    if (review.target_type === 'post') { const post = allPosts.find((row) => row.id === review.target_id); return post && { authorId: post.author_id, text: post.body }; }
    if (review.target_type === 'message') { const message = data.messages?.find((row) => row.id === review.target_id); return message && { authorId: message.sender_id, text: message.body }; }
    return undefined;
  };
  const targetLabel = (review: { target_type: AdminSafetyTargetType; target_id: string }) => {
    const label = SAFETY_TARGET_LABEL[review.target_type] ?? review.target_type;
    if (review.target_type === 'post') {
      const post = allPosts.find((row) => row.id === review.target_id);
      if (post) return `${label} · ${post.title}`;
    }
    return label;
  };

  if (section === 'overview') {
    const attention = [
      { key: 'openReports' as const, label: '미처리 신고', value: data.counts.openReports, urgent: true, section: 'reports' as const },
      { key: 'safetyHigh' as const, label: 'AI 고위험', value: data.counts.safetyHigh, urgent: true, section: 'safety' as const },
      { key: 'alertsOpen' as const, label: '감시어 경보', value: data.counts.alertsOpen, urgent: true, section: 'alerts' as const },
      { key: 'safetyPending' as const, label: 'AI 처리 대기', value: data.counts.safetyPending, section: 'safety' as const },
    ];
    type Metric = { key: keyof NonNullable<AdminDashboardData['deltas']>; label: string; value: number; urgent?: boolean; section: AdminSection };
    const deltaText = (key: Metric['key']) => {
      const delta = data.deltas?.[key];
      if (!delta) return null;
      const diff = delta.now - delta.before;
      if (diff === 0) return '24시간 전과 같음';
      return `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)} · 24시간 전 ${delta.before}`;
    };
    // One waiting list across reports, keyword alerts and high-risk AI results. AI results have no operator-closed state yet.
    type QueueItem = { key: string; kind: string; tone: AdminTone; title: string; sub: string; who: string; at: string; rank: number; section: AdminSection };
    const severityRank = (level: string | null) => level === 'critical' ? 4 : level === 'high' ? 3 : level === 'medium' ? 1 : 0;
    const queue: QueueItem[] = [
      ...(data.reports ?? []).filter((report) => report.status === 'open').map((report) => ({
        key: `report:${report.id}`, kind: `신고 · ${reportReasonLabel(report.reason_code)}`, tone: 'danger' as const,
        title: report.details || report.evidence?.title || report.evidence?.body || `${reportTargetLabel(report.target_type)} 신고`, sub: reportTargetLabel(report.target_type),
        who: displayName(profiles.get(report.reported_user_id), report.reported_user_id), at: report.created_at, rank: 2, section: 'reports' as const })),
      ...(data.safetyAlerts ?? []).filter((alert) => alert.status === 'open').map((alert) => ({
        key: `alert:${alert.id}`, kind: `경보 · ${ALERT_CATEGORY[alert.category] ?? alert.category}`, tone: alert.severity === 'medium' ? 'warning' as const : 'danger' as const,
        title: alert.excerpt, sub: `${SAFETY_TARGET_LABEL[alert.target_type] ?? alert.target_type} · 일치어 ${(alert.matched_terms ?? []).join(', ')}`,
        who: displayName(profiles.get(alert.author_id), alert.author_id), at: alert.created_at, rank: severityRank(alert.severity), section: 'alerts' as const })),
      ...(data.safetyReviews ?? []).filter((review) => review.risk_level === 'high' || review.risk_level === 'critical').map((review) => {
        const author = safetySource(review)?.authorId;
        return { key: `safety:${review.id}`, kind: `AI · ${SAFETY_RISK_LABEL[review.risk_level ?? 'pending']}`, tone: 'danger' as const,
          title: targetLabel(review), sub: review.risk_reasons.join(' · '), who: author ? displayName(profiles.get(author), author) : '', at: review.created_at,
          rank: severityRank(review.risk_level), section: 'safety' as const };
      }),
    ].sort((a, b) => (queueSort === 'risk' ? b.rank - a.rank : 0) || a.at.localeCompare(b.at));
    const shown = queue.slice(0, 6);
    return (
      <View style={styles.section}>
        <SectionHeading title="운영 현황" info="신고 여부와 상관없이 전체 활동을 봐요. 숫자 밑 변화는 24시간 전과 비교한 값이에요." />
        <View style={styles.metrics}>
          {attention.map((item: Metric) => (
            <Pressable key={item.label} accessibilityRole="button" accessibilityLabel={`${item.label} ${item.value}건 확인`} onPress={() => { play('selection'); onSection?.(item.section); }} style={({ pressed }) => [styles.metric, item.urgent && item.value > 0 && styles.metricUrgent, pressed && styles.pressed]}>
              <ThemedText type="small" style={styles.muted}>{item.label} →</ThemedText>
              <ThemedText type="title" style={[styles.metricValue, item.urgent && item.value > 0 && styles.urgent]}>{count(item.value)}</ThemedText>
              {!!deltaText(item.key) && <ThemedText type="small" style={styles.muted}>{deltaText(item.key)}</ThemedText>}
            </Pressable>
          ))}
        </View>
        <View style={styles.split}>
          <AdminCard icon="⚑" tone="danger" title="먼저 볼 것" count={queue.length} style={styles.splitMain}
            action={<StatusTabs label="먼저 볼 것 정렬" value={queueSort} onChange={setQueueSort} options={[{ value: 'oldest', label: '오래 기다린 순' }, { value: 'risk', label: '위험도 순' }]} />}>
            <div className="admin-sec-queue">
              {shown.map((item) => <button key={item.key} type="button" className="admin-sec-queue-row" onClick={() => { play('selection'); onSection?.(item.section); }}>
                <span className={`admin-badge admin-badge-${item.tone}`}>{item.kind}</span>
                <span className="admin-review-title"><strong>{item.title}</strong><span className="admin-muted">{item.sub}</span></span>
                <span className="admin-sec-side">{item.who}</span>
                <time className="admin-review-time" dateTime={item.at}>{formatDate(item.at)}</time>
              </button>)}
              {shown.length === 0 && <div className="admin-empty">지금 처리할 일이 없어요.</div>}
            </div>
            <AdminButton kind="text" label="신고 목록 전체 보기" onPress={() => onSection?.('reports')} />
          </AdminCard>
          <View style={styles.splitSide}>
            {data.sharedSessions.length > 0 && <AdminCard icon="⧉" tone="warning" title="같은 접속 환경 계정" count={`${data.sharedSessions.length}묶음`}
              info="최근 30일 안에 같은 IP나 기기로 접속한 계정이 둘 이상인 묶음이에요. 집·회사·통신사가 IP를 같이 쓰기도 하니 글·댓글 활동을 함께 보고 판단해 주세요.">
              {data.sharedSessions.map((group) => (
                <View key={`${group.ip}:${group.user_agent ?? 'ip'}`} style={styles.sessionGroup}>
                  <ThemedText type="smallBold" style={group.same_device ? styles.urgent : undefined}>{`${group.user_count}개 계정 · ${group.same_device ? '같은 기기' : '같은 IP'}`}</ThemedText>
                  {group.users.map((user) => (
                    <Pressable key={user.id} onPress={() => { play('selection'); return onUser(user.id); }} accessibilityRole="button" accessibilityLabel={`${user.nickname} 활동 보기`} style={styles.sessionUser}>
                      <ThemedText type="small">{user.nickname}{user.account_type !== 'member' ? ` (${user.account_type})` : ''} · 글 {count(user.posts)} · 댓글 {count(user.comments)} · {formatDate(user.last_seen)}</ThemedText>
                    </Pressable>
                  ))}
                  <AdminTrace items={[{ label: 'IP', value: group.ip }, { label: '기기', value: (group.user_agent && decodeUserAgent(group.user_agent)) || '정보 없음' }]} />
                </View>
              ))}
            </AdminCard>}
            <AdminCard icon="≡" tone="navy" title="전체 규모">
              <AdminFacts columns={3} items={[
                { label: '사용자', value: count(data.counts.profiles) },
                { label: '게시글', value: count(data.counts.posts) },
                { label: '메시지', value: count(data.counts.messages) },
              ]} />
            </AdminCard>
          </View>
        </View>
      </View>
    );
  }

  if (section === 'alerts') {
    return (
      <View style={styles.section}>
        <SectionHeading title="감시어 경보" info={['표현이 일치했다는 신호일 뿐 위반 확정이 아니에요. 원문과 앞뒤 맥락을 보고 판단해 주세요.',
          '마약·무기·성착취·사기·자해·위협·신상공개·불법체류 관련 표현을 글·댓글·대화·칠링·비즈니스 후기에서 감시해요. 최종 판단은 운영자가 해요.']} />
        <AdminAlertsPanel alerts={data.safetyAlerts} profiles={profiles} localPreview={localPreview} onUser={onUser} />
        <LoadMore loading={loadingMore} noMore={noMore} onPress={onLoadMore} />
      </View>
    );
  }

  if (section === 'trending') {
    return (
      <View style={styles.section}>
        <SectionHeading title="뜨는 글 알림" info="도시별 인기 글 알림과 발송 미리보기를 확인해요." />
        <AdminTrendingPanel localPreview={localPreview} />
      </View>
    );
  }

  if (section === 'errors') {
    return (
      <View style={styles.section}>
        <SectionHeading title="앱 오류" info={['사용자 폰의 자바스크립트 오류를 종류·앱 버전별로 묶어요.', '네이티브 충돌은 App Store Connect와 Play Console에서 확인해 주세요.']} />
        <AdminErrorsPanel localPreview={localPreview} />
      </View>
    );
  }

  if (section === 'safety') {
    const inTab = (review: AdminSafetyReview, tab: string) => tab === 'high' ? review.risk_level === 'high' || review.risk_level === 'critical'
      : tab === 'waiting' ? review.status === 'pending' || review.status === 'processing' : !tab || review.status === tab;
    const tabs = [{ value: '', label: '전체' }, { value: 'high', label: '고위험' }, { value: 'waiting', label: '분석 대기·진행' }, { value: 'reviewed', label: '분석 완료' }, { value: 'failed', label: '분석 실패' }]
      .map((tab) => ({ ...tab, count: tab.value ? data.safetyReviews.filter((review) => inTab(review, tab.value)).length : undefined }));
    const reviews = data.safetyReviews.filter((review) => matches(needle, review.target_id, review.last_error, ...review.risk_reasons)
      && selected(targets, review.target_type) && selected(risks, review.risk_level ?? 'pending') && inTab(review, safetyTab));
    const forward = async (review: AdminSafetyReview) => {
      if (localPreview || forwarded[review.id]) return;
      if (!ask('신고로 넘길까요?', '신고 목록에 이 건이 새로 올라가요. 경고·정지 같은 조치는 신고 목록에서 해요.')) return;
      setForwarded((current) => ({ ...current, [review.id]: 'busy' }));
      try {
        const reasons = review.risk_reasons.join(' · ');
        const result = await supabase.rpc('create_report', { target_type: review.target_type, target_id: review.target_id, reason_code: 'other',
          details: `AI 안전 검토 #${review.id}${reasons ? ` · ${reasons}` : ''}`.slice(0, 1000) });
        if (result.error) throw result.error;
        setForwarded((current) => ({ ...current, [review.id]: 'done' }));
      } catch {
        setForwarded((current) => { const next = { ...current }; delete next[review.id]; return next; });
        notify('신고로 넘기지 못했어요.', '권한과 연결을 확인해 주세요. 하루에 넘길 수 있는 건수를 넘었을 수도 있어요.');
      }
    };
    return (
      <View style={styles.section}>
        <SectionHeading title="AI 안전 모니터링" info={['전체 활동의 분석 결과를 보고 위험 신호를 검토해요.', 'AI 결과는 검토 순서를 돕는 신호예요. 최종 조치는 원문과 맥락을 확인한 운영자가 정해요.']} />
        <StatusTabs label="분석 상태" value={safetyTab} onChange={setSafetyTab} options={tabs} />
        <div className="admin-toolbar"><AdminSearch value={query} onChange={setQuery} placeholder="분석 이유 검색" />
          <AdminFilterBar applied={targets.length + risks.length}>
            <div className="admin-filter-row">
              <AdminMultiFilter label="대상" options={recordOptions(SAFETY_TARGET_LABEL)} value={targets} onChange={setTargets} />
              <AdminMultiFilter label="위험도" options={recordOptions(SAFETY_RISK_LABEL)} value={risks} onChange={setRisks} />
              <AdminFilterReset onReset={() => { setQuery(''); setTargets([]); setRisks([]); }} />
            </div>
          </AdminFilterBar><AdminTableSummary shown={reviews.length} loaded={data.safetyReviews.length} />
        </div>
        <div className="admin-review-list admin-sec-list" aria-label="AI 안전 분석 목록">
          <ReviewColumns labels={['분석 대상', '위험도·상태', '생성 시각']} />
          {reviews.map((review) => {
            const source = safetySource(review);
            const canForward = FORWARDABLE.includes(review.target_type);
            const state = forwarded[review.id];
            return (
              <ReviewRow key={review.id} tone={riskTone(review.risk_level)} toneLabel={`위험도 ${SAFETY_RISK_LABEL[review.risk_level ?? 'pending']}`}
                title={targetLabel(review)} sub={review.risk_reasons.join(' · ') || (review.status === 'failed' ? '분석을 끝내지 못했어요.' : '분석 결과를 기다리고 있어요.')}
                side={review.status === 'reviewed' ? SAFETY_RISK_LABEL[review.risk_level ?? 'pending'] : SAFETY_STATUS_LABEL[review.status]} time={review.created_at}>
                {!!source?.text && <ThemedText type="small" selectable style={styles.quote}>{source.text}</ThemedText>}
                {(review.target_type === 'chilling_profile' || review.target_type === 'chilling_application') && <AdminChillingContent targetType={review.target_type} targetId={review.target_id} localPreview={localPreview} onUser={onUser} />}
                {review.target_type === 'merchant_review' && <AdminMerchantReviewContent targetId={review.target_id} localPreview={localPreview} onUser={onUser} />}
                {review.target_type === 'merchant_review_reply' && <AdminMerchantReviewReplyContent targetId={review.target_id} localPreview={localPreview} onUser={onUser} />}
                {isTrustTarget(review.target_type) && <AdminTrustReviewContent targetType={review.target_type} targetId={review.target_id} localPreview={localPreview} onUser={onUser} />}
                <AdminFacts columns={3} items={[
                  { label: '위험 점수', value: review.risk_score ?? '미분석' },
                  { label: '분석 시각', value: review.reviewed_at ? formatDate(review.reviewed_at) : '아직 없음' },
                  { label: '작성자', value: source ? displayName(profiles.get(source.authorId), source.authorId) : '원문에서 확인' },
                ]} />
                {(!!source || canForward) && <AdminDock>
                  {!!source && <AdminButton kind="text" label="작성자 활동" onPress={() => onUser(source.authorId)} />}
                  <View style={styles.grow} />
                  {canForward && (state === 'done'
                    ? <ThemedText type="smallBold" style={styles.done} accessibilityLiveRegion="polite">신고로 넘겼어요</ThemedText>
                    : <AdminButton kind="primary" label={state === 'busy' ? '넘기는 중' : '신고로 넘기기'} onPress={() => void forward(review)} disabled={localPreview || !!state} />)}
                </AdminDock>}
                <AdminTrace items={[{ label: '분석 ID', value: String(review.id) }, { label: '대상 ID', value: review.target_id }, { label: '시도', value: `${review.attempts}회` },
                  ...(review.last_error ? [{ label: '오류', value: review.last_error }] : [])]} />
              </ReviewRow>
            );
          })}
          {reviews.length === 0 && <Empty text="조건에 맞는 안전 검토 기록이 없어요." />}
        </div>
        <LoadMore loading={loadingMore} noMore={noMore} onPress={onLoadMore} />
      </View>
    );
  }

  if (section === 'reports') {
    return <View style={styles.section}><SectionHeading title="신고 관리" description={`전체 ${data.counts.reports}건 · 미처리 ${data.counts.openReports}건`} /><AdminReportQueue reports={data.reports} profiles={profiles} actions={data.moderationActions} resolving={resolving} onUser={onUser} onResolve={onResolve} localPreview={localPreview} /><LoadMore loading={loadingMore} noMore={noMore} onPress={onLoadMore} /></View>;
  }

  const search = <TextInput value={query} onChangeText={setQuery} placeholder="닉네임, 제목, 내용 또는 ID 검색" placeholderTextColor={Colors.admin.textSecondary} accessibilityRole="search" accessibilityLabel="관리 데이터 검색" returnKeyType="search" style={styles.search} />;

  if (section === 'users') {
    if (!localPreview) return <AdminUserDirectoryPanel onUser={onUser} refreshData={data} />;
    const rows = data.profiles.filter((profile) => matches(needle, profile.nickname, profile.neighborhood, profile.city_id, profile.id));
    return <View style={styles.section}><SectionHeading title="사용자" info="사용자를 고르면 글·댓글·대화·신고 이력을 함께 봐요." />{search}<View style={styles.userRows}>{rows.map((profile, index) => <UserRow key={profile.id} profile={profile} compact={compactUsers} last={index === rows.length - 1} onPress={() => onUser(profile.id)} />)}{rows.length === 0 && <Empty />}</View><LoadMore loading={loadingMore} noMore={noMore} onPress={onLoadMore} /></View>;
  }

  if (section === 'posts') {
    const rows = data.posts
      .filter((post) => matches(needle, post.title, post.body, post.city_id, post.author_id, post.id, profiles.get(post.author_id)?.nickname))
      .filter((post) => (!postTab || post.status === postTab) && selected(postCity, post.city_id))
      .sort((a, b) => postSort === 'views' ? (b.view_count ?? 0) - (a.view_count ?? 0)
        : postSort === 'likes' ? (b.like_count ?? 0) - (a.like_count ?? 0)
        : b.created_at.localeCompare(a.created_at));
    const tabs = [{ value: '', label: '전체' }, { value: 'published', label: '공개' }, { value: 'removed', label: '내림' }]
      .map((tab) => ({ ...tab, count: tab.value ? data.posts.filter((post) => post.status === tab.value).length : data.posts.length }));
    return (
      <View style={styles.section}>
        <SectionHeading title="게시글" />
        <StatusTabs label="게시 상태" value={postTab} onChange={setPostTab} options={tabs} />
        <div className="admin-toolbar">
          <AdminSearch value={query} onChange={setQuery} placeholder="제목, 내용, 작성자 또는 ID 검색" />
          <AdminFilterBar applied={postCity.length}>
            <div className="admin-filter-row">
              <AdminMultiFilter label="도시" value={postCity} onChange={setPostCity} options={CITIES.map((city) => ({ value: city.id, label: city.name }))} />
              <AdminSelect label="정렬" value={postSort} onChange={setPostSort} options={recordOptions({ new: '최신순', views: '조회순', likes: '공감순' })} />
              <AdminFilterReset onReset={() => { setQuery(''); setPostCity([]); setPostSort('new'); }} />
            </div>
          </AdminFilterBar><AdminTableSummary shown={rows.length} loaded={data.posts.length} />
        </div>
        <div className={compact ? undefined : 'admin-table-wrap'}><View style={[styles.list, { minWidth: compact ? 0 : 680, borderWidth: 0 }]}>
          {!compact && <View style={styles.postHead}>
            <ThemedText type="smallBold" style={{ flex: 1 }}>글</ThemedText>
            <View style={styles.postMetrics}>{POST_COUNTERS.map(({ key, label }) => <ThemedText key={key} style={styles.postMetric}>{label}</ThemedText>)}</View>
          </View>}
          {rows.map((post, index) => (
            <AdminPostRow key={post.id} post={post} first={index === 0} compact={compact}
              author={displayName(profiles.get(post.author_id), post.author_id)}
              localPreview={localPreview} onUser={onUser} />
          ))}
          {rows.length === 0 && <Empty />}
        </View></div>
        <LoadMore loading={loadingMore} noMore={noMore} onPress={onLoadMore} />
      </View>
    );
  }

  return <AdminConversationWorkspace data={data} loadingMore={loadingMore} noMore={noMore} onLoadMore={onLoadMore} onUser={onUser} localPreview={localPreview} />;
}

// 글 자체의 수정·삭제는 작성자가 앱에서 한다. 여기서는 노출에 영향을 주는 값만 손댄다.
// 닫힌 행은 한 줄이다. 조정 칸은 펼쳤을 때만 나와서 목록을 훑을 때 조용하다.
// 숫자는 칸을 벗어날 때가 아니라 "반영"을 눌렀을 때만 저장한다.
const POST_COUNTERS = [
  { key: 'view_count', label: '조회수' },
  { key: 'like_count', label: '공감수' },
  { key: 'save_count', label: '저장수' },
] as const;

function AdminPostRow({ post, author, first, localPreview, compact, onUser }: {
  post: AdminPost; author: string; first?: boolean; localPreview?: boolean; compact?: boolean; onUser: (userId: string) => void;
}) {
  const { play } = useInteractionFeedback();
  const saved = {
    status: post.status as string,
    view_count: post.view_count ?? 0,
    like_count: post.like_count ?? 0,
    save_count: post.save_count ?? 0,
    hashtags: (post.hashtags ?? []).join(' '),
  };
  const [fields, setFields] = useState(saved);
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const down = fields.status === 'removed';

  const store = (next: AdminPostFields) => {
    const applied = {
      status: next.status,
      view_count: next.viewCount,
      like_count: next.likeCount,
      save_count: next.saveCount,
      hashtags: (next.hashtags ?? []).join(' '),
    };
    setFields(applied);
    setDraft(applied);
  };

  const apply = async (patch: AdminPostPatch, label: string) => {
    if (localPreview || busy) return;
    setBusy(true);
    try {
      store(await setAdminPostFields(supabase, post.id, patch));
    } catch {
      notify(`${label}을(를) 바꾸지 못했어요.`, '값의 범위와 권한을 확인해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const changed = POST_COUNTERS.filter(({ key }) => String(draft[key]) !== String(fields[key])).length + (draft.hashtags !== fields.hashtags ? 1 : 0);

  const applyEdits = () => {
    const patch: AdminPostPatch = {};
    for (const { key, label } of POST_COUNTERS) {
      const value = Number(String(draft[key]).trim());
      if (!Number.isInteger(value) || value < 0) return notify(`${label}를 확인해 주세요.`, '0 이상의 정수만 넣을 수 있어요.');
      if (value !== fields[key]) patch[key] = value;
    }
    if (draft.hashtags !== fields.hashtags) {
      patch.hashtags = draft.hashtags.split(/[\s,]+/).map((tag: string) => tag.replace(/^#/, '')).filter(Boolean).slice(0, 20);
    }
    if (Object.keys(patch).length === 0) return;
    void apply(patch, '값');
  };

  return (
    <View style={[styles.postRow, first && styles.postRowFirst]}>
      <Pressable onPress={() => { play('selection'); return setOpen((current) => !current); }} accessibilityRole="button"
        accessibilityState={{ expanded: open }} aria-expanded={open}
        accessibilityLabel={`${post.title}, ${author}, ${down ? '삭제됨' : '게시중'}, 조회 ${count(fields.view_count)}`}
        style={({ pressed }) => [styles.postHead, pressed && styles.pressed, open && styles.pressed]}>
        <View style={[styles.dot, down && styles.dotDown]} />
        <View style={styles.postTitle}>
          <ThemedText type="smallBold" numberOfLines={1} style={{ flexShrink: 1 }}>{post.title}</ThemedText>
          <ThemedText numberOfLines={1} style={styles.postMeta}>{author} · {CITIES.find((city) => city.id === post.city_id)?.name ?? post.city_id} · {formatDate(post.created_at)}</ThemedText>
          {compact && <ThemedText numberOfLines={1} style={styles.postMeta}>조회 {count(fields.view_count)} · 공감 {count(fields.like_count)} · 저장 {count(fields.save_count)}</ThemedText>}
        </View>
        {!compact && <View style={styles.postMetrics}>
          <ThemedText style={styles.postMetric}>{count(fields.view_count)}</ThemedText>
          <ThemedText style={styles.postMetric}>{count(fields.like_count)}</ThemedText>
          <ThemedText style={styles.postMetric}>{count(fields.save_count)}</ThemedText>
        </View>}
      </Pressable>
      {open && (
        <View style={styles.postBody}>
          <View style={styles.postMain}>
            <ThemedText type="small" selectable style={styles.quote}>{post.body}</ThemedText>
            <View style={styles.actions}>
              <AdminButton kind="text" label="글쓴이 보기" onPress={() => onUser(post.author_id)} />
              <View style={styles.grow} />
              {/* '다시 공개' is the only undo for a removed post; draft cancel is '취소' in the adjust card. */}
              {down
                ? <AdminButton label="다시 공개" onPress={() => void apply({ status: 'published' }, '상태')} disabled={busy || localPreview} />
                : <AdminButton kind="danger" label="내리기" onPress={() => void apply({ status: 'removed' }, '상태')} disabled={busy || localPreview} />}
            </View>
          </View>
          <AdminCard icon="⇅" tone="navy" title="수치 조정" style={styles.postAdjust}
            action={<View style={styles.inline}>
              <AdminButton label="맨 위로" onPress={() => void apply({ sort_at: new Date(Date.now() + 36e5).toISOString() }, '노출 순서')} disabled={busy || localPreview} />
              <AdminMoreMenu items={[{ label: '순서 원래대로', onPress: () => void apply({ sort_at: post.created_at }, '노출 순서'), disabled: busy || localPreview }]} />
            </View>}>
            <View style={styles.fieldRow}>
              {POST_COUNTERS.map(({ key, label }) => (
                <View key={key} style={styles.field}>
                  <ThemedText type="small" style={styles.muted}>{label}</ThemedText>
                  <TextInput value={String(draft[key])} onChangeText={(text) => setDraft((current) => ({ ...current, [key]: text }))}
                    inputMode="numeric" editable={!busy} accessibilityLabel={label} style={[styles.adminInput, String(draft[key]) !== String(fields[key]) && styles.adminInputChanged]} />
                </View>
              ))}
              <View style={[styles.field, { flexGrow: 1 }]}>
                <ThemedText type="small" style={styles.muted}>해시태그</ThemedText>
                <TextInput value={draft.hashtags} onChangeText={(text) => setDraft((current) => ({ ...current, hashtags: text }))}
                  editable={!busy} autoCapitalize="none" accessibilityLabel="해시태그" placeholder="밴쿠버 공지"
                  placeholderTextColor={Colors.admin.textSecondary} style={[styles.adminInput, styles.adminInputWide, draft.hashtags !== fields.hashtags && styles.adminInputChanged]} />
              </View>
            </View>
            {changed > 0 && <View style={styles.actions}>
              <ThemedText type="small" style={styles.muted} accessibilityLiveRegion="polite">{`바꾼 값 ${changed}개`}</ThemedText>
              <View style={styles.grow} />
              <AdminButton label="취소" onPress={() => setDraft(fields)} disabled={busy} />
              <AdminButton kind="primary" label={busy ? '반영 중' : '반영'} onPress={applyEdits} disabled={busy || localPreview} />
            </View>}
          </AdminCard>
        </View>
      )}
    </View>
  );
}


// 앱에서 올라온 자바스크립트 오류. 네이티브 충돌은 App Store Connect 와 Play Console 에 따로 쌓인다.
function AdminErrorsPanel({ localPreview }: { localPreview?: boolean }) {
  const { play } = useInteractionFeedback();
  const [rows, setRows] = useState<AdminClientError[] | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('open');
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [versions, setVersions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (localPreview) return;
    let active = true;
    void (async () => {
      try {
        setFailed(false);
        const next = await loadAdminClientErrors(supabase, true);
        if (active) setRows(next);
      } catch { if (active) setFailed(true); }
    })();
    return () => { active = false; };
  }, [localPreview, busy, retry]);

  const toggle = async (row: AdminClientError) => {
    if (localPreview || busy) return;
    setBusy(true);
    try { await resolveAdminClientError(supabase, row.id, !row.resolvedAt); }
    catch { notify('상태를 바꾸지 못했어요.', '권한과 연결을 확인해 주세요.'); }
    finally { setBusy(false); }
  };

  if (localPreview) return <Empty text="로컬 미리보기에서는 오류를 불러오지 않습니다." />;
  if (failed) return (
    <View accessibilityRole="alert" style={[styles.empty, { gap: Spacing.two }]}>
      <ThemedText type="smallBold">오류 목록을 불러오지 못했습니다</ThemedText>
      <ThemedText type="small" style={styles.muted}>관리자 권한이 만료됐거나 연결이 끊긴 상태일 수 있습니다.</ThemedText>
      <Pressable onPress={() => { play('selection'); return setRetry((value) => value + 1); }} accessibilityRole="button" style={[styles.more, styles.retry]}><ThemedText type="smallBold">다시 시도</ThemedText></Pressable>
    </View>
  );
  if (!rows) return <Empty text="불러오는 중" />;

  const status = (row: AdminClientError) => row.resolvedAt ? 'resolved' : 'open';
  const filtered = rows.filter((row) => matches(query.trim().toLocaleLowerCase('ko-KR'), row.message, row.screen, row.stack)
    && (!tab || status(row) === tab) && selected(platforms, row.platform) && selected(versions, row.appVersion));
  return (
    <View style={{ gap: Spacing.three }}>
      <StatusTabs label="해결 상태" value={tab} onChange={setTab} options={[
        { value: 'open', label: '미해결', count: rows.filter((row) => !row.resolvedAt).length },
        { value: 'resolved', label: '해결됨' }, { value: '', label: '전체' }]} />
      <div className="admin-toolbar"><AdminSearch value={query} onChange={setQuery} placeholder="오류 내용, 화면, 스택 검색" />
        <AdminFilterBar applied={platforms.length + versions.length}>
        <div className="admin-filter-row">
          <AdminMultiFilter label="플랫폼" value={platforms} onChange={setPlatforms} options={uniqueOptions(rows.map((row) => row.platform))} />
          <AdminMultiFilter label="앱 버전" value={versions} onChange={setVersions} options={uniqueOptions(rows.map((row) => row.appVersion))} />
          <AdminFilterReset onReset={() => { setQuery(''); setPlatforms([]); setVersions([]); }} />
        </div></AdminFilterBar><AdminTableSummary shown={filtered.length} loaded={rows.length} />
      </div>
      <div className="admin-review-list admin-sec-list" aria-label="앱 오류 목록">
        <ReviewColumns labels={['오류', '발생 횟수', '최근 발생']} />
        {filtered.map((row) => (
          <ReviewRow key={row.id} tone={row.resolvedAt ? 'success' : 'danger'} toneLabel={row.resolvedAt ? '해결됨' : '미해결'}
            title={row.message} sub={`${row.platform} ${row.appVersion}${row.screen ? ` · ${row.screen}` : ''}`} side={`${count(row.occurrences)}회`} time={row.lastSeen}>
            <ThemedText type="small" selectable style={styles.quote}>{row.message}</ThemedText>
            <AdminFacts columns={2} items={[{ label: '처음 발생', value: formatDate(row.firstSeen) }, { label: '기기', value: row.osVersion ?? '기기 정보 없음' }]} />
            {!!row.stack && <details className="admin-context-details" onToggle={() => play('selection')}><summary>스택 보기</summary>
              <TextInput value={row.stack} editable={false} multiline selectTextOnFocus accessibilityLabel="스택" style={styles.code} /></details>}
            <AdminDock>
              <View style={styles.grow} />
              {row.resolvedAt
                ? <AdminButton label="다시 열기" onPress={() => void toggle(row)} disabled={busy} />
                : <AdminButton kind="primary" label="해결 표시" onPress={() => void toggle(row)} disabled={busy} />}
            </AdminDock>
            <AdminTrace items={[{ label: '오류 ID', value: String(row.id) }]} />
          </ReviewRow>
        ))}
        {filtered.length === 0 && <Empty text="조건에 맞는 오류가 없어요." />}
      </div>
    </View>
  );
}

// Shared review row for AI safety, keyword alerts and app errors: summary line → content, fact cards, decision dock, folded trace.
function ReviewRow({ tone, toneLabel, title, sub, side, time, children }: {
  tone: AdminTone; toneLabel: string; title: ReactNode; sub: string; side: string; time: string; children: ReactNode;
}) {
  const { play } = useInteractionFeedback();
  return (
    <details className="admin-review-row" onToggle={() => play('selection')}>
      <summary className="admin-review-summary admin-sec-summary">
        <span className={`admin-sec-dot admin-sec-dot-${tone}`} role="img" aria-label={toneLabel} />
        <span className="admin-review-title"><strong>{title}</strong><span className="admin-muted" title={sub}>{sub}</span></span>
        <span className="admin-sec-side">{side}</span>
        <time className="admin-review-time" dateTime={time}>{formatDate(time)}</time><span className="admin-review-chevron" aria-hidden="true" />
      </summary>
      <div className="admin-review-detail"><View style={styles.detail}>{children}</View></div>
    </details>
  );
}

function ReviewColumns({ labels }: { labels: [string, string, string] }) {
  return <div className="admin-review-columns admin-sec-summary" aria-hidden="true"><span /><span>{labels[0]}</span><span>{labels[1]}</span><span>{labels[2]}</span><span /></div>;
}

// Status lives in these tabs only; the filter menu keeps the other conditions.
function StatusTabs({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string; count?: number }[]; onChange: (value: string) => void }) {
  const { play } = useInteractionFeedback();
  return <div className="admin-status-tabs" role="group" aria-label={label}>{options.map((option) => (
    <button type="button" key={option.value} aria-pressed={value === option.value} onClick={() => { play('selection'); onChange(option.value); }}>
      {option.label}{option.count ? <span className="admin-sec-tab-count">{count(option.count)}</span> : null}
    </button>))}</div>;
}

function riskTone(level: string | null): AdminTone {
  return level === 'critical' || level === 'high' ? 'danger' : level === 'medium' ? 'warning' : level === 'low' ? 'success' : 'neutral';
}

function SectionHeading({ title, info, description }: { title: string; info?: string | string[]; description?: string }) {
  return <View style={styles.heading}>
    <ThemedText type="title" accessibilityRole="header" style={styles.title}>{title}</ThemedText>
    {!!info && <AdminInfo text={info} />}
    {!!description && <ThemedText type="small" style={styles.muted}>{description}</ThemedText>}
  </View>;
}

function UserRow({ profile, compact, last, onPress }: { profile: AdminProfile; compact: boolean; last: boolean; onPress: () => void }) {
  const { play } = useInteractionFeedback();
  const location = `${profile.city_id ?? '지역 삭제됨'}${profile.neighborhood ? ` · ${profile.neighborhood}` : ''}`;
  return (
    <Pressable onPress={() => { play('selection'); onPress(); }} accessibilityRole="button" accessibilityLabel={`${profile.nickname}, ${location}, 신뢰 ${profile.verification_level}, ${profile.id}`} style={({ pressed }) => [styles.userRow, last && styles.userRowLast, pressed && styles.pressed]}>
      <View style={styles.userAvatar} accessibilityElementsHidden>
        <ThemedText type="smallBold" style={styles.userAvatarText}>{profile.nickname.trim().slice(0, 1)}</ThemedText>
      </View>
      <View style={styles.userIdentity}>
        <ThemedText type="smallBold" numberOfLines={1}>{profile.nickname}</ThemedText>
        <ThemedText type="small" numberOfLines={1} style={styles.id}>{compact ? location : profile.id}</ThemedText>
      </View>
      {!compact && <ThemedText type="small" numberOfLines={1} style={styles.userLocation}>{location}</ThemedText>}
      <StateText text={`신뢰 ${profile.verification_level}`} />
      <ThemedText accessibilityElementsHidden style={styles.chevron}>›</ThemedText>
    </Pressable>
  );
}

function StateText({ text, danger = false }: { text: string; danger?: boolean }) {
  return <ThemedText type="smallBold" style={[styles.state, danger && styles.danger]}>{text}</ThemedText>;
}

function Empty({ text = '검색 결과가 없습니다.', hint }: { text?: string; hint?: string }) {
  return (
    <View accessibilityRole="text" style={[styles.empty, { gap: Spacing.two, paddingHorizontal: Spacing.four }]}>
      <ThemedText type="smallBold">{text}</ThemedText>
      {!!hint && <ThemedText type="small" style={[styles.muted, { textAlign: 'center' }]}>{hint}</ThemedText>}
    </View>
  );
}

function LoadMore({ loading, noMore, onPress }: { loading: boolean; noMore: boolean; onPress: () => void }) {
  const { play } = useInteractionFeedback();
  return <Pressable onPress={() => { play('selection'); onPress(); }} disabled={loading || noMore} accessibilityRole="button" accessibilityState={{ disabled: loading || noMore, busy: loading }} style={[styles.more, (loading || noMore) && styles.moreDisabled]}><ThemedText type="smallBold">{noMore ? '마지막 기록입니다' : loading ? '불러오는 중' : '이전 기록 더 보기'}</ThemedText></Pressable>;
}

function recordOptions(values: Record<string, string>) { return Object.entries(values).map(([value, label]) => ({ value, label })); }
function uniqueOptions(values: string[]) { return [...new Set(values)].sort().map((value) => ({ value, label: value })); }

function formatDate(value: string) { return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }

const styles = StyleSheet.create({
  section: { gap: 20 },
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.one },
  grow: { flex: 1 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  detail: { gap: Spacing.three },
  done: { color: Colors.admin.success },
  quote: { paddingVertical: 12, paddingHorizontal: 14, borderLeftWidth: 3, borderLeftColor: Colors.admin.line, borderRadius: 8, backgroundColor: Colors.admin.background, lineHeight: 22 },
  code: { fontFamily: 'Menlo', fontSize: 11, lineHeight: 16, maxHeight: 200, padding: Spacing.two, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 6, color: Colors.admin.text },
  split: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: Spacing.three },
  splitMain: { flexGrow: 2, flexBasis: 420 },
  splitSide: { flexGrow: 1, flexBasis: 280, gap: Spacing.three },
  sessionGroup: { gap: 2, paddingBottom: Spacing.two },
  sessionUser: { minHeight: 44, justifyContent: 'center' },
  postMain: { flexGrow: 1, flexBasis: 320, gap: Spacing.two },
  postAdjust: { flexGrow: 1, flexBasis: 300 },
  adminInputChanged: { borderColor: Colors.admin.warning, backgroundColor: Colors.admin.warningBackground },
  subheading: { gap: Spacing.one },
  title: { fontSize: 28, lineHeight: 36, letterSpacing: -0.6 },
  muted: { color: Colors.admin.textSecondary },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  metric: { flexBasis: 150, minWidth: 0, flexGrow: 1, padding: Spacing.three, gap: Spacing.two, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 10, backgroundColor: Colors.admin.card },
  metricUrgent: { borderColor: '#EED3D9', backgroundColor: Colors.admin.dangerBackground },
  metricValue: { fontSize: 30, lineHeight: 36, fontVariant: ['tabular-nums'] },
  urgent: { color: Colors.admin.danger },
  search: { minHeight: 44, paddingHorizontal: Spacing.three, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 8, color: Colors.admin.text, backgroundColor: Colors.admin.card },
  rows: { gap: Spacing.two },
  userRows: { overflow: 'hidden', borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 8, backgroundColor: Colors.admin.card },
  userRow: { minHeight: 56, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderBottomWidth: 1, borderBottomColor: Colors.admin.line },
  userRowLast: { borderBottomWidth: 0 },
  userAvatar: { width: 32, height: 32, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: Colors.admin.backgroundSelected },
  userAvatarText: { color: Colors.admin.accent },
  userIdentity: { minWidth: 0, flex: 1 },
  userLocation: { flexBasis: 180, flexShrink: 1, color: Colors.admin.textSecondary },
  chevron: { color: Colors.admin.textSecondary, fontSize: 20, lineHeight: 20 },
  row: { padding: Spacing.three, gap: Spacing.one, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 6, backgroundColor: Colors.admin.card },
  rowTop: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  state: { fontSize: 11, color: Colors.admin.navy, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5, backgroundColor: Colors.admin.backgroundElement },
  danger: { color: Colors.admin.danger, backgroundColor: Colors.admin.dangerBackground },
  id: { color: Colors.admin.textSecondary, fontFamily: 'monospace' },
  empty: { minHeight: 160, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 10, backgroundColor: Colors.admin.card },
  more: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 8, backgroundColor: Colors.admin.card },
  retry: { alignSelf: 'center', paddingHorizontal: Spacing.four },
  moreDisabled: { opacity: 0.55 },
  pressed: { backgroundColor: Colors.admin.backgroundElement },
  list: { borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 10, backgroundColor: Colors.admin.card, overflow: 'hidden' },
  postRow: { borderTopWidth: 1, borderTopColor: Colors.admin.line },
  postRowFirst: { borderTopWidth: 0 },
  postHead: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.admin.success },
  dotDown: { backgroundColor: Colors.admin.danger },
  postTitle: { flex: 1, minWidth: 0, gap: 1 },
  postMeta: { color: Colors.admin.textSecondary, fontSize: 12 },
  postMetrics: { flexDirection: 'row', gap: Spacing.three },
  postMetric: { color: Colors.admin.textSecondary, fontSize: 12, fontVariant: ['tabular-nums'], minWidth: 62, textAlign: 'right' },
  postBody: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', paddingHorizontal: Spacing.three, paddingTop: Spacing.three, paddingBottom: Spacing.three, gap: Spacing.three, borderTopWidth: 1, borderTopColor: Colors.admin.line },
  fieldRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  field: { gap: 4 },
  adminInputWide: { flexBasis: 220, minWidth: 160, textAlign: 'left' },
  adminInput: { flexBasis: 104, minWidth: 88, minHeight: 44, paddingHorizontal: Spacing.two, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 6, color: Colors.admin.text, textAlign: 'right' },
});

const ALERT_CATEGORY: Record<string, string> = {
  drugs: '마약', weapons: '무기', sexual_exploitation: '성착취', fraud: '사기', self_harm: '자해·자살',
  violence: '폭력·위협', doxxing: '신상 공개', illegal_status: '불법 체류·위조',
};
const SAFETY_TARGET_LABEL: Record<AdminSafetyTargetType, string> = { post: '게시글', comment: '댓글', message: '메시지', chilling_profile: '칠링 프로필', chilling_application: '칠링 참여 신청', merchant_review: '비즈니스 후기', merchant_review_reply: '비즈니스 답변', meetup_review: '모임 후기', manner_review: '비공개 매너 평가', meetup_attendance: '참석 이의제기' };
const SAFETY_RISK_LABEL = { low: '낮음', medium: '보통', high: '높음', critical: '심각', pending: '미분석' };
const SAFETY_STATUS_LABEL = { pending: '분석 대기', processing: '분석 중', reviewed: '분석 완료', failed: '분석 실패' };

function AdminChillingContent({ targetType, targetId, localPreview, onUser }: {
  targetType: 'chilling_profile' | 'chilling_application'; targetId: string; localPreview?: boolean; onUser: (id: string) => void;
}) {
  const [content, setContent] = useState<{ authorId: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    if (localPreview || busy) return;
    setBusy(true);
    setError('');
    setContent(null);
    try {
      const result = await loadAdminChillingContent(supabase, targetType, targetId);
      setContent(result);
      if (!result) setError('내용을 찾을 수 없습니다.');
    } catch {
      setError('내용을 불러오지 못했습니다. 권한과 연결 상태를 확인해주세요.');
    } finally {
      setBusy(false);
    }
  };
  return <View>
    <ActionText label={busy ? '불러오는 중' : '내용 보기'} onPress={() => void load()} disabled={localPreview || busy} />
    {error ? <ThemedText type="small" accessibilityRole="alert">{error}</ThemedText> : null}
    {content && <>
      <ThemedText type="small" selectable>{content.text}</ThemedText>
      <ActionText label="작성자 이력 보기" onPress={() => onUser(content.authorId)} />
    </>}
  </View>;
}

const ALERT_STATUS: Record<AdminSafetyAlert['status'], string> = { open: '미처리', reviewed: '검토 완료', dismissed: '해당 없음', escalated: '공권력 이관' };

// ponytail: 로컬 상태로 행을 갱신한다. 전체 재조회는 상단 새로고침이 담당.
function AdminAlertsPanel({ alerts, profiles, localPreview, onUser }: {
  alerts: AdminSafetyAlert[]; profiles: Map<string, AdminProfile>; localPreview?: boolean; onUser: (userId: string) => void;
}) {
  const [overrides, setOverrides] = useState<Record<number, Partial<AdminSafetyAlert>>>({});
  const [evidence, setEvidence] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<string>('open');
  const [categories, setCategories] = useState<string[]>([]);
  const [severities, setSeverities] = useState<string[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const rows = alerts.map((alert) => ({ ...alert, ...overrides[alert.id] })).filter((alert) =>
    matches(query.trim().toLocaleLowerCase('ko-KR'), alert.excerpt, alert.author_id, alert.target_id, alert.note, profiles.get(alert.author_id)?.nickname, ...alert.matched_terms)
    && (!tab || alert.status === tab) && selected(categories, alert.category) && selected(severities, alert.severity) && selected(targets, alert.target_type));
  const act = async (alert: AdminSafetyAlert, status: AdminSafetyAlert['status']) => {
    if (localPreview || busy) return;
    setBusy(alert.id);
    try {
      await resolveAdminSafetyAlert(supabase, alert.id, status);
      setOverrides((current) => ({ ...current, [alert.id]: { status, reviewed_at: new Date().toISOString() } }));
    } catch {
      notify('경보 상태를 바꾸지 못했어요.', '권한과 연결 상태를 확인해 주세요.');
    } finally {
      setBusy(null);
    }
  };
  const exportEvidence = async (alert: AdminSafetyAlert) => {
    if (localPreview || busy) return;
    setBusy(alert.id);
    try {
      const bundle = await exportAdminSafetyEvidence(supabase, alert.id);
      setEvidence((current) => ({ ...current, [alert.id]: JSON.stringify(bundle, null, 2) }));
    } catch {
      notify('증거 묶음을 만들지 못했어요.', '권한과 연결 상태를 확인해 주세요.');
    } finally {
      setBusy(null);
    }
  };
  const confirmEscalate = (alert: AdminSafetyAlert) => {
    if (ask('공권력 이관으로 표시할까요?', '표시 자체는 외부로 전송되지 않아요. 증거 묶음을 내보내 공식 요청서와 함께 제출해 주세요. 운영 기록에 남아요.')) void act(alert, 'escalated');
  };
  const statusCounts = alerts.map((alert) => ({ ...alert, ...overrides[alert.id] }));
  return (
    <View style={styles.section}>
      <StatusTabs label="경보 상태" value={tab} onChange={setTab}
        options={[...recordOptions(ALERT_STATUS).map((option) => ({ ...option, count: option.value === 'open' ? statusCounts.filter((alert) => alert.status === 'open').length : undefined })), { value: '', label: '전체' }]} />
      <div className="admin-toolbar"><AdminSearch value={query} onChange={setQuery} placeholder="감시어, 내용, 작성자 또는 ID 검색" />
        <AdminFilterBar applied={categories.length + severities.length + targets.length}>
          <div className="admin-filter-row">
            <AdminMultiFilter label="심각도" value={severities} onChange={setSeverities} options={recordOptions({ medium: '보통', high: '높음', critical: '심각' })} />
            <AdminMultiFilter label="분류" value={categories} onChange={setCategories} options={recordOptions(ALERT_CATEGORY)} />
            <AdminMultiFilter label="대상" value={targets} onChange={setTargets} options={recordOptions(SAFETY_TARGET_LABEL)} />
            <AdminFilterReset onReset={() => { setQuery(''); setCategories([]); setSeverities([]); setTargets([]); }} />
          </div>
        </AdminFilterBar><AdminTableSummary shown={rows.length} loaded={alerts.length} />
      </div>
      <div className="admin-review-list admin-sec-list" aria-label="감시어 경보 목록">
      <ReviewColumns labels={['감지 내용', '작성자', '발생']} />
      {rows.length === 0 && <Empty text="조건에 맞는 경보가 없어요." hint="감시어에 걸린 표현이 없으면 경보는 생기지 않아요. 다른 탭을 보거나 이전 기록을 더 불러와 보세요." />}
      {rows.map((alert) => {
        const author = profiles.get(alert.author_id);
        const sameAuthor = statusCounts.filter((row) => row.author_id === alert.author_id).length;
        const open = alert.status === 'open';
        return (
          <ReviewRow key={alert.id} tone={alert.severity === 'medium' ? 'warning' : 'danger'} toneLabel={`심각도 ${SAFETY_RISK_LABEL[alert.severity]}`}
            title={<>{ALERT_CATEGORY[alert.category] ?? alert.category} 관련 표현{!open && <span className={`admin-badge admin-sec-inline-badge${alert.status === 'reviewed' ? ' admin-badge-success' : alert.status === 'escalated' ? ' admin-badge-danger' : ''}`}>{ALERT_STATUS[alert.status]}</span>}</>}
            sub={`${SAFETY_TARGET_LABEL[alert.target_type] ?? alert.target_type} · 일치어 ${(alert.matched_terms ?? []).map((term) => `"${term}"`).join(', ')}`}
            side={displayName(author, alert.author_id)} time={alert.created_at}>
            <ThemedText type="small" selectable style={styles.quote}>{alert.excerpt}</ThemedText>
            {(alert.target_type === 'chilling_profile' || alert.target_type === 'chilling_application') && <AdminChillingContent targetType={alert.target_type} targetId={alert.target_id} localPreview={localPreview} onUser={onUser} />}
            {alert.target_type === 'merchant_review' && <AdminMerchantReviewContent targetId={alert.target_id} localPreview={localPreview} onUser={onUser} />}
            {alert.target_type === 'merchant_review_reply' && <AdminMerchantReviewReplyContent targetId={alert.target_id} localPreview={localPreview} onUser={onUser} />}
            {isTrustTarget(alert.target_type) && <AdminTrustReviewContent targetType={alert.target_type} targetId={alert.target_id} localPreview={localPreview} onUser={onUser} />}
            <AdminFacts items={[
              { label: '심각도', value: SAFETY_RISK_LABEL[alert.severity], tone: alert.severity === 'medium' ? 'warning' : 'danger' },
              { label: '위치', value: SAFETY_TARGET_LABEL[alert.target_type] ?? alert.target_type },
              { label: '같은 사람 경보', value: sameAuthor > 1 ? `불러온 목록에 ${sameAuthor}건` : '불러온 목록에 이 건뿐' },
              { label: '도시', value: CITIES.find((city) => city.id === author?.city_id)?.name ?? author?.city_id ?? '정보 없음' },
              ...(alert.note ? [{ label: '메모', value: alert.note }] : []),
            ]} />
            <AdminDock>
              <AdminButton kind="text" label="작성자 활동" onPress={() => onUser(alert.author_id)} />
              <View style={styles.grow} />
              {open && <AdminButton label="해당 없음" onPress={() => void act(alert, 'dismissed')} disabled={busy !== null} />}
              {open && <AdminButton kind="primary" label="검토 완료" onPress={() => void act(alert, 'reviewed')} disabled={busy !== null} />}
              <AdminMoreMenu items={[
                { label: evidence[alert.id] ? '증거 묶음 새로 만들기' : '증거 묶음 내보내기', onPress: () => void exportEvidence(alert), disabled: busy !== null },
                ...(alert.status !== 'escalated' ? [{ label: '공권력 이관', onPress: () => confirmEscalate(alert), danger: true, disabled: busy !== null }] : []),
              ]} />
            </AdminDock>
            {evidence[alert.id] && <TextInput value={evidence[alert.id]} editable={false} multiline selectTextOnFocus accessibilityLabel="증거 묶음 JSON" style={[styles.code, { maxHeight: 240 }]} />}
            <AdminTrace items={[{ label: '경보 ID', value: String(alert.id) }, { label: '대상 ID', value: alert.target_id }, { label: '작성자 ID', value: alert.author_id }]} />
          </ReviewRow>
        );
      })}
      </div>
    </View>
  );
}

function ActionText({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { play } = useInteractionFeedback();
  return (
    <Pressable onPress={() => { play('selection'); onPress(); }} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled }} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 8, backgroundColor: Colors.admin.card, opacity: disabled ? 0.5 : 1 }}>
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );
}
