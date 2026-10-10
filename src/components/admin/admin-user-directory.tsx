import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import type { AdminDashboardData } from '@/lib/admin-data';
import { ACCOUNT_TYPES, ADMIN_GENDERS, EMPTY_DIRECTORY_FILTERS, searchAdminUsers, type AdminDirectoryFilters, type AdminUserDirectory } from '@/lib/admin-user-data';
import { supabase } from '@/lib/supabase';
import { formatIpGeo, formatIpGeoShort, lookupIpGeo, type IpGeo } from '@/lib/ip-geo';
import { CITIES } from '@/lib/mock';
import { shortId } from '@/lib/admin-labels';
import { isCompactAdminWidth } from '@/lib/admin-layout';
import { AdminFilterBar, AdminFilterReset, AdminMultiFilter, AdminSearch, AdminSelect, AdminTableSummary } from './admin-table-controls';

const ACCOUNT_OPTIONS = [{ value: 'member', label: '실제 가입자' }, { value: 'example', label: '직접 만든 계정' }, { value: 'admin', label: '관리자' }, { value: 'review', label: '심사 계정' }];
const STATUSES = { active: '정상', suspended: '정지', deleted: '탈퇴', reactivation_pending: '복구 대기' };
const AGES = [
  { value: 'under18', label: '만 18세 미만' }, { value: '18-24', label: '만 18–24세' }, { value: '25-29', label: '만 25–29세' },
  { value: '30-39', label: '만 30–39세' }, { value: '40-49', label: '만 40–49세' }, { value: '50plus', label: '만 50세 이상' },
  { value: 'unknown', label: '생년월일 미입력' },
];
const GENDER_OPTIONS = [...Object.entries(ADMIN_GENDERS).map(([value, label]) => ({ value, label })), { value: 'unknown', label: '미입력' }];
const date = (value: string | null) => value ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short' }).format(new Date(value)) : '—';

function appliedFilters(filters: AdminDirectoryFilters) {
  return filters.account_types.length + filters.cities.length + filters.statuses.length + filters.providers.length
    + filters.ages.length + filters.genders.length + (filters.joined_days === 'all' ? 0 : 1);
}

