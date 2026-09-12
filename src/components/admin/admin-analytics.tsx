import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { adminOptionKeys } from '@/lib/admin';
import { loadAdminAnalytics, type AdminAnalytics, type AnalyticsFilters, type Breakdown } from '@/lib/admin-analytics';
import { ADMIN_PAGE_SIZE } from '@/lib/admin-data';
import { CITIES } from '@/lib/mock';
import { supabase } from '@/lib/supabase';

const TABS = { overview: '요약', members: '회원', traffic: '트래픽', revenue: '결제·홍보', logs: '운영 로그' } as const;
const TIERS = { all: '전체 등급', free: '무료', plus: '플러스', premium: '프리미엄' } as const;
const INITIAL_FILTERS: AnalyticsFilters = { days: 30, city: null, tier: 'all', includeInternal: false, offset: 0 };

export function AdminAnalyticsView({ localPreview, onUser, refreshSignal = 0 }: {
  localPreview: boolean; onUser: (id: string) => void; refreshSignal?: number;
}) {
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [tab, setTab] = useState<keyof typeof TABS>('overview');
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; data: AdminAnalytics | null; error: boolean } | null>(null);
  const requestKey = JSON.stringify([filters, retry, refreshSignal, localPreview]);
  const data = !localPreview && result?.key === requestKey ? result.data : null;
  const error = !localPreview && result?.key === requestKey && result.error;
  const loading = !localPreview && result?.key !== requestKey;

  useEffect(() => {
    let active = true;
    if (localPreview) return;
    void loadAdminAnalytics(supabase, filters)
      .then((next) => { if (active) setResult({ key: requestKey, data: next, error: false }); })
      .catch(() => { if (active) setResult({ key: requestKey, data: null, error: true }); });
    return () => { active = false; };
  }, [filters, localPreview, requestKey]);

  const filter = (next: Partial<AnalyticsFilters>) => setFilters((current) => ({ ...current, ...next, offset: 0 }));
  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <View style={styles.heading}>
          <ThemedText accessibilityRole="header" style={styles.title}>운영 분석</ThemedText>
          <ThemedText type="small" style={styles.muted}>회원·활동·결제 흐름을 한눈에 확인합니다.</ThemedText>
        </View>
        <Action label="분석 새로고침" disabled={loading || localPreview} onPress={() => setRetry((value) => value + 1)} />
      </View>
      <View style={styles.filters}>
        <Choices label="조회 기간" values={[7, 30, 90].map((days) => ({ key: String(days), label: `${days}일` }))} selected={String(filters.days)} onSelect={(value) => filter({ days: Number(value) as AnalyticsFilters['days'] })} />
        <Choices label="선호 지역" values={[{ key: '', label: '전체 도시' }, ...CITIES.map((city) => ({ key: city.id, label: city.name }))]} selected={filters.city ?? ''} onSelect={(city) => filter({ city: city || null })} />
        <Choices label="현재 멤버십" values={Object.entries(TIERS).map(([key, label]) => ({ key, label }))} selected={filters.tier} onSelect={(tier) => filter({ tier: tier as AnalyticsFilters['tier'] })} />
        <View style={styles.switchRow}><Switch value={filters.includeInternal} onValueChange={(includeInternal) => filter({ includeInternal })} accessibilityLabel="목·심사·관리자 계정 포함" trackColor={{ true: Colors.light.accent }} /><ThemedText type="small">목·심사·관리자 계정 포함</ThemedText></View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} accessibilityRole="tablist" accessibilityLabel="분석 메뉴">
        {Object.entries(TABS).map(([key, label]) => <Pressable key={key} accessibilityRole="tab" aria-selected={key === tab} tabIndex={key === tab ? 0 : -1} {...(Platform.OS === 'web' ? { onKeyDown: adminOptionKeys } : {})} onPress={() => setTab(key as keyof typeof TABS)} style={({ pressed }) => [styles.tab, key === tab && styles.selectedTab, pressed && styles.pressed]}><ThemedText type="smallBold" style={key === tab ? styles.accent : styles.muted}>{label}</ThemedText></Pressable>)}
      </ScrollView>
      {localPreview && <Notice title="운영 데이터 미연결" text="로컬 미리보기입니다. 실제 회원·접속·매출 수치는 관리자 로그인 후 표시됩니다." />}
      {loading && <View accessibilityRole="progressbar" accessibilityLabel="분석 데이터 불러오는 중" style={styles.notice}><ThemedText style={styles.muted}>선택한 조건으로 분석하고 있어요.</ThemedText></View>}
      {error && <View accessibilityRole="alert" style={styles.notice}><ThemedText style={styles.accent}>분석 데이터를 불러오지 못했습니다. 관리자 권한과 연결 상태를 확인해주세요.</ThemedText><Action label="다시 시도" onPress={() => setRetry((value) => value + 1)} /></View>}
      {!loading && !error && <>
        {data && <ThemedText type="small" style={styles.muted}>{date(data.periodStart)} 이후 · 갱신 {date(data.generatedAt)} · UTC 기준</ThemedText>}
        {tab === 'overview' && <Overview data={data} />}
        {tab === 'members' && <Members data={data} filters={filters} onUser={onUser} onPage={(offset) => setFilters((current) => ({ ...current, offset }))} />}
        {tab === 'traffic' && <Traffic data={data} onUser={onUser} />}
        {tab === 'revenue' && <Revenue data={data} onUser={onUser} />}
        {tab === 'logs' && <Logs data={data} />}
      </>}
    </View>
  );
}

