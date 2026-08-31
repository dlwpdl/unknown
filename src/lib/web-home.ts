import { CITIES, MOCK_POSTS, TAGS } from './mock.ts';

export type WebHomeCitySummary = {
  id: string;
  name: string;
  province: string;
  state: 'open' | 'soon';
  stateLabel: string;
  headline: string;
  blurb: string;
  launchNote: string;
  postCount: number;
  meetupCount: number;
  neighborhoodCount: number;
};

const CITY_COPY: Record<string, Pick<WebHomeCitySummary, 'headline' | 'blurb' | 'launchNote'>> = {
  vancouver: {
    headline: '밴쿠버 피드는 정착 정보와 동네 일상이 같은 속도로 올라옵니다.',
    blurb: '킷실라노, 버나비, 코퀴틀람, 다운타운처럼 실제 생활권의 질문과 만남이 함께 쌓입니다.',
    launchNote: '서비스중',
  },
  toronto: {
    headline: '토론토 피드는 출근길 정보, 동네 추천, 모임 제안이 더 빠르게 순환합니다.',
    blurb: '노스욕, 미시사가, 영앤블루어처럼 이동 반경이 넓은 도시에서 글과 대화의 연결성이 더 중요합니다.',
    launchNote: '서비스중',
  },
  montreal: {
    headline: '몬트리올은 다음 기수에서 열릴 후보 도시입니다.',
    blurb: '도시별 밀도를 먼저 만든 뒤 순차적으로 여는 방식이라 대기열 수요를 먼저 모읍니다.',
    launchNote: '대기열 예정',
  },
  calgary: {
    headline: '캘거리는 대기열 도시로 쌓아 두고 있습니다.',
    blurb: '열리기 전부터 정착, 교통, 주거 수요를 모아 첫날 빈 피드가 생기지 않게 만듭니다.',
    launchNote: '대기열 예정',
  },
  winnipeg: {
    headline: '위니펙도 초기 관심 도시군에 포함됩니다.',
    blurb: '작은 도시일수록 글에서 대화와 모임으로 이어지는 구조가 먼저 필요합니다.',
    launchNote: '대기열 예정',
  },
  saskatoon: {
    headline: '사스카툰은 수요가 모이면 다음 웨이브에 포함됩니다.',
    blurb: '도시 규모가 작아도 생활 질문과 동네 관계는 충분히 독립된 커뮤니티가 됩니다.',
    launchNote: '대기열 예정',
  },
};

export const WEB_HERO_METRICS = [
  { label: '출시 도시', value: '밴쿠버 · 토론토' },
  { label: '게시 리듬', value: '하루 한 편' },
  { label: '관계 전환', value: '댓글 -> DM -> 모임' },
] as const;

export const WEB_FEATURES = [
  {
    kicker: 'Daily feed',
    title: '하루 한 편 리듬으로 피드 밀도를 지킵니다.',
    body: '양보다 읽힘을 우선하는 구조라서, 커뮤니티 초기에 더 중요한 질문과 반응이 먼저 살아납니다.',
  },
  {
    kicker: 'Contextual chat',
    title: '댓글, DM, 모임 신청이 한 흐름으로 이어집니다.',
    body: '정보 글, 후기 글, 동네 제안이 외부 메신저로 흩어지기 전에 관계로 이어지는 흐름을 만듭니다.',
  },
  {
    kicker: 'City-first',
    title: '도시 단위로 커뮤니티를 분리해 온도를 맞춥니다.',
    body: '밴쿠버와 토론토는 같은 한인 앱 안에서도 전혀 다른 템포와 질문을 가지기 때문에, 피드와 대화가 분리되어야 합니다.',
  },
] as const;

export const WEB_STORY_BLOCKS = [
  {
    id: 'what',
    kicker: 'What Gling Is',
    title: '도시 생활권을 위한\n북미 한인 커뮤니티 앱입니다.',
    body: '정착, 맛집, 교통, 주거, 산책, 소모임 같은 생활 질문이 도시 안에서 해결되도록 설계했습니다.',
    points: ['도시별 피드 분리', '실제 동네 중심 질문', '모임 카드와 함께 확장'],
    image: 'feed' as const,
  },
  {
    id: 'how',
    kicker: 'How Community Moves',
    title: '댓글에서 DM,\n그리고 모임까지 이어지는 흐름입니다.',
    body: '댓글은 공개 반응의 입구가 되고, 더 깊은 대화는 DM으로 이어지고, 필요하면 모임 신청으로 연결됩니다.',
    points: ['댓글에서 바로 반응', 'DM으로 자연스럽게 이동', '인증 기준에 맞는 모임 참여'],
    image: 'flow' as const,
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
    id: 'admin-review',
    title: '관리자 열람',
    body: '권한 있는 운영자는 신고와 안전 운영 목적상 글, 댓글, 사용자 이력, 대화를 검토할 수 있으며 기록이 남습니다.',
  },
  {
    id: 'ai-review',
    title: 'AI 분석',
    body: 'AI는 위험 탐지와 우선순위 분류 보조에 쓰이며, 사람 검토 없이 영구 제재를 확정하지 않습니다.',
  },
  {
    id: 'appeal',
    title: '이의 제기',
    body: '콘텐츠 숨김, 계정 제한, 신고 처리 결과에 대해 재검토를 요청할 수 있는 경로를 제품 소개 단계부터 공개합니다.',
  },
  {
    id: 'contact',
    title: '문의처',
    body: '운영 및 정책 문의는 임시로 gling@ej-entertainment.com 으로 받고 있으며 출시 전 운영 채널로 교체할 예정입니다.',
  },
] as const;

export const WEB_FOOTER_GROUPS = [
  {
    title: 'Site',
    links: [
      { label: 'About', href: '#about' },
      { label: 'Community', href: '#community' },
      { label: 'Cities', href: '#cities' },
      { label: 'Trust', href: '#trust' },
    ],
  },
  {
    title: 'Download',
    links: [
      { label: 'Waitlist', href: '#download' },
      { label: 'App Store 알림', href: '#download' },
      { label: 'Google Play 알림', href: '#download' },
    ],
  },
  {
    title: 'Policy',
    links: WEB_POLICY_ITEMS.map((item) => ({ label: item.title, href: `#policy-${item.id}` })),
  },
] as const;

function buildCitySummary(city: (typeof CITIES)[number]): WebHomeCitySummary {
  const posts = MOCK_POSTS.filter((post) => post.cityId === city.id);
  const neighborhoods = new Set(posts.map((post) => post.author.neighborhood).filter(Boolean));
  const meetups = posts.filter((post) => post.room).length;
  const copy = CITY_COPY[city.id] ?? {
    headline: `${city.name} 커뮤니티는 준비 중입니다.`,
    blurb: '도시 밀도가 충분히 모이면 다음 웨이브로 열립니다.',
    launchNote: city.state === 'open' ? '서비스중' : '대기열 예정',
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
    postCount: posts.length,
    meetupCount: meetups,
    neighborhoodCount: neighborhoods.size,
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

export const WEB_CATEGORY_LABELS = TAGS.slice(0, 6).map((tag) => tag.label);
