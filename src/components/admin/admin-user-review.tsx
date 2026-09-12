import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { adminOptionKeys } from '@/lib/admin';
import type { AdminProfile } from '@/lib/admin-data';
import {
  ACCOUNT_TYPES, ACTIVITY_KINDS, EMPTY_ACTIVITY_FILTERS, activityParams,
  loadAdminUserOverview, loadAdminUserActivityPage, mergeActivityRows,
  type ActivityFilters, type ActivityKind, type AdminActivityPage, type AdminUserOverview,
} from '@/lib/admin-user-data';
import { supabase } from '@/lib/supabase';

export function AdminUserReview({ userId, profiles, onStatusChange }: {
  userId: string; profiles: Map<string, AdminProfile>;
  onStatusChange?: (userId: string, status: 'active' | 'reactivation_pending') => Promise<void>;
}) {
  const [overview, setOverview] = useState<AdminUserOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [statusBusy, setStatusBusy] = useState(false);
  const [filters, setFilters] = useState<ActivityFilters>(EMPTY_ACTIVITY_FILTERS);
  const [draft, setDraft] = useState<ActivityFilters>(EMPTY_ACTIVITY_FILTERS);
  const [filterError, setFilterError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void loadAdminUserOverview(supabase, userId)
      .then((value) => { if (active) setOverview(value); })
      .catch(() => { if (active) setError('회원 상세를 불러오지 못했습니다. 관리자 권한과 연결을 확인해주세요.'); });
    return () => { active = false; };
  }, [userId, retry]);
  const apply = () => {
    try { activityParams(userId, draft); setFilters({ ...draft }); setFilterError(null); }
    catch (error) { setFilterError(error instanceof Error ? error.message : '조회 조건을 확인해주세요.'); }
  };
  const chooseKind = (kind: ActivityKind) => {
    const next = { ...filters, kind, conversationId: null };
    setFilters(next); setDraft(next); setFilterError(null);
  };
  const conversation = (id: string | null) => {
    const next = { ...EMPTY_ACTIVITY_FILTERS, conversationId: id };
    setFilters(next); setDraft(next); setFilterError(null);
  };
  const changeStatus = async (status: 'active' | 'reactivation_pending') => {
    if (!onStatusChange || statusBusy) return;
    setStatusBusy(true);
    try { await onStatusChange(userId, status); setOverview(null); setError(null); setRetry((value) => value + 1); }
    catch { setError('계정 상태를 변경하지 못했습니다. 다시 확인해주세요.'); }
    finally { setStatusBusy(false); }
  };
  if (!overview) return <View style={styles.section}>
    <ThemedText accessibilityRole={error ? 'alert' : 'progressbar'}>{error ?? '회원 식별 정보를 불러오는 중입니다.'}</ThemedText>
    {error && <Button label="다시 시도" onPress={() => { setError(null); setRetry((value) => value + 1); }} />}
  </View>;
  const profile = overview.profile;
  return <View style={styles.section}>
    <View style={styles.profileHeading}>
      <View style={styles.avatar} aria-hidden accessibilityElementsHidden><ThemedText type="subtitle" style={styles.accent}>{profile.nickname.trim().slice(0, 1)}</ThemedText></View>
      <View style={styles.identity}><ThemedText type="title" accessibilityRole="header" style={styles.name}>{profile.nickname}</ThemedText>
        <ThemedText type="small" style={styles.muted}>{ACCOUNT_TYPES[profile.account_type]} · {statusLabel(profile.account_status)}</ThemedText></View>
    </View>
    <View style={styles.card}>
      <GroupTitle title="계정 정보" />
      <Field label="회원 ID" value={profile.id} />
      <Field label="로그인 이메일" value={profile.email ?? '미제공'} />
      <Field label="이메일 확인" value={profile.email_confirmed_at ? formatDate(profile.email_confirmed_at) : '확인 기록 없음'} />
      <Field label="입력한 이름 · 비공개" value={profile.full_name ?? '미제공'} />
      <Field label="생년월일 · 만 나이" value={profile.date_of_birth ? `${profile.date_of_birth}${profile.age != null ? ` · 만 ${profile.age}세` : ''}` : '미제공'} />
      {profile.personal_info_updated_at && <Field label="개인정보 갱신" value={formatDate(profile.personal_info_updated_at)} />}
      <Field label="로그인 프로필 이름" value={profile.login_name ?? '미제공'} />
      <ThemedText type="small" style={styles.muted}>이름·생년월일은 본인이 별도 동의 후 입력한 정보입니다. 소셜 로그인 프로필 이름과 분리되며, 두 정보 모두 실명인증 결과가 아닙니다.</ThemedText>
      <Field label="실명인증" value="미도입 · 신뢰 단계와 별개" />
      <Field label="권한 · 신뢰" value={`${profile.auth_role} · 신뢰 ${profile.verification_level}`} />
      <Field label="가입" value={formatDate(profile.created_at)} />
      <Field label="최근 로그인" value={profile.last_sign_in_at ? formatDate(profile.last_sign_in_at) : '기록 없음'} />
      {!!profile.bio && <Field label="소개" value={profile.bio} />}
      {!!profile.account_status_note && <Field label="최근 상태 메모" value={profile.account_status_note} />}
      {onStatusChange && profile.account_status === 'suspended' && <Button disabled={statusBusy} label="이용 제한 해제" onPress={() => void changeStatus('active')} />}
      {onStatusChange && profile.account_status === 'deleted' && <Button disabled={statusBusy} label="재가입 허용" onPress={() => void changeStatus('reactivation_pending')} />}
      {error && <ThemedText accessibilityRole="alert" style={styles.error}>{error}</ThemedText>}
    </View>
    <View style={styles.card}>
      <GroupTitle title="위치 · 접속" />
      <Field label="등록 지역 · 회원 선택" value={[profile.city_id, profile.neighborhood].filter(Boolean).join(' · ') || '미제공'} />
      <Field label="최근 기기 위치 기록" value={overview.location_snapshot ? `${overview.location_snapshot.latitude}, ${overview.location_snapshot.longitude} · 반경 ${overview.location_snapshot.accuracy}m` : '보관 중인 기록 없음'} />
      {overview.location_snapshot && <>
        <Field label="위치 측정 시각" value={formatDate(overview.location_snapshot.measured_at)} />
        <Field label="서버 수신 시각" value={formatDate(overview.location_snapshot.received_at)} />
      </>}
      <ThemedText type="small" style={styles.muted}>동의한 사용자의 로그인·글 작성 시점에 기기가 보고한 위치입니다. 실시간 위치나 신원 인증이 아니며 30일 지난 기록은 조회되지 않습니다.</ThemedText>
      <Field label="최근 인증 세션 IP" value={profile.session_ip ?? '기록 없음'} />
      {profile.session_created_at && <Field label="해당 세션 생성" value={formatDate(profile.session_created_at)} />}
      {profile.session_updated_at && <Field label="해당 세션 갱신" value={formatDate(profile.session_updated_at)} />}
      <ThemedText type="small" style={styles.muted}>인증 서버에 남아 있는 세션 기록입니다. 공유망·VPN·인증 경로에 따라 IP가 달라질 수 있으며 현재 위치를 증명하지 않습니다. 보관 중인 다른 세션은 아래 계정 활동에서 조회합니다.</ThemedText>
    </View>
    <View style={styles.card}>
      <GroupTitle title="연결된 로그인 계정" />
      {overview.identities.map((identity) => <Field key={`${identity.provider}:${identity.provider_id}`} label={`${identity.provider} 계정 ID`} value={identity.provider_id} />)}
      {overview.identities.length === 0 && <ThemedText type="small" style={styles.muted}>연결된 계정 기록이 없습니다.</ThemedText>}
    </View>
    <GroupTitle title="저장된 활동" />
    <ThemedText type="small" style={styles.muted}>아래 건수는 현재 남아 있는 기록입니다. 삭제된 원문과 기록하지 않은 과거 변경은 포함되지 않습니다. 접속은 30분 구간 집계이며 최대 90일 보관됩니다.</ThemedText>
    <View style={styles.metrics}>{overview.counts.map((item) => <Pressable key={item.kind} accessibilityRole="button" accessibilityLabel={`${ACTIVITY_KINDS[item.kind]} ${item.count}건 보기`} onPress={() => chooseKind(item.kind)} style={({ pressed }) => [styles.metric, filters.kind === item.kind && styles.selected, pressed && styles.pressed]}>
      <ThemedText type="small" style={styles.muted}>{ACTIVITY_KINDS[item.kind]}</ThemedText><ThemedText type="smallBold" style={styles.metricValue}>{item.count}</ThemedText>
    </Pressable>)}</View>
    <View style={styles.card}>
      <GroupTitle title={filters.conversationId ? '대화 맥락' : '시간순 활동'} />
      {filters.conversationId && <><ThemedText selectable type="small">대화 {filters.conversationId} · 상대방 메시지 포함</ThemedText><Button label="회원 전체 활동으로 돌아가기" onPress={() => conversation(null)} /></>}
      {!filters.conversationId && <View accessibilityRole="radiogroup" accessibilityLabel="활동 종류" style={styles.filters}>{Object.entries(ACTIVITY_KINDS).map(([kind, label]) => <Pressable key={kind} accessibilityRole="radio" aria-checked={filters.kind === kind} tabIndex={filters.kind === kind ? 0 : -1} {...(Platform.OS === 'web' ? { onKeyDown: adminOptionKeys } : {})} onPress={() => chooseKind(kind as ActivityKind)} style={({ pressed }) => [styles.chip, filters.kind === kind && styles.selected, pressed && styles.pressed]}><ThemedText type="small" style={filters.kind === kind && styles.accent}>{label}</ThemedText></Pressable>)}</View>}
      <View style={styles.filters}>
        <TextInput accessibilityLabel="활동 시작일" placeholder="시작일 YYYY-MM-DD" value={draft.from} onChangeText={(from) => setDraft({ ...draft, from })} style={styles.input} maxLength={10} />
        <TextInput accessibilityLabel="활동 종료일" placeholder="종료일 YYYY-MM-DD" value={draft.until} onChangeText={(until) => setDraft({ ...draft, until })} style={styles.input} maxLength={10} />
      </View>
      <TextInput accessibilityLabel="활동 내용 또는 ID 검색" placeholder="내용, 상태 또는 ID 검색" value={draft.query} onChangeText={(query) => setDraft({ ...draft, query })} onSubmitEditing={apply} maxLength={200} style={styles.input} />
      <ThemedText type="small" style={styles.muted}>날짜 기준: {Intl.DateTimeFormat().resolvedOptions().timeZone} · 종료일 포함</ThemedText>
      <Button label="조회 조건 적용" onPress={apply} />
      {filterError && <ThemedText accessibilityRole="alert" style={styles.error}>{filterError}</ThemedText>}
    </View>
    <ActivityTimeline key={JSON.stringify(filters)} userId={userId} filters={filters} profiles={profiles} nickname={profile.nickname} onConversation={conversation} />
  </View>;
}

