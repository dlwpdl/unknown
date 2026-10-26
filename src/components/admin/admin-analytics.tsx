import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { adminOptionKeys } from '@/lib/admin';
import { loadAdminAnalytics, type AdminAnalytics, type AnalyticsFilters, type Breakdown } from '@/lib/admin-analytics';
import { CITIES } from '@/lib/mock';
import { supabase } from '@/lib/supabase';
import { AdminPerformanceView, type PerformanceView } from './admin-performance';
import { AdminFilterBar } from './admin-table-controls';
import { AdminButton, AdminCard, AdminInfo, type AdminTone } from './admin-ui';

// 7 tabs → 5 (2026-10-25 redesign). The member list lives in the 사용자 menu, so it is not repeated here.
const TABS: Record<PerformanceView, string> = { overview: '한눈에', growth: '성장', activity: '활동', revenue: '수익', quality: '품질' };
const TIERS = { all: '전체 등급', free: '무료', plus: '플러스', pro:'프로', premium: '프리미엄' } as const;
const INITIAL_FILTERS: AnalyticsFilters = { days: 30, city: null, tier: 'all', includeInternal: false, offset: 0 };

export function AdminAnalyticsView({ localPreview, onUser, refreshSignal = 0 }: {
  localPreview: boolean; onUser: (id: string) => void; refreshSignal?: number;
}) {
  const { play } = useInteractionFeedback();
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [tab, setTab] = useState<PerformanceView>('overview');
  // 한눈에 uses only the performance report; the other tabs add the base report below it.
  const baseActive = tab !== 'overview';
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; data: AdminAnalytics | null; error: boolean } | null>(null);
  const requestKey = JSON.stringify([filters, retry, refreshSignal, localPreview]);
  const data = !localPreview && result?.key === requestKey ? result.data : null;
  const error = baseActive && !localPreview && result?.key === requestKey && result.error;
  const loading = baseActive && !localPreview && result?.key !== requestKey;

  useEffect(() => {
    let active = true;
    if (localPreview || !baseActive) return;
    void loadAdminAnalytics(supabase, filters)
      .then((next) => { if (active) setResult({ key: requestKey, data: next, error: false }); })
      .catch(() => { if (active) setResult({ key: requestKey, data: null, error: true }); });
    return () => { active = false; };
  }, [filters, localPreview, baseActive, requestKey]);

  const filter = (next: Partial<AnalyticsFilters>) => setFilters((current) => ({ ...current, ...next, offset: 0 }));
  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <View style={styles.titleRow}>
          <ThemedText accessibilityRole="header" style={styles.title}>분석</ThemedText>
          <AdminInfo text={['회원·활동·결제 흐름을 봐요. 날짜와 시각은 세계 표준시 기준이라 밴쿠버보다 7~8시간 빨라요.', ...(data ? [`기본 집계 ${date(data.periodStart)} 이후 · 갱신 ${date(data.generatedAt)}`] : [])]} />
        </View>
        <AdminButton label="새로고침" accessibilityLabel="분석 새로고침" disabled={loading || localPreview} onPress={() => setRetry((value) => value + 1)} />
      </View>
      <AdminFilterBar applied={(filters.days === 30 ? 0 : 1) + (filters.city ? 1 : 0) + (filters.tier === 'all' ? 0 : 1) + (filters.includeInternal ? 1 : 0)}>
        <View style={styles.filters}>
          <Choices label="조회 기간" values={[7, 30, 90].map((days) => ({ key: String(days), label: `${days}일` }))} selected={String(filters.days)} onSelect={(value) => filter({ days: Number(value) as AnalyticsFilters['days'] })} />
          <Choices label="선호 지역" values={[{ key: '', label: '전체 도시' }, ...CITIES.map((city) => ({ key: city.id, label: city.name }))]} selected={filters.city ?? ''} onSelect={(city) => filter({ city: city || null })} />
          <Choices label="현재 멤버십" values={Object.entries(TIERS).map(([key, label]) => ({ key, label }))} selected={filters.tier} onSelect={(tier) => filter({ tier: tier as AnalyticsFilters['tier'] })} />
          <View style={styles.switchRow}><Switch value={filters.includeInternal} onValueChange={(includeInternal) => { play('selection'); return filter({ includeInternal }); }} accessibilityLabel="운영 캐릭터·심사·테스트·관리자 계정 포함" trackColor={{ true: Colors.admin.accent }} /><ThemedText type="small">운영 캐릭터·심사·테스트·관리자 계정 포함</ThemedText></View>
        </View>
      </AdminFilterBar>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} accessibilityRole="tablist" accessibilityLabel="분석 메뉴">
        {Object.entries(TABS).map(([key, label]) => <Pressable key={key} accessibilityRole="tab" aria-selected={key === tab} tabIndex={key === tab ? 0 : -1} {...(Platform.OS === 'web' ? { onKeyDown: adminOptionKeys } : {})} onPress={() => { play('selection'); return setTab(key as PerformanceView); }} style={({ pressed }) => [styles.tab, key === tab && styles.selectedTab, pressed && styles.pressed]}><ThemedText type="smallBold" style={key === tab ? styles.accent : styles.muted}>{label}</ThemedText></Pressable>)}
      </ScrollView>
      <AdminPerformanceView filters={filters} localPreview={localPreview} refreshSignal={refreshSignal + retry} view={tab}>
        {baseActive && <>
          {localPreview && <Notice title="운영 데이터 미연결" text="로컬 미리보기예요. 실제 회원·접속·매출 수치는 관리자 로그인 후 보여요." />}
          {loading && <View accessibilityRole="progressbar" accessibilityLabel="분석 데이터 불러오는 중" style={styles.notice}><ThemedText style={styles.muted}>선택한 조건으로 분석하고 있어요.</ThemedText></View>}
          {error && <View accessibilityRole="alert" style={styles.notice}><ThemedText style={styles.accent}>분석 데이터를 불러오지 못했어요. 관리자 권한과 연결 상태를 확인해 주세요.</ThemedText><Action label="다시 시도" onPress={() => setRetry((value) => value + 1)} /></View>}
          {!loading && !error && <>
            {tab === 'growth' && <Members data={data} />}
            {tab === 'activity' && <><Traffic data={data} onUser={onUser} /><Behavior data={data} /></>}
            {tab === 'revenue' && <Revenue data={data} onUser={onUser} />}
            {tab === 'quality' && <Logs data={data} />}
          </>}
        </>}
      </AdminPerformanceView>
    </View>
  );
}

