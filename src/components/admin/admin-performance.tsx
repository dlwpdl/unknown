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

const PLATFORMS = { all: '모든 기기', ios: '아이폰', android: '안드로이드', web: '웹' } as const;
const SOURCES = { unknown: '미분류', direct: '직접 링크', instagram: 'Instagram', threads: 'Threads', search: '검색 링크', facebook: 'Facebook', website: '웹사이트 링크' } as const;
const STEPS: Record<string, string> = { signup_complete: '가입 완료', consent_complete: '필수 동의 완료', meetup_request_complete: '모임 신청 완료' };
const FAILURES: Record<string, string> = { client_error: '앱 화면 오류', photo_upload_error: '사진 업로드 실패', map_error: '지도 오류' };
const NOTIFICATION_KINDS: Record<string, string> = {
  comment: '내 글 댓글', reply: '내 댓글 답글', post_like: '내 글 좋아요', comment_like: '댓글·답글 좋아요', message: '새 메시지', message_reaction: '메시지 반응',
  meetup_request: '모임 신청', meetup_approved: '모임 신청 승인', meetup_rejected: '모임 신청 거절', meetup_reminder: '모임 일정 안내',
  meetup_morning: '모임 당일 안내', meetup_changed: '모임 변경', meetup_cancelled: '모임 취소', meetup_review_request: '모임 후기 요청', meetup_host_tip: '빈 모임 호스트 안내',
  interest_post: '관심 태그의 새 글', nearby_meetup: '내 지역의 새로운 모임', trending_post: '내 도시에서 지금 뜨는 글', trending_meetup: '인기 모임',
  trending_hashtag: '인기 주제', weekly_ranking: '주간 인기 글 순위', city_food: '내 도시의 맛집·레스토랑', city_places: '내 도시의 가볼 만한 곳·행사',
  saved_merchant_post: '저장한 비즈니스 새 소식', merchant_review_received: '비즈니스 후기', merchant_review_verified: '비즈니스 후기 인증',
  merchant_review_rejected: '비즈니스 후기 인증 거절', merchant_review_reply: '비즈니스 후기 답변', merchant_operation: '비즈니스 게시·연결 문제',
  account_security: '계정 보안', moderation_warning: '이용 안내', moderation_blocked: '이용 제한', safety_alert: '안전 경고',
  admin_security: '보안 경고', admin_multiacct: '다계정 의심', admin_error_spike: '앱 오류 급증', admin_signup: '새 회원 가입', admin_persona_contact: '운영 캐릭터 개인 연락',
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
    '기기 선택은 방문·행동·행사·장소·알림·앱 오류 기록에만 적용돼요. 가입·글·모임·결제·신고·알림 발송 기록에는 어느 기기인지 정보가 없어요.',
    `${filters.includeInternal ? '내부 계정 포함' : '관리자·운영 캐릭터·심사·테스트 계정 기본 제외'} · 날짜는 세계 표준시 기준이라 밴쿠버보다 7~8시간 빨라요 · 한 사람이 아이폰과 웹을 둘 다 쓰면 기기별 숫자에 각각 들어가요.`,
    ...(data ? [`${date(data.periodStart)} 이후 · 갱신 ${date(data.generatedAt)} · 방문 수집 시작 ${date(data.collectionStartedAt)} · 새 행동 기록 시작 ${date(data.trackingAvailableAt)}`] : []),
  ];

  return <View style={styles.section}>
    <View style={styles.platformRow}>
      <View accessibilityRole="radiogroup" accessibilityLabel="기기 선택" style={styles.choices}>
        {Object.entries(PLATFORMS).map(([key, label]) => <Pressable key={key} accessibilityRole="radio" aria-checked={platform === key} tabIndex={platform === key ? 0 : -1}
          {...(Platform.OS === 'web' ? { onKeyDown: adminOptionKeys } : {})}
          onPress={() => { play('selection'); setPlatform(key as PerformancePlatform); }}
          style={({ pressed }) => [styles.choice, platform === key && styles.choiceSelected, pressed && styles.pressed]}>
          <ThemedText type="smallBold" style={platform === key ? styles.accent : styles.muted}>{label}</ThemedText>
        </Pressable>)}
      </View>
      <AdminInfo label="집계 범위 보기" text={scope} />
    </View>
    {localPreview ? <Notice title="운영 데이터 미연결" text="이 컴퓨터에서만 보는 미리보기예요. 실제 숫자는 관리자 로그인과 2단계 인증을 마친 뒤에 보여요." />
      : loading ? <View accessibilityRole="progressbar" accessibilityLabel="성과 데이터 불러오는 중" style={styles.notice}><ThemedText type="smallBold">성과 불러오는 중</ThemedText><Note>고른 조건으로 숫자를 세고 있어요.</Note></View>
        : current?.error ? <View accessibilityRole="alert" style={styles.notice}>
          <ThemedText type="smallBold" style={styles.danger}>{current.denied ? '관리자 인증을 확인해 주세요' : '성과 데이터를 불러오지 못했어요'}</ThemedText>
          <Note>{current.denied ? '관리자 로그인과 2단계 인증이 필요해요. 로그인 상태를 확인한 뒤 다시 시도해 주세요.' : '인터넷 연결을 확인한 뒤 다시 시도해 주세요. 불러오지 못한 숫자를 0으로 보여 주지 않아요.'}</Note>
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
    { label: '들어온 회원', value: count(data.activity.activeUsers), note: '고른 기간에 앱이나 웹을 한 번이라도 연 회원 수 (여러 번 와도 한 명)' },
    { label: '신규 가입', value: count(data.growth.newMembers), note: '고른 기간에 가입한 회원' },
    { label: '새 글', value: count(data.community.posts), note: '고른 기간에 올라온 글' },
    { label: '일주일 뒤 다시 온 비율', value: d7 ? retentionRate(d7) : '기록 없음', note: '가입하고 7일째 되는 날 다시 들어온 회원 비율 · 아직 7일이 안 된 회원은 빼고 계산해요' },
  ];
  const fact = (label: string, value: string) => ({ label, value: value === '미연결' ? <AdminPill label="연결 전" /> : value });
  const areas: { title: string; icon: string; tone: AdminTone; items: { label: string; value: ReactNode }[] }[] = [
    { title: '성장', icon: '↗', tone: 'accent', items: [fact('가입 후 실제로 활동한 비율', rate(data.growth.activationRate, '가입자 없음')), fact('가입 후 실제로 활동한 회원', count(data.growth.activatedMembers))] },
    { title: '활동', icon: '✦', tone: 'navy', items: [fact('댓글', count(data.community.comments)), fact('모임 신청', count(data.community.meetupRequests))] },
    { title: '수익', icon: '$', tone: 'success', items: [fact('현재 유료 회원', count(data.revenue.paidMembers)), fact('스토어에서 들어온 돈', count(data.revenue.settlement, '미연결'))] },
    { title: '품질', icon: '!', tone: 'warning', items: [fact('아직 처리 안 한 신고', count(data.quality.openReports)), fact('처리한 신고', count(data.quality.resolvedReports))] },
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
    { label: '신규 가입', value: count(data.newMembers), note: '고른 기간에 가입한 회원' },
    { label: '가입 후 실제로 활동한 회원', value: count(data.activatedMembers), note: '가입하고 나서 글·댓글·모임 신청·메시지 중 하나라도 남긴 회원' },
    { label: '가입 후 실제로 활동한 비율', value: rate(data.activationRate, '가입자 없음'), note: '같은 기간 새로 가입한 회원 중 실제로 활동한 회원 비율' },
  ];
  return <Section title="성장·유입" icon="↗" tone="accent" info={['고른 기간에 가입한 회원과 실제 활동이에요. 유입은 어떤 링크를 타고 들어왔는지, 그 방문에서 가입까지 했는지예요. 앱 설치가 어디서 왔는지는 아직 모으지 않아요.', '완료 행동은 단계마다 따로 센 숫자예요. 방문 수와 로그인 회원 수를 따로 세고, 단계가 순서대로 이어졌는지는 계산하지 않아요.', ...captions(items)]}>
    <Metrics items={items} />
    {data.sourceStartedAt ? <>
      <Note>유입 기록 시작 {date(data.sourceStartedAt)} · 어디서 왔는지 모르는 방문은 미분류로 둬요.</Note>
      <DataTable title="유입 채널" headers={['들어온 링크', '방문 수', '가입까지 간 방문', '가입한 비율']} rows={data.sources.map((row) => ({ key: row.source, cells: [SOURCES[row.source], count(row.sessions), count(row.signupSessions), rate(row.signupRate, '방문 없음')] }))} />
    </> : <Notice title="유입 수집 대기" text="어떤 링크로 들어왔는지 기록이 아직 없어요." />}
    <DataTable title="가입·온보딩 완료 행동" headers={['완료 행동', '방문 수', '로그인 회원']} rows={data.onboarding.map((row) => ({ key: row.target, cells: [STEPS[row.target] ?? row.target, count(row.sessions), count(row.members)] }))} />
  </Section>;
}