function Overview({ data }: { data: AdminAnalytics | null }) {
  return <>
    <View style={styles.metrics}>
      <Metric label="전체 회원" value={data?.counts.members} detail="현재 선호 지역·등급 기준 누계" />
      <Metric label="신규 가입" value={data?.counts.newMembers} detail="선택 기간 가입 회원" />
      <Metric label="활동 회원" value={data?.counts.activeUsers} detail={data ? `${data.collectionStartedAt.slice(0, 10)} 수집 시작 · 중복 제외` : '기간 내 화면 방문 회원 · 중복 제외'} />
      <Metric label="작성 글" value={data?.counts.posts} detail="선택 기간 작성" />
    </View>
    <DailyActivity data={data} />
    <View style={styles.breakdowns}>
      <Distribution title="현재 멤버십" rows={data?.memberships} label={tierLabel} />
      <Distribution title="선호 지역별 회원" rows={data?.cities} label={cityLabel} note="회원이 현재 저장한 선호 지역 기준입니다. 지역 변경 후 새로고침하면 집계에 반영됩니다." />
      <Distribution title="연령대" rows={data?.ages} label={ageLabel} note="입력한 생년월일에서 계산한 만 나이 기준입니다. 미입력 회원은 미확인으로 표시합니다." />
    </View>
  </>;
}