// Member distributions stay here; the paged member list is in the 사용자 menu.
function Members({ data }: { data: AdminAnalytics | null }) {
  return <Card title="회원 분포" icon="◎" tone="accent" count={data ? `${number(data.counts.members)}명` : undefined} info={['전체 회원 수와 분포는 현재 선호 지역·등급 기준 누계예요.', '선호 지역은 회원이 지금 저장한 지역 기준이에요. 지역을 바꾼 뒤 새로고침하면 반영돼요.', '연령대는 입력한 생년월일에서 계산한 만 나이예요. 미입력은 미확인으로 두고 추정하지 않아요.']}>
    <View style={styles.breakdowns}>
      <Distribution title="현재 멤버십" rows={data?.memberships} label={tierLabel} />
      <Distribution title="선호 지역별 회원" rows={data?.cities} label={cityLabel} />
      <Distribution title="연령대" rows={data?.ages} label={ageLabel} />
    </View>
  </Card>;
}

function Traffic({ data, onUser }: { data: AdminAnalytics | null; onUser: (id: string) => void }) {
  return <Card title="최근 접속" icon="⇢" tone="navy" info={[
    data ? `접속 기록 시작 ${date(data.collectionStartedAt)} · 그 전 접속은 기록이 없어요.` : '접속 정보 수집 전이에요.',
    '고른 조건의 최근 기록 50개까지예요. 로그인한 회원이 어느 화면을 어느 기기로 봤는지만 모아요.',
    '익명 방문·IP·검색어·대화 내용은 분석용으로 수집하지 않으며, 접속 원자료는 90일 보관해요.',
    '화면 조회: 수집된 화면 방문 횟수 · 글 조회 기록: 선택 기간 실제 중복 제거 조회 기록',
  ]}>
    <View style={styles.metrics}><Metric label="화면 조회" value={data?.counts.screenViews} /><Metric label="글 조회 기록" value={data?.counts.uniquePostViews} /></View>
    <DataTable headers={['회원', '화면', '기기 / 앱 버전', '처음 방문', '최근 방문', '본 횟수']} rows={(data?.visits ?? []).map((visit) => ({ key: `${visit.userId}:${visit.platform}:${visit.firstAt}`, cells: [<UserLink key="user" id={visit.userId} nickname={visit.nickname} onUser={onUser} />, visit.screen, `${visit.platform} / ${visit.appVersion || '미확인'}`, date(visit.firstAt), date(visit.lastAt), `${number(visit.views)}회`] }))} />
  </Card>;
}

