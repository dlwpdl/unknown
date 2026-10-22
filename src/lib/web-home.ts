import { CITIES, TAGS } from './mock.ts';

export type WebHomeCitySummary = {
  id: string;
  name: string;
  province: string;
  state: 'open' | 'soon';
  stateLabel: string;
  headline: string;
  blurb: string;
  launchNote: string;
};

const CITY_COPY: Record<string, Pick<WebHomeCitySummary, 'headline' | 'blurb' | 'launchNote'>> = {
  vancouver: {
    headline: '비 오는 날의 산책길부터, 오늘 저녁 함께 먹을 한 끼까지.',
    blurb: '킷실라노, 버나비, 코퀴틀람, 다운타운. 가까운 생활권의 작은 질문과 일상을 나눠요.',
    launchNote: '출시 준비 중',
  },
  toronto: {
    headline: '출근길에 발견한 풍경부터, 주말에 가보고 싶은 동네까지.',
    blurb: '노스욕, 미시사가, 영앤블루어. 넓은 도시에서도 서로의 하루를 가까이에서 나눠요.',
    launchNote: '출시 준비 중',
  },
  montreal: {
    headline: '몽루아얄 산책부터, 동네 시장에서 만난 한 끼까지.',
    blurb: '플라토, 마일엔드, 다운타운. 한국어로 몬트리올의 생활 정보와 일상을 나눠요.',
    launchNote: '출시 준비 중',
  },
  calgary: {
    headline: '캘거리의 이야기도 기다리고 있어요.',
    blurb: '정착부터 동네 생활까지. 확장 일정은 아직 정해지지 않았어요.',
    launchNote: '추후 검토',
  },
  winnipeg: {
    headline: '위니펙은 앞으로 함께할 후보 도시예요.',
    blurb: '가까운 이웃과 나누는 생활 이야기. 확장 일정은 아직 정해지지 않았어요.',
    launchNote: '추후 검토',
  },
  saskatoon: {
    headline: '사스카툰의 이야기도 기다리고 있어요.',
    blurb: '우리 동네의 작은 질문과 만남. 확장 일정은 아직 정해지지 않았어요.',
    launchNote: '추후 검토',
  },
};

export const WEB_HERO_METRICS = [
  { label: '먼저 만날 도시', value: '밴쿠버 · 토론토 · 몬트리올 · 에드먼튼' },
  { label: '함께 나눌 주제', value: '10개의 카테고리' },
  { label: '출시 준비 중', value: 'iOS · Android' },
] as const;

export const WEB_FEATURES = [
  {
    kicker: 'Open expression',
    title: '정치적 입장과 의견은 제한하지 않습니다.',
    body: '생각이 다르거나 운영진을 비판한다는 이유로 글과 계정을 제한하지 않습니다.',
  },
  {
    kicker: 'Clear boundaries',
    title: '불법과 직접적인 괴롭힘에는 분명한 선을 둡니다.',
    body: '협박, 신상 공개, 사기, 반복적인 욕설처럼 다른 사람의 안전과 참여를 해치는 행위만 제한합니다.',
  },
  {
    kicker: 'Accountable operations',
    title: '운영진의 판단도 설명하고 기록합니다.',
    body: '조치 이유를 알리고 이의를 제기할 수 있게 해 운영자가 커뮤니티 위에 서지 않도록 합니다.',
  },
] as const;

export const WEB_STORY_BLOCKS = [
  {
    id: 'what',
    kicker: '01 · 이웃의 이야기',
    title: '작은 질문도,\n반가운 이야기가 되도록.',
    body: '오늘 발견한 맛집, 처음이라 낯선 정착 질문, 취향이 닮은 모임. 글과 댓글에서 시작한 대화를 이웃과 이어가세요.',
    points: ['도시별 피드와 10개의 생활 주제', '글과 댓글로 나누는 동네 이야기', 'DM과 모임으로 이어지는 대화'],
    image: 'feed' as const,
  },
  {
    id: 'how',
    kicker: '02 · 가까운 동네부터',
    title: '어느 동네로\n갈까요?',
    body: '내가 사는 도시도, 다음에 가보고 싶은 도시도. 직접 동네를 골라 그곳의 이야기를 펼쳐보세요.',
    points: ['밴쿠버 · 토론토 · 몬트리올 · 에드먼튼에서 시작', '기기 위치 권한 없이 직접 도시 선택', '다음 도시의 일정은 추후 안내'],
    image: 'cities' as const,
  },
] as const;

export const WEB_POLICY_ITEMS = [
  {
    id: 'privacy',
    title: '개인정보처리방침',
    body: '가입, 프로필, 글과 댓글, 대화, 신고 처리, 안전 운영에 필요한 범위의 데이터를 수집하고 사용합니다.',
  },
  {
    id: 'retention',
    title: '보존 기간',
    body: '게시물, 메시지, 신고, 감사 로그는 목적별 기준에 따라 보존되며, 삭제 요청 경로를 함께 안내합니다.',
  },
  {
    id: 'ai-review',
    title: 'AI 분석',
    body: '모든 새 글·댓글·대화는 위험 탐지 대상입니다. AI는 우선순위만 보조하며 사람 검토 없이 영구 제재를 확정하지 않습니다.',
  },
  {
    id: 'appeal',
    title: '이의 제기',
    body: '콘텐츠 숨김, 계정 제한, 신고 처리 결과에 대해 재검토를 요청할 수 있는 경로를 제품 소개 단계부터 공개합니다.',
  },
  {
    id: 'contact',
    title: '문의처',
    body: '운영, 정책, 개인정보 및 계정 삭제 문의는 eunsense0308@gmail.com 으로 받습니다.',
  },
] as const;

export const WEB_FOOTER_GROUPS = [
  {
    title: '글링',
    links: [
      { label: '소개', href: '#about' },
      { label: '앱 둘러보기', href: '#community' },
      { label: '시작하는 도시', href: '#cities' },
      { label: '운영 원칙', href: '#trust' },
    ],
  },
  {
    title: '출시 소식',
    links: [
      { label: '오픈 알림 신청', href: '#download' },
    ],
  },
  {
    title: '정책',
    links: [
      { label: '이용약관', href: 'terms' },
      { label: '개인정보처리방침', href: 'privacy' },
      { label: '계정 삭제', href: 'account-deletion' },
    ],
  },
] as const;

function buildCitySummary(city: (typeof CITIES)[number]): WebHomeCitySummary {
  const copy = CITY_COPY[city.id] ?? {
    headline: `${city.name} 커뮤니티는 준비 중입니다.`,
    blurb: '확장 일정은 추후 안내합니다.',
    launchNote: city.state === 'open' ? '출시 준비 중' : '추후 검토',
  };

  return {
    id: city.id,
    name: city.name,
    province: city.province,
    state: city.state,
    stateLabel: copy.launchNote,
    headline: copy.headline,
    blurb: copy.blurb,
    launchNote: copy.launchNote,
  };
}

export function listWebHomeCities() {
  return [...CITIES]
    .sort((left, right) => {
      if (left.state === right.state) return 0;
      return left.state === 'open' ? -1 : 1;
    })
    .map(buildCitySummary);
}

export function getWebHomeCitySummary(cityId: string | null | undefined) {
  const cities = listWebHomeCities();
  return cities.find((city) => city.id === cityId) ?? cities[0];
}

export const WEB_CATEGORY_LABELS = TAGS.map((tag) => tag.label);