function DailyActivity({ data }: { data: AdminAnalytics | null }) {
  const [showTable, setShowTable] = useState(false);
  const rows = data?.daily ?? [];
  const collected = (day: string) => !!data && day >= data.collectionStartedAt.slice(0, 10);
  const peak = Math.max(0, ...rows.filter((row) => collected(row.day)).map((row) => row.activeUsers));
  return <View style={styles.panel}>
    <View style={styles.headingRow}><SectionTitle title="일별 활동" note="로그인 회원의 화면 방문 기준 · 하루 안에서 회원 중복 제외" /><Action label={showTable ? '차트 보기' : '수치 표 보기'} onPress={() => setShowTable((value) => !value)} /></View>
    {!rows.length ? <Empty text={data ? '선택 기간에 수집한 활동 기록이 없습니다.' : '관리자 로그인 후 일별 추이가 표시됩니다.'} /> : showTable ? <DataTable headers={['날짜 (UTC)', '활동 회원', '화면 조회', '작성 글', '신규 가입']} rows={rows.map((row) => ({ key: row.day, cells: [row.day, collected(row.day) ? number(row.activeUsers) : '미수집', collected(row.day) ? number(row.screenViews) : '미수집', number(row.posts), number(row.newMembers)] }))} /> : <>
      <ThemedText type="small" style={styles.muted}>최대 {number(peak)}명 / 일 · 수집 시작 전 구간은 비워 둡니다.</ThemedText>
      <ScrollView horizontal contentContainerStyle={styles.chart} accessibilityLabel="일별 활동 회원 막대 차트">
        {rows.map((row, index) => <View key={row.day} accessible accessibilityLabel={`${row.day}, ${collected(row.day) ? `활동 회원 ${row.activeUsers}명, 화면 조회 ${row.screenViews}회` : '접속 미수집'}, 작성 글 ${row.posts}개, 신규 가입 ${row.newMembers}명`} style={styles.barColumn}>
          <View style={styles.barTrack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={[styles.bar, { height: `${collected(row.day) ? row.activeUsers / Math.max(1, peak) * 100 : 0}%` }]} /></View>
          <ThemedText type="small" style={styles.barLabel}>{index === 0 || index === rows.length - 1 || index % Math.ceil(rows.length / 7) === 0 ? row.day.slice(5) : ' '}</ThemedText>
        </View>)}
      </ScrollView>
    </>}
    <ThemedText type="small" style={styles.muted}>{data ? `접속 수집 시작 ${date(data.collectionStartedAt)} · 수집 이전 트래픽은 확인할 수 없습니다.` : '접속 수집 전 기간의 숫자는 표시하지 않습니다.'}</ThemedText>
  </View>;
}

function Members({ data, filters, onUser, onPage }: { data: AdminAnalytics | null; filters: AnalyticsFilters; onUser: (id: string) => void; onPage: (offset: number) => void }) {
  const rows = data?.members ?? [];
  return <View style={styles.section}>
    <SectionTitle title="회원 목록" note="현재 선호 지역·멤버십 기준 전체 회원입니다. 회원을 선택하면 선호 지역과 최근 GPS 기준 가까운 도시를 함께 확인할 수 있습니다." />
    <DataTable headers={['회원', '선호 지역', '현재 멤버십', '가입일', '최근 로그인', '상태']} rows={rows.map((member) => ({ key: member.id, cells: [<UserLink key="user" id={member.id} nickname={`${member.nickname}${member.internal ? ' · 내부' : ''}`} onUser={onUser} />, cityLabel(member.city), tierLabel(member.tier), date(member.createdAt), date(member.lastSignIn), statusLabel(member.status)] }))} />
    <View style={styles.headingRow}>
      <ThemedText type="small" style={styles.muted}>{data ? `${number(data.counts.members)}명 중 ${rows.length ? `${filters.offset + 1}–${filters.offset + rows.length}` : '0'}명` : '운영 데이터 미연결'} · {ADMIN_PAGE_SIZE}명씩</ThemedText>
      <View style={styles.choices}><Action label="이전 회원" disabled={!data || filters.offset === 0} onPress={() => onPage(Math.max(0, filters.offset - ADMIN_PAGE_SIZE))} /><Action label="다음 회원" disabled={!data || filters.offset + rows.length >= data.counts.members} onPress={() => onPage(filters.offset + ADMIN_PAGE_SIZE)} /></View>
    </View>
    <View style={styles.breakdowns}><Distribution title="현재 멤버십" rows={data?.memberships} label={tierLabel} /><Distribution title="연령대" rows={data?.ages} label={ageLabel} note="본인 입력 생년월일 기준이며, 미입력 연령은 추정하지 않습니다." /></View>
  </View>;
}

function Traffic({ data, onUser }: { data: AdminAnalytics | null; onUser: (id: string) => void }) {
  return <>
    <ThemedText type="small" style={styles.muted}>{data ? `접속 수집 시작 ${date(data.collectionStartedAt)} (UTC) · 이전 접속 기록은 미수집입니다.` : '접속 정보 수집 전'}</ThemedText>
    <View style={styles.metrics}><Metric label="활동 회원" value={data?.counts.activeUsers} detail="기간 내 화면 방문 회원 · 중복 제외" /><Metric label="방문 구간" value={data?.counts.visits} detail="계정·플랫폼별 30분 구간" /><Metric label="화면 조회" value={data?.counts.screenViews} detail="수집된 화면 방문 횟수" /><Metric label="글 조회 기록" value={data?.counts.uniquePostViews} detail="선택 기간 실제 중복 제거 조회 기록" /></View>
    <DailyActivity data={data} />
    <SectionTitle title="최근 접속" note="선택 조건의 최근 기록 최대 50개 · 로그인 회원의 화면·플랫폼만 수집합니다." />
    <DataTable headers={['회원', '화면', '플랫폼 / 버전', '최초 방문', '최근 방문', '화면 조회']} rows={(data?.visits ?? []).map((visit) => ({ key: `${visit.userId}:${visit.platform}:${visit.firstAt}`, cells: [<UserLink key="user" id={visit.userId} nickname={visit.nickname} onUser={onUser} />, visit.screen, `${visit.platform} / ${visit.appVersion || '미확인'}`, date(visit.firstAt), date(visit.lastAt), `${number(visit.views)}회`] }))} />
    <Notice title="접속 정보의 범위" text="로그인한 회원의 방문만 표시합니다. 익명 방문·IP·검색어·대화 내용은 분석용으로 수집하지 않으며, 접속 원자료는 90일 보관합니다." />
  </>;
}

function Revenue({ data, onUser }: { data: AdminAnalytics | null; onUser: (id: string) => void }) {
  return <>
    <SectionTitle title="구독 결제 발생액" note="운영 환경의 실제 결제 이벤트 · 환불·스토어 수수료 차감 전 · 통화별 집계" />
    <ThemedText type="small" style={styles.muted}>{data ? `결제 이벤트 수집 시작 ${date(data.collectionStartedAt)} (UTC) · 이전 결제 내역은 집계되지 않습니다.` : '결제 데이터 미연결'}</ThemedText>
    <View style={styles.metrics}>{data?.purchases.length ? data.purchases.map((purchase) => <View key={purchase.currency} style={styles.metric}><ThemedText type="smallBold">{purchase.currency}</ThemedText><ThemedText style={styles.metricValue}>{money(purchase.amount, purchase.currency)}</ThemedText><ThemedText type="small" style={styles.muted}>{number(purchase.purchases)}건 · 구매 회원 {number(purchase.buyers)}명</ThemedText></View>) : <Notice title="집계할 결제 기록이 없습니다" text="인증된 결제 알림을 받은 시점부터 집계합니다. 과거 미수집 결제액은 0원으로 간주하지 않습니다." />}</View>
    <SectionTitle title="구독 구매 회원" note="통화별 결제 발생액 내림차순 · 환불·수수료 차감 전 · 최대 50개" />
    <DataTable headers={['회원', '통화', '결제 발생액', '결제 건수']} rows={(data?.buyers ?? []).map((buyer) => ({ key: `${buyer.userId}:${buyer.currency}`, cells: [<UserLink key="user" id={buyer.userId} nickname={buyer.nickname} onUser={onUser} />, buyer.currency, money(buyer.amount, buyer.currency), number(buyer.purchases)] }))} />
    <SectionTitle title="결제 이벤트" note="최근 수신 기록 최대 50개 · 테스트 이벤트는 위 결제액에서 제외됩니다." />
    <DataTable headers={['발생 시각 (UTC)', '이벤트', '상품', '환경']} rows={(data?.paymentEvents ?? []).map((event) => ({ key: event.id, cells: [date(event.occurredAt), paymentLabel(event.type), event.productId, event.environment === 'SANDBOX' ? '테스트' : event.environment === 'PRODUCTION' ? '운영' : event.environment] }))} />
    <Notice title="글 끌어올리기 · 미연결" text="홍보 상품과 유료 노출 집계는 아직 연결되지 않았습니다. 연결 후 진행 중인 글·목표 대비 노출·남은 노출·구매 회원 순위를 확인할 수 있습니다. 자연 조회수는 유료 노출에 합산하지 않습니다." />
  </>;
}

function Logs({ data }: { data: AdminAnalytics | null }) {
  return <>
    <SectionTitle title="관리자 접근 기록" note="선택 기간의 전체 운영 감사 기록입니다. 도시·회원 멤버십 필터는 적용하지 않습니다." />
    <View style={styles.metrics}>{data?.auditSummary.length ? data.auditSummary.map((row) => <Metric key={row.key} label={scopeLabel(row.key)} value={row.count} detail="선택 기간 열람·작업 기록" />) : <Empty />}</View>
    <DataTable headers={['시각 (UTC)', '운영자 ID', '작업']} rows={(data?.audit ?? []).map((entry) => ({ key: String(entry.id), cells: [date(entry.createdAt), entry.actorId, scopeLabel(entry.scope)] }))} />
    <SectionTitle title="안전 분석 오류" note={`전체 운영 · 최근 실패 ${data ? `${data.errors.length}건` : '미확인'} (최대 50개) · 콘텐츠 원문과 내부 오류 상세는 표시하지 않습니다.`} />
    <DataTable headers={['기록 ID', '상태', '시도 횟수', '생성 시각 (UTC)']} rows={(data?.errors ?? []).map((entry) => ({ key: String(entry.id), cells: [String(entry.id), entry.status === 'failed' ? '실패' : entry.status, `${entry.attempts}회`, date(entry.createdAt)] }))} />
  </>;
}

function DataTable({ headers, rows }: { headers: string[]; rows: { key: string; cells: ReactNode[] }[] }) {
  if (!rows.length) return <View style={styles.panel}><Empty /></View>;
  return <ScrollView horizontal style={styles.tableScroll} accessibilityLabel={`${headers.join(', ')} 목록. 좌우로 스크롤할 수 있습니다.`}>
    <View role="table" style={[styles.table, { minWidth: headers.length * 142 }]}>
      <View role="row" style={styles.tableHeader}>{headers.map((header) => <View role="columnheader" key={header} style={styles.cell}><ThemedText type="smallBold" style={styles.muted}>{header}</ThemedText></View>)}</View>
      {rows.map((row, rowIndex) => <View role="row" key={row.key} style={[styles.tableRow, rowIndex % 2 === 1 && styles.tableRowAlternate]}>{row.cells.map((cell, index) => <View role="cell" key={index} style={styles.cell}>{typeof cell === 'string' || typeof cell === 'number' ? <ThemedText type="small" selectable style={styles.tableValue}>{cell}</ThemedText> : cell}</View>)}</View>)}
    </View>
  </ScrollView>;
}

function UserLink({ id, nickname, onUser }: { id: string; nickname: string; onUser: (id: string) => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${nickname} 회원 상세 보기`} onPress={() => onUser(id)} style={({ pressed }) => [styles.userLink, pressed && styles.pressed]}><ThemedText type="smallBold" style={styles.accent}>{nickname}</ThemedText><ThemedText type="small" style={styles.muted}>{id.slice(0, 8)}</ThemedText></Pressable>;
}

function Choices({ label, values, selected, onSelect }: { label: string; values: { key: string; label: string }[]; selected: string; onSelect: (value: string) => void }) {
  return <View style={styles.choiceGroup}><ThemedText type="small" style={styles.muted}>{label}</ThemedText><View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={label}>{values.map((item) => <Pressable key={item.key} accessibilityRole="radio" aria-checked={selected === item.key} tabIndex={selected === item.key ? 0 : -1} {...(Platform.OS === 'web' ? { onKeyDown: adminOptionKeys } : {})} onPress={() => onSelect(item.key)} style={({ pressed }) => [styles.choice, selected === item.key && styles.choiceSelected, pressed && styles.pressed]}><ThemedText type="smallBold" style={selected === item.key ? styles.accent : styles.muted}>{item.label}</ThemedText></Pressable>)}</View></View>;
}

function Metric({ label, value, detail }: { label: string; value?: number; detail: string }) {
  return <View style={styles.metric}><ThemedText type="smallBold">{label}</ThemedText><ThemedText style={styles.metricValue}>{value === undefined ? '—' : number(value)}</ThemedText><ThemedText type="small" style={styles.muted}>{detail}</ThemedText></View>;
}

function Distribution({ title, rows, label, note }: { title: string; rows?: Breakdown[]; label: (key: string) => string; note?: string }) {
  const total = rows?.reduce((sum, row) => sum + row.count, 0) ?? 0;
  return <View style={styles.distribution}><SectionTitle title={title} />{!rows?.length ? <Empty /> : rows.map((row) => <View key={row.key} style={styles.distributionRow}><View style={styles.rowBetween}><ThemedText type="small">{label(row.key)}</ThemedText><ThemedText type="smallBold">{number(row.count)}명 · {total ? Math.round(row.count / total * 100) : 0}%</ThemedText></View><View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={[styles.fill, { width: `${total ? row.count / total * 100 : 0}%` }]} /></View></View>)}{note && <ThemedText type="small" style={styles.muted}>{note}</ThemedText>}</View>;
}

function SectionTitle({ title, note }: { title: string; note?: string }) {
  return <View style={styles.heading}><ThemedText accessibilityRole="header" {...(Platform.OS === 'web' ? { 'aria-level': 2 } : {})} style={styles.sectionTitle}>{title}</ThemedText>{note && <ThemedText type="small" style={styles.muted}>{note}</ThemedText>}</View>;
}

function Notice({ title, text }: { title: string; text: string }) {
  return <View style={styles.notice}><ThemedText type="smallBold">{title}</ThemedText><ThemedText type="small" style={styles.muted}>{text}</ThemedText></View>;
}

function Empty({ text = '표시할 기록이 없습니다.' }: { text?: string }) { return <ThemedText type="small" style={styles.empty}>{text}</ThemedText>; }
function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" aria-disabled={disabled} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.action, disabled && styles.disabled, pressed && styles.pressed]}><ThemedText type="smallBold">{label}</ThemedText></Pressable>;
}

function number(value: number) { return new Intl.NumberFormat('ko-KR').format(value); }
function date(value: string | null) { return value ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value)) : '기록 없음'; }
function tierLabel(key: string) { return TIERS[key as keyof typeof TIERS] ?? key; }
function cityLabel(key: string | null) { return CITIES.find((city) => city.id === key)?.name ?? (key && key !== 'unknown' ? key : '미확인'); }
function ageLabel(key: string) { return key === 'unknown' ? '미확인' : key; }
function statusLabel(key: string) { return ({ active: '정상', suspended: '이용 제한', deleted: '탈퇴', reactivation_pending: '재가입 허용' } as Record<string, string>)[key] ?? key; }
function scopeLabel(key: string) { return ({ analytics: '운영 분석', dashboard: '운영 현황', user_detail: '회원 상세', users: '회원 목록', posts: '게시글', messages: '대화', safety: '안전 검토', reports: '신고' } as Record<string, string>)[key] ?? key; }
function paymentLabel(key: string) { return ({ INITIAL_PURCHASE: '첫 결제', RENEWAL: '갱신 결제', CANCELLATION: '취소', UNCANCELLATION: '취소 철회', EXPIRATION: '만료', BILLING_ISSUE: '결제 문제', PRODUCT_CHANGE: '상품 변경', NON_RENEWING_PURCHASE: '단건 결제' } as Record<string, string>)[key] ?? key; }
function money(amount: number, currency: string) { return new Intl.NumberFormat('ko-KR', { style: 'currency', currency, currencyDisplay: 'code' }).format(amount); }

const styles = StyleSheet.create({
  section: { gap: Spacing.four },
  heading: { gap: Spacing.one, flexShrink: 1 },
  headingRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.three },
  title: { fontSize: 30, lineHeight: 38, fontWeight: 600, letterSpacing: -0.6 },
  sectionTitle: { fontSize: 17, lineHeight: 24, fontWeight: 600 },
  accent: { color: Colors.light.accent },
  muted: { color: Colors.light.textSecondary },
  filters: { padding: Spacing.three, gap: Spacing.three, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', borderWidth: 1, borderColor: Colors.light.line, borderRadius: 10, backgroundColor: Colors.light.card },
  choiceGroup: { gap: Spacing.two, maxWidth: '100%' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  choice: { minHeight: 44, paddingHorizontal: Spacing.three, justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: 'transparent', backgroundColor: Colors.light.backgroundElement },
  choiceSelected: { backgroundColor: Colors.light.card, borderColor: Colors.light.accent },
  switchRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  tabs: { gap: Spacing.three, borderBottomWidth: 1, borderBottomColor: Colors.light.line },
  tab: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.two, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  selectedTab: { borderBottomColor: Colors.light.accent },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  metric: { flexBasis: 150, flexGrow: 1, minWidth: 0, gap: Spacing.two, padding: Spacing.three, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 10, backgroundColor: Colors.light.card },
  metricValue: { fontSize: 30, lineHeight: 36, fontWeight: 600, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  breakdowns: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  distribution: { flexBasis: 240, flexGrow: 1, minWidth: 0, gap: Spacing.three, padding: Spacing.three, backgroundColor: Colors.light.card, borderRadius: 8, borderWidth: 1, borderColor: Colors.light.line },
  distributionRow: { gap: Spacing.two },
  rowBetween: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: Spacing.two },
  track: { height: 5, borderRadius: 3, backgroundColor: Colors.light.backgroundElement },
  fill: { height: 5, borderRadius: 3, backgroundColor: Colors.light.navy },
  notice: { width: '100%', flexShrink: 1, gap: Spacing.two, padding: Spacing.three, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8, backgroundColor: Colors.light.backgroundElement },
  empty: { paddingVertical: Spacing.four, color: Colors.light.textSecondary },
  panel: { gap: Spacing.three, padding: Spacing.three, borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8, backgroundColor: Colors.light.card },
  chart: { flexGrow: 1, minWidth: '100%', gap: Spacing.one, paddingTop: Spacing.two },
  barColumn: { flexGrow: 1, minWidth: 30, gap: Spacing.two },
  barTrack: { height: 150, justifyContent: 'flex-end', borderBottomWidth: 1, borderBottomColor: Colors.light.line },
  bar: { backgroundColor: Colors.light.accent, borderTopLeftRadius: 2, borderTopRightRadius: 2, marginHorizontal: 5 },
  barLabel: { fontSize: 10, textAlign: 'center', color: Colors.light.textSecondary },
  tableScroll: { borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8 },
  table: { flex: 1, backgroundColor: Colors.light.card },
  tableHeader: { flexDirection: 'row', backgroundColor: Colors.light.backgroundElement },
  tableRow: { minHeight: 56, flexDirection: 'row', borderTopWidth: 1, borderTopColor: Colors.light.line },
  tableRowAlternate: { backgroundColor: Colors.light.background },
  tableValue: { fontVariant: ['tabular-nums'] },
  cell: { flex: 1, minWidth: 142, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, justifyContent: 'center' },
  userLink: { minHeight: 44, justifyContent: 'center' },
  action: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.light.line, borderRadius: 8, backgroundColor: Colors.light.card },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
});
