import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type ScrollViewInstance } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { adminOptionKeys } from '@/lib/admin';
import type { AdminProfile } from '@/lib/admin-data';
import {
  ACCOUNT_TYPES, ACTIVITY_KINDS, EMPTY_ACTIVITY_FILTERS, activityParams,
  ADMIN_GENDERS, loadAdminUserOverview, loadAdminUserActivityPage, mergeActivityRows,
  type ActivityFilters, type ActivityKind, type AdminActivityPage, type AdminUserOverview,
} from '@/lib/admin-user-data';
import { supabase } from '@/lib/supabase';
import { formatIpGeo, lookupIpGeo, type IpGeo } from '@/lib/ip-geo';
import { nearbyCommunity } from '@/lib/location';
import { CITIES } from '@/lib/mock';
import { getAdminMerchantAccess, setAdminMerchantAccess } from '@/lib/admin-merchants';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { displayName } from '@/lib/admin-labels';
import { NicknameEditor } from '@/components/nickname-editor';
import { changeProfileNickname } from '@/lib/nickname';
import { AdminUserBusiness } from './admin-user-business';
import { AdminUserMembership } from './admin-user-membership';
import { AdminButton, AdminCard, AdminFacts, AdminInfo, AdminPill, AdminTrace, type AdminTone } from './admin-ui';

const MAIN_ACTIVITY_KINDS: ActivityKind[] = ['all', 'post', 'comment', 'message', 'meetup', 'report'];
const KIND_TONES: Partial<Record<ActivityKind, AdminTone>> = {
  account: 'success', post: 'accent', comment: 'accent', message: 'navy', conversation: 'navy', meetup: 'accent',
  report: 'danger', moderation: 'danger', safety: 'danger', block: 'warning', payment: 'warning',
};