function Activity({ data, collectionStartedAt, chart }: { data: AdminPerformance['activity']; collectionStartedAt: string; chart: boolean }) {
  const items: MetricItem[] = [
    { label: '오늘 들어온 회원', value: count(data.dau), note: '오늘 하루 앱이나 웹을 연 회원 수 (여러 번 와도 한 명)' },
    { label: '최근 7일 들어온 회원', value: count(data.wau), note: '오늘까지 7일 동안 한 번이라도 들어온 회원 수' },
    { label: '최근 30일 들어온 회원', value: count(data.mau), note: '오늘까지 30일 동안 한 번이라도 들어온 회원 수' },
    { label: '고른 기간에 들어온 회원', value: count(data.activeUsers), note: '고른 기간에 한 번이라도 들어온 회원 수' },
    { label: '방문 횟수', value: count(data.visits), note: '회원이 앱이나 웹을 연 횟수 (기기마다 따로 세요)' },
    { label: '한 명당 평균 방문', value: count(data.visitsPerUser, '들어온 회원 없음'), note: '방문 횟수를 들어온 회원 수로 나눈 값' },
  ];
  return <Section title="활동" icon="✦" tone="navy" info={['로그인한 회원이 앱이나 웹을 연 기록으로 세요. 한 사람이 여러 번 와도 한 명으로 세요.', '날짜는 세계 표준시 기준이라 밴쿠버보다 7~8시간 빨라요.', `방문 기록 시작 ${date(collectionStartedAt)} · 그 전 날짜는 기록 없음으로 보여요.`, ...captions(items)]}>
    <Metrics items={items} />
    {chart && <DailyActivity rows={data.daily} collectionStartedAt={collectionStartedAt} />}
    <DataTable title="기기별 활동" headers={['기기', '회원 수', '방문 횟수']} rows={data.platforms.map((row) => ({ key: row.platform, cells: [platformLabel(row.platform), count(row.users), count(row.visits)] }))} />
  </Section>;
}

