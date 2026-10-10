import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { matches, selected } from './admin-section-filter';
import { AdminFilterBar, AdminMultiFilter, AdminSelect, AdminSearch, AdminFilterReset, AdminTableSummary } from '@/components/admin/admin-table-controls';
import { AdminReportQueue } from '@/components/admin/admin-report-queue';
import { AdminMerchantReviewContent } from '@/components/admin/admin-merchant-review-content';
import { AdminMerchantReviewReplyContent } from '@/components/admin/admin-merchant-review-reply-content';
import { AdminTrendingPanel } from '@/components/admin/admin-trending-panel';
import { AdminUserDirectoryPanel } from '@/components/admin/admin-user-directory';
import { conversationLabel, decodeUserAgent, displayName, shortId } from '@/lib/admin-labels';
import { isCompactAdminWidth } from '@/lib/admin-layout';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import type { AdminSection } from '@/lib/admin';
import { exportAdminSafetyEvidence, loadAdminChillingContent, loadAdminClientErrors, resolveAdminClientError, resolveAdminSafetyAlert, setAdminPostFields, type AdminDashboardData, type AdminPost, type AdminProfile, type AdminSafetyAlert, type AdminSafetyTargetType } from '@/lib/admin-data';
import type { AdminClientError, AdminPostFields, AdminPostPatch } from '@/lib/admin-trending';
import { count } from '@/i18n/ko';
import { CITIES } from '@/lib/mock';
import { supabase } from '@/lib/supabase';

