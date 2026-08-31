import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { AdminReportQueue } from '@/components/admin/admin-report-queue';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import type { AdminSection } from '@/lib/admin';
import type { AdminDashboardData, AdminProfile } from '@/lib/admin-data';

export function AdminSectionView({
  section,
  data,
  resolving,
  loadingMore,
  noMore,
  onUser,
  onResolve,
  onLoadMore,
}: {
  section: AdminSection;
  data: AdminDashboardData;
  resolving: boolean;
  loadingMore: boolean;
  noMore: boolean;
  onUser: (userId: string) => void;
  onResolve: (reportId: string, action: 'dismissed' | 'warned' | 'blocked', note: string) => void;
  onLoadMore: () => void;
}) {
  const [query, setQuery] = useState('');
  const compactUsers = useWindowDimensions().width < 560;
  const profiles = useMemo(() => new Map(data.profiles.map((profile) => [profile.id, profile])), [data.profiles]);
  const needle = query.trim().toLocaleLowerCase('ko-KR');

  if (section === 'overview') {
    const items = [
      { label: '미처리 신고', value: data.counts.openReports, urgent: true },
      { label: 'AI 고위험', value: data.counts.safetyHigh, urgent: true },
      { label: 'AI 처리 대기', value: data.counts.safetyPending },
      { label: '전체 사용자', value: data.counts.profiles },
      { label: '전체 게시글', value: data.counts.posts },
      { label: '전체 메시지', value: data.counts.messages },
    ];
    return (
      <View style={styles.section}>
        <SectionHeading title="운영 현황" description="신고 여부와 무관하게 전체 활동을 확인할 수 있습니다." />
        <View style={styles.metrics}>
          {items.map((item) => (
            <View key={item.label} accessibilityLabel={`${item.label} ${item.value}건`} style={[styles.metric, item.urgent && styles.metricUrgent]}>
              <ThemedText type="smallBold" style={item.urgent ? styles.urgent : styles.muted}>{item.label}</ThemedText>
              <ThemedText type="title" style={[styles.metricValue, item.urgent && styles.urgent]}>{item.value}</ThemedText>
            </View>
          ))}
        </View>
        <View style={styles.subheading}>
          <ThemedText type="subtitle" accessibilityRole="header">최근 신고</ThemedText>
          <ThemedText type="small" style={styles.muted}>미처리 항목을 먼저 표시합니다.</ThemedText>
        </View>
        <AdminReportQueue reports={data.reports.slice(0, 5)} profiles={profiles} actions={data.moderationActions} resolving={resolving} onUser={onUser} onResolve={onResolve} />
      </View>
    );
  }

  if (section === 'safety') {
    return (
      <View style={styles.section}>
        <SectionHeading title="AI 안전 모니터링" description={`처리 대기 ${data.counts.safetyPending}건 · 고위험 ${data.counts.safetyHigh}건`} />
        <View style={styles.rows}>
          {data.safetyReviews.map((review) => (
            <View key={review.id} style={styles.row}>
              <View style={styles.rowTop}>
                <ThemedText type="smallBold">{review.target_type} · {shortId(review.target_id)}</ThemedText>
                <StateText text={review.risk_level ?? review.status} danger={review.risk_level === 'high' || review.risk_level === 'critical' || review.status === 'failed'} />
              </View>
              <ThemedText type="small">{review.risk_reasons.length ? review.risk_reasons.join(' · ') : review.last_error ?? '분석 결과 대기 중'}</ThemedText>
              <ThemedText type="small" style={styles.muted}>위험도 {review.risk_score ?? '-'} · 시도 {review.attempts}회 · {formatDate(review.created_at)}</ThemedText>
            </View>
          ))}
          {data.safetyReviews.length === 0 && <Empty text="안전 검토 기록이 없습니다." />}
        </View>
        <LoadMore loading={loadingMore} noMore={noMore} onPress={onLoadMore} />
      </View>
    );
  }

  if (section === 'reports') {
    return <View style={styles.section}><SectionHeading title="신고 관리" description={`전체 ${data.counts.reports}건 · 미처리 ${data.counts.openReports}건`} /><AdminReportQueue reports={data.reports} profiles={profiles} actions={data.moderationActions} resolving={resolving} onUser={onUser} onResolve={onResolve} /><LoadMore loading={loadingMore} noMore={noMore} onPress={onLoadMore} /></View>;
  }

  const search = <TextInput value={query} onChangeText={setQuery} placeholder="닉네임, 제목, 내용 또는 ID 검색" placeholderTextColor={Colors.light.textSecondary} accessibilityRole="search" accessibilityLabel="관리 데이터 검색" returnKeyType="search" style={styles.search} />;

  if (section === 'users') {
    const rows = data.profiles.filter((profile) => matches(needle, profile.nickname, profile.neighborhood, profile.city_id, profile.id));
    return <View style={styles.section}><SectionHeading title="사용자" description="사용자를 선택하면 글·댓글·대화·신고 이력을 함께 봅니다." />{search}<View style={styles.userRows}>{rows.map((profile, index) => <UserRow key={profile.id} profile={profile} compact={compactUsers} last={index === rows.length - 1} onPress={() => onUser(profile.id)} />)}{rows.length === 0 && <Empty />}</View><LoadMore loading={loadingMore} noMore={noMore} onPress={onLoadMore} /></View>;
  }

  if (section === 'posts') {
    const rows = data.posts.filter((post) => matches(needle, post.title, post.body, post.city_id, post.author_id));
    return <View style={styles.section}><SectionHeading title="게시글" description="삭제 처리된 글을 포함한 최근 게시글입니다." />{search}<View style={styles.rows}>{rows.map((post) => <Pressable key={post.id} onPress={() => onUser(post.author_id)} accessibilityRole="button" style={styles.row}><View style={styles.rowTop}><ThemedText type="smallBold">{post.title}</ThemedText><StateText text={post.status === 'removed' ? '삭제됨' : '게시중'} danger={post.status === 'removed'} /></View><ThemedText type="small" numberOfLines={2}>{post.body}</ThemedText><ThemedText type="small" style={styles.muted}>{profiles.get(post.author_id)?.nickname ?? post.author_id} · {formatDate(post.created_at)}</ThemedText></Pressable>)}{rows.length === 0 && <Empty />}</View><LoadMore loading={loadingMore} noMore={noMore} onPress={onLoadMore} /></View>;
  }

  const messages = data.messages.filter((message) => matches(needle, message.body, message.sender_id, message.conversation_id));
  return <View style={styles.section}><SectionHeading title="대화" description={`최근 대화방 ${data.conversations.length}개와 메시지 ${data.messages.length}개`} />{search}<View style={styles.rows}>{messages.map((message) => <Pressable key={message.id} onPress={() => onUser(message.sender_id)} accessibilityRole="button" style={styles.row}><ThemedText type="smallBold">{profiles.get(message.sender_id)?.nickname ?? message.sender_id}</ThemedText><ThemedText>{message.body}</ThemedText><ThemedText type="small" style={styles.muted}>대화 {shortId(message.conversation_id)} · {formatDate(message.created_at)}</ThemedText></Pressable>)}{messages.length === 0 && <Empty text="표시할 메시지가 없습니다." />}</View><LoadMore loading={loadingMore} noMore={noMore} onPress={onLoadMore} /></View>;
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return <View style={styles.heading}><ThemedText type="title" accessibilityRole="header" style={styles.title}>{title}</ThemedText><ThemedText style={styles.muted}>{description}</ThemedText></View>;
}