function Behavior({ data }: { data: AdminAnalytics | null }) {
  const rows = data?.behavior;
  const stepNames: Record<string, string> = { signup_complete: '회원가입 완료', consent_complete: '필수 동의 완료', meetup_request_complete: '모임 신청 완료', 'post.poll.vote': '투표 참여', 'ticketmaster.meetup.created': '행사 모임 등록' };
  return <>
    <Card title="화면별 활동" icon="▤" tone="navy" info={['어느 화면·버튼인지만 기록해요. 입력한 글이나 대화 내용은 모으지 않아요.', '로그인 안 한 방문은 앱을 한 번 연 것을 방문 한 번으로 세요. 도시나 등급을 고르면 이런 방문은 빠져요. 예전 앱 버전에서 모으지 않은 기록은 되살릴 수 없어요.', '머문 시간은 앱이나 웹 화면을 실제로 보고 있던 시간의 합이에요. 앱을 강제로 끄거나 인터넷이 끊기면 일부 빠질 수 있어요.']}>
      <DataTable headers={['기기 / 화면', '본 횟수', '방문 수', '머문 시간 (분)', '버튼 누름', '끝까지 내림']} rows={(rows?.screens ?? []).map((r) => ({ key: `${r.platform}:${r.screen}`, cells: [`${r.platform} / ${r.screen}`, number(r.views), number(r.sessions), (r.dwellMs / 60000).toFixed(1), number(r.presses), number(r.bottoms)] }))} />
    </Card>
    <Card title="완료한 작업" icon="✓" tone="success" info={['실제로 끝까지 성공한 작업을 앱이 알려 온 횟수예요. 버튼을 누른 횟수와는 달라요. 결제나 회원 수의 공식 기록으로 쓰면 안 돼요.', '단계마다 따로 센 숫자라, 앞 단계에서 다음 단계로 몇 퍼센트가 넘어갔는지는 아니에요.']}>
      <DataTable headers={['작업', '기기', '횟수', '방문 수']} rows={(rows?.steps ?? []).map((r) => ({ key: `${r.platform}:${r.screen}:${r.target}`, cells: [stepNames[r.target] ?? '기타 완료 기록', r.platform, number(r.count), number(r.sessions)] }))} />
    </Card>
    <RawData>
      <SectionTitle title="완료한 작업 원본 기록" />
      <DataTable headers={['단계 이름표', '기기', '횟수', '방문 수']} rows={(rows?.steps ?? []).map((r) => ({ key: `${r.platform}:${r.screen}:${r.target}`, cells: [r.target, r.platform, number(r.count), number(r.sessions)] }))} />
      <SectionTitle title="버튼 · 스크롤 상세" note="이름표는 코드에 붙인 버튼·화면 이름이에요. 25/50/75/100은 화면을 몇 퍼센트까지 내렸는지예요. 많은 순으로 300개까지 보여요." />
      <DataTable headers={['화면 / 기기', '종류', '이름표', '내린 정도', '횟수', '방문 수']} rows={(rows?.actions ?? []).filter((r) => r.kind !== 'success').map((r) => ({ key: `${r.platform}:${r.screen}:${r.kind}:${r.target}:${r.value}`, cells: [`${r.screen} / ${r.platform}`, r.kind, r.target, r.kind === 'scroll' ? `${r.value}%` : '—', number(r.count), number(r.sessions)] }))} />
      <SectionTitle title="최근 행동 순서" note="최근 100개예요. 같은 방문 안에서 번호 순서대로 무엇을 했는지 볼 수 있어요. 시각은 서버가 기록을 받은 때예요." />
      <DataTable headers={['받은 시각', '방문 / 순서', '화면', '행동', '이름표', '값']} rows={(rows?.recent ?? []).map((r) => ({ key: `${r.sessionId}:${r.seq}`, cells: [date(r.createdAt), `${r.sessionId} / ${r.seq}${r.anonymous ? ' (익명)' : ''}`, `${r.platform} / ${r.screen}`, r.kind, r.target, String(r.value)] }))} />
    </RawData>
  </>;
}

