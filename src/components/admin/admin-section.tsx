import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { AdminReportQueue } from '@/components/admin/admin-report-queue';
import { AdminTrendingPanel } from '@/components/admin/admin-trending-panel';
import { AdminUserDirectoryPanel } from '@/components/admin/admin-user-directory';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import type { AdminSection } from '@/lib/admin';
import { exportAdminSafetyEvidence, resolveAdminSafetyAlert, setAdminPostFields, type AdminDashboardData, type AdminPost, type AdminProfile, type AdminSafetyAlert } from '@/lib/admin-data';
import type { AdminPostPatch } from '@/lib/admin-trending';
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
  onResolve: (reportId: string, action: 'dismissed' | 'warned' | 'blocked', note: string) => void;
  onLoadMore: () => void;
  localPreview?: boolean;
}) {
  const [query, setQuery] = useState('');
  const compactUsers = useWindowDimensions().width < 560;
  const profiles = useMemo(() => new Map(data.profiles.map((profile) => [profile.id, profile])), [data.profiles]);
  const needle = query.trim().toLocaleLowerCase('ko-KR');

  if (section === 'overview') {
    const items = [
      { label: '미처리 신고', value: data.counts.openReports, urgent: true },
      { label: 'AI 고위험', value: data.counts.safetyHigh, urgent: true },
      { label: '감시어 경보', value: data.counts.alertsOpen, urgent: data.counts.alertsOpen > 0 },
      { label: 'AI 처리 대기', value: data.counts.safetyPending },
      { label: '전체 사용자', value: data.counts.profiles },
      { label: '전체 게시글', value: data.counts.posts },
      { label: '전체 메시지', value: data.counts.messages },
      { label: '다계정 의심', value: data.sharedSessions.length, urgent: data.sharedSessions.length > 0 },
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
        {data.sharedSessions.length > 0 && <>
          <View style={styles.subheading}>
            <ThemedText type="subtitle" accessibilityRole="header">다계정 의심</ThemedText>
            <ThemedText type="small" style={styles.muted}>최근 30일 안에 같은 IP(또는 같은 IP·기기)로 접속한 계정이 둘 이상입니다. 가정·사무실·통신사 공유 IP일 수 있으니 댓글·글 활동을 함께 보고 판단하세요.</ThemedText>
          </View>
          <View style={styles.rows}>
            {data.sharedSessions.map((group) => (
              <View key={`${group.ip}:${group.user_agent ?? 'ip'}`} style={styles.row}>
                <View style={styles.rowTop}>
                  <ThemedText type="smallBold">{group.same_device ? '같은 IP · 같은 기기' : '같은 IP'} · {group.ip}</ThemedText>
                  <StateText text={`${group.user_count}개 계정`} danger={group.same_device} />
                </View>
                {group.user_agent && <ThemedText type="small" style={styles.muted} numberOfLines={1}>{group.user_agent}</ThemedText>}
                <View style={styles.rowTop}>
                  {group.users.map((user) => (
                    <Pressable key={user.id} onPress={() => onUser(user.id)} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
                      <ThemedText type="small">{user.nickname}{user.account_type !== 'member' ? ` (${user.account_type})` : ''} · 글 {user.posts} · 댓글 {user.comments} · {formatDate(user.last_seen)}</ThemedText>
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
        <SectionHeading title="감시어 경보" description={`미처리 ${data.counts.alertsOpen}건 · 마약·무기·성착취·사기·자해·위협·신상공개·불법체류 관련 표현이 글·댓글·대화에 나타나면 기록됩니다. 표현 일치는 신호이며 판단은 사람이 합니다.`} />
        <AdminAlertsPanel alerts={data.safetyAlerts} profiles={profiles} localPreview={localPreview} onUser={onUser} />
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
    if (!localPreview) return <AdminUserDirectoryPanel onUser={onUser} refreshData={data} />;
    const rows = data.profiles.filter((profile) => matches(needle, profile.nickname, profile.neighborhood, profile.city_id, profile.id));
    return <View style={styles.section}><SectionHeading title="사용자" description="사용자를 선택하면 글·댓글·대화·신고 이력을 함께 봅니다." />{search}<View style={styles.userRows}>{rows.map((profile, index) => <UserRow key={profile.id} profile={profile} compact={compactUsers} last={index === rows.length - 1} onPress={() => onUser(profile.id)} />)}{rows.length === 0 && <Empty />}</View><LoadMore loading={loadingMore} noMore={noMore} onPress={onLoadMore} /></View>;
  }

  if (section === 'posts') {
    const rows = data.posts.filter((post) => matches(needle, post.title, post.body, post.city_id, post.author_id));
    return (
      <View style={styles.section}>
        <SectionHeading title="게시글" description="삭제 처리된 글을 포함한 최근 게시글입니다. 조회수·노출 순서·해시태그는 여기서만 조정합니다." />
        {search}
        <View style={styles.rows}>
          {rows.map((post) => (
            <AdminPostRow key={post.id} post={post} author={profiles.get(post.author_id)?.nickname ?? post.author_id}
              localPreview={localPreview} onUser={onUser} />
          ))}
          {rows.length === 0 && <Empty />}
        </View>
        <LoadMore loading={loadingMore} noMore={noMore} onPress={onLoadMore} />
      </View>
    );
  }

  const messages = data.messages.filter((message) => matches(needle, message.body, message.sender_id, message.conversation_id));
  return <View style={styles.section}><SectionHeading title="대화" description={`최근 대화방 ${data.conversations.length}개와 메시지 ${data.messages.length}개`} />{search}<View style={styles.rows}>{messages.map((message) => <Pressable key={message.id} onPress={() => onUser(message.sender_id)} accessibilityRole="button" style={styles.row}><ThemedText type="smallBold">{profiles.get(message.sender_id)?.nickname ?? message.sender_id}</ThemedText><ThemedText>{message.body}</ThemedText><ThemedText type="small" style={styles.muted}>대화 {shortId(message.conversation_id)} · {formatDate(message.created_at)}</ThemedText></Pressable>)}{messages.length === 0 && <Empty text="표시할 메시지가 없습니다." />}</View><LoadMore loading={loadingMore} noMore={noMore} onPress={onLoadMore} /></View>;
}

// 글 자체의 수정·삭제는 작성자가 앱에서 한다. 여기서는 노출에 영향을 주는 값만 손댄다.
function AdminPostRow({ post, author, localPreview, onUser }: {
  post: AdminPost; author: string; localPreview?: boolean; onUser: (userId: string) => void;
}) {
  const [fields, setFields] = useState<{ status: string; viewCount: number; hashtags: string[] }>(
    { status: post.status, viewCount: post.view_count ?? 0, hashtags: post.hashtags ?? [] });
  const [views, setViews] = useState(String(post.view_count ?? 0));
  const [tags, setTags] = useState((post.hashtags ?? []).join(' '));
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const apply = async (patch: AdminPostPatch, label: string) => {
    if (localPreview || busy) return;
    setBusy(true);
    try {
      const next = await setAdminPostFields(supabase, post.id, patch);
      setFields({ status: next.status, viewCount: next.viewCount, hashtags: next.hashtags ?? [] });
      setViews(String(next.viewCount));
      setTags((next.hashtags ?? []).join(' '));
    } catch {
      Alert.alert(`${label}을(를) 바꾸지 못했습니다.`, '값의 범위와 권한을 확인해주세요.');
    } finally {
      setBusy(false);
    }
  };

  const saveViews = () => {
    const value = Number(views.trim());
    if (!Number.isInteger(value) || value < 0) return Alert.alert('조회수를 확인해주세요.', '0 이상의 정수만 넣을 수 있습니다.');
    if (value !== fields.viewCount) void apply({ view_count: value }, '조회수');
  };
  const saveTags = () => {
    const next = tags.split(/[\s,]+/).map((tag: string) => tag.replace(/^#/, '')).filter(Boolean).slice(0, 20);
    if (next.join(' ') !== fields.hashtags.join(' ')) void apply({ hashtags: next }, '해시태그');
  };

  return (
    <View style={styles.row}>
      <Pressable onPress={() => onUser(post.author_id)} accessibilityRole="button">
        <View style={styles.rowTop}>
          <ThemedText type="smallBold" numberOfLines={1} style={{ flex: 1 }}>{post.title}</ThemedText>
          <StateText text={fields.status === 'removed' ? '삭제됨' : '게시중'} danger={fields.status === 'removed'} />
        </View>
        <ThemedText type="small" numberOfLines={2}>{post.body}</ThemedText>
        <ThemedText type="small" style={styles.muted}>{author} · 조회 {fields.viewCount} · {formatDate(post.created_at)}</ThemedText>
      </Pressable>
      <View style={styles.rowTop}>
        <ActionText label={open ? '조정 닫기' : '조정'} onPress={() => setOpen((current) => !current)} disabled={busy} />
        {fields.status === 'published'
          ? <ActionText label="내리기" onPress={() => void apply({ status: 'removed' }, '상태')} disabled={busy} danger />
          : <ActionText label="되돌리기" onPress={() => void apply({ status: 'published' }, '상태')} disabled={busy} />}
      </View>
      {open && (
        <View style={{ gap: Spacing.two }}>
          <View style={styles.rowTop}>
            <ThemedText type="small" style={styles.muted}>조회수</ThemedText>
            <TextInput value={views} onChangeText={setViews} inputMode="numeric" editable={!busy}
              accessibilityLabel="조회수" onBlur={saveViews} style={styles.adminInput} />
          </View>
          <View style={styles.rowTop}>
            <ThemedText type="small" style={styles.muted}>해시태그</ThemedText>
            <TextInput value={tags} onChangeText={setTags} editable={!busy} autoCapitalize="none"
              accessibilityLabel="해시태그" onBlur={saveTags} placeholder="밴쿠버 공지"
              placeholderTextColor={Colors.light.textSecondary} style={[styles.adminInput, { flexBasis: 220 }]} />
          </View>
          <View style={styles.rowTop}>
            <ThemedText type="small" style={styles.muted}>노출 순서</ThemedText>
            <View style={{ flexDirection: 'row' }}>
              <ActionText label="맨 위로" onPress={() => void apply({ sort_at: new Date(Date.now() + 36e5).toISOString() }, '노출 순서')} disabled={busy} />
              <ActionText label="원래대로" onPress={() => void apply({ sort_at: post.created_at }, '노출 순서')} disabled={busy} />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return <View style={styles.heading}><ThemedText type="title" accessibilityRole="header" style={styles.title}>{title}</ThemedText><ThemedText style={styles.muted}>{description}</ThemedText></View>;
}

function UserRow({ profile, compact, last, onPress }: { profile: AdminProfile; compact: boolean; last: boolean; onPress: () => void }) {
  const location = `${profile.city_id ?? '지역 삭제됨'}${profile.neighborhood ? ` · ${profile.neighborhood}` : ''}`;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${profile.nickname}, ${location}, 신뢰 ${profile.verification_level}, ${profile.id}`} style={({ pressed }) => [styles.userRow, last && styles.userRowLast, pressed && styles.pressed]}>
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
  title: { fontSize: 30, lineHeight: 38, letterSpacing: -0.6 },
  muted: { color: Colors.light.textSecondary },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  metric: { flexBasis: 150, minWidth: 0, flexGrow: 1, padding: Spacing.three, gap: Spacing.two, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 10, backgroundColor: Colors.light.card },
  metricUrgent: { borderColor: '#E8B8AE', backgroundColor: '#FDF6F4' },
  metricValue: { fontSize: 30, lineHeight: 36, fontVariant: ['tabular-nums'] },
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
  pressed: { backgroundColor: Colors.light.backgroundElement },
  adminInput: { flexBasis: 120, minHeight: 44, paddingHorizontal: Spacing.two, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 6, color: Colors.light.text, textAlign: 'right' },
});

const ALERT_CATEGORY: Record<string, string> = {
  drugs: '마약', weapons: '무기', sexual_exploitation: '성착취', fraud: '사기', self_harm: '자해·자살',
  violence: '폭력·위협', doxxing: '신상 공개', illegal_status: '불법 체류·위조',
};
const ALERT_STATUS: Record<AdminSafetyAlert['status'], string> = { open: '미처리', reviewed: '검토 완료', dismissed: '해당 없음', escalated: '공권력 이관' };

// ponytail: 로컬 상태로 행을 갱신한다. 전체 재조회는 상단 새로고침이 담당.
function AdminAlertsPanel({ alerts, profiles, localPreview, onUser }: {
  alerts: AdminSafetyAlert[]; profiles: Map<string, AdminProfile>; localPreview?: boolean; onUser: (userId: string) => void;
}) {
  const [overrides, setOverrides] = useState<Record<number, Partial<AdminSafetyAlert>>>({});
  const [evidence, setEvidence] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const rows = alerts.map((alert) => ({ ...alert, ...overrides[alert.id] }));
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
  if (rows.length === 0) return <Empty />;
  return (
    <View style={styles.rows}>
      {rows.map((alert) => {
        const author = profiles.get(alert.author_id);
        const critical = alert.severity === 'critical';
        return (
          <View key={alert.id} style={[styles.row, alert.status === 'open' && critical && styles.metricUrgent]}>
            <View style={styles.rowTop}>
              <ThemedText type="smallBold">{ALERT_CATEGORY[alert.category] ?? alert.category} · {alert.target_type} · {alert.matched_terms.join(', ')}</ThemedText>
              <StateText text={`${alert.severity} · ${ALERT_STATUS[alert.status]}`} danger={alert.status === 'open' && alert.severity !== 'medium'} />
            </View>
            <ThemedText type="small" numberOfLines={4}>{alert.excerpt}</ThemedText>
            <Pressable onPress={() => onUser(alert.author_id)} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
              <ThemedText type="small" style={styles.muted}>{author?.nickname ?? alert.author_id} · {formatDate(alert.created_at)}{alert.note ? ` · ${alert.note}` : ''}</ThemedText>
            </Pressable>
            <View style={styles.rowTop}>
              {alert.status === 'open' && <ActionText label="검토 완료" onPress={() => void act(alert, 'reviewed')} disabled={busy === alert.id} />}
              {alert.status === 'open' && <ActionText label="해당 없음" onPress={() => void act(alert, 'dismissed')} disabled={busy === alert.id} />}
              {alert.status !== 'escalated' && <ActionText label="공권력 이관" onPress={() => confirmEscalate(alert)} disabled={busy === alert.id} danger />}
              <ActionText label={evidence[alert.id] ? '증거 묶음 새로 만들기' : '증거 묶음 내보내기'} onPress={() => void exportEvidence(alert)} disabled={busy === alert.id} />
            </View>
            {evidence[alert.id] && <TextInput value={evidence[alert.id]} editable={false} multiline selectTextOnFocus accessibilityLabel="증거 묶음 JSON"
              style={{ fontFamily: 'Menlo', fontSize: 11, lineHeight: 16, maxHeight: 240, padding: Spacing.two, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 6, color: Colors.light.text }} />}
          </View>
        );
      })}
    </View>
  );
}

function ActionText({ label, onPress, disabled, danger }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled }} style={{ minHeight: 44, justifyContent: 'center', paddingRight: Spacing.three, opacity: disabled ? 0.5 : 1 }}>
      <ThemedText type="smallBold" style={danger ? styles.urgent : undefined}>{label}</ThemedText>
    </Pressable>
  );
}