function UserRow({ profile, compact, last, onPress }: { profile: AdminProfile; compact: boolean; last: boolean; onPress: () => void }) {
  const location = `${profile.city_id ?? '지역 삭제됨'}${profile.neighborhood ? ` · ${profile.neighborhood}` : ''}`;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${profile.nickname}, ${location}, 신뢰 ${profile.verification_level}, ${profile.id}`} style={[styles.userRow, last && styles.userRowLast]}>
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

function Empty({ text = '검색 결과가 없습니다.' }: { text?: string }) {
  return <View accessibilityRole="text" style={styles.empty}><ThemedText style={styles.muted}>{text}</ThemedText></View>;
}

function LoadMore({ loading, noMore, onPress }: { loading: boolean; noMore: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} disabled={loading || noMore} accessibilityRole="button" accessibilityState={{ disabled: loading || noMore, busy: loading }} style={[styles.more, (loading || noMore) && styles.moreDisabled]}><ThemedText type="smallBold">{noMore ? '마지막 기록입니다' : loading ? '불러오는 중' : '이전 기록 더 보기'}</ThemedText></Pressable>;
}

function matches(query: string, ...values: (string | null | undefined)[]) {
  return !query || values.some((value) => value?.toLocaleLowerCase('ko-KR').includes(query));
}

function shortId(value: string) { return value.slice(0, 8); }
function formatDate(value: string) { return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }

const styles = StyleSheet.create({
  section: { gap: Spacing.four },
  heading: { gap: Spacing.one },
  subheading: { gap: Spacing.one },
  title: { fontSize: 30, lineHeight: 38 },
  muted: { color: Colors.light.textSecondary },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  metric: { minWidth: 160, flexGrow: 1, padding: Spacing.four, gap: Spacing.two, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 6, backgroundColor: Colors.light.card },
  metricUrgent: { borderColor: '#E8B8AE', backgroundColor: '#FDF6F4' },
  metricValue: { fontSize: 30, lineHeight: 34 },
  urgent: { color: Colors.light.accent },
  search: { minHeight: 44, paddingHorizontal: Spacing.three, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8, color: Colors.light.text, backgroundColor: Colors.light.card },
  rows: { gap: Spacing.two },
  userRows: { overflow: 'hidden', borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8, backgroundColor: Colors.light.card },
  userRow: { minHeight: 56, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderBottomWidth: 1, borderBottomColor: Colors.light.line },
  userRowLast: { borderBottomWidth: 0 },
  userAvatar: { width: 32, height: 32, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: Colors.light.backgroundSelected },
  userAvatarText: { color: Colors.light.accent },
  userIdentity: { minWidth: 0, flex: 1 },
  userLocation: { flexBasis: 180, flexShrink: 1, color: Colors.light.textSecondary },
  chevron: { color: Colors.light.textSecondary, fontSize: 20, lineHeight: 20 },
  row: { padding: Spacing.three, gap: Spacing.one, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 6, backgroundColor: Colors.light.card },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  state: { fontSize: 11, color: Colors.light.navy },
  danger: { color: Colors.light.accent },
  id: { color: Colors.light.textSecondary, fontFamily: 'monospace' },
  empty: { minHeight: 160, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.light.line, borderRadius: 10, backgroundColor: Colors.light.card },
  more: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8, backgroundColor: Colors.light.card },
  moreDisabled: { opacity: 0.55 },
});
