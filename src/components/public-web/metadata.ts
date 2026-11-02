import type { Metadata } from 'expo-router/server';
import { PUBLIC_CHANNELS, PUBLIC_SITE, publicAboutGling, publicDisambiguation, publicImmigrationMeta, publicSiteName } from '@/lib/public-seo';

export const publicReaderDescription = '밴쿠버·토론토·몬트리올 한인 커뮤니티 글링에서 동네 이야기, 맛집, 렌트·구인·중고, 모임을 둘러보세요. 미리보기는 바로 보고, 로그인하면 전체 글을 읽을 수 있어요.';


// 1200×630 covers in public/share-covers/ (rendered by scripts/render-share-covers.py).
export type ShareCover = 'home' | 'post' | 'vancouver' | 'toronto' | 'montreal' | 'business' | 'meetup' | 'festival';
export const shareCoverUrl = (cover: ShareCover) => `${PUBLIC_SITE}/share-covers/${cover}.png`;

export function publicMetadata(title: string, description: string, canonical: string, cover: ShareCover = 'home'): Metadata {
  return {
    title, description, robots: 'index, follow, max-image-preview:large',
    alternates: { canonical },
    openGraph: { type: 'website', siteName: publicSiteName(), locale: 'ko_KR', title, description, url: canonical, images: [{ url: shareCoverUrl(cover), width: 1200, height: 630, alt: title }] },
    twitter: { card: 'summary_large_image', title, description, images: [{ url: shareCoverUrl(cover), alt: title }] },
  };
}

export const publicHomeSchema = {
  '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebSite', '@id': `${PUBLIC_SITE}/#website`, name: '글링', alternateName: [publicSiteName(), publicSiteName('en'), 'Gling'],
      url: `${PUBLIC_SITE}/`, description: publicReaderDescription, inLanguage: 'ko', publisher: { '@id': `${PUBLIC_SITE}/#organization` } },
    { '@type': 'Organization', '@id': `${PUBLIC_SITE}/#organization`, name: 'Gling', alternateName: '글링', url: `${PUBLIC_SITE}/`,
      logo: { '@type': 'ImageObject', url: `${PUBLIC_SITE}/gling-logo-512.png`, width: 512, height: 512 }, email: 'gling@ej-entertainment.com', areaServed: [{ '@type': 'City', name: 'Vancouver' }, { '@type': 'City', name: 'Toronto' }, { '@type': 'City', name: 'Montreal' }], description: `${publicAboutGling} ${publicDisambiguation}`, sameAs: ['https://apps.apple.com/ca/app/id6809273242', ...PUBLIC_CHANNELS.map(channel => channel.url)] },
    { '@type': 'MobileApplication', name: 'Gling', alternateName: '글링', operatingSystem: 'iOS', applicationCategory: 'SocialNetworkingApplication',
      url: 'https://apps.apple.com/ca/app/id6809273242', offers: { '@type': 'Offer', price: '0', priceCurrency: 'CAD' }, publisher: { '@id': `${PUBLIC_SITE}/#organization` } },
  ],
};

