import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { adminOptionKeys } from '@/lib/admin';
import type { AnalyticsFilters } from '@/lib/admin-analytics';
import { isCompactAdminWidth } from '@/lib/admin-layout';
import { loadAdminPerformance, type AdminPerformance, type PerformancePlatform, type RetentionRow } from '@/lib/admin-performance';
import { useInteractionFeedback } from '@/lib/interaction-feedback';
import { CITIES } from '@/lib/mock';
import { supabase } from '@/lib/supabase';
import { AdminButton, AdminCard, AdminFacts, AdminInfo, AdminPill, type AdminTone } from './admin-ui';

const PLATFORMS = { all: '전체 플랫폼', ios: 'iOS', android: 'Android', web: 'Web' } as const;
const SOURCES = { unknown: '미분류', direct: '직접 링크', instagram: 'Instagram', threads: 'Threads', search: '검색 링크', facebook: 'Facebook', website: '웹사이트 링크' } as const;
const STEPS: Record<string, string> = { signup_complete: '가입 완료', consent_complete: '필수 동의 완료', meetup_request_complete: '모임 신청 완료' };
const FAILURES: Record<string, string> = { client_error: '클라이언트 오류', photo_upload_error: '사진 업로드 실패', map_error: '지도 오류' };
const NOTIFICATION_KINDS: Record<string, string> = {
  comment: '내 글 댓글', reply: '내 댓글 답글', post_like: '내 글 좋아요', comment_like: '댓글·답글 좋아요', message: '새 메시지', message_reaction: '메시지 반응',
  meetup_request: '모임 신청', meetup_approved: '모임 신청 승인', meetup_rejected: '모임 신청 거절', meetup_reminder: '모임 일정 안내',
  meetup_morning: '모임 당일 안내', meetup_changed: '모임 변경', meetup_cancelled: '모임 취소', meetup_review_request: '모임 후기 요청',
  interest_post: '관심 태그의 새 글', nearby_meetup: '내 지역의 새로운 모임', trending_post: '내 도시에서 지금 뜨는 글', trending_meetup: '인기 모임',
  trending_hashtag: '인기 주제', weekly_ranking: '주간 인기 글 순위', city_food: '내 도시의 맛집·레스토랑', city_places: '내 도시의 가볼 만한 곳·행사',
  saved_merchant_post: '저장한 비즈니스 새 소식', merchant_review_received: '비즈니스 후기', merchant_review_verified: '비즈니스 후기 인증',
  merchant_review_rejected: '비즈니스 후기 인증 거절', merchant_review_reply: '비즈니스 후기 답변', merchant_operation: '비즈니스 게시·연결 문제',
  account_security: '계정 보안', moderation_warning: '이용 안내', moderation_blocked: '이용 제한', safety_alert: '안전 경고',
  admin_security: '보안 경고', admin_multiacct: '다계정 의심', admin_error_spike: '앱 오류 급증', admin_signup: '새 회원 가입',
};

export type PerformanceView = 'overview' | 'growth' | 'activity' | 'revenue' | 'quality';