export function AdminUserReview({ userId, profiles, onStatusChange, onTrustLevelChange, onProfileChanged, onClose }: {
  userId: string; profiles: Map<string, AdminProfile>; onClose?: () => void;
  onStatusChange?: (userId: string, status: 'active' | 'reactivation_pending') => Promise<void>;
  onTrustLevelChange?: (userId: string, level: 1 | 2 | 3) => Promise<void>;
  onProfileChanged?: () => Promise<void>;
}) {
  const [overview, setOverview] = useState<AdminUserOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [statusBusy, setStatusBusy] = useState(false);
  const [trustBusy, setTrustBusy] = useState(false);
  const { play } = useInteractionFeedback();
  const [merchantAccess, setMerchantAccess] = useState<boolean | null>(null), [merchantBusy, setMerchantBusy] = useState(false);
  const [ipGeo, setIpGeo] = useState<{ ip: string; geo: IpGeo | null } | null>(null);
  const [filters, setFilters] = useState<ActivityFilters>(EMPTY_ACTIVITY_FILTERS);
  const [draft, setDraft] = useState<ActivityFilters>(EMPTY_ACTIVITY_FILTERS);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [tab, setTab] = useState('activity');
  const scroll = useRef<ScrollViewInstance>(null);
  const showConnection = tab === 'info';
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [tab]);
  const [showFilters, setShowFilters] = useState(false);
  useEffect(() => {
    let active = true;
    void loadAdminUserOverview(supabase, userId)
      .then((value) => { if (active) setOverview(value); })
      .catch(() => { if (active) setError('회원 상세를 불러오지 못했습니다. 관리자 권한과 연결을 확인해주세요.'); });
    void getAdminMerchantAccess(supabase, userId).then(value => { if (active) setMerchantAccess(value); }).catch(() => { if (active) setError('비즈니스 권한을 확인하지 못했습니다.'); });
    return () => { active = false; };
  }, [userId, retry]);
  const changeMerchantAccess = async (enabled: boolean) => {
    if (merchantBusy || merchantAccess === null || merchantAccess === enabled) return;
    play('selection');
    if (!await confirmChange(enabled ? '비즈니스 관리 권한을 줄까요?' : '비즈니스 관리 권한을 없앨까요?', enabled ? '이 회원이 연결된 비즈니스를 관리할 수 있게 돼요.' : '기존 글·사진은 남아요.', !enabled)) return;
    setMerchantBusy(true); setError(null);
    try {
      await setAdminMerchantAccess(supabase, userId, enabled);
      const saved = await getAdminMerchantAccess(supabase, userId);
      if (saved !== enabled) throw new Error('MERCHANT_ACCESS_SAVE_FAILED');
      setMerchantAccess(saved);
    } catch { play('warning'); setMerchantAccess(null); setError('변경 결과를 확인하지 못했습니다. 다시 확인한 뒤 변경해 주세요.'); }
    finally { setMerchantBusy(false); }
  };
  const sessionIp = overview?.profile.session_ip ?? null;
  useEffect(() => {
    if (!showConnection) return;
    let active = true;
    void lookupIpGeo(sessionIp).then((geo) => { if (active) setIpGeo(sessionIp ? { ip: sessionIp, geo } : null); });
    return () => { active = false; };
  }, [sessionIp, showConnection]);
  const apply = () => {
    try { activityParams(userId, draft); setFilters({ ...draft }); setFilterError(null); }
    catch (error) { setFilterError(error instanceof Error ? error.message : '조회 조건을 확인해주세요.'); }
  };
  const chooseKind = (kind: ActivityKind) => {
    play('selection');
    const next = { ...filters, kind, conversationId: null };
    setFilters(next); setDraft(next); setFilterError(null);
  };
  const conversation = (id: string | null) => {
    const next = { ...EMPTY_ACTIVITY_FILTERS, conversationId: id };
    setFilters(next); setDraft(next); setFilterError(null);
  };
  const changeStatus = async (status: 'active' | 'reactivation_pending') => {
    if (!onStatusChange || statusBusy) return;
    if (!await confirmChange(status === 'active' ? '이용 제한을 풀까요?' : '재가입을 허용할까요?', status === 'active' ? '이 회원이 바로 다시 활동할 수 있어요.' : '탈퇴·재가입 잠금이 풀려요.', false)) return;
    setStatusBusy(true);
    try { await onStatusChange(userId, status); setOverview(null); setError(null); setRetry((value) => value + 1); }
    catch { setError('계정 상태를 변경하지 못했습니다. 다시 확인해주세요.'); }
    finally { setStatusBusy(false); }
  };
  const changeTrust = async (level: 1 | 2 | 3) => {
    if (!onTrustLevelChange || trustBusy) return;
    play('selection');
    setTrustBusy(true);
    try { await onTrustLevelChange(userId, level); setOverview(null); setError(null); setRetry((value) => value + 1); }
    catch { setError('신뢰 단계를 바꾸지 못했습니다. 다시 확인해주세요.'); }
    finally { setTrustBusy(false); }
  };
  const closeButton = onClose && <Pressable onPress={() => { play('selection'); onClose(); }} accessibilityRole="button" accessibilityLabel="사용자 상세 닫기" style={({ pressed }) => [styles.close, pressed && styles.pressed]}><ThemedText type="smallBold">✕</ThemedText></Pressable>;
  if (!overview) return <View style={[styles.section, styles.profileHeading]}>
    <View style={styles.identity}><ThemedText accessibilityRole={error ? 'alert' : 'progressbar'}>{error ?? '회원 식별 정보를 불러오는 중이에요.'}</ThemedText>
      {error && <Button label="다시 시도" onPress={() => { setError(null); setRetry((value) => value + 1); }} />}</View>
    {closeButton}
  </View>;
  const profile = overview.profile;
  // undefined = lookup still running for this IP
  const geo = sessionIp && ipGeo?.ip === sessionIp ? ipGeo.geo : undefined;
  const snapshot = overview.location_snapshot;
  const measuredAt = snapshot ? Date.parse(snapshot.measured_at) : NaN;
  // Evaluate the recorded fix at measurement time, not as a fresh/live location.
  const gpsCityId = snapshot ? nearbyCommunity({ ...snapshot, measuredAt, mocked: false }, measuredAt) : null;
  const gpsCity = CITIES.find((city) => city.id === gpsCityId);
  const cityName = CITIES.find(city => city.id === profile.city_id)?.name ?? profile.city_id;
  const count = (kind: ActivityKind) => overview.counts.find(item => item.kind === kind)?.count ?? 0;
  const statusTone = profile.account_status === 'active' ? 'success' : profile.account_status === 'reactivation_pending' ? 'warning' : 'danger';
  const roleLabel = profile.auth_role === 'admin' ? '관리자' : profile.auth_role === 'member' ? '일반 회원' : profile.auth_role;
  const merchantChoice = (enabled: boolean) => <Pressable key={String(enabled)} accessibilityRole="button" accessibilityLabel={`비즈니스 관리 권한 ${enabled ? '있음' : '없음'}`} accessibilityState={{ selected: merchantAccess === enabled, disabled: merchantBusy || merchantAccess === null || merchantAccess === enabled }} disabled={merchantBusy || merchantAccess === null || merchantAccess === enabled}
    onPress={() => { void changeMerchantAccess(enabled); }} style={({ pressed }) => [styles.chip, merchantAccess === enabled && styles.selected, pressed && styles.pressed]}><ThemedText type="smallBold" style={merchantAccess === enabled ? styles.accent : undefined}>{enabled ? '권한 있음' : '권한 없음'}</ThemedText></Pressable>;
  return <View style={styles.workspace}>
    <View style={styles.header}>
      <View style={styles.profileHeading}>
        <View style={styles.avatar} aria-hidden accessibilityElementsHidden><ThemedText type="subtitle" style={styles.accent}>{profile.nickname.trim().slice(0, 1)}</ThemedText></View>
        <View style={styles.identity}>
          <View style={styles.nameRow}><ThemedText accessibilityRole="header" style={styles.name} numberOfLines={1}>{profile.nickname}</ThemedText>
            <AdminPill label={statusLabel(profile.account_status)} tone={statusTone} /><AdminPill label={`신뢰 ${profile.verification_level}단계`} tone="accent" /></View>
          <ThemedText type="small" style={styles.muted}>{[cityName, ACCOUNT_TYPES[profile.account_type], `${formatDay(profile.created_at)} 가입`].filter(Boolean).join(' · ')}</ThemedText>
        </View>
        {closeButton}
      </View>
      <AdminFacts items={[
        { label: '게시글', value: count('post') }, { label: '댓글', value: count('comment') },
        { label: '신고 기록', value: count('report'), tone: count('report') ? 'warning' : undefined }, { label: '관리자 조치', value: count('moderation'), tone: count('moderation') ? 'danger' : undefined },
      ]} />
    </View>
    <View accessibilityRole="tablist" accessibilityLabel="회원 상세 화면" style={styles.tabs}>
      {([['activity', '활동 기록'], ['management', '계정 관리'], ['info', '정보']] as const).map(([key, label]) => <Pressable key={key} nativeID={`admin-member-tab-${key}`} accessibilityRole="tab" aria-selected={tab === key} aria-controls={`admin-member-${key}`} tabIndex={tab === key ? 0 : -1} {...(Platform.OS === 'web' ? { onKeyDown: adminOptionKeys } : {})} onPress={() => { play('selection'); setTab(key); }} style={({ pressed }) => [styles.tab, tab === key && styles.activeTab, pressed && styles.pressed]}><ThemedText type="smallBold" style={tab === key ? styles.accent : styles.muted}>{label}</ThemedText></Pressable>)}
    </View>
    <ScrollView ref={scroll} nativeID="admin-member-scroll" style={styles.scroll} contentContainerStyle={styles.body}>
      {error && <ThemedText accessibilityRole="alert" style={styles.error}>{error}</ThemedText>}
      <View nativeID="admin-member-activity" role="tabpanel" aria-labelledby="admin-member-tab-activity" style={{ display: tab === 'activity' ? 'flex' : 'none', gap: 16 }}>
        <View style={styles.activityControls}>
          {filters.conversationId && <><GroupTitle title="대화 맥락" /><ThemedText type="small">상대방 메시지를 포함한 대화예요.</ThemedText><Button label="회원 전체 활동으로 돌아가기" onPress={() => conversation(null)} /></>}
          {!filters.conversationId && <ScrollView horizontal showsHorizontalScrollIndicator={false}><View accessibilityRole="radiogroup" accessibilityLabel="활동 종류" style={styles.kindFilters}>{Object.entries(ACTIVITY_KINDS).filter(([kind]) => showFilters || MAIN_ACTIVITY_KINDS.includes(kind as ActivityKind) || kind === filters.kind).map(([kind, label]) => <Pressable key={kind} accessibilityRole="radio" aria-checked={filters.kind === kind} tabIndex={filters.kind === kind ? 0 : -1} {...(Platform.OS === 'web' ? { onKeyDown: adminOptionKeys } : {})} onPress={() => chooseKind(kind as ActivityKind)} style={({ pressed }) => [styles.chip, filters.kind === kind && styles.selected, pressed && styles.pressed]}><ThemedText type="small" style={filters.kind === kind && styles.accent}>{label}{kind !== 'all' ? ` ${overview.counts.find(item => item.kind === kind)?.count ?? 0}` : ''}</ThemedText></Pressable>)}</View></ScrollView>}
          <View style={styles.helpRow}>
            <Button expanded={showFilters} label={showFilters ? '상세 조회 조건 접기' : '상세 조회 조건'} onPress={() => setShowFilters(value => !value)} />
            <AdminInfo label="기록 기준 보기" text="종류별 건수는 이 회원의 전체 보관 기록이고, 대화 맥락의 건수가 아니에요. 삭제된 원문과 기록하지 않은 과거 변경은 빠져 있어요. 접속은 30분 단위로 모으고 최대 90일 보관해요." />
          </View>
          <View style={{ display: showFilters ? 'flex' : 'none', gap: 12 }}>
            <View style={styles.filters}>
              <TextInput onFocus={() => play('selection')} accessibilityLabel="활동 시작일" placeholder="시작일 YYYY-MM-DD" value={draft.from} onChangeText={(from) => setDraft({ ...draft, from })} style={styles.input} maxLength={10} />
              <TextInput onFocus={() => play('selection')} accessibilityLabel="활동 종료일" placeholder="종료일 YYYY-MM-DD" value={draft.until} onChangeText={(until) => setDraft({ ...draft, until })} style={styles.input} maxLength={10} />
            </View>
            <TextInput onFocus={() => play('selection')} accessibilityLabel="활동 내용 검색" placeholder="내용, 상태 검색" value={draft.query} onChangeText={(query) => setDraft({ ...draft, query })} onSubmitEditing={apply} maxLength={200} style={styles.input} />
            <ThemedText type="small" style={styles.muted}>날짜 기준: {Intl.DateTimeFormat().resolvedOptions().timeZone} · 종료일 포함</ThemedText>
            <View style={styles.helpRow}><AdminButton kind="primary" label="조회 조건 적용" onPress={apply} /></View>
            {filterError && <ThemedText accessibilityRole="alert" style={styles.error}>{filterError}</ThemedText>}
          </View>
        </View>
        <ActivityTimeline key={JSON.stringify(filters)} userId={userId} filters={filters} profiles={profiles} nickname={profile.nickname} onConversation={conversation} />
      </View>
      <View nativeID="admin-member-management" role="tabpanel" aria-labelledby="admin-member-tab-management" style={{ display: tab === 'management' ? 'flex' : 'none', gap: 12 }}>
        <AdminCard icon="⛔" tone={profile.account_status === 'active' ? 'success' : 'danger'} title="이용 상태" info="이용 제한은 신고 처리 화면에서 해요. 여기서는 제한 해제와 재가입 허용만 할 수 있어요."
          action={<AdminPill label={statusLabel(profile.account_status)} tone={statusTone} />}>
          {!!profile.account_status_note && <Field label="최근 메모" value={profile.account_status_note} />}
          {onStatusChange && profile.account_status === 'suspended' && <View style={styles.helpRow}><AdminButton disabled={statusBusy} label="이용 제한 해제" onPress={() => void changeStatus('active')} /></View>}
          {onStatusChange && profile.account_status === 'deleted' && <View style={styles.helpRow}><AdminButton disabled={statusBusy} label="재가입 허용" onPress={() => void changeStatus('reactivation_pending')} /></View>}
          {!profile.account_status_note && !(onStatusChange && ['suspended', 'deleted'].includes(profile.account_status)) && <ThemedText type="small" style={styles.muted}>남은 상태 메모가 없어요.</ThemedText>}
        </AdminCard>
        <AdminCard icon="★" tone="accent" title="신뢰 단계" info="배지와 노출 판단에만 써요. 실명인증 결과가 아니고, 바꾸면 감사 기록에 남아요.">
          {onTrustLevelChange ? <View style={styles.trustRow}>
            {([1, 2, 3] as const).map((level) => (
              <Pressable key={level} accessibilityRole="button" disabled={trustBusy || level === profile.verification_level}
                accessibilityLabel={`신뢰 단계 ${level}로 변경`}
                accessibilityState={{ disabled: trustBusy || level === profile.verification_level, selected: level === profile.verification_level }}
                onPress={() => void changeTrust(level)}
                style={({ pressed }) => [styles.chip, styles.segment, level === profile.verification_level && styles.selected, trustBusy && styles.disabled, pressed && styles.pressed]}>
                <ThemedText type="smallBold" style={level === profile.verification_level ? styles.accent : undefined}>{level}단계</ThemedText>
              </Pressable>
            ))}
            {trustBusy && <ThemedText type="small" accessibilityLiveRegion="polite" style={styles.muted}>바꾸는 중…</ThemedText>}
          </View> : <ThemedText type="smallBold">{profile.verification_level}단계</ThemedText>}
        </AdminCard>
        <AdminCard icon="◆" tone="accent" title="멤버십" info={['관리자 지급은 스토어 결제와 별개예요. 자동으로 결제되거나 갱신되지 않고, 끝나는 날 밤까지만 적용돼요.', '스토어 결제나 초대 이용권이 더 높으면 그쪽이 적용돼요. 지급·해제는 누가 언제 했는지 변경 기록에 남아요.']}>
          <AdminUserMembership key={userId} userId={userId} active={profile.account_status === 'active'} />
        </AdminCard>
        <View style={styles.cardRow}>
          <AdminCard icon="✎" tone="navy" title="닉네임" style={styles.halfCard}>
            {profile.account_status === 'active' ? <NicknameEditor admin nickname={profile.nickname} onSave={async (value, expected) => {
              const nickname = await changeProfileNickname(supabase, userId, value, expected);
              setOverview(current => current?.profile.id === userId ? { ...current, profile: { ...current.profile, nickname } } : current);
              await onProfileChanged?.();
            }} /> : <ThemedText type="smallBold">{profile.nickname}</ThemedText>}
          </AdminCard>
          <AdminCard icon="⌂" tone="navy" title="비즈니스 연결" style={styles.halfCard} info={['관리 권한이 있으면 본인이 운영하는 비즈니스를 관리할 수 있어요. 비즈니스 소유 확인, 관리자 권한과는 별개예요.', '개인 프로필은 그대로 두고 비즈니스만 연결해요. 권한을 없애도 기존 글·사진은 남아요.']}>
            <View style={styles.trustRow}>
              {([true, false] as const).map(merchantChoice)}
              {(merchantBusy || merchantAccess === null) && <ThemedText type="small" accessibilityLiveRegion="polite" style={styles.muted}>{merchantBusy ? '저장 중…' : '확인 필요'}</ThemedText>}
            </View>
            {merchantAccess === null && <Button label="비즈니스 권한 다시 확인" onPress={() => setRetry(v => v + 1)} />}
            {profile.account_status === 'active' && <AdminUserBusiness key={[profile.id, profile.nickname, profile.email].join(':')} account={profile} onChanged={() => setRetry(value => value + 1)} />}
          </AdminCard>
        </View>
      </View>
      <View nativeID="admin-member-info" role="tabpanel" aria-labelledby="admin-member-tab-info" style={{ display: showConnection ? 'flex' : 'none', gap: 12 }}>
        <AdminCard icon="✎" tone="navy" title="본인 입력" info={['이름·생년월일은 본인이 따로 동의하고 입력한 정보예요. 소셜 로그인 프로필 이름과 별개예요.', '둘 다 실명인증 결과가 아니에요. 실명인증은 아직 도입하지 않았고 신뢰 단계와도 별개예요.']}>
          <Field label="입력한 이름 · 비공개" value={profile.full_name ?? '미제공'} />
          <Field label="생년월일 · 만 나이" value={profile.date_of_birth ? `${profile.date_of_birth}${profile.age != null ? ` · 만 ${profile.age}세` : ''}` : '미제공'} />
          <Field label="성별 · 비공개" value={profile.gender ? ADMIN_GENDERS[profile.gender] ?? profile.gender : '미제공'} />
          {profile.personal_info_updated_at && <Field label="개인정보 갱신" value={formatDate(profile.personal_info_updated_at)} />}
          {!!profile.bio && <Field label="소개" value={profile.bio} />}
        </AdminCard>
        <AdminCard icon="⇥" tone="navy" title="로그인">
          <Field label="가입일" value={formatDate(profile.created_at)} />
          <Field label="로그인 이메일" value={profile.email ?? '미제공'} />
          <Field label="이메일 확인" value={profile.email_confirmed_at ? '확인 완료' : '확인 기록 없음'} />
          <Field label="로그인 프로필 이름" value={profile.login_name ?? '미제공'} />
          <Field label="연결된 로그인" value={overview.identities.map(identity => identity.provider).join(' · ') || '기록 없음'} />
          <Field label="최근 로그인" value={profile.last_sign_in_at ? formatDate(profile.last_sign_in_at) : '기록 없음'} />
        </AdminCard>
        <AdminCard icon="⌖" tone="navy" title="위치 · 접속" info={[
          '실시간 위치나 신원 인증이 아니에요. 위치 기록은 30일 보관하고, 지난 기록은 조회되지 않아요.',
          '선호 지역은 회원이 저장한 선택이고 지역별 회원 수를 셀 때 써요. GPS 도시는 동의한 회원의 최근 측정 위치에서 가까운 지원 커뮤니티예요. 로그인·글·모임 작성 때 남은 기록이에요.',
          '세션 IP는 인증 서버에 남은 기록이라 공유망·VPN·인증 경로에 따라 달라질 수 있고 현재 위치를 증명하지 않아요. 국가·도시·통신사는 공개 IP 위치 DB(ipwho.is) 조회 결과예요. 휴대폰 IP는 통신사 등록지로 나올 수 있어요. 다른 세션은 활동 기록에서 볼 수 있어요.',
        ]}>
          <Field label="선호 지역 · 회원 선택" value={[cityName, profile.neighborhood].filter(Boolean).join(' · ') || '미제공'} />
          <Field label="GPS 기준 가까운 도시" value={snapshot ? gpsCity?.name ?? '연결 가능한 도시 없음 · 지원 범위 또는 정확도 확인 필요' : '보관 중인 기록 없음'} />
          <Field label="최근 기기 위치 기록" value={snapshot ? `${snapshot.latitude}, ${snapshot.longitude} · 반경 ${snapshot.accuracy}m` : '보관 중인 기록 없음'} />
          {snapshot && <>
            <Field label="위치 측정 시각" value={formatDate(snapshot.measured_at)} />
            <Field label="서버 수신 시각" value={formatDate(snapshot.received_at)} />
          </>}
          <Field label="최근 인증 세션 IP" value={profile.session_ip ?? '기록 없음'} />
          {!!profile.session_ip && <Field label="IP 국가 · 도시" value={geo === undefined ? '조회 중…' : geo ? formatIpGeo(geo) : '추정 결과 없음 · VPN·공유망·사내망일 수 있음'} />}
          {profile.session_created_at && <Field label="해당 세션 생성" value={formatDate(profile.session_created_at)} />}
          {profile.session_updated_at && <Field label="해당 세션 갱신" value={formatDate(profile.session_updated_at)} />}
        </AdminCard>
      </View>
      <AdminTrace items={[{ label: '회원 ID', value: profile.id }, { label: '권한', value: roleLabel }, ...overview.identities.map((identity) => ({ label: `${identity.provider} 계정 ID`, value: identity.provider_id }))]} />
    </ScrollView>
  </View>;
}