function ActivityTimeline({ userId, filters, profiles, nickname, onConversation }: {
  userId: string; filters: ActivityFilters; profiles: Map<string, AdminProfile>; nickname: string; onConversation: (id: string) => void;
}) {
  const [page, setPage] = useState<AdminActivityPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [retry, setRetry] = useState(0);
  const revision = useRef(0);
  useEffect(() => {
    const id = ++revision.current;
    void loadAdminUserActivityPage(supabase, userId, filters)
      .then((data) => { if (id === revision.current) setPage(data); })
      .catch(() => { if (id === revision.current) setError('활동을 불러오지 못했습니다. 기록 없음으로 처리하지 않았습니다.'); })
      .finally(() => { if (id === revision.current) setBusy(false); });
    return () => { revision.current = id + 1; };
  }, [filters, userId, retry]);
  const more = async () => {
    if (!page?.nextCursor || busy) return;
    const id = revision.current;
    setBusy(true); setError(null);
    try {
      const next = await loadAdminUserActivityPage(supabase, userId, filters, page.nextCursor);
      if (id === revision.current) setPage({ ...next, rows: mergeActivityRows(page.rows, next.rows) });
    } catch { if (id === revision.current) setError('이전 활동을 불러오지 못했습니다. 다시 시도할 수 있습니다.'); }
    finally { if (id === revision.current) setBusy(false); }
  };
  return <View style={styles.section}>
    {page && <ThemedText accessibilityLiveRegion="polite">조건에 맞는 {page.total}건 중 {page.rows.length}건 표시 · 최신순</ThemedText>}
    {busy && !page && <ThemedText accessibilityRole="progressbar">활동을 불러오는 중입니다.</ThemedText>}
    {error && <><ThemedText accessibilityRole="alert" style={styles.error}>{error}</ThemedText><Button label="다시 시도" onPress={() => { if (page) void more(); else { setError(null); setBusy(true); setRetry((value) => value + 1); } }} /></>}
    {page?.rows.map((event) => <View key={event.event_key} style={[styles.card, styles.event]}>
      <View style={styles.eventHeading}><ThemedText type="smallBold" style={styles.eventKind}>{ACTIVITY_KINDS[event.kind]}</ThemedText><ThemedText type="small" style={styles.muted}>{formatDate(event.occurred_at)}{event.state ? ` · ${statusLabel(event.state)}` : ''}</ThemedText></View>
      <ThemedText type="smallBold">{event.title}</ThemedText>
      <ThemedText selectable>{event.body || '추가 내용 없음'}</ThemedText>
      {event.actor_id && <ThemedText selectable type="small" style={styles.muted}>행위자 · {event.actor_id === userId ? `${nickname} (본인)` : profiles.get(event.actor_id)?.nickname ?? event.actor_id}</ThemedText>}
      <ThemedText selectable type="small" style={styles.id}>{event.event_key}</ThemedText>
      {event.context_id && <ThemedText selectable type="small" style={styles.id}>관련 ID · {event.context_id}</ThemedText>}
      {!filters.conversationId && event.context_id && ['message','conversation'].includes(event.kind) && <Button label="이 대화 앞뒤 내용 보기" onPress={() => onConversation(event.context_id!)} />}
    </View>)}
    {page?.total === 0 && <ThemedText>이 조건에 맞는 저장된 활동이 없습니다.</ThemedText>}
    {page?.nextCursor && <Button label={busy ? '불러오는 중' : '이전 활동 50개 더 보기'} disabled={busy} onPress={() => void more()} />}
    {page && !page.nextCursor && page.total > 0 && <ThemedText type="small" style={styles.muted}>이 조건의 저장된 기록을 끝까지 불러왔습니다. 삭제된 기록은 복구되지 않습니다.</ThemedText>}
  </View>;
}