// `view` picks the analytics tab; without it every area renders (standalone use and tests).
export function AdminPerformanceView({ filters, localPreview, refreshSignal = 0, view, children }: {
  filters: AnalyticsFilters; localPreview: boolean; refreshSignal?: number; view?: PerformanceView; children?: ReactNode;
}) {
  const { play } = useInteractionFeedback();
  const [platform, setPlatform] = useState<PerformancePlatform>('all');
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; data: AdminPerformance | null; denied: boolean; error: boolean } | null>(null);
  const requestKey = JSON.stringify([filters.days, filters.city, filters.tier, filters.includeInternal, platform, retry, refreshSignal, localPreview]);
  const current = !localPreview && result?.key === requestKey ? result : null;
  const data = current?.data;
  const loading = !localPreview && !current;
  const shows = (area: PerformanceView) => !view || view === area;

  useEffect(() => {
    let active = true;
    if (localPreview) return;
    void loadAdminPerformance(supabase, filters, platform)
      .then((next) => { if (active) setResult({ key: requestKey, data: next, denied: false, error: false }); })
      .catch((error: unknown) => {
        if (active) setResult({ key: requestKey, data: null, denied: error instanceof Error && /ADMIN_REQUIRED|MFA|AAL2|permission denied/i.test(error.message), error: true });
      });
    return () => { active = false; };
  }, [filters, localPreview, platform, requestKey]);

  const scope = [
    '필터 적용 범위: 회원의 현재 저장한 선호 지역과 일반 멤버십으로 집계해요. 행사·장소 행은 대상 도시를 따라요.',
    '플랫폼은 방문·행동·행사·장소·알림 행동과 클라이언트 실패 기록에 적용돼요. 가입·글·모임·결제·신고·발송 사실에는 플랫폼 정보가 없어요.',
    `${filters.includeInternal ? '내부 계정 포함' : '관리자·운영 캐릭터·심사·테스트 계정 기본 제외'} · UTC 기준 · 플랫폼별 고유 회원 수는 서로 겹칠 수 있어요.`,
    ...(data ? [`${date(data.periodStart)} 이후 · 갱신 ${date(data.generatedAt)} · 방문 수집 시작 ${date(data.collectionStartedAt)} · 새 행동 기록 지원 ${date(data.trackingAvailableAt)} (UTC)`] : []),
  ];

  return <View style={styles.section}>
    <View style={styles.platformRow}>
      <View accessibilityRole="radiogroup" accessibilityLabel="성과 플랫폼" style={styles.choices}>
        {Object.entries(PLATFORMS).map(([key, label]) => <Pressable key={key} accessibilityRole="radio" aria-checked={platform === key} tabIndex={platform === key ? 0 : -1}
          {...(Platform.OS === 'web' ? { onKeyDown: adminOptionKeys } : {})}
          onPress={() => { play('selection'); setPlatform(key as PerformancePlatform); }}
          style={({ pressed }) => [styles.choice, platform === key && styles.choiceSelected, pressed && styles.pressed]}>
          <ThemedText type="smallBold" style={platform === key ? styles.accent : styles.muted}>{label}</ThemedText>
        </Pressable>)}
      </View>
      <AdminInfo label="집계 범위 보기" text={scope} />
    </View>
    {localPreview ? <Notice title="운영 데이터 미연결" text="로컬 미리보기예요. 실제 성과는 관리자 로그인과 MFA 인증 후 서버 기록으로 보여요." />
      : loading ? <View accessibilityRole="progressbar" accessibilityLabel="성과 데이터 불러오는 중" style={styles.notice}><ThemedText type="smallBold">성과 불러오는 중</ThemedText><Note>선택한 조건의 서버 집계를 기다리고 있어요.</Note></View>
        : current?.error ? <View accessibilityRole="alert" style={styles.notice}>
          <ThemedText type="smallBold" style={styles.danger}>{current.denied ? '관리자 인증을 확인해 주세요' : '성과 데이터를 불러오지 못했어요'}</ThemedText>
          <Note>{current.denied ? '관리자 권한과 MFA 인증이 필요해요. 로그인 상태를 확인한 뒤 다시 시도해 주세요.' : '연결 상태를 확인한 뒤 다시 시도해 주세요. 요청 실패를 0건으로 표시하지 않아요.'}</Note>
          <Action label="다시 시도" onPress={() => setRetry((value) => value + 1)} />
        </View> : data && <>
          {view === 'overview' && <Overview data={data} />}
          {shows('growth') && <><Growth data={data.growth} /><Retention rows={data.retention} cohorts={data.cohorts} /></>}
          {shows('activity') && <>
            <Activity data={data.activity} collectionStartedAt={data.collectionStartedAt} chart={!view} />
            <Community data={data.community} />
            <Discovery data={data.discovery} />
            <Notifications data={data.notifications} platform={platform} />
          </>}
          {shows('revenue') && <Revenue data={data.revenue} />}
          {shows('quality') && <Quality data={data.quality} filters={filters} />}
        </>}
    {children}
  </View>;
}

type MetricItem = { label: string; value: string; note: string };
// Each metric's caption moves into its card's ⓘ so the grid shows only numbers.
const captions = (items: MetricItem[]) => items.map(item => `${item.label}: ${item.note}`);