export function AdminSectionView({
  section,
  data,
  resolving,
  loadingMore,
  noMore,
  onUser,
  onResolve,
  onLoadMore,
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
  localPreview?: boolean;
}) {
  const { play } = useInteractionFeedback();
  const [query, setQuery] = useState('');
  const [postStatus, setPostStatus] = useState<string[]>([]);
  const [postCity, setPostCity] = useState<string[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [risks, setRisks] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [senders, setSenders] = useState<string[]>([]);
  const [rooms, setRooms] = useState<string[]>([]);
  const [postSort, setPostSort] = useState('new');
  const windowWidth = useWindowDimensions().width;
  const compactUsers = windowWidth < 560;
  const compact = isCompactAdminWidth(windowWidth);
  const profiles = useMemo(() => new Map(data.profiles.map((profile) => [profile.id, profile])), [data.profiles]);
  const needle = query.trim().toLocaleLowerCase('ko-KR');

  if (section === 'overview') {
    const attention = [
      { key: 'openReports' as const, label: '미처리 신고', value: data.counts.openReports, urgent: true },
      { key: 'alertsOpen' as const, label: '감시어 경보', value: data.counts.alertsOpen, urgent: data.counts.alertsOpen > 0 },
      { key: 'safetyHigh' as const, label: 'AI 고위험', value: data.counts.safetyHigh, urgent: true },
      { key: 'safetyPending' as const, label: 'AI 처리 대기', value: data.counts.safetyPending },
    ];
    const scale = [
      { key: 'profiles' as const, label: '전체 사용자', value: data.counts.profiles },
      { key: 'posts' as const, label: '전체 게시글', value: data.counts.posts },
      { key: 'messages' as const, label: '전체 메시지', value: data.counts.messages },
    ];
    type Metric = { key: keyof NonNullable<AdminDashboardData['deltas']>; label: string; value: number; urgent?: boolean };
    const deltaText = (key: Metric['key']) => {
      const delta = data.deltas?.[key];
      if (!delta) return null;
      const diff = delta.now - delta.before;
      if (diff === 0) return '24시간 전과 같음';
      return `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)} · 24시간 전 ${delta.before}`;
    };
    const metrics = (items: Metric[]) => (
      <View style={styles.metrics}>
        {items.map((item) => (
          <View key={item.label} accessibilityLabel={`${item.label} ${item.value}건`} style={[styles.metric, item.urgent && item.value > 0 && styles.metricUrgent]}>
            <ThemedText type="small" style={styles.muted}>{item.label}</ThemedText>
            <ThemedText type="title" style={[styles.metricValue, item.urgent && item.value > 0 && styles.urgent]}>{count(item.value)}</ThemedText>
            {!!deltaText(item.key) && <ThemedText type="small" style={styles.muted}>{deltaText(item.key)}</ThemedText>}
          </View>
        ))}
      </View>
    );
    return (
      <View style={styles.section}>
        <SectionHeading title="운영 현황" description="신고 여부와 무관하게 전체 활동을 확인할 수 있습니다." />
        <View style={styles.heading}>
          <ThemedText type="smallBold">지금 처리할 일</ThemedText>
        </View>
        {metrics(attention)}
        <View style={styles.heading}>
          <ThemedText type="smallBold">서비스 규모</ThemedText>
        </View>
        {metrics(scale)}
        {data.sharedSessions.length > 0 && <>
          <View style={styles.subheading}>
            <ThemedText type="subtitle" accessibilityRole="header">다계정 의심 · {data.sharedSessions.length}건</ThemedText>
            <ThemedText type="small" style={styles.muted}>최근 30일 안에 같은 IP(또는 같은 IP·기기)로 접속한 계정이 둘 이상입니다. 가정·사무실·통신사 공유 IP일 수 있으니 댓글·글 활동을 함께 보고 판단하세요.</ThemedText>
          </View>
          <View style={styles.rows}>
            {data.sharedSessions.map((group) => (
              <View key={`${group.ip}:${group.user_agent ?? 'ip'}`} style={styles.row}>
                <View style={styles.rowTop}>
                  <ThemedText type="smallBold">{group.same_device ? '같은 IP · 같은 기기' : '같은 IP'} · {group.ip}</ThemedText>
                  <StateText text={`${group.user_count}개 계정`} danger={group.same_device} />
                </View>
                {group.user_agent && <ThemedText type="small" style={styles.muted} numberOfLines={1}>{decodeUserAgent(group.user_agent)}</ThemedText>}
                <View style={styles.rowTop}>
                  {group.users.map((user) => (
                    <Pressable key={user.id} onPress={() => { play('selection'); return onUser(user.id); }} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
                      <ThemedText type="small">{user.nickname}{user.account_type !== 'member' ? ` (${user.account_type})` : ''} · 글 {count(user.posts)} · 댓글 {count(user.comments)} · {formatDate(user.last_seen)}</ThemedText>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
          </View>
        </>}
        <View style={styles.subheading}>
          <ThemedText type="subtitle" accessibilityRole="header">최근 신고</ThemedText>
          <ThemedText type="small" style={styles.muted}>미처리 항목을 먼저 표시합니다.</ThemedText>
        </View>
        <AdminReportQueue reports={data.reports.slice(0, 5)} profiles={profiles} actions={data.moderationActions} resolving={resolving} onUser={onUser} onResolve={onResolve} />
      </View>
    );
  }

  if (section === 'alerts') {
    return (
      <View style={styles.section}>
        <SectionHeading title="감시어 경보" description="표현 일치는 신호입니다. 원문과 맥락을 검토해주세요." />
        <div className="admin-summary-strip"><span>미처리<strong className={data.counts.alertsOpen ? 'admin-summary-danger' : undefined}>{count(data.counts.alertsOpen)}건</strong></span><span>불러온 경보<strong>{count(data.safetyAlerts.length)}건</strong></span></div>
        <AdminAlertsPanel alerts={data.safetyAlerts} profiles={profiles} localPreview={localPreview} onUser={onUser} />
        <details className="admin-context-details" onToggle={() => play('selection')}><summary>감시 범위와 판단 기준</summary><p>마약·무기·성착취·사기·자해·위협·신상공개·불법체류 관련 표현을 글·댓글·대화·칠링·업체 후기에서 감시합니다. 표현 일치는 신호이며 위반 확정이 아닙니다. 최종 판단은 운영자가 합니다.</p></details>
        <LoadMore loading={loadingMore} noMore={noMore} onPress={onLoadMore} />
      </View>
    );
  }

  if (section === 'trending') {
    return (
      <View style={styles.section}>
        <SectionHeading title="뜨는 글 알림" description="도시마다 반응이 오는 글 하나를 골라 그 도시 사용자에게만 알립니다. 점수 값을 바꾸면 아래 미리보기가 함께 바뀝니다." />
        <AdminTrendingPanel localPreview={localPreview} />
      </View>
    );
  }

  if (section === 'errors') {
    return (
      <View style={styles.section}>
        <SectionHeading title="앱 오류" description="사용자 폰에서 난 자바스크립트 오류입니다. 같은 오류는 한 줄로 묶이고 앱 버전별로 따로 셉니다. 네이티브 충돌은 App Store Connect 와 Play Console 에서 봅니다." />
        <AdminErrorsPanel localPreview={localPreview} />
      </View>
    );
  }

  if (section === 'safety') {
    // 대상이 글일 때는 ID 대신 제목을 보여준다. 댓글·메시지는 본문을 따로 불러오지 않으므로 짧은 ID를 유지한다.
    const allPosts = [...data.posts, ...(data.contextPosts ?? [])];
    const targetLabel = (review: { target_type: AdminSafetyTargetType; target_id: string }) => {
      const label = SAFETY_TARGET_LABEL[review.target_type] ?? review.target_type;
      if (review.target_type === 'post') {
        const post = allPosts.find((row) => row.id === review.target_id);
        if (post) return `${label} · ${post.title}`;
      }
      return `${label} · ${shortId(review.target_id)}`;
    };
    const reviews = data.safetyReviews.filter((review) => matches(needle, review.target_id, review.last_error, ...review.risk_reasons)
      && selected(targets, review.target_type) && selected(risks, review.risk_level ?? 'pending') && selected(statuses, review.status));
    return (
      <View style={styles.section}>
        <SectionHeading title="AI 안전 모니터링" description="전체 활동의 분석 결과를 확인하고 위험 신호를 검토합니다." />
        <div className="admin-summary-strip"><span>처리 대기<strong>{count(data.counts.safetyPending)}건</strong></span><span>고위험<strong className={data.counts.safetyHigh ? 'admin-summary-danger' : undefined}>{count(data.counts.safetyHigh)}건</strong></span><span>불러온 분석<strong>{count(data.safetyReviews.length)}건</strong></span></div>
        <div className="admin-toolbar"><AdminSearch value={query} onChange={setQuery} placeholder="대상 ID, 분석 이유, 오류 검색" />
          <AdminFilterBar applied={targets.length + risks.length + statuses.length}>
            <div className="admin-filter-row">
              <AdminMultiFilter label="대상" options={recordOptions(SAFETY_TARGET_LABEL)} value={targets} onChange={setTargets} />
              <AdminMultiFilter label="위험도" options={recordOptions(SAFETY_RISK_LABEL)} value={risks} onChange={setRisks} />
              <AdminMultiFilter label="처리 상태" options={recordOptions(SAFETY_STATUS_LABEL)} value={statuses} onChange={setStatuses} />
              <AdminFilterReset onReset={() => { setQuery(''); setTargets([]); setRisks([]); setStatuses([]); }} />
            </div>
          </AdminFilterBar><AdminTableSummary shown={reviews.length} loaded={data.safetyReviews.length} />
        </div>
        <div className="admin-status-tabs" role="group" aria-label="안전 검토 빠른 필터">
          <button type="button" aria-pressed={!risks.length && !statuses.length} onClick={() => { play('selection'); setRisks([]); setStatuses([]); }}>전체</button>
          <button type="button" aria-pressed={risks.length === 2 && risks.includes('high') && risks.includes('critical') && !statuses.length} onClick={() => { play('selection'); setRisks(['high', 'critical']); setStatuses([]); }}>고위험</button>
          <button type="button" aria-pressed={statuses.length === 2 && statuses.includes('pending') && statuses.includes('processing') && !risks.length} onClick={() => { play('selection'); setRisks([]); setStatuses(['pending', 'processing']); }}>분석 대기·진행</button>
          <button type="button" aria-pressed={statuses.length === 1 && statuses[0] === 'failed' && !risks.length} onClick={() => { play('selection'); setRisks([]); setStatuses(['failed']); }}>분석 실패</button>
        </div>
        <div className="admin-review-list" aria-label="AI 안전 분석 목록">
          <div className="admin-review-columns" aria-hidden="true"><span>분석 대상</span><span>위험도</span><span>분석 상태</span><span>생성 시각</span><span /></div>
          {reviews.map((review) => (
            <details key={review.id} className="admin-review-row" onToggle={() => play('selection')}>
              <summary className="admin-review-summary">
                <span className="admin-review-title"><strong>{targetLabel(review)}</strong><span className="admin-muted">{review.risk_reasons.join(' · ') || review.last_error || '분석 결과를 기다리고 있습니다.'}</span></span>
                <span className={`admin-badge${review.risk_level === 'critical' || review.risk_level === 'high' ? ' admin-badge-danger' : review.risk_level === 'medium' ? ' admin-badge-warning' : review.risk_level === 'low' ? ' admin-badge-success' : ''}`}>{SAFETY_RISK_LABEL[review.risk_level ?? 'pending']}</span>
                <span className={`admin-badge${review.status === 'failed' ? ' admin-badge-danger' : review.status === 'reviewed' ? ' admin-badge-success' : ' admin-badge-accent'}`}>{SAFETY_STATUS_LABEL[review.status]}</span>
                <time className="admin-review-time" dateTime={review.created_at}>{formatDate(review.created_at)}</time><span className="admin-review-chevron" aria-hidden="true" />
              </summary><div className="admin-review-detail"><View style={{ gap: Spacing.three }}>
              <View style={styles.rowTop}>
                <ThemedText type="smallBold">{targetLabel(review)}</ThemedText>
                <ThemedText type="small" style={styles.muted}>{shortId(review.target_id)}</ThemedText>
                <StateText text={SAFETY_RISK_LABEL[review.risk_level ?? 'pending']} danger={review.risk_level === 'high' || review.risk_level === 'critical' || review.status === 'failed'} />
              </View>
              <ThemedText type="small">{review.risk_reasons.length ? review.risk_reasons.join(' · ') : review.last_error ?? '분석 결과 대기 중'}</ThemedText>
              <ThemedText type="small" style={styles.muted}>분석 점수 {review.risk_score ?? '미분석'} · 시도 {review.attempts}회 · 대상 ID {review.target_id}</ThemedText>
              {(review.target_type === 'chilling_profile' || review.target_type === 'chilling_application') && <AdminChillingContent targetType={review.target_type} targetId={review.target_id} localPreview={localPreview} onUser={onUser} />}
              {review.target_type === 'merchant_review' && <AdminMerchantReviewContent targetId={review.target_id} localPreview={localPreview} onUser={onUser} />}
              {review.target_type === 'merchant_review_reply' && <AdminMerchantReviewReplyContent targetId={review.target_id} localPreview={localPreview} onUser={onUser} />}
            </View></div></details>
          ))}
          {reviews.length === 0 && <Empty text="조건에 맞는 안전 검토 기록이 없습니다." />}
        </div>
        <ThemedText type="small" style={styles.muted}>AI 결과는 검토 우선순위를 돕는 신호입니다. 최종 조치는 원문과 맥락을 확인한 운영자가 판단합니다.</ThemedText>
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
    return <View style={styles.section}><SectionHeading title="사용자" description="사용자를 선택하면 글·댓글·대화·신고 이력을 함께 봅니다." />{search}<View style={styles.userRows}>{rows.map((profile, index) => <UserRow key={profile.id} profile={profile} compact={compactUsers} last={index === rows.length - 1} onPress={() => onUser(profile.id)} />)}{rows.length === 0 && <Empty />}</View><LoadMore loading={loadingMore} noMore={noMore} onPress={onLoadMore} /></View>;
  }

  if (section === 'posts') {
    const rows = data.posts
      .filter((post) => matches(needle, post.title, post.body, post.city_id, post.author_id, post.id, profiles.get(post.author_id)?.nickname))
      .filter((post) => selected(postStatus, post.status) && selected(postCity, post.city_id))
      .sort((a, b) => postSort === 'views' ? (b.view_count ?? 0) - (a.view_count ?? 0)
        : postSort === 'likes' ? (b.like_count ?? 0) - (a.like_count ?? 0)
        : b.created_at.localeCompare(a.created_at));
    return (
      <View style={styles.section}>
        <SectionHeading title="게시글" description="한 줄에 한 글입니다. 조정이 필요한 글만 펼치세요. 조회수·공감수·저장수·노출 순서·해시태그는 여기서만 바꿉니다." />
        <div className="admin-toolbar">
          <AdminSearch value={query} onChange={setQuery} placeholder="제목, 내용, 작성자 또는 ID 검색" />
          <AdminFilterBar applied={postStatus.length + postCity.length}>
            <div className="admin-filter-row">
              <AdminMultiFilter label="상태" value={postStatus} onChange={setPostStatus} options={recordOptions({ published: '게시중', removed: '삭제됨' })} />
              <AdminMultiFilter label="도시" value={postCity} onChange={setPostCity} options={CITIES.map((city) => ({ value: city.id, label: city.name }))} />
              <AdminSelect label="정렬" value={postSort} onChange={setPostSort} options={recordOptions({ new: '최신순', views: '조회순', likes: '공감순' })} />
              <AdminFilterReset onReset={() => { setQuery(''); setPostStatus([]); setPostCity([]); setPostSort('new'); }} />
            </div>
          </AdminFilterBar><AdminTableSummary shown={rows.length} loaded={data.posts.length} />
        </div>
        <div className={compact ? undefined : 'admin-table-wrap'}><View style={[styles.list, { minWidth: compact ? 0 : 680, borderWidth: 0 }]}>
          {!compact && <View style={styles.postHead}>
            <ThemedText type="smallBold" style={{ flex: 1 }}>게시글 · 작성자 · 지역</ThemedText>
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

  const conversationsById = new Map(data.conversations.map((conversation) => [conversation.id, conversation]));
  const roomLabel = (conversationId: string) => {
    const conversation = conversationsById.get(conversationId);
    return conversation
      ? conversationLabel(conversation, profiles, [...data.posts, ...(data.contextPosts ?? [])])
      : { primary: `대화 ${shortId(conversationId)}`, secondary: '대화 정보 없음' };
  };
  const roomOptions = [...new Set([...data.conversations.map((conversation) => conversation.id), ...data.messages.map((message) => message.conversation_id)])]
    .map((id) => ({ value: id, label: roomLabel(id).primary }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ko-KR'));
  const messages = data.messages.filter((message) => matches(needle, message.body, message.sender_id, message.conversation_id, profiles.get(message.sender_id)?.nickname, roomLabel(message.conversation_id).primary)
    && selected(senders, message.sender_id) && selected(rooms, message.conversation_id));
  return <View style={styles.section}>
    <SectionHeading title="대화" description="불러온 메시지를 검색합니다. 내용을 펼치면 전문과 작성자 이력을 확인할 수 있습니다." />
    <div className="admin-toolbar"><AdminSearch value={query} onChange={setQuery} placeholder="내용, 작성자 이름 검색" />
      <AdminFilterBar applied={senders.length + rooms.length}>
        <div className="admin-filter-row">
          <AdminMultiFilter label="작성자" options={Array.from(new Set(data.messages.map((message) => message.sender_id))).map((id) => ({ value: id, label: displayName(profiles.get(id), id) })).sort((a, b) => a.label.localeCompare(b.label, 'ko-KR'))} value={senders} onChange={setSenders} />
          <AdminMultiFilter label="대화방" options={roomOptions} value={rooms} onChange={setRooms} />
          <AdminFilterReset onReset={() => { setQuery(''); setSenders([]); setRooms([]); }} />
        </div>
      </AdminFilterBar><AdminTableSummary shown={messages.length} loaded={data.messages.length} />
    </div>
    {compact ? (
      // 폰에서는 680px 표를 가로로 밀기보다 한 줄에 한 건씩 카드로 본다.
      <div className="admin-card-list" aria-label="대화 목록">
        {messages.map((message) => <button key={message.id} type="button" className="admin-card" onClick={() => { play('selection'); return onUser(message.sender_id); }} aria-label={`${displayName(profiles.get(message.sender_id), message.sender_id)}의 메시지, 작성자 활동 보기`}>
          <span className="admin-card-top">
            <span className="admin-card-title">{displayName(profiles.get(message.sender_id), message.sender_id)}</span>
            <span className="admin-card-meta">{formatDate(message.created_at)}</span>
          </span>
          <span className="admin-card-excerpt">{message.body || '(내용 없음)'}</span>
          <span className="admin-card-meta"><span>{roomLabel(message.conversation_id).primary}</span><span>{roomLabel(message.conversation_id).secondary}</span></span>
        </button>)}
        {messages.length === 0 && <div className="admin-empty">조건에 맞는 메시지가 없습니다.</div>}
      </div>
    ) : (
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>작성자</th><th>메시지</th><th>대화방</th><th>보낸 시각</th></tr></thead>
        <tbody>{messages.map((message) => <tr key={message.id}>
          <td><button className="admin-row-button" onClick={() => { play('selection'); return onUser(message.sender_id); }} title={message.sender_id}>{displayName(profiles.get(message.sender_id), message.sender_id)}</button></td>
          <td><details><summary style={{ cursor: 'pointer', maxWidth: 480, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{message.body || '(내용 없음)'}</summary><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message.body}</p></details></td>
          <td title={message.conversation_id}><span className="admin-cell-primary" style={{ fontWeight: 400 }}>{roomLabel(message.conversation_id).primary}</span><span className="admin-cell-secondary">{roomLabel(message.conversation_id).secondary}</span></td><td>{formatDate(message.created_at)}</td>
        </tr>)}</tbody></table>{messages.length === 0 && <Empty text="조건에 맞는 메시지가 없습니다." />}</div>
    )}
    <LoadMore loading={loadingMore} noMore={noMore} onPress={onLoadMore} />
  </View>;
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
      Alert.alert(`${label}을(를) 바꾸지 못했습니다.`, '값의 범위와 권한을 확인해주세요.');
    } finally {
      setBusy(false);
    }
  };

  const dirty = POST_COUNTERS.some(({ key }) => String(draft[key]) !== String(fields[key]))
    || draft.hashtags !== fields.hashtags;

  const applyEdits = () => {
    const patch: AdminPostPatch = {};
    for (const { key, label } of POST_COUNTERS) {
      const value = Number(String(draft[key]).trim());
      if (!Number.isInteger(value) || value < 0) return Alert.alert(`${label}를 확인해주세요.`, '0 이상의 정수만 넣을 수 있습니다.');
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
          <Pressable onPress={() => { play('selection'); return onUser(post.author_id); }} accessibilityRole="button" style={{ paddingVertical: Spacing.two }}>
            <ThemedText type="small" selectable>{post.body}</ThemedText>
            <ThemedText type="small" style={styles.muted}>글쓴이 보기</ThemedText>
          </Pressable>
          <View style={styles.fieldRow}>
            {POST_COUNTERS.map(({ key, label }) => (
              <View key={key} style={styles.field}>
                <ThemedText type="small" style={styles.muted}>{label}</ThemedText>
                <TextInput value={String(draft[key])} onChangeText={(text) => setDraft((current) => ({ ...current, [key]: text }))}
                  inputMode="numeric" editable={!busy} accessibilityLabel={label} style={styles.adminInput} />
              </View>
            ))}
            <View style={[styles.field, { flexGrow: 1 }]}>
              <ThemedText type="small" style={styles.muted}>해시태그</ThemedText>
              <TextInput value={draft.hashtags} onChangeText={(text) => setDraft((current) => ({ ...current, hashtags: text }))}
                editable={!busy} autoCapitalize="none" accessibilityLabel="해시태그" placeholder="밴쿠버 공지"
                placeholderTextColor={Colors.admin.textSecondary} style={[styles.adminInput, styles.adminInputWide]} />
            </View>
          </View>
          <View style={styles.rowTop}>
            <View style={{ flexDirection: 'row' }}>
              <ActionText label="맨 위로" onPress={() => void apply({ sort_at: new Date(Date.now() + 36e5).toISOString() }, '노출 순서')} disabled={busy} />
              <ActionText label="순서 원래대로" onPress={() => void apply({ sort_at: post.created_at }, '노출 순서')} disabled={busy} />
              {down
                ? <ActionText label="되돌리기" onPress={() => void apply({ status: 'published' }, '상태')} disabled={busy} />
                : <ActionText label="내리기" onPress={() => void apply({ status: 'removed' }, '상태')} disabled={busy} danger />}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ThemedText type="small" style={styles.muted}>{dirty ? '저장하지 않은 값이 있어요' : '저장됨'}</ThemedText>
              {dirty && <ActionText label="되돌리기" onPress={() => setDraft(fields)} disabled={busy} />}
              <ActionText label={busy ? '반영 중' : '반영'} onPress={applyEdits} disabled={busy || !dirty} />
            </View>
          </View>
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
  const [statuses, setStatuses] = useState<string[]>([]);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [versions, setVersions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);

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
    catch { Alert.alert('상태를 바꾸지 못했습니다.', '권한과 연결을 확인해주세요.'); }
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

  const filtered = rows.filter((row) => matches(query.trim().toLocaleLowerCase('ko-KR'), row.message, row.screen, row.stack)
    && selected(statuses, row.resolvedAt ? 'resolved' : 'open') && selected(platforms, row.platform) && selected(versions, row.appVersion));
  return (
    <View style={{ gap: Spacing.two }}>
      <div className="admin-toolbar"><AdminSearch value={query} onChange={setQuery} placeholder="오류 내용, 화면, 스택 검색" />
        <AdminFilterBar applied={statuses.length + platforms.length + versions.length}>
        <div className="admin-filter-row">
          <AdminMultiFilter label="상태" value={statuses} onChange={setStatuses} options={recordOptions({ open: '미해결', resolved: '해결됨' })} />
          <AdminMultiFilter label="플랫폼" value={platforms} onChange={setPlatforms} options={uniqueOptions(rows.map((row) => row.platform))} />
          <AdminMultiFilter label="앱 버전" value={versions} onChange={setVersions} options={uniqueOptions(rows.map((row) => row.appVersion))} />
          <AdminFilterReset onReset={() => { setQuery(''); setStatuses([]); setPlatforms([]); setVersions([]); }} />
        </div></AdminFilterBar><AdminTableSummary shown={filtered.length} loaded={rows.length} />
      </div>
      {filtered.length === 0 && <Empty text="조건에 맞는 오류가 없습니다." />}
      <View style={styles.list}>
        <View style={styles.postHead}><ThemedText type="smallBold" style={{ flex: 1 }}>오류 · 플랫폼 · 최근 발생</ThemedText><ThemedText style={styles.postMetric}>발생 횟수</ThemedText></View>
        {filtered.map((row, index) => (
          <View key={row.id} style={[styles.postRow, index === 0 && styles.postRowFirst]}>
            <Pressable onPress={() => { play('selection'); return setExpanded((current) => current === row.id ? null : row.id); }}
              accessibilityRole="button" accessibilityState={{ expanded: expanded === row.id }}
              style={({ pressed }) => [styles.postHead, pressed && styles.pressed]}>
              <View style={[styles.dot, !row.resolvedAt && styles.dotDown]} />
              <View style={styles.postTitle}>
                <ThemedText type="smallBold" numberOfLines={1} style={{ flexShrink: 1 }}>{row.message}</ThemedText>
                <ThemedText numberOfLines={1} style={styles.postMeta}>
                  {row.resolvedAt ? '해결됨' : '미해결'} · {row.platform} {row.appVersion}{row.screen ? ` · ${row.screen}` : ''} · {formatDate(row.lastSeen)}
                </ThemedText>
              </View>
              <ThemedText style={styles.postMetric}>{count(row.occurrences)}회</ThemedText>
            </Pressable>
            {expanded === row.id && (
              <View style={styles.postBody}>
                <ThemedText type="small" selectable>{row.message}</ThemedText>
                <ThemedText type="small">{row.resolvedAt ? '해결됨' : '미해결'}</ThemedText>
                {!!row.stack && <TextInput value={row.stack} editable={false} multiline selectTextOnFocus
                  accessibilityLabel="스택"
                  style={{ fontFamily: 'Menlo', fontSize: 11, lineHeight: 16, maxHeight: 200, padding: Spacing.two,
                    borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 6, color: Colors.admin.text }} />}
                <ThemedText type="small" style={styles.muted}>
                  {row.osVersion ?? '기기 정보 없음'} · 처음 {formatDate(row.firstSeen)}
                </ThemedText>
                <View style={styles.rowTop}>
                  <ActionText label={row.resolvedAt ? '다시 열기' : '해결 표시'} onPress={() => void toggle(row)} disabled={busy} />
                </View>
              </View>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return <View style={styles.heading}><ThemedText type="title" accessibilityRole="header" style={styles.title}>{title}</ThemedText><ThemedText type="small" style={styles.muted}>{description}</ThemedText></View>;
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
  heading: { gap: Spacing.two, marginBottom: Spacing.one },
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
  postBody: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three, gap: Spacing.two, borderTopWidth: 1, borderTopColor: Colors.admin.line },
  fieldRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  field: { gap: 4 },
  adminInputWide: { flexBasis: 220, minWidth: 160, textAlign: 'left' },
  adminInput: { flexBasis: 104, minWidth: 88, minHeight: 44, paddingHorizontal: Spacing.two, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 6, color: Colors.admin.text, textAlign: 'right' },
});

const ALERT_CATEGORY: Record<string, string> = {
  drugs: '마약', weapons: '무기', sexual_exploitation: '성착취', fraud: '사기', self_harm: '자해·자살',
  violence: '폭력·위협', doxxing: '신상 공개', illegal_status: '불법 체류·위조',
};
const SAFETY_TARGET_LABEL: Record<AdminSafetyTargetType, string> = { post: '게시글', comment: '댓글', message: '메시지', chilling_profile: '칠링 프로필', chilling_application: '칠링 참여 신청', merchant_review: '업체 후기', merchant_review_reply: '업체 답변' };
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
  const { play } = useInteractionFeedback();
  const [overrides, setOverrides] = useState<Record<number, Partial<AdminSafetyAlert>>>({});
  const [evidence, setEvidence] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [severities, setSeverities] = useState<string[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const rows = alerts.map((alert) => ({ ...alert, ...overrides[alert.id] })).filter((alert) =>
    matches(query.trim().toLocaleLowerCase('ko-KR'), alert.excerpt, alert.author_id, alert.target_id, alert.note, profiles.get(alert.author_id)?.nickname, ...alert.matched_terms)
    && selected(statuses, alert.status) && selected(categories, alert.category) && selected(severities, alert.severity) && selected(targets, alert.target_type));
  const act = async (alert: AdminSafetyAlert, status: AdminSafetyAlert['status']) => {
    if (localPreview || busy) return;
    setBusy(alert.id);
    try {
      await resolveAdminSafetyAlert(supabase, alert.id, status);
      setOverrides((current) => ({ ...current, [alert.id]: { status, reviewed_at: new Date().toISOString() } }));
    } catch {
      Alert.alert('경보 상태를 바꾸지 못했습니다.', '권한과 연결 상태를 확인해주세요.');
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
      Alert.alert('증거 묶음을 만들지 못했습니다.', '권한과 연결 상태를 확인해주세요.');
    } finally {
      setBusy(null);
    }
  };
  const confirmEscalate = (alert: AdminSafetyAlert) => Alert.alert(
    '공권력 이관으로 표시할까요?',
    '표시 자체는 외부에 전송되지 않습니다. 증거 묶음을 내보내 공식 요청서와 함께 제출하세요. 운영 기록에 남습니다.',
    [{ text: '취소', style: 'cancel' }, { text: '표시', style: 'destructive', onPress: () => void act(alert, 'escalated') }],
  );
  return (
    <View style={styles.section}>
      <div className="admin-toolbar"><AdminSearch value={query} onChange={setQuery} placeholder="감시어, 내용, 작성자 또는 ID 검색" />
        <AdminFilterBar applied={statuses.length + categories.length + severities.length + targets.length}>
          <div className="admin-filter-row">
            <AdminMultiFilter label="상태" value={statuses} onChange={setStatuses} options={recordOptions(ALERT_STATUS)} />
            <AdminMultiFilter label="분류" value={categories} onChange={setCategories} options={recordOptions(ALERT_CATEGORY)} />
            <AdminMultiFilter label="심각도" value={severities} onChange={setSeverities} options={recordOptions({ medium: '보통', high: '높음', critical: '심각' })} />
            <AdminMultiFilter label="대상" value={targets} onChange={setTargets} options={recordOptions(SAFETY_TARGET_LABEL)} />
            <AdminFilterReset onReset={() => { setQuery(''); setStatuses([]); setCategories([]); setSeverities([]); setTargets([]); }} />
          </div>
        </AdminFilterBar><AdminTableSummary shown={rows.length} loaded={alerts.length} />
      </div>
      <div className="admin-status-tabs" role="group" aria-label="경보 상태 빠른 필터">
        {[{ value: '', label: '전체' }, ...recordOptions(ALERT_STATUS)].map((option) => <button type="button" key={option.value} aria-pressed={option.value ? statuses.length === 1 && statuses[0] === option.value : !statuses.length} onClick={() => { play('selection'); setStatuses(option.value ? [option.value] : []); }}>{option.label}</button>)}
      </div>
      <div className="admin-review-list" aria-label="감시어 경보 목록">
      <div className="admin-review-columns" aria-hidden="true"><span>감지 내용·작성자</span><span>심각도</span><span>처리 상태</span><span>발생 시각</span><span /></div>
      {rows.length === 0 && <Empty text="조건에 맞는 경보가 없습니다." hint="감시어에 걸린 표현이 없으면 경보는 생기지 않습니다. 필터를 초기화하거나 이전 기록을 더 불러와 보세요." />}
      {rows.map((alert) => {
        const author = profiles.get(alert.author_id);
        return (
          <details key={alert.id} className="admin-review-row" onToggle={() => play('selection')}>
            <summary className="admin-review-summary">
              <span className="admin-review-title"><strong>{ALERT_CATEGORY[alert.category] ?? alert.category} 관련 표현 감지</strong><span className="admin-muted">{displayName(author, alert.author_id)} · {SAFETY_TARGET_LABEL[alert.target_type]} · {alert.matched_terms.join(', ')}</span></span>
              <span className={`admin-badge${alert.severity === 'medium' ? ' admin-badge-warning' : ' admin-badge-danger'}`}>{SAFETY_RISK_LABEL[alert.severity]}</span>
              <span className={`admin-badge${alert.status === 'open' ? ' admin-badge-warning' : alert.status === 'reviewed' ? ' admin-badge-success' : alert.status === 'escalated' ? ' admin-badge-danger' : ''}`}>{ALERT_STATUS[alert.status]}</span>
              <time className="admin-review-time" dateTime={alert.created_at}>{formatDate(alert.created_at)}</time><span className="admin-review-chevron" aria-hidden="true" />
            </summary><div className="admin-review-detail"><View style={{ gap: Spacing.three }}>
            <View style={styles.rowTop}>
              <ThemedText type="smallBold">{ALERT_CATEGORY[alert.category] ?? alert.category} · {SAFETY_TARGET_LABEL[alert.target_type] ?? alert.target_type} · {alert.matched_terms.join(', ')}</ThemedText>
              <StateText text={`${SAFETY_RISK_LABEL[alert.severity]} · ${ALERT_STATUS[alert.status]}`} danger={alert.status === 'open' && alert.severity !== 'medium'} />
            </View>
            <ThemedText type="small" selectable>{alert.excerpt}</ThemedText>
            {(alert.target_type === 'chilling_profile' || alert.target_type === 'chilling_application') && <AdminChillingContent targetType={alert.target_type} targetId={alert.target_id} localPreview={localPreview} onUser={onUser} />}
            {alert.target_type === 'merchant_review' && <AdminMerchantReviewContent targetId={alert.target_id} localPreview={localPreview} onUser={onUser} />}
            {alert.target_type === 'merchant_review_reply' && <AdminMerchantReviewReplyContent targetId={alert.target_id} localPreview={localPreview} onUser={onUser} />}
            <Pressable onPress={() => { play('selection'); return onUser(alert.author_id); }} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
              <ThemedText type="small" style={styles.muted}>{displayName(author, alert.author_id)} · {formatDate(alert.created_at)}{alert.note ? ` · ${alert.note}` : ''}</ThemedText>
            </Pressable>
            <div className="admin-review-actions">
              {alert.status === 'open' && <ActionText label="검토 완료" onPress={() => void act(alert, 'reviewed')} disabled={busy !== null} />}
              {alert.status === 'open' && <ActionText label="해당 없음" onPress={() => void act(alert, 'dismissed')} disabled={busy !== null} />}
              <ActionText label={evidence[alert.id] ? '증거 묶음 새로 만들기' : '증거 묶음 내보내기'} onPress={() => void exportEvidence(alert)} disabled={busy !== null} />
              {alert.status !== 'escalated' && <ActionText label="공권력 이관" onPress={() => confirmEscalate(alert)} disabled={busy !== null} danger />}
            </div>
            {evidence[alert.id] && <TextInput value={evidence[alert.id]} editable={false} multiline selectTextOnFocus accessibilityLabel="증거 묶음 JSON"
              style={{ fontFamily: 'Menlo', fontSize: 11, lineHeight: 16, maxHeight: 240, padding: Spacing.two, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 6, color: Colors.admin.text }} />}
          </View></div></details>
        );
      })}
      </div>
    </View>
  );
}

function ActionText({ label, onPress, disabled, danger }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  const { play } = useInteractionFeedback();
  return (
    <Pressable onPress={() => { play('selection'); onPress(); }} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled }} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 8, backgroundColor: Colors.admin.card, opacity: disabled ? 0.5 : 1 }}>
      <ThemedText type="smallBold" style={danger ? styles.urgent : undefined}>{label}</ThemedText>
    </Pressable>
  );
}