function Field({ label, value }: { label: string; value: string }) {
  return <View style={styles.field}><ThemedText type="small" style={styles.fieldLabel}>{label}</ThemedText><ThemedText selectable type="small" style={styles.fieldValue}>{value}</ThemedText></View>;
}
function GroupTitle({ title }: { title: string }) {
  return <ThemedText accessibilityRole="header" {...(Platform.OS === 'web' ? { 'aria-level': 2 } : {})} style={styles.groupTitle}>{title}</ThemedText>;
}
function Button({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, disabled && styles.disabled, pressed && styles.pressed]}><ThemedText type="smallBold">{label}</ThemedText></Pressable>;
}
function formatDate(value: string) { return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value)); }
function statusLabel(value: string) {
  return ({ active: '정상', suspended: '이용 제한', deleted: '삭제됨', reactivation_pending: '재가입 허용', published: '게시중', removed: '숨김', pending: '대기', approved: '승인', rejected: '거절', cancelled: '취소', ended: '종료', open: '미처리', actioned: '조치함', dismissed: '기각', warned: '경고', blocked: '차단' } as Record<string, string>)[value] ?? value;
}
const styles = StyleSheet.create({
  section: { gap: Spacing.three }, card: { padding: Spacing.three, gap: Spacing.two, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 10, backgroundColor: Colors.light.card },
  profileHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.light.backgroundElement, justifyContent: 'center', alignItems: 'center' },
  identity: { flex: 1, minWidth: 0, gap: Spacing.one }, name: { fontSize: 26, lineHeight: 34, letterSpacing: -0.5 },
  groupTitle: { fontSize: 17, lineHeight: 24, fontWeight: 600, marginBottom: Spacing.one },
  field: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.light.line },
  fieldLabel: { flexBasis: 156, flexGrow: 1, color: Colors.light.textSecondary }, fieldValue: { flexBasis: 220, flexGrow: 3, minWidth: 0 },
  muted: { color: Colors.light.textSecondary }, error: { color: Colors.light.accent }, accent: { color: Colors.light.accent },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  metric: { minHeight: 44, flexBasis: 120, flexGrow: 1, padding: Spacing.two, gap: Spacing.two, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8, backgroundColor: Colors.light.card },
  metricValue: { fontVariant: ['tabular-nums'], fontSize: 17 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { minHeight: 44, paddingHorizontal: Spacing.two, justifyContent: 'center', borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8 },
  selected: { borderColor: Colors.light.accent, backgroundColor: Colors.light.background },
  input: { minHeight: 44, flexGrow: 1, minWidth: 150, paddingHorizontal: Spacing.two, color: Colors.light.text, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 6, backgroundColor: Colors.light.card },
  button: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8, backgroundColor: Colors.light.background },
  event: { borderLeftWidth: 3, borderLeftColor: Colors.light.navy },
  eventHeading: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, alignItems: 'center' }, eventKind: { color: Colors.light.navy },
  pressed: { opacity: 0.65 }, disabled: { opacity: 0.55 },
  id: { fontFamily: 'monospace', fontSize: 11, color: Colors.light.textSecondary },
});