function Overview({ data }: { data: AdminPerformance }) {
  const d7 = data.retention.find(row => row.days === 7);
  const items: MetricItem[] = [
    { label: '활동 회원', value: count(data.activity.activeUsers), note: '선택 기간 화면을 방문한 고유 회원' },
    { label: '신규 가입', value: count(data.growth.newMembers), note: '선택 기간에 가입한 회원' },
    { label: '새 글', value: count(data.community.posts), note: '선택 기간에 작성된 글' },
    { label: '7일 재방문', value: d7 ? retentionRate(d7) : '미수집', note: '가입 7일째 날 다시 방문한 회원 비율 · 관측이 끝난 회원만 분모에 넣어요' },
  ];
  const fact = (label: string, value: string) => ({ label, value: value === '미연결' ? <AdminPill label="연결 전" /> : value });
  const areas: { title: string; icon: string; tone: AdminTone; items: { label: string; value: ReactNode }[] }[] = [
    { title: '성장', icon: '↗', tone: 'accent', items: [fact('가입 후 활동률', rate(data.growth.activationRate, '가입 대상 없음')), fact('가입 후 활동 회원', count(data.growth.activatedMembers))] },
    { title: '활동', icon: '✦', tone: 'navy', items: [fact('댓글', count(data.community.comments)), fact('모임 신청', count(data.community.meetupRequests))] },
    { title: '수익', icon: '$', tone: 'success', items: [fact('현재 유료 회원', count(data.revenue.paidMembers)), fact('스토어 정산', count(data.revenue.settlement, '미연결'))] },
    { title: '품질', icon: '!', tone: 'warning', items: [fact('미처리 신고', count(data.quality.openReports)), fact('처리된 신고', count(data.quality.resolvedReports))] },
  ];
  return <>
    <View accessibilityLabel="핵심 지표" style={styles.overviewHead}>
      <View style={styles.grow}><Metrics items={items} /></View>
      <AdminInfo label="핵심 지표 설명" text={captions(items)} />
    </View>
    <DailyActivity rows={data.activity.daily} collectionStartedAt={data.collectionStartedAt} />
    <View style={styles.areaGrid}>{areas.map(area => <View key={area.title} accessibilityLabel={`${area.title} 요약`} style={styles.areaCard}>
      <AdminCard icon={area.icon} tone={area.tone} title={area.title}><AdminFacts columns={2} items={area.items} /></AdminCard>
    </View>)}</View>
  </>;
}

function Growth({ data }: { data: AdminPerformance['growth'] }) {
  const items: MetricItem[] = [
    { label: '신규 가입', value: count(data.newMembers), note: '선택 기간에 가입한 회원' },
    { label: '가입 후 활동 회원', value: count(data.activatedMembers), note: '가입 뒤 글·댓글·모임 신청·메시지를 실제로 남긴 회원' },
    { label: '가입 후 활동률', value: rate(data.activationRate, '가입 대상 없음'), note: '같은 기간 신규 가입 회원 중 실제 활동 회원' },
  ];
  return <Section title="성장·유입" icon="↗" tone="accent" info={['기간 내 가입 회원과 실제 활동 기록이에요. 유입은 인식한 링크 채널과 세션별 가입 완료 기록이며 설치 기여는 미수집이에요.', '완료 행동은 단계별 기록이에요. 세션과 로그인 회원 수를 구분하며 순서 기반 전환 퍼널로 계산하지 않아요.', ...captions(items)]}>
    <Metrics items={items} />
    {data.sourceStartedAt ? <>
      <Note>유입 수집 시작 {date(data.sourceStartedAt)} (UTC) · 미분류를 자연 유입으로 추정하지 않아요.</Note>
      <DataTable title="유입 채널" headers={['링크 채널', '세션', '가입 완료 세션', '가입 완료율']} rows={data.sources.map((row) => ({ key: row.source, cells: [SOURCES[row.source], count(row.sessions), count(row.signupSessions), rate(row.signupRate, '세션 없음')] }))} />
    </> : <Notice title="유입 수집 대기" text="링크 채널 기록을 아직 받지 못했어요. 방문 수집 시작일로 유입 수집을 대신하지 않아요." />}
    <DataTable title="가입·온보딩 완료 행동" headers={['완료 행동', '세션', '로그인 회원']} rows={data.onboarding.map((row) => ({ key: row.target, cells: [STEPS[row.target] ?? row.target, count(row.sessions), count(row.members)] }))} />
  </Section>;
}

function Activity({ data, collectionStartedAt, chart }: { data: AdminPerformance['activity']; collectionStartedAt: string; chart: boolean }) {
  const items: MetricItem[] = [
    { label: 'DAU', value: count(data.dau), note: '오늘 (UTC) · 고유 회원' },
    { label: 'WAU', value: count(data.wau), note: '오늘 포함 7일 · 고유 회원' },
    { label: 'MAU', value: count(data.mau), note: '오늘 포함 30일 · 고유 회원' },
    { label: '기간 활동 회원', value: count(data.activeUsers), note: '선택 기간 · 고유 회원' },
    { label: '방문 구간', value: count(data.visits), note: '회원·플랫폼별 방문 기록' },
    { label: '회원당 방문', value: count(data.visitsPerUser, '활동 회원 없음'), note: '선택 기간 방문 구간 / 활동 회원' },
  ];
  return <Section title="활동" icon="✦" tone="navy" info={['로그인 회원의 화면 방문 기준이에요. DAU는 오늘(UTC), WAU·MAU는 오늘을 포함한 7·30일의 고유 회원이에요.', `방문 수집 시작 ${date(collectionStartedAt)} (UTC) · 수집 전 구간은 미수집으로 표시해요.`, ...captions(items)]}>
    <Metrics items={items} />
    {chart && <DailyActivity rows={data.daily} collectionStartedAt={collectionStartedAt} />}
    <DataTable title="플랫폼별 활동" headers={['플랫폼', '고유 회원', '방문 구간']} rows={data.platforms.map((row) => ({ key: row.platform, cells: [platformLabel(row.platform), count(row.users), count(row.visits)] }))} />
  </Section>;
}