function ActivityTimeline({ userId, filters, profiles, nickname, onConversation }: {
  userId: string; filters: ActivityFilters; profiles: Map<string, AdminProfile>; nickname: string; onConversation: (id: string) => void;
}) {
  const [page, setPage] = useState<AdminActivityPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [expandedEvents, setExpandedEvents] = useState<string[]>([]);
  const [showTechnical, setShowTechnical] = useState(false);
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
  return <View style={styles.timeline}>
    {page && <ThemedText type="small" accessibilityLiveRegion="polite" style={styles.muted}>{page.total}건 중 {page.rows.length}건</ThemedText>}
    {busy && !page && <ThemedText accessibilityRole="progressbar">활동을 불러오는 중입니다.</ThemedText>}
    {error && <><ThemedText accessibilityRole="alert" style={styles.error}>{error}</ThemedText><Button label="다시 시도" onPress={() => { if (page) void more(); else { setError(null); setBusy(true); setRetry((value) => value + 1); } }} /></>}
    {page?.rows.map((event, index) => {
      const day = formatDay(event.occurred_at);
      const content = MAIN_ACTIVITY_KINDS.includes(event.kind) || ['moderation', 'payment', 'safety'].includes(event.kind);
      return <View key={event.event_key}>
      {(index === 0 || formatDay(page.rows[index - 1].occurred_at) !== day) && <ThemedText accessibilityRole="header" type="smallBold" style={styles.dayHeader}>{day}</ThemedText>}
      <View style={[styles.card, styles.event]}>
      <View style={styles.eventHeading}><AdminPill label={ACTIVITY_KINDS[event.kind]} tone={KIND_TONES[event.kind] ?? 'neutral'} /><ThemedText type="small" style={styles.muted}>{formatTime(event.occurred_at)}{event.state ? ` · ${statusLabel(event.state)}` : ''}</ThemedText></View>
      <ThemedText type="smallBold">{event.title}</ThemedText>
      {(content || !!event.body) && <ThemedText selectable numberOfLines={expandedEvents.includes(event.event_key) || !event.body || (event.body.length <= 120 && !event.body.includes('\n')) ? undefined : 2}>{event.body || '추가 내용 없음'}</ThemedText>}
      {event.body && (event.body.length > 120 || event.body.includes('\n')) && <Button expanded={expandedEvents.includes(event.event_key)} label={expandedEvents.includes(event.event_key) ? '원문 접기' : '원문 펼치기'} onPress={() => setExpandedEvents(keys => keys.includes(event.event_key) ? keys.filter(key => key !== event.event_key) : [...keys, event.event_key])} />}
      {event.actor_id && (event.actor_id !== userId || showTechnical) && <ThemedText selectable type="small" style={styles.muted}>행위자 · {event.actor_id === userId ? `${nickname} (본인)` : displayName(profiles.get(event.actor_id), event.actor_id)}</ThemedText>}
      {showTechnical && <><ThemedText selectable type="small" style={styles.id}>{event.event_key}</ThemedText>{event.context_id && <ThemedText selectable type="small" style={styles.id}>관련 ID · {event.context_id}</ThemedText>}</>}
      {!filters.conversationId && event.context_id && ['message','conversation'].includes(event.kind) && <Button label="이 대화 앞뒤 내용 보기" onPress={() => onConversation(event.context_id!)} />}
    </View></View>; })}
    {page?.total === 0 && <ThemedText>이 조건에 맞는 저장된 활동이 없습니다.</ThemedText>}
    {page?.nextCursor && <Button label={busy ? '불러오는 중' : '이전 활동 50개 더 보기'} disabled={busy} onPress={() => void more()} />}
    {page && <Button expanded={showTechnical} label={showTechnical ? '문제 추적 정보 접기' : '문제 추적 정보'} onPress={() => setShowTechnical(value => !value)} />}
    {page && !page.nextCursor && page.total > 0 && <ThemedText type="small" style={styles.muted}>이 조건의 저장된 기록을 끝까지 불러왔습니다. 삭제된 기록은 복구되지 않습니다.</ThemedText>}
  </View>;
}