function Revenue({ data, onUser }: { data: AdminAnalytics | null; onUser: (id: string) => void }) {
  return <>
    <Card title="구독 결제 기록" icon="$" tone="success" info={['실제 결제 기록이에요. 환불과 스토어 수수료를 빼기 전 금액이고, 통화별로 따로 더해요.', data ? `결제 기록 시작 ${date(data.collectionStartedAt)} · 그 전 결제는 들어 있지 않아요.` : '결제 데이터 미연결', '결제한 회원은 통화별로 많이 낸 순서대로 50명까지 보여요.', '결제 기록은 최근 50개까지 보여요. 테스트 결제는 금액에서 빠져요.']}>
      <View style={styles.metrics}>{data?.purchases.length ? data.purchases.map((purchase) => <View key={purchase.currency} style={styles.metric}><ThemedText type="small" style={styles.muted}>{purchase.currency}</ThemedText><ThemedText style={styles.metricValue}>{money(purchase.amount, purchase.currency)}</ThemedText><ThemedText type="small" style={styles.muted}>{number(purchase.purchases)}건 · 구매 회원 {number(purchase.buyers)}명</ThemedText></View>) : <Notice title="집계할 결제 기록이 없어요" text="인증된 결제 알림을 받은 시점부터 집계해요. 과거 미수집 결제액은 0원으로 간주하지 않아요." />}</View>
      <SectionTitle title="구독 구매 회원" />
      <DataTable headers={['회원', '통화', '결제 발생액', '결제 건수']} rows={(data?.buyers ?? []).map((buyer) => ({ key: `${buyer.userId}:${buyer.currency}`, cells: [<UserLink key="user" id={buyer.userId} nickname={buyer.nickname} onUser={onUser} />, buyer.currency, money(buyer.amount, buyer.currency), number(buyer.purchases)] }))} />
      <SectionTitle title="결제 기록" />
      <DataTable headers={['시각', '결제 종류', '상품', '실제/테스트']} rows={(data?.paymentEvents ?? []).map((event) => ({ key: event.id, cells: [date(event.occurredAt), paymentLabel(event.type), event.productId, event.environment === 'SANDBOX' ? '테스트' : event.environment === 'PRODUCTION' ? '운영' : event.environment] }))} />
    </Card>
    <Card title="글 끌어올리기" icon="↑" tone="neutral" count="연결 전" info="홍보 상품과 유료 노출 집계는 아직 연결되지 않았어요. 연결 후 진행 중인 글·목표 대비 노출·남은 노출·구매 회원 순위를 볼 수 있어요. 자연 조회수는 유료 노출에 합산하지 않아요." />
  </>;
}

function Logs({ data }: { data: AdminAnalytics | null }) {
  return <>
    <Card title="관리자 접근 기록" icon="⌂" tone="navy" info="고른 기간에 관리자가 무엇을 했는지 남긴 기록 전체예요. 도시·멤버십 선택은 적용되지 않아요.">
      <View style={styles.metrics}>{data?.auditSummary.length ? data.auditSummary.map((row) => <Metric key={row.key} label={scopeLabel(row.key)} value={row.count} />) : <Empty />}</View>
      <DataTable headers={['시각', '작업']} rows={(data?.audit ?? []).map((entry) => ({ key: String(entry.id), cells: [date(entry.createdAt), scopeLabel(entry.scope)] }))} />
    </Card>
    <Card title="안전 분석 오류" icon="!" tone="warning" count={data ? `${data.errors.length}건` : undefined} info="AI 안전 분석이 실패한 최근 기록 50개까지예요. 글 원문과 자세한 오류 내용은 보여 주지 않아요.">
      <DataTable headers={['상태', '생긴 시각']} rows={(data?.errors ?? []).map((entry) => ({ key: String(entry.id), cells: [entry.status === 'failed' ? '실패' : entry.status, date(entry.createdAt)] }))} />
    </Card>
    <RawData>
      <SectionTitle title="관리자 접근 원본 기록" />
      <DataTable headers={['시각', '운영자 ID', '작업']} rows={(data?.audit ?? []).map((entry) => ({ key: String(entry.id), cells: [date(entry.createdAt), entry.actorId, scopeLabel(entry.scope)] }))} />
      <SectionTitle title="안전 분석 오류 원본 기록" />
      <DataTable headers={['기록 ID', '상태', '시도 횟수', '생긴 시각']} rows={(data?.errors ?? []).map((entry) => ({ key: String(entry.id), cells: [String(entry.id), entry.status === 'failed' ? '실패' : entry.status, `${entry.attempts}회`, date(entry.createdAt)] }))} />
    </RawData>
  </>;
}