function DailyActivity({ rows, collectionStartedAt }: { rows: AdminPerformance['activity']['daily']; collectionStartedAt: string }) {
  const [showTable, setShowTable] = useState(false);
  const compact = isCompactAdminWidth(useWindowDimensions().width);
  const peak = Math.max(0, ...rows.map((row) => row.users ?? 0));
  return <View accessibilityLabel="일별 활동 추이" style={styles.section}>
    <AdminCard icon="▥" tone="accent" title="일별 활동 회원" info={[`최대 ${count(peak)}명 / 일 · 미수집 날짜는 막대를 비워 둬요.`, `방문 수집 시작 ${date(collectionStartedAt)} (UTC)`]}
      action={<AdminButton kind="text" label={showTable ? '차트 보기' : '수치 표 보기'} onPress={() => setShowTable((value) => !value)} />}>
      {!rows.length ? <Empty /> : showTable ? <DataTable title="일별 활동 수치" headers={['날짜 (UTC)', '활동 회원', '방문 구간', '신규 가입']} rows={rows.map((row) => ({ key: row.day, cells: [row.day, count(row.users), count(row.visits), count(row.signups)] }))} /> : <View style={styles.chartRow}>
        <View style={styles.axis} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><ThemedText type="small" style={styles.axisLabel}>{count(peak)}</ThemedText><ThemedText type="small" style={styles.axisLabel}>0</ThemedText></View>
        <ScrollView horizontal accessibilityLabel="일별 활동 회원 막대 차트" contentContainerStyle={styles.chart}>
          {rows.map((row, index) => <View key={row.day} accessible accessibilityLabel={`${row.day}, 활동 회원 ${count(row.users)}, 방문 구간 ${count(row.visits)}, 신규 가입 ${count(row.signups)}`} style={[styles.barColumn, compact && styles.barColumnCompact]}>
            <View style={styles.barTrack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={styles.gridLine} /><View style={[styles.bar, { height: `${(row.users ?? 0) / Math.max(1, peak) * 100}%` }]} /></View>
            <ThemedText type="small" style={styles.barLabel}>{index === 0 || index === rows.length - 1 || index % Math.ceil(rows.length / 7) === 0 ? row.day.slice(5) : ' '}</ThemedText>
          </View>)}
        </ScrollView>
      </View>}
    </AdminCard>
  </View>;
}

function Retention({ rows, cohorts }: { rows: RetentionRow[]; cohorts: AdminPerformance['cohorts'] }) {
  return <Section title="재방문·코호트" icon="↻" tone="accent" info="가입일 기준 D1·D7·D30의 해당 UTC 날짜에 다시 방문한 회원이에요. 방문 수집 이후 관측이 끝난 날짜만 분모에 넣어요. 관측 중인 회원과 분모가 없는 칸을 0%로 바꾸지 않아요.">
    <DataTable title="D1·D7·D30 재방문" headers={['재방문일', '관측 완료 회원', '재방문 회원', '관측 중 회원', '완료분 재방문율']} rows={rows.map((row) => ({ key: String(row.days), cells: [`D${row.days}`, count(row.eligible), count(row.returned), count(row.pending), retentionRate(row)] }))} />
    <DataTable title="가입일별 재방문" headers={['가입일 (UTC)', '가입 회원', 'D1', 'D7', 'D30']} rows={cohorts.map((cohort) => ({ key: cohort.day, cells: [cohort.day, count(cohort.joined), ...[1, 7, 30].map((days) => {
      const row = cohort.retention.find((item) => item.days === days);
      return row ? `D${days} ${retentionRate(row)}\n재방문 ${count(row.returned)} / 완료 ${count(row.eligible)}명\n관측 중 ${count(row.pending)}명` : `D${days} 미수집`;
    })] }))} />
  </Section>;
}

function Community({ data }: { data: AdminPerformance['community'] }) {
  const items: MetricItem[] = [
    { label: '작성 글', value: count(data.posts), note: '선택 기간 생성' },
    { label: '댓글', value: count(data.comments), note: '선택 기간 생성' },
    { label: '모임 신청', value: count(data.meetupRequests), note: '선택 기간 생성' },
    { label: '상호 대화', value: count(data.mutualConversations), note: '양측의 실제 메시지 기록' },
  ];
  return <Section title="커뮤니티" icon="✎" tone="navy" info={['기간에 생성된 글·댓글·신청과 실제 메시지예요. 모임 승인 수는 기간에 생성된 신청의 현재 승인 상태예요. 상호 대화는 양쪽 참여자가 실제로 메시지를 보낸 대화예요.', ...captions(items)]}>
    <Metrics items={items} />
    <DataTable title="커뮤니티 참여" headers={['기록', '값', '집계 범위']} rows={[
      { key: 'authors', cells: ['글 작성 회원', `${count(data.authors)}명`, '기간 내 고유 작성자'] },
      { key: 'commenters', cells: ['댓글 작성 회원', `${count(data.commenters)}명`, '기간 내 고유 작성자'] },
      { key: 'approved', cells: ['현재 승인된 신청', `${count(data.approvedRequests)}건`, '기간에 생성된 신청의 현재 상태'] },
      { key: 'saves', cells: ['글 저장', `${count(data.savedPosts)}건`, '기간에 생성되어 현재 남아 있는 저장'] },
      { key: 'shares', cells: ['글 공유·복사', `${count(data.sharedPosts)}건`, '회원·글별 최초 공유 또는 복사 기록'] },
    ]} />
  </Section>;
}

function Discovery({ data }: { data: AdminPerformance['discovery'] }) {
  const items: MetricItem[] = [
    { label: '기존 행사 클릭', value: count(data.legacyEventViews, '범위 확인 불가'), note: '기존 원장에는 도시·플랫폼 정보가 없어 해당 필터의 집계는 확인할 수 없어요.' },
    { label: '행사 저장·공유', value: '미연결', note: '행사 저장·공유 기능의 기록이 없어요.' },
    { label: '장소 저장·공유', value: '미연결', note: '장소 저장·공유 기능의 기록이 없어요.' },
  ];
  return <Section title="행사·장소" icon="⌖" tone="navy" info={['대상 도시별 실제 열람·길찾기·웹사이트 클릭 기록이에요. 같은 행동·대상·회원·UTC 날짜·플랫폼마다 한 번 집계해요. 길찾기 클릭으로 실제 방문을 추정하지 않아요.', ...captions(items)]}>
    {data.startedAt ? <Note>행사·장소 수집 시작 {date(data.startedAt)} (UTC)</Note> : <Notice title="행사·장소 수집 대기" text="새 행동 기록을 아직 받지 못했어요. 기존 클릭과 새 대상별 기록을 합산하지 않아요." />}
    <Metrics items={items} />
    <DataTable title="대상별 행동" headers={['대상', '대상 도시', '열람', '길찾기 클릭', '웹사이트 클릭']} rows={data.rows.map((row) => ({ key: `${row.kind}:${row.cityId}:${row.targetId}`, cells: [`${row.kind === 'event' ? '행사' : row.kind === 'place' ? '장소' : row.kind} · ${row.title}`, cityLabel(row.cityId), count(row.views), count(row.directions), count(row.websites)] }))} />
  </Section>;
}

function Notifications({ data, platform }: { data: AdminPerformance['notifications']; platform: PerformancePlatform }) {
  const missingRate = platform !== 'all' ? '플랫폼별 산출 불가' : data.clickStartedAt ? '접수 코호트 없음' : '미수집';
  const items: MetricItem[] = [
    { label: '생성 알림', value: count(data.generated), note: '선택 기간의 수신 회원별 알림' },
    { label: '제공자 접수', value: count(data.providerAccepted), note: '보존된 큐에서 접수된 알림' },
    { label: '발송 실패', value: count(data.failed), note: '보존된 큐의 실패 기록' },
    { label: '푸시 클릭률', value: platform === 'all' ? rate(data.clickRate, missingRate) : missingRate, note: '탭 추적 시작 뒤의 같은 수신 회원·접수 알림 코호트만 분모에 포함' },
    { label: '푸시 탭', value: count(data.pushOpens), note: 'OS 푸시를 실제로 누른 기록' },
    { label: '인앱 알림 열기', value: count(data.inboxOpens), note: '알림 항목 개별 열기 · 목록 일괄 읽음 제외' },
    { label: '열기 뒤 활동 회원', value: count(data.activeAfterOpen), note: '30분 안에 글·댓글·신청·메시지를 실제로 남긴 고유 회원' },
  ];
  return <Section title="알림" icon="◔" tone="navy" info={[
    'APNs·FCM 접수는 제공자의 요청 수락이에요. 실제 단말 표시 여부는 미수집이에요. 발송 큐는 최대 7일 보존하며 기기 삭제로 기록이 사라질 수 있어요.',
    '같은 알림·입구의 탭은 여러 기기에서도 한 번 세요. 발송에는 플랫폼 정보가 없어 플랫폼별 클릭률은 산출할 수 없어요. 열기 뒤 활동은 고유 회원 수이며 인과 관계나 증가 효과를 뜻하지 않아요.',
    ...captions(items),
  ]}>
    <Note>발송 확인 범위 {date(data.deliverySince)} 이후 (UTC) · 선택 기간 중 보존된 큐만 집계해요.</Note>
    <Metrics items={items} />
    {data.clickStartedAt ? <Note>알림 탭 수집 시작 {date(data.clickStartedAt)} (UTC)</Note> : <Notice title="알림 탭 수집 대기" text="푸시 탭과 인앱 개별 열기는 아직 미수집이에요. 발송 접수나 목록 읽음으로 클릭 수를 채우지 않아요." />}
    <DataTable title="알림 종류별 반응" headers={['종류', '생성', '제공자 접수', '실패', '푸시 탭', '인앱 열기', '푸시 클릭률']} rows={data.rows.map((row) => ({ key: row.kind, cells: [NOTIFICATION_KINDS[row.kind] ?? `기타 알림 (${row.kind})`, count(row.generated), count(row.providerAccepted), count(row.failed), count(row.pushOpens), count(row.inboxOpens), platform === 'all' ? rate(row.clickRate, missingRate) : missingRate] }))} />
    <Note>현재 수신 설정 스냅샷 · 동의 {count(data.optedInMembers)}명 / 설정 기록 {count(data.preferenceMembers)}명 · 수신 해제 전환은 미수집이에요.</Note>
  </Section>;
}

function Revenue({ data }: { data: AdminPerformance['revenue'] }) {
  const items: MetricItem[] = [
    { label: '현재 유료 회원', value: count(data.paidMembers), note: '현재 일반 유료 멤버십 회원 · 스냅샷' },
    { label: '신규 가입 유료 전환', value: rate(data.paidConversion, '가입 대상 없음'), note: '기간 내 가입 회원 중 같은 기간 첫 결제가 확인된 회원' },
    { label: '갱신 결제', value: count(data.renewals), note: '실제 갱신 결제 이벤트' },
    { label: '갱신 해지', value: count(data.cancellations), note: '자동 갱신을 해지한 기록이며 환불 건수가 아니에요.' },
    { label: '환불', value: count(data.refunds, '미연결'), note: '확정 환불 원자료 연결 대기' },
    { label: '스토어 정산', value: count(data.settlement, '미연결'), note: '스토어의 확정 정산 원자료 연결 대기' },
  ];
  return <Section title="수익" icon="$" tone="success" info={['확인된 일반 멤버십 운영 결제의 통화별 총 결제 발생액이에요. 비즈니스 요금제는 합산하지 않아요. 환불·스토어 수수료 차감 전이며 정산액은 미연결이에요.', '기록이 없는 기간의 과거 미수집 결제를 추정하지 않아요. 통화 간 합산과 유료 홍보·광고 수익은 미연결이에요.', ...captions(items)]}>
    <Metrics items={items} />
    <DataTable title="통화별 결제 발생액" headers={['통화', '총 결제 발생액', '결제 건수', '구매 회원', '갱신 결제']} rows={data.currencies.map((row) => ({ key: row.currency, cells: [row.currency, count(row.amount), count(row.purchases), count(row.buyers), count(row.renewals)] }))} />
  </Section>;
}

function Quality({ data, filters }: { data: AdminPerformance['quality']; filters: AnalyticsFilters }) {
  const showLegacy = filters.includeInternal && filters.city === null && filters.tier === 'all';
  const items: MetricItem[] = [
    { label: '미처리 신고', value: count(data.openReports), note: '현재 미처리 신고 잔량 · 스냅샷' },
    { label: '처리된 신고', value: count(data.resolvedReports), note: '선택 기간에 해결한 신고' },
    { label: '평균 신고 처리 시간', value: data.averageResolutionHours === null ? '해결 기록 없음' : `${count(data.averageResolutionHours)}시간`, note: '선택 기간에 해결한 신고의 생성부터 해결까지' },
  ];
  return <Section title="품질" icon="!" tone="warning" info={['실패는 영향을 받은 로그인 회원 수예요. 전체 실패율을 산출할 분모는 미수집이에요. 회원 신고 기록만 포함해요.', ...captions(items)]}>
    <Metrics items={items} />
    <DataTable title="앱 버전별 활동" headers={['플랫폼', '버전', '고유 회원', '방문 구간']} rows={data.versions.map((row) => ({ key: `${row.platform}:${row.version}`, cells: [platformLabel(row.platform), row.version || '미확인', count(row.members), count(row.visits)] }))} />
    {data.errorStartedAt ? <Note>클라이언트 실패 수집 시작 {date(data.errorStartedAt)} (UTC)</Note> : <Notice title="실패 수집 대기" text="새 클라이언트 오류 기록을 아직 받지 못했어요. 미수집을 실패 0건으로 해석하지 않아요." />}
    <DataTable title="실패를 겪은 회원" headers={['실패 종류', '영향받은 고유 회원']} rows={data.failures.map((row) => ({ key: row.kind, cells: [FAILURES[row.kind] ?? row.kind, `${count(row.members)}명`] }))} />
    {showLegacy && <>
      <Notice title="운영 누적 참고" text="기존 오류 지문은 계정·플랫폼·누적 발생을 합쳐요. 선택 기간에 최근 관측된 지문의 전체 누적값이에요. 이 기간의 정확한 오류 건수나 실패율로 해석하지 않아요. 내부 계정 포함·전체 도시·전체 일반 등급에서만 보여요." />
      <DataTable title="기존 오류 지문 · 운영 누적 참고" headers={['플랫폼', '버전', '지문 그룹', '전체 누적 보고']} rows={data.errorGroups.map((row) => ({ key: `${row.platform}:${row.version}`, cells: [platformLabel(row.platform), row.version || '미확인', count(row.groups), count(row.lifetimeReports)] }))} />
    </>}
  </Section>;
}

function Section({ title, icon, tone, info, children }: { title: string; icon: string; tone: AdminTone; info: string | string[]; children: ReactNode }) {
  return <View accessibilityLabel={title} style={styles.sectionWrap}><AdminCard icon={icon} tone={tone} title={title} info={info}>{children}</AdminCard></View>;
}
function Metrics({ items }: { items: MetricItem[] }) {
  return <View style={styles.metrics}>{items.map(item => <Metric key={item.label} label={item.label} value={item.value} />)}</View>;
}
// Unconnected collectors show one grey "연결 전" badge instead of occupying the big-number slot.
function Metric({ label, value }: { label: string; value: string }) {
  return <View role="group" accessibilityLabel={label} style={styles.metric}><ThemedText type="small" style={styles.muted}>{label}</ThemedText>
    {value === '미연결' ? <AdminPill label="연결 전" /> : <ThemedText selectable style={styles.metricValue}>{value}</ThemedText>}</View>;
}
function DataTable({ title, headers, rows }: { title: string; headers: string[]; rows: { key: string; cells: string[] }[] }) {
  const { play } = useInteractionFeedback();
  return <View accessibilityLabel={title} style={styles.section}>
    <ThemedText type="smallBold">{title}</ThemedText>
    {!rows.length ? <Empty /> : <ScrollView horizontal tabIndex={Platform.OS === 'web' ? 0 : undefined} role="region" onFocus={() => play('selection')} style={styles.tableScroll} accessibilityLabel={`${title}. 좌우로 스크롤할 수 있습니다.`}>
      <View role="table" accessibilityLabel={title} style={[styles.table, { minWidth: headers.length * 142 }]}>
        <View role="row" style={styles.tableHeader}>{headers.map((header) => <View role="columnheader" key={header} style={styles.cell}><ThemedText type="smallBold" style={styles.muted}>{header}</ThemedText></View>)}</View>
        {rows.map((row, rowIndex) => <View role="row" key={row.key} style={[styles.tableRow, rowIndex % 2 === 1 && styles.tableRowAlternate]}>{row.cells.map((cell, index) => <View role="cell" key={headers[index]} style={styles.cell}><ThemedText type="small" selectable style={styles.tableValue}>{cell}</ThemedText></View>)}</View>)}
      </View>
    </ScrollView>}
  </View>;
}

function Note({ children }: { children: ReactNode }) { return <ThemedText type="small" style={styles.muted}>{children}</ThemedText>; }
function Notice({ title, text }: { title: string; text: string }) { return <View style={styles.notice}><ThemedText type="smallBold">{title}</ThemedText><Note>{text}</Note></View>; }
function Empty() { return <Note>선택 조건에 표시할 기록이 없어요.</Note>; }
function Action({ label, onPress }: { label: string; onPress: () => void }) {
  const { play } = useInteractionFeedback();
  return <Pressable accessibilityRole="button" onPress={() => { play('selection'); onPress(); }} style={({ pressed }) => [styles.action, pressed && styles.pressed]}><ThemedText type="smallBold">{label}</ThemedText></Pressable>;
}
const formatter = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 20 });
function count(value: number | null, missing = '미수집') { return value === null ? missing : formatter.format(value); }
function rate(value: number | null, missing: string) { return value === null ? missing : `${count(value)}%`; }
function retentionRate(row: RetentionRow) { return row.eligible > 0 && row.rate !== null ? rate(row.rate, '미수집') : row.pending > 0 ? '관측 중' : row.eligible === 0 ? '대상 없음' : '미수집'; }
function date(value: string) { return new Date(value).toISOString().slice(0, 16).replace('T', ' '); }
function cityLabel(value: string) { return CITIES.find((city) => city.id === value)?.name ?? value; }
function platformLabel(value: string) { return PLATFORMS[value as PerformancePlatform] ?? value; }