export const FAQ_ITEMS: { question: string; answer: string }[] = [
  { question: '글링이 뭐예요?', answer: '밴쿠버·토론토·몬트리올에 사는 한인을 위한 커뮤니티 앱이에요. 라이프, 맛집, 여행, 쇼핑, 정착, 부동산, 교육, 구인구직, 중고거래, 비즈니스 같은 주제로 동네 이야기를 나누고, 축제나 콘서트에 함께 갈 사람을 찾고, 파티·운동·취미·여행 모임을 만들고 참여할 수 있어요.' },
  { question: '가입하지 않고도 볼 수 있나요?', answer: '공개 게시판은 웹에서 미리보기로 둘러볼 수 있어요. 글 전체를 읽거나 댓글을 달고 모임에 참여하려면 로그인 후 앱에서 이용하세요.' },
  { question: '어떤 도시에서 쓸 수 있나요?', answer: '지금은 밴쿠버, 토론토, 몬트리올에서 쓸 수 있어요. 다른 도시는 사람이 모이는 대로 차례로 열어요.' },
  { question: '모임은 어떻게 찾고 참여하나요?', answer: '앱에서 모임 목록을 보고 참여할 수 있어요. 직접 모임을 만들 수도 있고, 축제나 콘서트 동행도 찾을 수 있어요.' },
  { question: '글은 한국어로만 써야 하나요?', answer: '아니요. 한국어와 영어로 모두 쓸 수 있고, 번역 보기로 다른 언어로 읽을 수 있어요.' },
  { question: '글링은 무료인가요?', answer: '무료로 쓸 수 있어요. 일부 기능은 인앱 구매가 있어요.' },
  // Same steps as the app: post ⋯ / comment 신고 / profile / chat settings / long-press in meetup chat, block option in the report sheet.
  { question: '불편한 글이나 사람은 어떻게 신고하고 차단해요?', answer: "앱에서 글은 오른쪽 위 ⋯ 버튼을, 댓글은 밑에 있는 '신고'를 누르면 돼요. 사람은 닉네임을 누르면 나오는 프로필에서 신고하거나 차단해요. 대화방에서는 1:1이면 오른쪽 위 설정에서, 모임이면 메시지를 길게 눌러서 할 수 있어요. 신고할 때 '차단하기'에 체크해 두면 차단까지 한 번에 돼요. 신고한 글은 내 화면에서 바로 사라지고, 운영팀이 확인해서 규칙에 어긋나면 다른 사람에게도 안 보이게 내려요. 차단한 사람의 글과 댓글, 메시지는 더 이상 내 화면에 나오지 않아요." },
  { question: '가게나 회사를 글링에 어떻게 등록하나요?', answer: '글링 비즈니스 웹(gling.ej-entertainment.com/merchant)에 로그인해서 비즈니스를 등록하면 돼요. 소유 확인이 끝나면 프로필을 꾸미고 소식이나 직원 구하는 글을 올릴 수 있어요. 자세한 내용은 gling.ej-entertainment.com/business에 있어요.' },
  { question: '비즈니스 등록은 얼마예요?', answer: '등록과 기본 기능은 무료예요. 무료 요금제로 한 달에 새 글 1편을 올릴 수 있고, 더 자주 올리려면 플러스(월 CA$19.99), 프로(월 CA$49.99), 프리미엄(월 CA$149.99)으로 바꿀 수 있어요. 유료 요금제는 앱에서 App Store나 Google Play 구독으로 결제해요.' },
  { question: 'AI로 비즈니스 글을 쓸 수 있나요?', answer: '유료 비즈니스 요금제에서는 Claude나 ChatGPT를 글링에 연결해 소식 초안을 만들 수 있어요. 초안은 글링 웹에서 직접 확인한 뒤에 게시돼요.' },
  { question: '캐나다 워홀러도 쓸 수 있나요?', answer: '네. 정착 정보나 동네 모임을 찾는 워홀러도 쓸 수 있어요. 집, 일자리, 생활 정보는 동네 이야기에서 나눠요.' },
];

export const publicFaqSchema = {
  '@context': 'https://schema.org', '@type': 'FAQPage', '@id': `${PUBLIC_SITE}/faq#faq`, url: `${PUBLIC_SITE}/faq`,
  name: '글링 자주 묻는 질문', inLanguage: 'ko',
  mainEntity: FAQ_ITEMS.map(item => ({
    '@type': 'Question', name: item.question,
    acceptedAnswer: { '@type': 'Answer', text: item.answer },
  })),
};