// Raw IDs and identifier tables live in one folded "원본 데이터" block at the bottom of a tab.
function RawData({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <View style={styles.section}>
    <Action label="원본 데이터" expanded={open} onPress={() => setOpen(value => !value)} />
    {open && children}
  </View>;
}

function Card({ title, icon, tone, count, info, children }: { title: string; icon: string; tone: AdminTone; count?: string; info: string | string[]; children?: ReactNode }) {
  return <View accessibilityLabel={title}><AdminCard icon={icon} tone={tone} title={title} count={count} info={info}>{children}</AdminCard></View>;
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
  const { play } = useInteractionFeedback();
  const name = nickname.trim() || '회원';
  return <Pressable accessibilityRole="button" accessibilityLabel={`${name} 회원 상세 보기`} onPress={() => { play('selection'); return onUser(id); }} style={({ pressed }) => [styles.userLink, pressed && styles.pressed]}><ThemedText type="smallBold" style={styles.accent}>{name}</ThemedText></Pressable>;
}

function Choices({ label, values, selected, onSelect }: { label: string; values: { key: string; label: string }[]; selected: string; onSelect: (value: string) => void }) {
  const { play } = useInteractionFeedback();
  return <View style={styles.choiceGroup}><ThemedText type="small" style={styles.muted}>{label}</ThemedText><View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={label}>{values.map((item) => <Pressable key={item.key} accessibilityRole="radio" aria-checked={selected === item.key} tabIndex={selected === item.key ? 0 : -1} {...(Platform.OS === 'web' ? { onKeyDown: adminOptionKeys } : {})} onPress={() => { play('selection'); return onSelect(item.key); }} style={({ pressed }) => [styles.choice, selected === item.key && styles.choiceSelected, pressed && styles.pressed]}><ThemedText type="smallBold" style={selected === item.key ? styles.accent : styles.muted}>{item.label}</ThemedText></Pressable>)}</View></View>;
}

function Metric({ label, value }: { label: string; value?: number }) {
  return <View style={styles.metric}><ThemedText type="small" style={styles.muted}>{label}</ThemedText><ThemedText style={styles.metricValue}>{value === undefined ? '—' : number(value)}</ThemedText></View>;
}

function Distribution({ title, rows, label }: { title: string; rows?: Breakdown[]; label: (key: string) => string }) {
  const total = rows?.reduce((sum, row) => sum + row.count, 0) ?? 0;
  return <View style={styles.distribution}><SectionTitle title={title} />{!rows?.length ? <Empty /> : rows.map((row) => <View key={row.key} style={styles.distributionRow}><View style={styles.rowBetween}><ThemedText type="small">{label(row.key)}</ThemedText><ThemedText type="smallBold">{number(row.count)}명 · {total ? Math.round(row.count / total * 100) : 0}%</ThemedText></View><View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={[styles.fill, { width: `${total ? row.count / total * 100 : 0}%` }]} /></View></View>)}</View>;
}

function SectionTitle({ title, note }: { title: string; note?: string }) {
  return <View style={styles.heading}><ThemedText accessibilityRole="header" {...(Platform.OS === 'web' ? { 'aria-level': 2 } : {})} style={styles.sectionTitle}>{title}</ThemedText>{note && <ThemedText type="small" style={styles.muted}>{note}</ThemedText>}</View>;
}

function Notice({ title, text }: { title: string; text: string }) {
  return <View style={styles.notice}><ThemedText type="smallBold">{title}</ThemedText><ThemedText type="small" style={styles.muted}>{text}</ThemedText></View>;
}

function Empty({ text = '표시할 기록이 없습니다.' }: { text?: string }) { return <ThemedText type="small" style={styles.empty}>{text}</ThemedText>; }
function Action({ label, onPress, disabled = false, expanded }: { label: string; onPress: () => void; disabled?: boolean; expanded?: boolean }) {
  const { play } = useInteractionFeedback();
  return <Pressable accessibilityRole="button" aria-disabled={disabled} aria-expanded={expanded} accessibilityState={{ disabled, expanded }} disabled={disabled} onPress={() => { play('selection'); onPress(); }} style={({ pressed }) => [styles.action, disabled && styles.disabled, pressed && styles.pressed]}><ThemedText type="smallBold">{label}</ThemedText></Pressable>;
}

const numberFormatter = new Intl.NumberFormat('ko-KR');
const dateFormatter = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' });
function number(value: number) { return numberFormatter.format(value); }
function date(value: string | null) { return value ? dateFormatter.format(new Date(value)) : '기록 없음'; }
function tierLabel(key: string) { return TIERS[key as keyof typeof TIERS] ?? key; }
function cityLabel(key: string | null) { return CITIES.find((city) => city.id === key)?.name ?? (key && key !== 'unknown' ? key : '미확인'); }
function ageLabel(key: string) { return key === 'unknown' ? '미확인' : key; }
function scopeLabel(key: string) { return ({ analytics: '운영 분석', dashboard: '운영 현황', user_detail: '회원 상세', users: '회원 목록', posts: '게시글', messages: '대화', safety: '안전 검토', reports: '신고' } as Record<string, string>)[key] ?? key; }
function paymentLabel(key: string) { return ({ INITIAL_PURCHASE: '첫 결제', RENEWAL: '갱신 결제', CANCELLATION: '취소', UNCANCELLATION: '취소 철회', EXPIRATION: '만료', BILLING_ISSUE: '결제 문제', PRODUCT_CHANGE: '상품 변경', NON_RENEWING_PURCHASE: '단건 결제' } as Record<string, string>)[key] ?? key; }
function money(amount: number, currency: string) { return new Intl.NumberFormat('ko-KR', { style: 'currency', currency, currencyDisplay: 'code' }).format(amount); }

const styles = StyleSheet.create({
  section: { gap: 20 },
  heading: { gap: Spacing.one, flexShrink: 1 },
  headingRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.three },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  title: { fontSize: 28, lineHeight: 36, fontWeight: 600, letterSpacing: -0.6 },
  sectionTitle: { fontSize: 17, lineHeight: 24, fontWeight: 600 },
  accent: { color: Colors.admin.accent },
  muted: { color: Colors.admin.textSecondary },
  filters: { padding: Spacing.three, gap: Spacing.three, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 10, backgroundColor: Colors.admin.card },
  choiceGroup: { gap: Spacing.two, maxWidth: '100%' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  choice: { minHeight: 44, paddingHorizontal: Spacing.three, justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: 'transparent', backgroundColor: Colors.admin.backgroundElement },
  choiceSelected: { backgroundColor: Colors.admin.card, borderColor: Colors.admin.accent },
  switchRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  tabs: { gap: Spacing.three, borderBottomWidth: 1, borderBottomColor: Colors.admin.line },
  tab: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.two, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  selectedTab: { borderBottomColor: Colors.admin.accent },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  metric: { flexBasis: 150, flexGrow: 1, minWidth: 0, gap: Spacing.one, padding: Spacing.three, borderRadius: 10, backgroundColor: Colors.admin.backgroundElement },
  metricValue: { fontSize: 30, lineHeight: 36, fontWeight: 600, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  breakdowns: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  distribution: { flexBasis: 220, flexGrow: 1, minWidth: 0, gap: Spacing.three, padding: Spacing.three, backgroundColor: Colors.admin.backgroundElement, borderRadius: 10 },
  distributionRow: { gap: Spacing.two },
  rowBetween: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: Spacing.two },
  track: { height: 5, borderRadius: 3, backgroundColor: Colors.admin.backgroundElement },
  fill: { height: 5, borderRadius: 3, backgroundColor: Colors.admin.navy },
  notice: { width: '100%', flexShrink: 1, gap: Spacing.two, padding: Spacing.three, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 8, backgroundColor: Colors.admin.backgroundElement },
  empty: { paddingVertical: Spacing.four, color: Colors.admin.textSecondary },
  panel: { gap: Spacing.three, padding: Spacing.three, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 8, backgroundColor: Colors.admin.card },
  tableScroll: { borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 8 },
  table: { flex: 1, backgroundColor: Colors.admin.card },
  tableHeader: { flexDirection: 'row', backgroundColor: Colors.admin.backgroundElement },
  tableRow: { minHeight: 44, flexDirection: 'row', borderTopWidth: 1, borderTopColor: Colors.admin.line },
  tableRowAlternate: { backgroundColor: Colors.admin.background },
  tableValue: { fontVariant: ['tabular-nums'] },
  cell: { flex: 1, minWidth: 142, paddingHorizontal: 12, paddingVertical: Spacing.one, justifyContent: 'center' },
  userLink: { minHeight: 44, justifyContent: 'center' },
  action: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 8, backgroundColor: Colors.admin.card },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
});