const styles = StyleSheet.create({
  section: { gap: Spacing.three, minWidth: 0, maxWidth: '100%' },
  sectionWrap: { minWidth: 0, maxWidth: '100%' },
  grow: { flex: 1, minWidth: 0 },
  platformRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  overviewHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  areaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  areaCard: { flexBasis: 260, flexGrow: 1, minWidth: 0 },
  muted: { color: Colors.admin.textSecondary },
  accent: { color: Colors.admin.accent },
  danger: { color: Colors.admin.danger },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  choice: { minHeight: 44, paddingHorizontal: Spacing.three, justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: Colors.admin.line, backgroundColor: Colors.admin.card },
  choiceSelected: { backgroundColor: Colors.admin.backgroundSelected, borderColor: Colors.admin.accent },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  metric: { flexBasis: 150, flexGrow: 1, minWidth: 0, gap: Spacing.one, padding: Spacing.three, borderRadius: 10, backgroundColor: Colors.admin.backgroundElement },
  metricValue: { fontSize: 26, lineHeight: 34, fontWeight: 600, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  notice: { gap: Spacing.two, padding: Spacing.three, borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 8, backgroundColor: Colors.admin.backgroundElement },
  chartRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.one },
  chart: { flexGrow: 1, minWidth: '100%', gap: Spacing.one, paddingTop: Spacing.two },
  axis: { width: 32, height: 118, justifyContent: 'space-between' },
  axisLabel: { fontSize: 10, color: Colors.admin.textSecondary, textAlign: 'right', fontVariant: ['tabular-nums'] },
  barColumn: { flexGrow: 1, minWidth: 30, gap: Spacing.two },
  barColumnCompact: { minWidth: 14 },
  barTrack: { height: 110, justifyContent: 'flex-end', borderBottomWidth: 1, borderBottomColor: Colors.admin.line },
  gridLine: { position: 'absolute', top: 0, left: 0, right: 0, borderTopWidth: 1, borderTopColor: Colors.admin.line, borderStyle: 'dashed' },
  bar: { backgroundColor: Colors.admin.accent, borderTopLeftRadius: 2, borderTopRightRadius: 2, marginHorizontal: Spacing.one },
  barLabel: { fontSize: 10, textAlign: 'center', color: Colors.admin.textSecondary },
  tableScroll: { borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 8, maxWidth: '100%' },
  table: { flex: 1, backgroundColor: Colors.admin.card },
  tableHeader: { flexDirection: 'row', backgroundColor: Colors.admin.backgroundElement },
  tableRow: { minHeight: 44, flexDirection: 'row', borderTopWidth: 1, borderTopColor: Colors.admin.line },
  tableRowAlternate: { backgroundColor: Colors.admin.background },
  cell: { flex: 1, minWidth: 142, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, justifyContent: 'center' },
  tableValue: { fontVariant: ['tabular-nums'] },
  action: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: Spacing.three, justifyContent: 'center', borderWidth: 1, borderColor: Colors.admin.line, borderRadius: 8, backgroundColor: Colors.admin.card },
  pressed: { opacity: 0.7 },
});