export function AdminUserDirectoryPanel({ onUser, refreshData }: { onUser: (id: string) => void; refreshData: AdminDashboardData }) {
  const { play } = useInteractionFeedback();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<AdminDirectoryFilters>(EMPTY_DIRECTORY_FILTERS);
  const [response, setResponse] = useState<{ key: string; source: AdminDashboardData; data: AdminUserDirectory | null; error: string | null } | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [ipGeo, setIpGeo] = useState<Record<string, IpGeo | null>>({});
  const [dense, setDense] = useState(false);
  const compact = isCompactAdminWidth(useWindowDimensions().width);
  const revision = useRef(0);
  const requestKey = JSON.stringify([filters, query, retry]);
  const current = response?.key === requestKey && response.source === refreshData ? response : null;
  const result = current?.data ?? null;
  const error = current?.error ?? null;
  const busy = !current || moreBusy;
  useEffect(() => {
    const id = ++revision.current;
    void searchAdminUsers(supabase, query, 0, filters).then((data) => { if (id === revision.current) setResponse({ key: requestKey, source: refreshData, data, error: null }); })
      .catch(() => { if (id === revision.current) setResponse({ key: requestKey, source: refreshData, data: null, error: '회원 정보를 불러오지 못했습니다. 관리자 권한과 연결을 확인해주세요.' }); })
      .finally(() => { if (id === revision.current) setMoreBusy(false); });
    return () => { revision.current = id + 1; };
  }, [filters, query, refreshData, requestKey]);
  const more = async () => {
    if (!result || busy) return;
    const id = revision.current;
    setMoreBusy(true);
    try {
      const next = await searchAdminUsers(supabase, query, result.rows.length, filters);
      if (id === revision.current) setResponse({ key: requestKey, source: refreshData, data: { ...next, rows: [...new Map([...result.rows, ...next.rows].map((row) => [row.id, row])).values()] }, error: null });
    } catch { if (id === revision.current) setResponse({ key: requestKey, source: refreshData, data: result, error: '다음 회원 목록을 불러오지 못했습니다.' }); }
    finally { if (id === revision.current) setMoreBusy(false); }
  };
  const search = () => { setQuery(input.trim()); setRetry((value) => value + 1); };
  const reset = () => { setInput(''); setQuery(''); setFilters(EMPTY_DIRECTORY_FILTERS); };
  const sessionIps = useMemo(() => [...new Set((result?.rows ?? []).map((row) => row.session_ip).filter((ip): ip is string => !!ip))], [result]);
  useEffect(() => {
    let active = true;
    void Promise.all(sessionIps.map(async (ip) => [ip, await lookupIpGeo(ip)] as const))
      .then((entries) => { if (active) setIpGeo(Object.fromEntries(entries)); });
    return () => { active = false; };
  }, [sessionIps]);
  return <View style={styles.section}>
    <View style={styles.heading}>
      <ThemedText type="title" accessibilityRole="header" style={styles.title}>사용자</ThemedText>
      <ThemedText type="small" style={styles.muted}>전체 회원에서 검색합니다. 이름을 선택하면 상세 정보와 활동을 확인할 수 있습니다.</ThemedText>
    </View>
    <div className="admin-toolbar">
      <AdminSearch value={input} onChange={setInput} onSubmit={search} placeholder="닉네임, 이메일, 이름 또는 회원 ID 검색" />
      <AdminSelect label="정렬" value={filters.sort} onChange={(sort) => setFilters({ ...filters, sort })} options={[
        { value: 'newest', label: '최근 가입순' }, { value: 'oldest', label: '가입 오래된순' }, { value: 'last_seen', label: '최근 로그인순' }, { value: 'nickname', label: '닉네임순' },
      ]} />
      <button type="button" className="admin-reset" aria-pressed={dense} onClick={() => { play('selection'); return setDense((value) => !value); }}>{dense ? '편하게 보기' : '촘촘하게 보기'}</button>
    <AdminFilterBar applied={appliedFilters(filters)}>
      <div className="admin-filter-row">
        <AdminMultiFilter label="계정 구분" options={ACCOUNT_OPTIONS} value={filters.account_types} onChange={(account_types) => setFilters({ ...filters, account_types })} />
        <AdminMultiFilter label="도시" options={CITIES.map((city) => ({ value: city.id, label: city.name }))} value={filters.cities} onChange={(cities) => setFilters({ ...filters, cities })} />
        <AdminMultiFilter label="상태" options={Object.entries(STATUSES).map(([value, label]) => ({ value, label }))} value={filters.statuses} onChange={(statuses) => setFilters({ ...filters, statuses })} />
        <AdminMultiFilter label="로그인 방식" options={[{ value: 'google', label: 'Google' }, { value: 'apple', label: 'Apple' }, { value: 'kakao', label: '카카오' }, { value: 'email', label: '이메일' }]} value={filters.providers} onChange={(providers) => setFilters({ ...filters, providers })} />
        <AdminMultiFilter label="나이" options={AGES} value={filters.ages} onChange={(ages) => setFilters({ ...filters, ages })} />
        <AdminMultiFilter label="성별" options={GENDER_OPTIONS} value={filters.genders} onChange={(genders) => setFilters({ ...filters, genders })} />
        <AdminSelect label="가입 기간" options={[{ value: 'all', label: '전체 기간' }, { value: '7', label: '최근 7일' }, { value: '30', label: '최근 30일' }, { value: '90', label: '최근 90일' }]} value={filters.joined_days} onChange={(joined_days) => setFilters({ ...filters, joined_days })} />
        <AdminFilterReset onReset={reset} disabled={!input && !query && JSON.stringify(filters) === JSON.stringify(EMPTY_DIRECTORY_FILTERS)} />
      </div>
    </AdminFilterBar>
    </div>
    {error && <View accessibilityRole="alert" style={styles.heading}><ThemedText style={styles.error}>{error}</ThemedText><Pressable onPress={() => { play('selection'); return setRetry((value) => value + 1); }} accessibilityRole="button" style={styles.button}><ThemedText>다시 시도</ThemedText></Pressable></View>}
    {busy && !result && <ThemedText accessibilityRole="progressbar">회원 정보를 불러오는 중입니다.</ThemedText>}
    {result && <>
      <AdminTableSummary shown={result.rows.length} total={result.total} unit="명" />
      {compact ? (
        <div className="admin-card-list" aria-label="회원 목록">
          {result.rows.map((profile) => <button key={profile.id} type="button" className="admin-card" onClick={() => { play('selection'); return onUser(profile.id); }} aria-label={`${profile.nickname}, 상세 활동 보기`}>
            <span className="admin-card-top">
              <span className="admin-card-title">{profile.nickname}</span>
              <span className={`admin-badge${profile.account_status === 'active' ? ' admin-badge-success' : ' admin-badge-danger'}`}>{STATUSES[profile.account_status]}</span>
            </span>
            <span className="admin-card-meta"><span>{profile.email ?? '—'}</span><span>{profile.providers.join(' · ') || '연결 없음'}</span><span>{shortId(profile.id)}</span></span>
            <span className="admin-card-meta">
              <span>{CITIES.find((city) => city.id === profile.city_id)?.name ?? profile.city_id ?? '—'}</span>
              <span>가입 {date(profile.created_at)}</span>
              <span>최근 로그인 {date(profile.last_sign_in_at)}</span>
            </span>
          </button>)}
          {result.total === 0 && <div className="admin-empty">조건에 맞는 회원이 없습니다. 검색어나 필터를 줄여보세요.</div>}
        </div>
      ) : (
      <div className="admin-table-wrap" tabIndex={0} role="region" aria-label="회원 목록, 좁은 화면에서는 좌우로 스크롤">
        <table className={`admin-table admin-user-table${dense ? ' admin-table-dense' : ''}`}>
          <caption className="admin-sr-only">회원 검색 결과</caption>
          <colgroup><col style={{ width: '15%' }} /><col style={{ width: '17%' }} /><col style={{ width: '7%' }} /><col style={{ width: '11%' }} /><col style={{ width: '6%' }} /><col style={{ width: '9%' }} /><col style={{ width: '7%' }} /><col style={{ width: '9%' }} /><col style={{ width: '19%' }} /></colgroup>
          <thead><tr>{['회원', '이메일 · 로그인 방식', '선호 도시', '생년월일 · 만 나이', '성별', '계정 구분', '상태', '가입일', '최근 로그인 · IP · 위치'].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{result.rows.map((profile) => {
            const geo = ipGeo[profile.session_ip ?? ''] ?? null;
            return <tr key={profile.id}>
            <td><button type="button" className="admin-row-button" onClick={() => { play('selection'); return onUser(profile.id); }} aria-label={`${profile.nickname}, 상세 활동 보기`} title={profile.id}>
              <span className="admin-user-avatar" aria-hidden="true">{profile.nickname.trim().slice(0, 1)}</span><span className="admin-user-identity"><span className="admin-cell-primary">{profile.nickname}</span><span className="admin-cell-secondary">{shortId(profile.id)}</span></span>
            </button></td>
            <td title={[profile.email ?? '이메일 미제공', profile.full_name, profile.login_name].filter(Boolean).join(' · ')}><span className="admin-cell-primary" style={{ fontWeight: 400 }}>{profile.email ?? '—'}</span><span className="admin-cell-secondary">{profile.providers.join(' · ') || '연결 없음'}</span></td>
            <td>{CITIES.find((city) => city.id === profile.city_id)?.name ?? profile.city_id ?? '—'}</td>
            <td title={profile.date_of_birth ?? '생년월일 미입력'}><span className="admin-cell-primary" style={{ fontWeight: 400 }}>{profile.date_of_birth ?? '—'}</span><span className="admin-cell-secondary">{profile.age != null ? `만 ${profile.age}세` : ''}</span></td>
            <td>{profile.gender ? ADMIN_GENDERS[profile.gender] ?? profile.gender : '—'}</td>
            <td><span className="admin-badge">{ACCOUNT_OPTIONS.find((option) => option.value === profile.account_type)?.label ?? ACCOUNT_TYPES[profile.account_type]}</span></td>
            <td><span className={`admin-badge${profile.account_status === 'active' ? ' admin-badge-success' : ' admin-badge-danger'}`}>{STATUSES[profile.account_status]}</span></td>
            <td title={profile.created_at}>{date(profile.created_at)}</td><td><span className="admin-cell-primary" title={profile.last_sign_in_at ?? ''}>{date(profile.last_sign_in_at)}</span><span className="admin-cell-secondary" title={`최근 인증 세션 IP: ${profile.session_ip ?? '기록 없음'}`}>{profile.session_ip ?? '—'}</span>{geo && <span className="admin-cell-secondary" title={`${formatIpGeo(geo)} · ipwho.is 조회`}>{formatIpGeoShort(geo)}</span>}</td>
          </tr>;
          })}</tbody>
        </table>
        {result.total === 0 && <div className="admin-empty">조건에 맞는 회원이 없습니다. 검색어나 필터를 줄여보세요.</div>}
      </div>
      )}
      {result.rows.length < result.total && <button type="button" className="admin-reset" disabled={busy} onClick={() => { play('selection'); return void more(); }}>{busy ? '불러오는 중' : '회원 더 보기'}</button>}
      <div className="admin-muted">직접 만든 계정은 예시 계정이며, 실제 가입자에는 관리자·심사 계정이 포함되지 않습니다.</div>
      <div className="admin-muted">조회 관리자 · {result.viewer.email ?? result.viewer.id}</div>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 20 }, muted: { color: Colors.admin.textSecondary }, error: { color: Colors.admin.danger },
  heading: { gap: Spacing.two, marginBottom: Spacing.two }, title: { fontSize: 28, lineHeight: 36, letterSpacing: -0.6 },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.three },
});