function DailyActivity({ rows, collectionStartedAt }: { rows: AdminPerformance['activity']['daily']; collectionStartedAt: string }) {
  const [showTable, setShowTable] = useState(false);
  const compact = isCompactAdminWidth(useWindowDimensions().width);
  const peak = Math.max(0, ...rows.map((row) => row.users ?? 0));
  return <View accessibilityLabel="일별 활동 추이" style={styles.section}>
    <AdminCard icon="▥" tone="accent" title="날마다 들어온 회원" info={[`가장 많은 날 ${count(peak)}명 · 기록이 없는 날은 막대를 비워 둬요.`, `방문 기록 시작 ${date(collectionStartedAt)} · 날짜는 세계 표준시 기준`]}
      action={<AdminButton kind="text" label={showTable ? '차트 보기' : '수치 표 보기'} onPress={() => setShowTable((value) => !value)} />}>
      {!rows.length ? <Empty /> : showTable ? <DataTable title="일별 활동 수치" headers={['날짜', '들어온 회원', '방문 횟수', '신규 가입']} rows={rows.map((row) => ({ key: row.day, cells: [row.day, count(row.users), count(row.visits), count(row.signups)] }))} /> : <View style={styles.chartRow}>
        <View style={styles.axis} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><ThemedText type="small" style={styles.axisLabel}>{count(peak)}</ThemedText><ThemedText type="small" style={styles.axisLabel}>0</ThemedText></View>
        <ScrollView horizontal accessibilityLabel="날마다 들어온 회원 막대 차트" contentContainerStyle={styles.chart}>
          {rows.map((row, index) => <View key={row.day} accessible accessibilityLabel={`${row.day}, 들어온 회원 ${count(row.users)}, 방문 횟수 ${count(row.visits)}, 신규 가입 ${count(row.signups)}`} style={[styles.barColumn, compact && styles.barColumnCompact]}>
            <View style={styles.barTrack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={styles.gridLine} /><View style={[styles.bar, { height: `${(row.users ?? 0) / Math.max(1, peak) * 100}%` }]} /></View>
            <ThemedText type="small" style={styles.barLabel}>{index === 0 || index === rows.length - 1 || index % Math.ceil(rows.length / 7) === 0 ? row.day.slice(5) : ' '}</ThemedText>
          </View>)}
        </ScrollView>
      </View>}
    </AdminCard>
  </View>;
}

function Retention({ rows, cohorts }: { rows: RetentionRow[]; cohorts: AdminPerformance['cohorts'] }) {
  return <Section title="다시 찾아온 회원" icon="↻" tone="accent" info={['가입하고 1일째, 7일째, 30일째 되는 날 다시 들어온 회원 비율이에요.', '아직 그날이 오지 않은 회원은 계산에서 빼요. 0%로 치지 않아요.', '날짜는 세계 표준시 기준이에요.']}>
    <DataTable title="가입 후 1일·7일·30일째 다시 온 회원" headers={['가입 후', '계산에 넣은 회원', '다시 온 회원', '아직 그날이 안 된 회원', '다시 온 비율']} rows={rows.map((row) => ({ key: String(row.days), cells: [`${row.days}일째`, count(row.eligible), count(row.returned), count(row.pending), retentionRate(row)] }))} />
    <DataTable title="가입한 날짜별로 다시 온 회원" headers={['가입일', '가입 회원', '1일째', '7일째', '30일째']} rows={cohorts.map((cohort) => ({ key: cohort.day, cells: [cohort.day, count(cohort.joined), ...[1, 7, 30].map((days) => {
      const row = cohort.retention.find((item) => item.days === days);
      return row ? `${retentionRate(row)}\n${count(row.eligible)}명 중 ${count(row.returned)}명 다시 옴\n아직 날이 안 된 ${count(row.pending)}명` : '기록 없음';
    })] }))} />
  </Section>;
}

function Community({ data }: { data: AdminPerformance['community'] }) {
  const items: MetricItem[] = [
    { label: '작성 글', value: count(data.posts), note: '고른 기간에 올라온 글' },
    { label: '댓글', value: count(data.comments), note: '고른 기간에 달린 댓글' },
    { label: '모임 신청', value: count(data.meetupRequests), note: '고른 기간에 들어온 신청' },
    { label: '서로 주고받은 대화', value: count(data.mutualConversations), note: '두 사람 모두 실제로 메시지를 보낸 대화' },
  ];
  return <Section title="커뮤니티" icon="✎" tone="navy" info={['고른 기간에 올라온 글·댓글·신청과 실제로 오간 메시지예요.', '승인된 신청은 그 기간에 들어온 신청이 지금 승인 상태인지로 세요.', ...captions(items)]}>
    <Metrics items={items} />
    <DataTable title="커뮤니티 참여" headers={['기록', '값', '집계 범위']} rows={[
      { key: 'authors', cells: ['글 작성 회원', `${count(data.authors)}명`, '고른 기간에 글을 쓴 사람 수'] },
      { key: 'commenters', cells: ['댓글 작성 회원', `${count(data.commenters)}명`, '고른 기간에 댓글을 쓴 사람 수'] },
      { key: 'approved', cells: ['현재 승인된 신청', `${count(data.approvedRequests)}건`, '고른 기간에 들어온 신청의 지금 상태'] },
      { key: 'saves', cells: ['글 저장', `${count(data.savedPosts)}건`, '고른 기간에 저장했고 지금도 저장된 것'] },
      { key: 'shares', cells: ['글 공유·복사', `${count(data.sharedPosts)}건`, '한 사람이 한 글을 처음 공유하거나 복사한 횟수'] },
    ]} />
  </Section>;
}

function Discovery({ data }: { data: AdminPerformance['discovery'] }) {
  const items: MetricItem[] = [
    { label: '기존 행사 클릭', value: count(data.legacyEventViews, '범위 확인 불가'), note: '예전 기록에는 도시·기기 정보가 없어서 도시나 기기를 고르면 셀 수 없어요.' },
    { label: '행사 저장·공유', value: '미연결', note: '행사 저장·공유 기능의 기록이 없어요.' },
    { label: '장소 저장·공유', value: '미연결', note: '장소 저장·공유 기능의 기록이 없어요.' },
  ];
  return <Section title="행사·장소" icon="⌖" tone="navy" info={['행사·장소를 열어 보거나 길찾기·웹사이트를 누른 기록이에요. 같은 사람이 같은 날 같은 곳에 같은 행동을 여러 번 해도 한 번으로 세요. 길찾기를 눌렀다고 실제로 갔다고 보지 않아요.', ...captions(items)]}>
    {data.startedAt ? <Note>행사·장소 기록 시작 {date(data.startedAt)}</Note> : <Notice title="행사·장소 기록 대기" text="새 기록이 아직 없어요. 예전 클릭 기록과 합치지 않아요." />}
    <Metrics items={items} />
    <DataTable title="대상별 행동" headers={['대상', '대상 도시', '열람', '길찾기 클릭', '웹사이트 클릭']} rows={data.rows.map((row) => ({ key: `${row.kind}:${row.cityId}:${row.targetId}`, cells: [`${row.kind === 'event' ? '행사' : row.kind === 'place' ? '장소' : row.kind} · ${row.title}`, cityLabel(row.cityId), count(row.views), count(row.directions), count(row.websites)] }))} />
  </Section>;
}

function Notifications({ data, platform }: { data: AdminPerformance['notifications']; platform: PerformancePlatform }) {
  const missingRate = platform !== 'all' ? '기기별로는 계산할 수 없어요' : data.clickStartedAt ? '보낸 알림 없음' : '기록 없음';
  const items: MetricItem[] = [
    { label: '만든 알림', value: count(data.generated), note: '고른 기간에 회원에게 보내려고 만든 알림 (받는 사람마다 하나)' },
    { label: '애플·구글이 받은 알림', value: count(data.providerAccepted), note: '애플·구글 알림 서버가 받아 간 알림' },
    { label: '보내기 실패', value: count(data.failed), note: '알림 서버로 보내지 못한 알림' },
    { label: '알림 누른 비율', value: platform === 'all' ? rate(data.clickRate, missingRate) : missingRate, note: '알림을 받은 회원 중 눌러서 들어온 비율 (누른 기록을 모으기 시작한 뒤의 알림만)' },
    { label: '알림 누른 횟수', value: count(data.pushOpens), note: '휴대폰 화면에 뜬 알림을 실제로 누른 횟수' },
    { label: '앱 안 알림함에서 연 횟수', value: count(data.inboxOpens), note: '알림함에서 하나씩 연 횟수 · 모두 읽음 처리는 빼요' },
    { label: '알림 열고 활동한 회원', value: count(data.activeAfterOpen), note: '알림을 열고 30분 안에 글·댓글·신청·메시지를 남긴 회원 수' },
  ];
  return <Section title="알림" icon="◔" tone="navy" info={[
    '애플·구글이 받은 알림이라도 실제로 휴대폰 화면에 떴는지는 알 수 없어요. 보낸 기록은 최대 7일만 남고, 기기를 지우면 사라질 수 있어요.',
    '같은 알림을 여러 기기에서 눌러도 한 번으로 세요. 보낸 기록에는 기기 정보가 없어서 기기별로 누른 비율은 계산할 수 없어요. 알림 열고 활동한 회원이 많다고 알림 덕분이라는 뜻은 아니에요.',
    ...captions(items),
  ]}>
    <Note>{date(data.deliverySince)} 이후 보낸 알림만 세요. 남아 있는 기록만 셀 수 있어요.</Note>
    <Metrics items={items} />
    {data.clickStartedAt ? <Note>알림 누른 기록 시작 {date(data.clickStartedAt)}</Note> : <Notice title="알림 누른 기록 대기" text="알림을 누르거나 알림함에서 연 기록이 아직 없어요." />}
    <DataTable title="알림 종류별 반응" headers={['종류', '만든 알림', '애플·구글이 받음', '실패', '알림 누름', '알림함에서 엶', '누른 비율']} rows={data.rows.map((row) => ({ key: row.kind, cells: [NOTIFICATION_KINDS[row.kind] ?? `기타 알림 (${row.kind})`, count(row.generated), count(row.providerAccepted), count(row.failed), count(row.pushOpens), count(row.inboxOpens), platform === 'all' ? rate(row.clickRate, missingRate) : missingRate] }))} />
    <Note>지금 알림을 켜 둔 회원 {count(data.optedInMembers)}명 / 알림 설정이 있는 회원 {count(data.preferenceMembers)}명 · 언제 껐는지는 기록하지 않아요.</Note>
  </Section>;
}

function Revenue({ data }: { data: AdminPerformance['revenue'] }) {
  const items: MetricItem[] = [
    { label: '지금 유료 회원', value: count(data.paidMembers), note: '지금 유료 멤버십을 쓰는 일반 회원 수' },
    { label: '새 가입자 중 결제한 비율', value: rate(data.paidConversion, '가입자 없음'), note: '고른 기간에 가입한 회원 중 같은 기간에 처음 결제한 회원 비율' },
    { label: '자동 갱신 결제', value: count(data.renewals), note: '구독이 다음 달로 넘어가며 실제로 결제된 횟수' },
    { label: '자동 갱신 해지', value: count(data.cancellations), note: '자동 갱신을 끈 횟수예요. 환불 건수가 아니에요.' },
    { label: '환불', value: count(data.refunds, '미연결'), note: '환불 기록은 아직 연결 전이에요' },
    { label: '스토어에서 들어온 돈', value: count(data.settlement, '미연결'), note: '앱스토어·구글 정산 기록은 아직 연결 전이에요' },
  ];
  return <Section title="수익" icon="$" tone="success" info={['일반 회원 멤버십 결제를 통화별로 더한 금액이에요. 비즈니스 요금제는 넣지 않아요.', '환불과 스토어 수수료를 빼기 전 금액이에요. 실제로 통장에 들어온 돈과 달라요.', '기록이 없는 예전 결제는 짐작해서 넣지 않아요. 다른 통화끼리는 합치지 않아요.', ...captions(items)]}>
    <Metrics items={items} />
    <DataTable title="통화별 결제 발생액" headers={['통화', '결제 금액 합계', '결제 횟수', '결제한 회원', '자동 갱신 결제']} rows={data.currencies.map((row) => ({ key: row.currency, cells: [row.currency, count(row.amount), count(row.purchases), count(row.buyers), count(row.renewals)] }))} />
  </Section>;
}

function Quality({ data, filters }: { data: AdminPerformance['quality']; filters: AnalyticsFilters }) {
  const showLegacy = filters.includeInternal && filters.city === null && filters.tier === 'all';
  const items: MetricItem[] = [
    { label: '아직 처리 안 한 신고', value: count(data.openReports), note: '지금 남아 있는 신고 수' },
    { label: '처리한 신고', value: count(data.resolvedReports), note: '고른 기간에 처리를 끝낸 신고' },
    { label: '평균 신고 처리 시간', value: data.averageResolutionHours === null ? '해결 기록 없음' : `${count(data.averageResolutionHours)}시간`, note: '신고가 들어와서 처리가 끝날 때까지 걸린 시간의 평균' },
  ];
  return <Section title="품질" icon="!" tone="warning" info={['오류는 오류를 겪은 로그인 회원 수로 세요. 전체 중 몇 퍼센트인지는 아직 계산할 수 없어요.', '신고는 회원 신고 기록만 세요.', ...captions(items)]}>
    <Metrics items={items} />
    <DataTable title="앱 버전별 활동" headers={['기기', '앱 버전', '회원 수', '방문 횟수']} rows={data.versions.map((row) => ({ key: `${row.platform}:${row.version}`, cells: [platformLabel(row.platform), row.version || '미확인', count(row.members), count(row.visits)] }))} />
    {data.errorStartedAt ? <Note>앱 오류 기록 시작 {date(data.errorStartedAt)}</Note> : <Notice title="앱 오류 기록 대기" text="새 앱 오류 기록이 아직 없어요. 기록이 없다고 오류가 0건이라는 뜻은 아니에요." />}
    <DataTable title="오류를 겪은 회원" headers={['오류 종류', '겪은 회원 수']} rows={data.failures.map((row) => ({ key: row.kind, cells: [FAILURES[row.kind] ?? row.kind, `${count(row.members)}명`] }))} />
    {showLegacy && <>
      <Notice title="예전 오류 누적 (참고용)" text="같은 오류끼리 묶은 예전 기록이에요. 계정·기기·기간을 가리지 않고 처음부터 쌓인 숫자라 이 기간의 오류 수로 보면 안 돼요. 내부 계정 포함·모든 도시·모든 등급을 골랐을 때만 보여요." />
      <DataTable title="예전 오류 누적 (참고용)" headers={['기기', '앱 버전', '같은 오류 묶음 수', '처음부터 쌓인 보고 수']} rows={data.errorGroups.map((row) => ({ key: `${row.platform}:${row.version}`, cells: [platformLabel(row.platform), row.version || '미확인', count(row.groups), count(row.lifetimeReports)] }))} />
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
function count(value: number | null, missing = '기록 없음') { return value === null ? missing : formatter.format(value); }
function rate(value: number | null, missing: string) { return value === null ? missing : `${count(value)}%`; }
function retentionRate(row: RetentionRow) { return row.eligible > 0 && row.rate !== null ? rate(row.rate, '기록 없음') : row.pending > 0 ? '아직 계산 중' : row.eligible === 0 ? '해당 회원 없음' : '기록 없음'; }
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