// Owner 2026-11-01: official IRCC and provincial pages with one line each and the date checked.
// No fees, ages, processing times or eligibility numbers on the page: they change, and this is not legal advice.
export const IMMIGRATION_SECTIONS: { id: string; title: string; links: { name: string; url: string; about: string }[] }[] = [
  { id: 'pr', title: '영주권(이민)', links: [
    { name: 'Express Entry · IRCC', url: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry.html',
      about: '숙련 인력이 영주권을 신청할 때 쓰는 연방 정부 온라인 시스템이에요. 캐나다 경험 이민(CEC), 연방 숙련 인력 이민(FSW) 같은 프로그램이 이 시스템으로 운영돼요.' },
    { name: '주정부 이민(PNP) · IRCC', url: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/provincial-nominees.html',
      about: '각 주가 필요한 사람을 골라 영주권 대상으로 추천하는 제도예요. 조건은 주마다 달라요.' },
    { name: 'BC PNP · WelcomeBC', url: 'https://www.welcomebc.ca/immigrate-to-b-c', about: '밴쿠버가 있는 BC주의 주정부 이민 안내예요.' },
    { name: 'OINP · 온타리오 정부', url: 'https://www.ontario.ca/page/ontario-immigrant-nominee-program-oinp', about: '토론토가 있는 온타리오주의 주정부 이민 안내예요.' },
    { name: '퀘벡 이민 · 퀘벡 정부', url: 'https://www.quebec.ca/en/immigration/permanent',
      about: '퀘벡은 PNP 대신 주정부가 숙련 인력 이민을 따로 선발해요. 몬트리올로 갈 생각이면 여기부터 봐요.' },
  ] },
  { id: 'study', title: '유학', links: [
    { name: '학업 허가(Study permit) · IRCC', url: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit.html',
      about: '외국인은 대부분 학업 허가가 있어야 캐나다에서 공부할 수 있어요. 필요한 서류와 신청 순서가 나와 있어요.' },
    { name: '지정 교육기관(DLI) 목록 · IRCC', url: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit/prepare/designated-learning-institutions-list.html',
      about: '학업 허가로 다니는 학교는 지정 교육기관이어야 해서, 가려는 학교가 목록에 있는지 여기서 찾아봐요.' },
  ] },
  { id: 'iec', title: '워킹홀리데이', links: [
    { name: 'International Experience Canada(IEC) · IRCC', url: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/work-canada/iec.html',
      about: '워킹홀리데이는 IEC 프로그램으로 신청해요. 한국도 협정 국가라서 나이 같은 조건이 맞으면 지원할 수 있어요.' },
  ] },
  { id: 'spouse', title: '배우자 비자·초청', links: [
    { name: '배우자·파트너 초청 · IRCC', url: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/family-sponsorship/spouse-partner-children.html',
      about: '배우자나 사실혼 파트너가 영주권을 받도록 후원하는 프로그램이에요. 누가 후원할 수 있는지도 같은 페이지에 있어요.' },
    { name: '유학생·근로자 배우자의 취업 허가 · IRCC', url: 'https://ircc.canada.ca/english/helpcentre/answer.asp?qnum=199&top=17',
      about: '유학생이나 근로자로 와 있는 사람의 배우자도 캐나다에서 일하려면 보통 취업 허가(워크퍼밋)를 따로 받아요. 오픈 워크퍼밋을 받을 수 있는 경우는 이 도움말에 나와 있어요.' },
  ] },
  { id: 'before', title: '신청하기 전에', links: [
    { name: '처리 기간 조회 · IRCC', url: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/check-processing-times.html',
      about: '신청 종류별로 지금 처리에 얼마나 걸리는지 IRCC가 직접 보여 줘요.' },
    { name: '등록 이민 컨설턴트 명단 · CICC', url: 'https://register.college-ic.ca/Public-Register-EN/Public-Register-EN/Default.aspx',
      about: '돈을 받고 이민 상담을 하려면 자격이 있어야 해요. 대행을 맡기기 전에 등록된 컨설턴트인지 이 명단에서 확인할 수 있어요.' },
  ] },
];

export const publicImmigrationSchema = {
  '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', '@id': `${PUBLIC_SITE}/immigration`, url: `${PUBLIC_SITE}/immigration`, name: publicImmigrationMeta.heading,
      description: publicImmigrationMeta.description, inLanguage: 'ko', lastReviewed: publicImmigrationMeta.checked, isPartOf: { '@id': `${PUBLIC_SITE}/#website` },
      significantLink: IMMIGRATION_SECTIONS.flatMap(section => section.links.map(link => link.url)) },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: '글링', item: `${PUBLIC_SITE}/` },
      { '@type': 'ListItem', position: 2, name: publicImmigrationMeta.heading, item: `${PUBLIC_SITE}/immigration` },
    ] },
  ],
};

export function generatePrivateMetadata(): Metadata {
  return { title: '글링 | 앱에서 이어가기', robots: 'noindex, nofollow' };
}