function Field({ label, value }: { label: string; value: string }) {
  return <View style={styles.field}><ThemedText type="small" style={styles.fieldLabel}>{label}</ThemedText><ThemedText selectable type="small" style={styles.fieldValue}>{value}</ThemedText></View>;
}
function GroupTitle({ title }: { title: string }) {
  return <ThemedText accessibilityRole="header" {...(Platform.OS === 'web' ? { 'aria-level': 2 } : {})} style={styles.groupTitle}>{title}</ThemedText>;
}
function Button({ label, onPress, disabled = false, expanded }: { label: string; onPress: () => void; disabled?: boolean; expanded?: boolean }) {
  const { play } = useInteractionFeedback();
  return <Pressable accessibilityRole="button" aria-expanded={expanded} accessibilityState={{ disabled, expanded }} disabled={disabled} onPress={() => { play('selection'); onPress(); }} style={({ pressed }) => [styles.button, disabled && styles.disabled, pressed && styles.pressed]}><ThemedText type="smallBold">{label}</ThemedText></Pressable>;
}
// Account-changing actions confirm first; the destructive (red) style only appears inside this dialog.
function confirmChange(title: string, message: string, destructive: boolean) {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n${message}`));
  return new Promise<boolean>((resolve) => Alert.alert(title, message, [
    { text: '취소', style: 'cancel', onPress: () => resolve(false) },
    { text: '확인', style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
}
function formatDay(value: string) { return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(value)); }
function formatTime(value: string) { return new Intl.DateTimeFormat('ko-KR', { timeStyle: 'medium' }).format(new Date(value)); }
function formatDate(value: string) { return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value)); }
function statusLabel(value: string) {
  return ({ active: '정상', suspended: '이용 제한', deleted: '삭제됨', reactivation_pending: '재가입 허용', published: '게시중', removed: '숨김', pending: '대기', approved: '승인', rejected: '거절', cancelled: '취소', ended: '종료', open: '미처리', actioned: '조치함', dismissed: '기각', warned: '경고', blocked: '차단' } as Record<string, string>)[value] ?? value;
}
const styles = StyleSheet.create({
  workspace: { flex: 1, minHeight: 0 }, scroll: { flex: 1 }, body: { padding: 20, paddingBottom: 40, gap: 16 },
  section: { gap: Spacing.four }, timeline: { gap: Spacing.two }, card: { gap: Spacing.two },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.admin.line, paddingHorizontal: 12 },
  tab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  activeTab: { borderBottomColor: Colors.admin.accent },
  activityControls: { gap: 12 }, helpRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  header: { padding: 20, paddingBottom: 12, gap: 16 },
  profileHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  nameRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 10, backgroundColor: Colors.admin.card },
  cardRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }, halfCard: { flexBasis: 320, flexGrow: 1 },
  segment: { flexGrow: 1, alignItems: 'center' },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.admin.backgroundElement, justifyContent: 'center', alignItems: 'center' },
  identity: { flex: 1, minWidth: 0, gap: Spacing.one }, name: { fontSize: 24, lineHeight: 32, fontWeight: 600, letterSpacing: -0.4 },
  groupTitle: { fontSize: 17, lineHeight: 24, fontWeight: 600, marginBottom: Spacing.one },
  field: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one, paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.admin.line },
  fieldLabel: { flexBasis: 156, flexGrow: 1, color: Colors.admin.textSecondary }, fieldValue: { flexBasis: 220, flexGrow: 3, minWidth: 0 },
  muted: { color: Colors.admin.textSecondary }, error: { color: Colors.admin.danger }, accent: { color: Colors.admin.accent },
  kindFilters: { flexDirection: 'row', gap: Spacing.two },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { minHeight: 44, paddingHorizontal: Spacing.three, justifyContent: 'center', borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 10 },
  selected: { borderColor: Colors.admin.accent, backgroundColor: Colors.admin.backgroundSelected },
  input: { minHeight: 44, flexGrow: 1, minWidth: 150, paddingHorizontal: Spacing.three, color: Colors.admin.text, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 10, backgroundColor: Colors.admin.background },
  button: { alignSelf: 'flex-start', minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 10, backgroundColor: Colors.admin.card },
  event: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: Colors.admin.line },
  eventHeading: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, alignItems: 'center' },
  dayHeader: { marginTop: Spacing.three, paddingBottom: Spacing.one, color: Colors.admin.textSecondary },
  pressed: { opacity: 0.65 }, disabled: { opacity: 0.55 },
  id: { fontFamily: 'monospace', fontSize: 11, color: Colors.admin.textSecondary },
  trustRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
});
